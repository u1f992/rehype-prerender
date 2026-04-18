import type * as hast from "hast";

import {
  hasElement,
  inlineScript,
  prependToHead,
  removeElements,
  type PrerenderSpec,
} from "rehype-prerender";

const DONE_KEY = "mathjax-prerender-done";
const MARKER = "dataPrerenderMathjax";

const authorInit = `
(function () {
  var existing = window.MathJax || {};
  var prev = typeof existing.AuthorInit === "function" ? existing.AuthorInit : null;
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

/**
 * Create a PrerenderSpec for MathJax v2.
 *
 * @param matchSrc - Predicate applied to each `<script src="…">` value.
 *   Return `true` for MathJax-related scripts so they can be detected and
 *   removed after pre-rendering.
 */
export function mathjaxSpec({
  matchSrc,
  timeout,
}: {
  matchSrc: (src: string) => boolean;
  timeout?: number | undefined;
}): PrerenderSpec {
  const isMathJaxScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    matchSrc(el.properties.src);

  return {
    name: "mathjax",
    when: (tree) => hasElement(tree, isMathJaxScript),
    prepare: (tree) => {
      prependToHead(tree, inlineScript(authorInit, { [MARKER]: "" }));
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
