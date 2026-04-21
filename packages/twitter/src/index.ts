import type * as hast from "hast";

import {
  hasElement,
  hasMatch,
  inlineScript,
  prependToHead,
  prerender,
  removeElements,
  type PrerenderOptions,
  type PrerenderSpec,
} from "rehype-prerender";

const DONE_KEY = "twitter-prerender-done";
const MARKER = "dataPrerenderTwitter";

export const DEFAULT_TWITTER_WIDGETS_SRC =
  "https://platform.twitter.com/widgets.js";

/**
 * Default predicate for `matchInjectedSrc`. Matches any URL whose hostname
 * is `platform.twitter.com`, i.e. the webpack chunks and iframes that
 * widgets.js injects at runtime.
 */
export function matchesTwitterHost(src: string): boolean {
  try {
    return new URL(src).hostname === "platform.twitter.com";
  } catch {
    return false;
  }
}

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

export type TwitterSpecOptions = {
  /**
   * The exact `<script src="…">` value identifying the Twitter widgets
   * loader. Used only to detect whether the spec applies. Defaults to
   * `DEFAULT_TWITTER_WIDGETS_SRC`.
   */
  src?: string | undefined;
  /**
   * Predicate applied to scripts and iframe URLs encountered at cleanup /
   * finalize time. widgets.js injects additional webpack chunks and iframes
   * at runtime with URLs that are not known ahead of time; everything this
   * predicate matches is treated as part of the Twitter runtime and removed
   * or extracted. Defaults to `matchesTwitterHost`.
   */
  matchInjectedSrc?: ((src: string) => boolean) | undefined;
  timeout?: number | undefined;
};

/**
 * Create a PrerenderSpec for Twitter embedded tweets.
 */
export function twitterSpec({
  src = DEFAULT_TWITTER_WIDGETS_SRC,
  matchInjectedSrc = matchesTwitterHost,
  timeout,
}: TwitterSpecOptions = {}): PrerenderSpec {
  const isLoaderScript = (el: hast.Element) =>
    el.tagName === "script" && el.properties?.src === src;

  const isInjectedScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    matchInjectedSrc(el.properties.src);

  return {
    when: (tree) =>
      hasMatch(tree, "blockquote.twitter-tweet") &&
      hasElement(tree, isLoaderScript),
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
        if (!matchInjectedSrc(frame.url())) continue;
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
          isLoaderScript(el) ||
          isInjectedScript(el) ||
          (el.tagName === "script" && MARKER in (el.properties ?? {})) ||
          // Drop hidden iframes left behind by widgets.js.
          el.tagName === "iframe",
      );
    },
  };
}

export type PrerenderTwitterOptions = Omit<PrerenderOptions, "specs"> &
  TwitterSpecOptions;

/**
 * Rehype plugin: pre-render Twitter embedded tweets. Thin wrapper around
 * `prerender` with a single `twitterSpec`. Use this when Twitter is the only
 * library to bake; compose `prerender` directly when combining multiple
 * libraries in one pass.
 */
export function prerenderTwitter(options: PrerenderTwitterOptions) {
  return prerender({
    ...options,
    specs: [
      twitterSpec({
        src: options.src,
        matchInjectedSrc: options.matchInjectedSrc,
        timeout: options.timeout,
      }),
    ],
  });
}
