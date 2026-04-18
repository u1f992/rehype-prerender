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

// widgets.js first assigns an empty `twttr` and then fills in properties
// like `events` afterwards. events is not yet present at setter time, so
// we hold on to the same object reference and poll at short intervals
// until events.bind appears, then bind.
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
    // The real widgets.js replaces the blockquote with a cross-origin iframe
    // under platform.twitter.com. contentDocument is off-limits, so we enter
    // the frame via puppeteer's ElementHandle.contentFrame() and extract the
    // contents with evaluate.
    finalize: async (page) => {
      const iframes = await page.$$("iframe");
      for (const iframe of iframes) {
        const frame = await iframe.contentFrame();
        if (!frame) continue;
        if (!matchSrc(frame.url())) continue;
        // widgets.js also creates hidden iframes; only target visible ones.
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

        // Extract all CSSRules inside the iframe as text. React Native for
        // Web injects atomic CSS via the CSSOM, so it is not present in the
        // innerHTML of any <style>.
        const allCss = await frame.evaluate(`
          Array.from(document.styleSheets).map(function (sheet) {
            try {
              return Array.from(sheet.cssRules).map(function (r) { return r.cssText; }).join("\\n");
            } catch (e) { return ""; }
          }).join("\\n")
        `);
        const bodyInnerHtml = await frame.evaluate("document.body.innerHTML");
        // Pull layout-related properties from the body's computed style.
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
          // Drop hidden iframes left behind by widgets.js.
          el.tagName === "iframe",
      );
    },
  };
}
