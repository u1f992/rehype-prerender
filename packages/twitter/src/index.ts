import type * as hast from "hast";
import { visit, SKIP } from "unist-util-visit";

import {
  hasMatch,
  hasScript,
  inlineScript,
  prependToHead,
  removeScripts,
  type PrerenderSpec,
} from "rehype-prerender";

const TWITTER_EMBED_HOST = "platform.twitter.com";
const DONE_KEY = "twitter-prerender-done";
const MARKER = "dataPrerenderTwitter";

const isTwitterScript = (el: hast.Element) => {
  const src = el.properties?.src;
  return typeof src === "string" && src.includes("platform.twitter.com/");
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

export const twitterSpec: PrerenderSpec = {
  name: "twitter",
  when: (tree) =>
    hasMatch(tree, "blockquote.twitter-tweet") && hasScript(tree, isTwitterScript),
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
      // widgets.js は非表示の iframe も作る。表示中のものだけ対象にする。
      const isVisible = await page.evaluate(
        // @ts-expect-error runs in browser context
        (el) => getComputedStyle(el).display !== "none",
        iframe,
      );
      if (!isVisible) continue;

      await frame.waitForFunction(
        "document.body && document.body.innerText.length > 0",
        { timeout: 15_000 },
      );

      // iframe 内の全 CSSRules をテキストとして抽出する。
      // React Native for Web はアトミック CSS を CSSOM 経由で注入するため
      // <style> の innerHTML には含まれない。
      const allCss = await frame.evaluate(`
        Array.from(document.styleSheets).map(function (sheet) {
          try {
            return Array.from(sheet.cssRules).map(function (r) { return r.cssText; }).join('\\n');
          } catch (e) { return ''; }
        }).join('\\n')
      `);
      const bodyInnerHtml = await frame.evaluate("document.body.innerHTML");
      // body の computed style からレイアウト関連プロパティを取得
      const bodyComputedStyle = await frame.evaluate(`
        (function () {
          var cs = getComputedStyle(document.body);
          var props = ['margin','padding','background-color','color'];
          return props.map(function (p) {
            return p + ':' + cs.getPropertyValue(p);
          }).join(';');
        })()
      `);

      const iframeStyle = await page.evaluate(
        (el) => el.getAttribute("style") || "",
        iframe,
      );

      await page.evaluate(
        (el, css, inner, ifStyle, bStyle) => {
          const container = el.ownerDocument.createElement("div");
          container.className = "tweet-extracted";
          container.setAttribute("style", ifStyle);
          const style = el.ownerDocument.createElement("style");
          style.textContent = "@scope (.tweet-extracted) { " + css + " }";
          container.appendChild(style);
          const bodyWrapper = el.ownerDocument.createElement("div");
          bodyWrapper.setAttribute("style", bStyle);
          bodyWrapper.innerHTML = inner;
          container.appendChild(bodyWrapper);
          el.parentNode?.replaceChild(container, el);
        },
        iframe,
        allCss,
        bodyInnerHtml,
        iframeStyle,
        bodyComputedStyle,
      );
    }
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isTwitterScript(el) || MARKER in (el.properties ?? {}),
    );
    // widgets.js が残した非表示 iframe を除去
    visit(tree, "element", (el, index, parent) => {
      if (el.tagName === "iframe" && index !== null && parent) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    });
  },
};
