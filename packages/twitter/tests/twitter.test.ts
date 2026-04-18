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

import { twitterSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const spec = twitterSpec({
  matchSrc: (src) => src.includes("platform.twitter.com/"),
});

test("Twitter: bakes jack/status/20 via the real widgets.js and removes script references", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "twitter.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process({ contents: html, path: htmlPath });
  const output = String(result);

  assert.ok(
    output.includes('class="tweet-extracted"'),
    `Could not find the div expanded by finalize: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("just setting up my twttr"),
    "Tweet body was not hoisted into the outer DOM",
  );
  assert.ok(
    !/<blockquote[^>]*class="[^"]*twitter-tweet/.test(output),
    "Original blockquote is still present",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*platform\.twitter\.com\/widgets\.js/i.test(output),
    "widgets.js reference is still present",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "twitter.html"), output);

  await assertVisualMatchRender(htmlPath, output, {
    ...PRERENDER_TEST_OPTS,
    fixturesDir: FIXTURES_DIR,
    diffOutputPath: path.join(RESULTS_DIR, "twitter-diff.png"),
  });
});
