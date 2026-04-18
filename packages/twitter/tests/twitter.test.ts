import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import url from "node:url";

import rehype from "rehype";

import { prerender } from "rehype-prerender";
import {
  assertVisualMatch,
  BROWSER_CACHE_DIR,
  screenshotHtml,
} from "test-helpers";

import { twitterSpec } from "../src/index.ts";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "fixtures");
const RESULTS_DIR = path.join(__dirname, "results");

test("Twitter: 本物のwidgets.jsでjack/status/20を焼き、script参照が消える", async () => {
  const htmlPath = path.join(FIXTURES_DIR, "twitter.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  const result = await rehype()
    .use(prerender, {
      specs: [twitterSpec],
      browserCacheDir: BROWSER_CACHE_DIR,
      launchArgs: ["--no-sandbox"],
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

  const ssOpts = { browserCacheDir: BROWSER_CACHE_DIR, launchArgs: ["--no-sandbox"] as const };
  const fixtureShot = await screenshotHtml(html, ssOpts);
  const resultShot = await screenshotHtml(output, ssOpts);
  assertVisualMatch(resultShot, fixtureShot, {
    diffOutputPath: path.join(RESULTS_DIR, "twitter-diff.png"),
  });
});
