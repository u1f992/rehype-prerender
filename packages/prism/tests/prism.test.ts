import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import rehype from "rehype";

import { prerender } from "rehype-prerender";
import {
  assertVisualMatchRender,
  PRERENDER_TEST_OPTS,
  testDirs,
} from "test-helpers";

import { prismSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const PRISM_CDN = "cdnjs.cloudflare.com/ajax/libs/prism";
const spec = prismSpec({ matchSrc: (src) => src.includes(PRISM_CDN) });

test("Prism: autoloader fetches languages and tokenizes, Prism references are removed", async () => {
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
    `No Prism tokens found: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("print_endline") || output.includes("print"),
    "Original code text has been lost",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prism script reference is still present",
  );
  assert.ok(
    !output.includes("Prism.highlightAll"),
    "Injected runner script is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "autoloader.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "autoloader-diff.png"),
  });
});

test("Prism file-highlight + autoloader: autoloader fetches languages and the data-src external file is tokenized", async () => {
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
    `No Prism tokens found: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("hello from file"),
    "External file code text is missing",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prism script reference is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "file-highlight-autoloader.html"),
    output,
  );

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(
      RESULTS_DIR,
      "file-highlight-autoloader-diff.png",
    ),
  });
});

test("Prism file-highlight: data-src loads the external file and tokenizes it", async () => {
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
    `No Prism tokens found: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("hello from file"),
    "External file code text is missing",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prism script reference is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "file-highlight.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "file-highlight-diff.png"),
  });
});

test("Prism line-numbers: line numbers are generated and tokenized", async () => {
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
    `No Prism tokens found: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("line-numbers-rows"),
    "Line-number elements were not generated",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/prism/i.test(
      output,
    ),
    "Prism script reference is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "line-numbers.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "line-numbers-diff.png"),
  });
});
