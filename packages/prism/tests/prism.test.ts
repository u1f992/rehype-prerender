import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import rehype from "rehype";

import { prerender } from "rehype-prerender";
import {
  assertVisualMatch,
  PRERENDER_TEST_OPTS,
  screenshotHtml,
  testDirs,
} from "test-helpers";

import { prismSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const PRISM_CDN = "cdnjs.cloudflare.com/ajax/libs/prism";
const spec = prismSpec({ matchSrc: (src) => src.includes(PRISM_CDN) });

test("Prism: autoloaderが言語を取得しトークン化、Prism参照が除去される", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
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

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "autoloader.html"), output);

  const fixtureShot = await screenshotHtml(html, PRERENDER_TEST_OPTS);
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "autoloader-diff.png"),
  });
});

test("Prism file-highlight + autoloader: autoloaderで言語を取得しdata-srcの外部ファイルをトークン化", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "file-highlight-autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
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

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "file-highlight-autoloader.html"),
    output,
  );

  const fixtureShot = await screenshotHtml(html, {
    ...PRERENDER_TEST_OPTS,
    baseDir: FIXTURES_DIR,
  });
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(
      RESULTS_DIR,
      "file-highlight-autoloader-diff.png",
    ),
  });
});

test("Prism file-highlight: data-srcで外部ファイルを読み込みトークン化される", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "file-highlight.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
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

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "file-highlight.html"), output);

  const fixtureShot = await screenshotHtml(html, {
    ...PRERENDER_TEST_OPTS,
    baseDir: FIXTURES_DIR,
  });
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "file-highlight-diff.png"),
  });
});

test("Prism line-numbers: 行番号が生成されトークン化される", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "line-numbers.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    /<span[^>]*class="token/.test(output),
    `Prismトークンが見つからない: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("line-numbers-rows"),
    "行番号の要素が生成されていない",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prismスクリプト参照が残っている",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "line-numbers.html"), output);

  const fixtureShot = await screenshotHtml(html, PRERENDER_TEST_OPTS);
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "line-numbers-diff.png"),
  });
});
