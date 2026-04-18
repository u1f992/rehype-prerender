import type * as hast from "hast";

import {
  hasElement,
  hasMatch,
  inlineScript,
  prependToHead,
  removeElements,
  type PrerenderSpec,
} from "rehype-prerender";

const DONE_KEY = "twitter-prerender-done";
const MARKER = "dataPrerenderTwitter";

// widgets.jsはまず空の`twttr`を代入し、その後で`events`等のプロパティを
// 埋めていく。setter時点でbindしようとしてもeventsがまだ無いので、
// 同じオブジェクト参照を掴んだままevents.bindが生えるのを短間隔で待ち、
// 揃い次第bindする。
const initScript = `
(function () {
  Object.defineProperty(window, "twttr", {
    configurable: true,
    get: function () { return undefined; },
    set: function (value) {
      Object.defineProperty(window, "twttr", {
        value: value,
        writable: true,
        configurable: true,
      });
      let bound = false;
      const attempt = function () {
        if (bound) return;
        if (value && value.events && typeof value.events.bind === "function") {
          value.events.bind("loaded", function () {
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

/**
 * Create a PrerenderSpec for Twitter embedded tweets.
 *
 * @param matchSrc - Predicate applied to each `<script src="…">` value
 *   and iframe URL. Return `true` for Twitter-related URLs so they can
 *   be detected and removed after pre-rendering.
 */
export function twitterSpec({
  matchSrc,
  timeout,
}: {
  matchSrc: (src: string) => boolean;
  timeout?: number | undefined;
}): PrerenderSpec {
  const isTwitterScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    matchSrc(el.properties.src);

  return {
    when: (tree) =>
      hasMatch(tree, "blockquote.twitter-tweet") &&
      hasElement(tree, isTwitterScript),
    prepare: (tree) => {
      prependToHead(tree, inlineScript(initScript, { [MARKER]: "" }));
    },
    waitUntil: (page) =>
      page.waitForFunction(
        `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
        timeout !== undefined ? { timeout } : {},
      ),
    // 本物のwidgets.jsはblockquoteをplatform.twitter.com配下のクロスオリジン
    // iframeに差し替える。contentDocumentは触れないので、puppeteerの
    // ElementHandle.contentFrame()経由でフレームに入り、evaluateで中身を抜く。
    finalize: async (page) => {
      const iframes = await page.$$("iframe");
      for (const iframe of iframes) {
        const frame = await iframe.contentFrame();
        if (!frame) continue;
        if (!matchSrc(frame.url())) continue;
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
              return Array.from(sheet.cssRules).map(function (r) { return r.cssText; }).join("\\n");
            } catch (e) { return ""; }
          }).join("\\n")
        `);
        const bodyInnerHtml = await frame.evaluate("document.body.innerHTML");
        // body の computed style からレイアウト関連プロパティを取得
        const bodyComputedStyle = await frame.evaluate(`
          (function () {
            const cs = getComputedStyle(document.body);
            const props = ["margin", "padding", "background-color", "color"];
            return props.map(function (p) {
              return p + ":" + cs.getPropertyValue(p);
            }).join(";");
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
      removeElements(
        tree,
        (el) =>
          isTwitterScript(el) ||
          (el.tagName === "script" && MARKER in (el.properties ?? {})) ||
          // widgets.js が残した非表示 iframe を除去
          el.tagName === "iframe",
      );
    },
  };
}
