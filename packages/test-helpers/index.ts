import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import url from "node:url";

import mime from "mime";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import puppeteer from "puppeteer-core";

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

type BrowserOptions = {
  browserCacheDir: string;
  launchArgs?: readonly string[];
};

async function launch(options: BrowserOptions) {
  const executablePath = await ensureBrowserExecutable({
    browserCacheDir: options.browserCacheDir,
    chromeBuildId: DEFAULT_CHROME_BUILD_ID,
  });
  return puppeteer.launch({
    executablePath,
    args: [...(options.launchArgs ?? [])],
  });
}

/**
 * Screenshot HTML that is expected to be self-contained — i.e. the output of
 * rehype-prerender after all external libraries have been inlined. Uses
 * `page.setContent` with no asset serving, deliberately: if rendering needs
 * interception or a local server to match the live fixture, the plugin has
 * failed to eliminate a runtime dependency and the test should fail.
 */
export async function screenshotStaticHtml(
  html: string,
  options: BrowserOptions,
): Promise<Buffer> {
  const browser = await launch(options);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
    return (await page.screenshot()) as Buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Live-render a fixture HTML file by serving `fixturesDir` over a throwaway
 * local HTTP server on an ephemeral port. External URLs (CDN etc.) pass
 * through to the real network. For use on the "before" side of a visual
 * regression test, where the fixture legitimately depends on external
 * libraries or sibling files.
 */
export async function screenshotFixture(
  fixturePath: string,
  options: BrowserOptions & { fixturesDir: string },
): Promise<Buffer> {
  const fixturesDir = path.resolve(options.fixturesDir);
  const server = http.createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    const pathname = decodeURIComponent(new URL(reqUrl, "http://x").pathname);
    const relative = pathname.replace(/^\//, "");
    const resolved = path.resolve(fixturesDir, relative);
    const rel = path.relative(fixturesDir, resolved);
    if (
      !rel ||
      rel.startsWith("..") ||
      path.isAbsolute(rel) ||
      !fs.existsSync(resolved) ||
      !fs.statSync(resolved).isFile()
    ) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      mime.getType(resolved) ?? "text/plain; charset=utf-8",
    );
    fs.createReadStream(resolved).pipe(res);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind local fixture server");
  }
  const port = address.port;

  const fixtureRel = path.relative(fixturesDir, path.resolve(fixturePath));
  if (fixtureRel.startsWith("..") || path.isAbsolute(fixtureRel)) {
    server.close();
    throw new Error(`fixturePath must live inside fixturesDir: ${fixturePath}`);
  }
  const fixtureUrl = `http://127.0.0.1:${port}/${fixtureRel.split(path.sep).join("/")}`;

  const browser = await launch(options);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    await page.goto(fixtureUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 60_000 });
    return (await page.screenshot()) as Buffer;
  } finally {
    await browser.close();
    server.close();
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
