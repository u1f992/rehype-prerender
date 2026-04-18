// @ts-check
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type * as hast from "hast";
import rehype from "rehype";

import {
  hasMatch,
  inlineScript,
  prependToHead,
  prerender,
  removeScripts,
  type PrerenderSpec,
} from "../src/index.ts";
import {
  assertVisualMatch,
  BROWSER_CACHE_DIR,
  FIXTURES_DIR,
  RESULTS_DIR,
  screenshotHtml,
} from "./helpers.ts";

const ssOpts = {
  browserCacheDir: BROWSER_CACHE_DIR,
  launchArgs: ["--no-sandbox"] as const,
};

const PRISM_RESULTS_DIR = path.join(RESULTS_DIR, "prism");

const PRISM_FIXTURES_DIR = path.join(FIXTURES_DIR, "prism");

const PRISM_CDN = "cdnjs.cloudflare.com/ajax/libs/prism";
const MARKER = "dataPrerenderPrism";

const isPrismScript = (el: hast.Element) => {
  const src = el.properties?.src;
  return typeof src === "string" && src.includes(PRISM_CDN);
};

const runnerScript = `
window.Prism = window.Prism || {};
window.Prism.manual = true;

window.addEventListener('load', function () {
  if (window.Prism && typeof Prism.highlightAll === 'function') {
    Prism.highlightAll(false);
  }
});
`;

const prismSpec: PrerenderSpec = {
  name: "prism",
  when: (tree) =>
    hasMatch(tree, 'pre > code[class*="language-"]') ||
    hasMatch(tree, 'pre[class*="language-"] > code'),
  prepare: (tree) => {
    prependToHead(tree, inlineScript(runnerScript, { [MARKER]: "" }));
  },
  waitUntil: {
    type: "networkIdle",
    idleTime: 500,
    timeout: 30_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isPrismScript(el) || MARKER in (el.properties ?? {}),
    );
  },
};

const fileHighlightRunnerScript = `
window.addEventListener('load', function () {
  if (window.Prism && typeof Prism.highlightAll === 'function') {
    Prism.highlightAll(false);
  }
});
`;

const fileHighlightSpec: PrerenderSpec = {
  name: "prism-file-highlight",
  when: (tree) => hasMatch(tree, "pre[data-src]"),
  prepare: (tree) => {
    prependToHead(
      tree,
      inlineScript(fileHighlightRunnerScript, { [MARKER]: "" }),
    );
  },
  waitUntil: {
    type: "function",
    expression: `document.querySelectorAll('pre[data-src]').length > 0
      && document.querySelectorAll('pre[data-src]:not([data-src-status="loaded"])').length === 0`,
    timeout: 30_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isPrismScript(el) || MARKER in (el.properties ?? {}),
    );
  },
};

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
