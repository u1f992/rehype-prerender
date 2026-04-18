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

import { mathjaxSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const MATHJAX_CDN = "cdnjs.cloudflare.com/ajax/libs/mathjax";
const spec = mathjaxSpec({ matchSrc: (src) => src.includes(MATHJAX_CDN) });

test("MathJax: 数式がCHTML化され、<script>参照が除去される", async () => {
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
  // 実行に寄与する<script src=...>のみを検証する。MathJaxは@font-faceの
  // srcとしてCDNのフォントURLを残すが、それは表示に必要なので除去しない。
  assert.ok(
    !/<script[^>]+src="[^"]*cdnjs\.cloudflare\.com\/ajax\/libs\/mathjax/i.test(
      output,
    ),
    "実行を再誘発するMathJax <script>参照が残っている",
  );
  assert.ok(
    !output.includes("Symbol.for"),
    "注入したdone-flagスクリプトが残っている",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "mathjax.html"), output);

  const fixtureShot = await screenshotHtml(html, PRERENDER_TEST_OPTS);
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "mathjax-diff.png"),
  });
});
