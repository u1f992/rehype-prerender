import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type * as hast from "hast";
import rehype from "rehype";

import {
  hasMatch,
  hasScript,
  inlineScript,
  prependToHead,
  prerender,
  removeScripts,
  type PrerenderSpec,
} from "../src/index.ts";
import { BROWSER_CACHE_DIR, FIXTURES_DIR, RESULTS_DIR } from "./helpers.ts";

const TWITTER_EMBED_HOST = "platform.twitter.com";
const DONE_KEY = "twitter-prerender-done";
const MARKER = "dataPrerenderTwitter";

const isWidgetsJs = (el: hast.Element) => {
  const src = el.properties?.src;
  return (
    typeof src === "string" &&
    src.includes("platform.twitter.com/widgets.js")
  );
};

// widgets.jsはまず空の`twttr`を代入し、その後で`events`等のプロパティを
// 埋めていく。setter時点でbindしようとしてもeventsがまだ無いので、
// 同じオブジェクト参照を掴んだままevents.bindが生えるのを短間隔で待ち、
// 揃い次第bindする。
const doneScript = `
(function () {
  Object.defineProperty(window, 'twttr', {
    configurable: true,
    get: function () { return undefined; },
    set: function (value) {
      Object.defineProperty(window, 'twttr', {
        value: value,
        writable: true,
        configurable: true,
      });
      var bound = false;
      var attempt = function () {
        if (bound) return;
        if (value && value.events && typeof value.events.bind === 'function') {
          value.events.bind('loaded', function () {
            window[Symbol.for(${JSON.stringify(DONE_KEY)})] = true;
          });
          bound = true;
          return;
        }
        setTimeout(attempt, 5);
      };
      attempt();
    },
  });
})();
`;

const twitterSpec: PrerenderSpec = {
  name: "twitter",
  when: (tree) =>
    hasMatch(tree, "blockquote.twitter-tweet") && hasScript(tree, isWidgetsJs),
  prepare: (tree) => {
    prependToHead(tree, inlineScript(doneScript, { [MARKER]: "" }));
  },
  waitUntil: {
    type: "function",
    expression: `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
    timeout: 30_000,
  },
  // 本物のwidgets.jsはblockquoteをplatform.twitter.com配下のクロスオリジン
  // iframeに差し替える。contentDocumentは触れないので、puppeteerの
  // ElementHandle.contentFrame()経由でフレームに入り、evaluateで中身を抜く。
  finalize: async (page) => {
    const iframes = await page.$$("iframe");
    for (const iframe of iframes) {
      const frame = await iframe.contentFrame();
      if (!frame) continue;
      if (!frame.url().includes(TWITTER_EMBED_HOST)) continue;

      await frame.waitForFunction(
        "document.body && document.body.innerText.length > 0",
        { timeout: 15_000 },
      );
      const innerHtml = await frame.evaluate("document.body.innerHTML");

      await page.evaluate(
        (el, html) => {
          const container = el.ownerDocument.createElement("div");
          container.className = "tweet-extracted";
          container.innerHTML = html;
          el.parentNode?.replaceChild(container, el);
        },
        iframe,
        innerHtml,
      );
    }
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isWidgetsJs(el) || MARKER in (el.properties ?? {}),
    );
  },
};

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
});
