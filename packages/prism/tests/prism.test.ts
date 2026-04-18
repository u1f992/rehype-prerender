import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import url from "node:url";

import rehype from "rehype";

import { prerender } from "rehype-prerender";
import {
  assertVisualMatch,
  BROWSER_CACHE_DIR,
  screenshotHtml,
} from "test-helpers";

import { fileHighlightSpec, prismSpec } from "../src/index.ts";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const RESULTS_DIR = path.join(__dirname, "results");

const ssOpts = {
  browserCacheDir: BROWSER_CACHE_DIR,
  launchArgs: ["--no-sandbox"] as const,
};

const PRISM_RESULTS_DIR = path.join(RESULTS_DIR, "prism");

const PRISM_FIXTURES_DIR = path.join(FIXTURES_DIR, "prism");

test("Prism: autoloaderが言語を取得しトークン化、Prism参照が除去される", async (t) => {
  const htmlPath = path.join(PRISM_FIXTURES_DIR, "autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [prismSpec],
      browserCacheDir: BROWSER_CACHE_DIR,
      launchArgs: ["--no-sandbox"],
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    /<span[^>]*class="token/.test(output),
    `Prismトークンが見つからない: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("print_endline") || output.includes("print"),
    "元のコードテキストが失われている",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prismスクリプト参照が残っている",
  );
  assert.ok(
    !output.includes("Prism.highlightAll"),
    "注入したrunnerスクリプトが残っている",
  );

  fs.mkdirSync(PRISM_RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PRISM_RESULTS_DIR, "autoloader.html"), output);

  const fixtureShot = await screenshotHtml(html, ssOpts);
  const resultShot = await screenshotHtml(output, ssOpts);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(PRISM_RESULTS_DIR, "autoloader-diff.png"),
  });
});

test("Prism file-highlight + autoloader: autoloaderで言語を取得しdata-srcの外部ファイルをトークン化", async () => {
  const htmlPath = path.join(PRISM_FIXTURES_DIR, "file-highlight-autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [fileHighlightSpec],
      browserCacheDir: BROWSER_CACHE_DIR,
      launchArgs: ["--no-sandbox"],
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    /<span[^>]*class="token/.test(output),
    `Prismトークンが見つからない: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("hello from file"),
    "外部ファイルのコードテキストが含まれていない",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prismスクリプト参照が残っている",
  );

  fs.mkdirSync(PRISM_RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PRISM_RESULTS_DIR, "file-highlight-autoloader.html"),
    output,
  );

  const fixtureShot = await screenshotHtml(html, {
    ...ssOpts,
    baseDir: PRISM_FIXTURES_DIR,
  });
  const resultShot = await screenshotHtml(output, ssOpts);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(PRISM_RESULTS_DIR, "file-highlight-autoloader-diff.png"),
  });
});

test("Prism file-highlight: data-srcで外部ファイルを読み込みトークン化される", async () => {
  const htmlPath = path.join(PRISM_FIXTURES_DIR, "file-highlight.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [fileHighlightSpec],
      browserCacheDir: BROWSER_CACHE_DIR,
      launchArgs: ["--no-sandbox"],
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    /<span[^>]*class="token/.test(output),
    `Prismトークンが見つからない: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("hello from file"),
    "外部ファイルのコードテキストが含まれていない",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prismスクリプト参照が残っている",
  );

  fs.mkdirSync(PRISM_RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PRISM_RESULTS_DIR, "file-highlight.html"),
    output,
  );

  const fixtureShot = await screenshotHtml(html, {
    ...ssOpts,
    baseDir: PRISM_FIXTURES_DIR,
  });
  const resultShot = await screenshotHtml(output, ssOpts);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(PRISM_RESULTS_DIR, "file-highlight-diff.png"),
  });
});
