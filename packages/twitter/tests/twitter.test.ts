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

import { twitterSpec } from "../src/index.ts";

const [FIXTURES_DIR, RESULTS_DIR] = testDirs(import.meta.url);

const spec = twitterSpec({
  matchSrc: (src) => src.includes("platform.twitter.com/"),
});

test("Twitter: 本物のwidgets.jsでjack/status/20を焼き、script参照が消える", async () => {
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
    `finalizeが展開したdivが見つからない: ${output.slice(0, 400)}`,
  );
  assert.ok(
    output.includes("just setting up my twttr"),
    "ツイート本文が外側DOMに引き上げられていない",
  );
  assert.ok(
    !/<blockquote[^>]*class="[^"]*twitter-tweet/.test(output),
    "元のblockquoteが残っている",
  );
  assert.ok(
    !/<script[^>]+src="[^"]*platform\.twitter\.com\/widgets\.js/i.test(output),
    "widgets.js参照が残っている",
  );

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "twitter.html"), output);

  const fixtureShot = await screenshotHtml(html, PRERENDER_TEST_OPTS);
  const resultShot = await screenshotHtml(output, PRERENDER_TEST_OPTS);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "twitter-diff.png"),
  });
});
