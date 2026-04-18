import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type * as hast from "hast";
import rehype from "rehype";

import {
  hasScript,
  inlineScript,
  prependToHead,
  prerender,
  removeScripts,
  type PrerenderSpec,
} from "../src/index.ts";
import { BROWSER_CACHE_DIR, FIXTURES_DIR, RESULTS_DIR } from "./helpers.ts";

/**
 * Recognize the MathJax CDN reference VFM emits, as well as any extension
 * scripts MathJax itself appended to the DOM during execution.
 */
const isMathJax = (el: hast.Element) => {
  const src = el.properties?.src;
  return (
    typeof src === "string" &&
    src.includes("cdnjs.cloudflare.com/ajax/libs/mathjax")
  );
};

const DONE_KEY = "mathjax-prerender-done";
const MARKER = "dataPrerenderMathjax";

const authorInit = `
(function () {
  var existing = window.MathJax || {};
  var prev = typeof existing.AuthorInit === "function" ? existing.AuthorInit : null;
  existing.AuthorInit = function () {
    if (prev) prev.apply(this, arguments);
    MathJax.Hub.Register.StartupHook("End", function () {
      MathJax.Hub.Queue(function () {
        window[Symbol.for(${JSON.stringify(DONE_KEY)})] = true;
      });
    });
  };
  window.MathJax = existing;
})();
`;

const mathjaxSpec: PrerenderSpec = {
  name: "mathjax",
  when: (tree) => hasScript(tree, isMathJax),
  prepare: (tree) => {
    prependToHead(tree, inlineScript(authorInit, { [MARKER]: "" }));
  },
  waitUntil: {
    type: "function",
    expression: `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
    timeout: 60_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isMathJax(el) || MARKER in (el.properties ?? {}),
    );
  },
};

test("MathJax: 数式がCHTML化され、<script>参照が除去される", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "mathjax.html");
  const html = fs.readFileSync(htmlPath, "utf-8");
  const result = await rehype()
    .use(prerender, {
      specs: [mathjaxSpec],
      browserCacheDir: BROWSER_CACHE_DIR,
      launchArgs: ["--no-sandbox"],
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
});
