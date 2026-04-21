import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import url from "node:url";

import rehype from "rehype";

import { prerender } from "rehype-prerender";
import {
  assertVisualMatchRender,
  PRERENDER_TEST_OPTS,
  testDirs,
} from "test-helpers";

import { mathjaxSpec, prerenderMathJax } from "#self";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const MATHJAX_CDN_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.9/MathJax.js";
const spec = mathjaxSpec({ src: MATHJAX_CDN_SRC });

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

test("MathJax: prerenderMathJax wrapper produces the same baked output as the spec form", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "mathjax.html");
  const html = fs.readFileSync(htmlPath, "utf-8");
  const result = await rehype()
    .use(prerenderMathJax, {
      src: MATHJAX_CDN_SRC,
      ...PRERENDER_TEST_OPTS,
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    output.includes("MJXc-") || output.includes("mjx-chtml"),
    `Expected MathJax CHTML markup. Got: ${output.slice(0, 400)}...`,
  );
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
  fs.writeFileSync(path.join(RESULTS_DIR, "mathjax.wrapper.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "mathjax.wrapper-diff.png"),
  });
});

test("MathJax: locally bundled mathjax under fixtures/ is consumed via relative <script src>", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "mathjax.local.html");
  const localMathjaxDir = path.join(FIXTURES_DIR, "mathjax");
  const sourceMathjaxDir = path.dirname(
    url.fileURLToPath(import.meta.resolve("mathjax/package.json")),
  );
  fs.cpSync(sourceMathjaxDir, localMathjaxDir, { recursive: true });
  try {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const localSpec = mathjaxSpec({
      src: "mathjax/MathJax.js",
    });
    const result = await rehype()
      .use(prerender, {
        specs: [localSpec],
        ...PRERENDER_TEST_OPTS,
      })
      .process({ contents: html, path: htmlPath });
    const output = String(result);

    assert.ok(
      output.includes("MJXc-") || output.includes("mjx-chtml"),
      `Expected MathJax CHTML markup. Got: ${output.slice(0, 400)}...`,
    );
    assert.ok(
      !/<script[^>]+src="[^"]*mathjax\/MathJax\.js/i.test(output),
      "Local MathJax <script> reference is still present",
    );
    assert.ok(
      !output.includes("Symbol.for"),
      "Injected done-flag script is still present",
    );

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, "mathjax.local.html"), output);

    await assertVisualMatchRender(htmlPath, output, {
      ...PRERENDER_TEST_OPTS,
      fixturesDir: FIXTURES_DIR,
      diffOutputPath: path.join(RESULTS_DIR, "mathjax.local-diff.png"),
    });
  } finally {
    fs.rmSync(localMathjaxDir, { recursive: true, force: true });
  }
});
