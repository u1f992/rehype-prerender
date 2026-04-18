import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import puppeteer, { type Page } from "puppeteer-core";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BROWSER_CACHE_DIR = path.resolve(__dirname, "../../.cache");

export const PRERENDER_TEST_OPTS = {
  browserCacheDir: BROWSER_CACHE_DIR,
  launchArgs: ["--no-sandbox"],
} as const;

export function testDirs(importMetaUrl: string) {
  const dir = path.dirname(url.fileURLToPath(importMetaUrl));
  return [path.join(dir, "fixtures"), path.join(dir, "results")] as const;
}

import {
  DEFAULT_CHROME_BUILD_ID,
  ensureBrowserExecutable,
} from "rehype-prerender";

const BASE_URL = "https://screenshot.invalid/";
const ENTRY_URL = BASE_URL + "__entry__.html";

const CONTENT_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
};

/**
 * Render HTML in headless Chrome and return a viewport screenshot as PNG.
 *
 * If `baseDir` is given, relative-URL requests under the fake origin are
 * resolved from that directory (same idea as the plugin's request
 * interception). External URLs (CDN etc.) pass through normally.
 */
export async function screenshotHtml(
  html: string,
  options: {
    browserCacheDir: string;
    launchArgs?: readonly string[];
    baseDir?: string;
    beforeScreenshot?: (page: Page) => Promise<void>;
  },
): Promise<Buffer> {
  const executablePath = await ensureBrowserExecutable({
    browserCacheDir: options.browserCacheDir,
    chromeBuildId: DEFAULT_CHROME_BUILD_ID,
  });
  const browser = await puppeteer.launch({
    executablePath,
    args: [...(options.launchArgs ?? [])],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const reqUrl = req.url();
      if (reqUrl === ENTRY_URL) {
        req
          .respond({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: "<!doctype html><html><head></head><body></body></html>",
          })
          .catch(() => {});
        return;
      }
      if (reqUrl.startsWith(BASE_URL) && options.baseDir) {
        const pathname = new URL(reqUrl).pathname;
        const decoded = decodeURIComponent(pathname.replace(/^\//, ""));
        if (decoded) {
          const resolved = path.resolve(options.baseDir, decoded);
          const rel = path.relative(options.baseDir, resolved);
          if (
            rel &&
            !rel.startsWith("..") &&
            !path.isAbsolute(rel) &&
            fs.existsSync(resolved) &&
            fs.statSync(resolved).isFile()
          ) {
            const ext = path.extname(resolved).toLowerCase();
            req
              .respond({
                status: 200,
                contentType: CONTENT_TYPES[ext] ?? "text/plain",
                body: fs.readFileSync(resolved),
              })
              .catch(() => {});
            return;
          }
        }
        req.respond({ status: 404, body: "" }).catch(() => {});
        return;
      }
      req.continue().catch(() => {});
    });

    await page.goto(ENTRY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });

    if (options.beforeScreenshot) {
      await options.beforeScreenshot(page);
    }

    return (await page.screenshot()) as Buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Assert that two PNG screenshots are visually equivalent.
 * Writes a diff image to `diffOutputPath` on failure.
 */
export function assertVisualMatch(
  actual: Buffer,
  expected: Buffer,
  options?: { maxDiffPercent?: number; diffOutputPath?: string },
) {
  const actualPng = PNG.sync.read(actual);
  const expectedPng = PNG.sync.read(expected);

  const width = actualPng.width;
  assert.equal(width, expectedPng.width, "Screenshot widths differ");

  const height = Math.max(actualPng.height, expectedPng.height);

  // Pad shorter image with white to match heights
  const padToHeight = (png: PNG, targetHeight: number): Uint8Array => {
    if (png.height >= targetHeight) return png.data;
    const padded = new Uint8Array(png.width * targetHeight * 4);
    padded.fill(255);
    padded.set(png.data);
    return padded;
  };

  const actualData = padToHeight(actualPng, height);
  const expectedData = padToHeight(expectedPng, height);
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(
    actualData,
    expectedData,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );

  const totalPixels = width * height;
  const diffPercent = numDiffPixels / totalPixels;
  const maxDiff = options?.maxDiffPercent ?? 0.01;

  if (diffPercent > maxDiff) {
    if (options?.diffOutputPath) {
      fs.mkdirSync(path.dirname(options.diffOutputPath), { recursive: true });
      fs.writeFileSync(options.diffOutputPath, PNG.sync.write(diff));
    }
    assert.fail(
      `Visual mismatch: ${(diffPercent * 100).toFixed(2)}% pixels differ ` +
        `(${numDiffPixels}/${totalPixels})`,
    );
  }
}
