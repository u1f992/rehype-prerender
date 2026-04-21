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

import { prerenderPrism, prismSpec } from "#self";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const PRISM_CDN = "https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0";
const PRISM_CORE = `${PRISM_CDN}/components/prism-core.min.js`;
const PRISM_AUTOLOADER = `${PRISM_CDN}/plugins/autoloader/prism-autoloader.min.js`;
const PRISM_FILE_HIGHLIGHT = `${PRISM_CDN}/plugins/file-highlight/prism-file-highlight.min.js`;
const PRISM_LINE_NUMBERS = `${PRISM_CDN}/plugins/line-numbers/prism-line-numbers.min.js`;
const PRISM_BUNDLE = `${PRISM_CDN}/prism.min.js`;

test("Prism: autoloader fetches languages and tokenizes, Prism references are removed", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [prismSpec({ srcs: [PRISM_CORE, PRISM_AUTOLOADER] })],
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

test("Prism: idleTime is forwarded to page.waitForNetworkIdle and an overly small value causes a timeout", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  // idleTime greater than timeout forces waitForNetworkIdle to time out before
  // any idle window can be observed. If idleTime were ignored (and defaulted
  // to 500), the waiter would finish well inside the 1s timeout and no error
  // would surface. The thrown TimeoutError therefore proves the value reached
  // page.waitForNetworkIdle.
  await assert.rejects(
    () =>
      rehype()
        .use(prerender, {
          specs: [
            prismSpec({
              srcs: [PRISM_CORE, PRISM_AUTOLOADER],
              idleTime: 5_000,
              timeout: 1_000,
            }),
          ],
          ...PRERENDER_TEST_OPTS,
        })
        .process({ contents: html, path: htmlPath }),
    /Timeout/i,
  );
});

test("Prism: prerenderPrism wrapper produces the same baked output as the spec form", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerenderPrism, {
      srcs: [PRISM_CORE, PRISM_AUTOLOADER],
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
  fs.writeFileSync(path.join(RESULTS_DIR, "autoloader.wrapper.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "autoloader.wrapper-diff.png"),
  });
});

test("Prism file-highlight + autoloader: autoloader fetches languages and the data-src external file is tokenized", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "file-highlight-autoloader.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [
        prismSpec({
          srcs: [PRISM_CORE, PRISM_AUTOLOADER, PRISM_FILE_HIGHLIGHT],
        }),
      ],
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
      specs: [prismSpec({ srcs: [PRISM_BUNDLE, PRISM_FILE_HIGHLIGHT] })],
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
      specs: [
        prismSpec({
          srcs: [PRISM_CORE, PRISM_AUTOLOADER, PRISM_LINE_NUMBERS],
        }),
      ],
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

test("Prism: locally bundled prismjs under fixtures/ is consumed via relative <script src>", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "autoloader.local.html");
  const localPrismDir = path.join(FIXTURES_DIR, "prism");
  const sourcePrismDir = path.dirname(
    url.fileURLToPath(import.meta.resolve("prismjs/package.json")),
  );
  fs.cpSync(sourcePrismDir, localPrismDir, { recursive: true });
  try {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const localSpec = prismSpec({
      srcs: [
        "prism/components/prism-core.min.js",
        "prism/plugins/autoloader/prism-autoloader.min.js",
      ],
    });
    const result = await rehype()
      .use(prerender, {
        specs: [localSpec],
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
      !/<script[^>]+src="[^"]*prism\//i.test(output),
      "Local Prism script reference is still present",
    );
    assert.ok(
      !output.includes("Prism.highlightAll"),
      "Injected runner script is still present",
    );

    fs.mkdirSync(RESULTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RESULTS_DIR, "autoloader.local.html"), output);

    await assertVisualMatchRender(htmlPath, output, {
      ...PRERENDER_TEST_OPTS,
      fixturesDir: FIXTURES_DIR,
      diffOutputPath: path.join(RESULTS_DIR, "autoloader.local-diff.png"),
    });
  } finally {
    fs.rmSync(localPrismDir, { recursive: true, force: true });
  }
});
