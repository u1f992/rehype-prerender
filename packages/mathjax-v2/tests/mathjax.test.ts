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

import { mathjaxSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const MATHJAX_CDN = "cdnjs.cloudflare.com/ajax/libs/mathjax";
const spec = mathjaxSpec({ matchSrc: (src) => src.includes(MATHJAX_CDN) });

test("MathJax: formulas are converted to CHTML and <script> references are removed", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "mathjax.html");
  const html = fs.readFileSync(htmlPath, "utf-8");
  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    output.includes("MJXc-") || output.includes("mjx-chtml"),
    `Expected MathJax CHTML markup. Got: ${output.slice(0, 400)}...`,
  );
  // Only check for <script src=...> that would re-trigger execution. MathJax
  // leaves CDN font URLs as @font-face srcs, but those are needed for display
  // and should not be removed.
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax/i.test(
      output,
    ),
    "MathJax <script> reference that would re-trigger execution is still present",
  );
  assert.ok(
    !output.includes("Symbol.for"),
    "Injected done-flag script is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "mathjax.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "mathjax-diff.png"),
  });
});
