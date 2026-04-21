import type * as hast from "hast";

import {
  hasElement,
  inlineScript,
  prependToHead,
  prerender,
  removeElements,
  type PrerenderOptions,
  type PrerenderSpec,
} from "rehype-prerender";

const DONE_KEY = "mathjax-prerender-done";
const MARKER = "dataPrerenderMathjax";

const initScript = `
(function () {
  const existing = window.MathJax || {};
  const prev = typeof existing.AuthorInit === "function" ? existing.AuthorInit : null;
  existing.AuthorInit = function () {
    if (prev) prev.apply(this, arguments);
    MathJax.Hub.Register.StartupHook("End", function () {
      MathJax.Hub.Queue(function () {
        window[Symbol.for(${JSON.stringify(DONE_KEY)})] = true;
      });
    });
  };
  window.MathJax = existing;
})();
`;

export type MathJaxSpecOptions = {
  /**
   * The `<script src="…">` value identifying the MathJax loader. Matched by
   * equality on the path portion only; `?config=…` query strings are ignored
   * on both sides so the same spec works regardless of which MathJax config
   * the manuscript loads.
   */
  src: string;
  timeout?: number | undefined;
};

/**
 * Create a PrerenderSpec for MathJax v2.
 */
export function mathjaxSpec({
  src,
  timeout,
}: MathJaxSpecOptions): PrerenderSpec {
  const withoutQuery = (s: string) => {
    const i = s.indexOf("?");
    return i < 0 ? s : s.slice(0, i);
  };
  const targetSrc = withoutQuery(src);
  const isMathJaxScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    withoutQuery(el.properties.src) === targetSrc;

  return {
    when: (tree) => hasElement(tree, isMathJaxScript),
    prepare: (tree) => {
      prependToHead(tree, inlineScript(initScript, { [MARKER]: "" }));
    },
    waitUntil: (page) =>
      page.waitForFunction(
        `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
        timeout !== undefined ? { timeout } : {},
      ),
    cleanup: (tree) => {
      removeElements(
        tree,
        (el) =>
          isMathJaxScript(el) ||
          (el.tagName === "script" && MARKER in (el.properties ?? {})),
      );
    },
  };
}

export type PrerenderMathJaxOptions = Omit<PrerenderOptions, "specs"> &
  MathJaxSpecOptions;

/**
 * Rehype plugin: pre-render MathJax v2 formulas. Thin wrapper around
 * `prerender` with a single `mathjaxSpec`. Use this when MathJax is the only
 * library to bake; compose `prerender` directly when combining multiple
 * libraries in one pass.
 */
export function prerenderMathJax(options: PrerenderMathJaxOptions) {
  return prerender({
    ...options,
    specs: [mathjaxSpec({ src: options.src, timeout: options.timeout })],
  });
}
