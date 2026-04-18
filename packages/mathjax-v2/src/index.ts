import type * as hast from "hast";

import {
  hasScript,
  inlineScript,
  prependToHead,
  removeScripts,
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
export function mathjaxSpec(matchSrc: (src: string) => boolean): PrerenderSpec {
  const isMathJax = (el: hast.Element) => {
    const src = el.properties?.src;
    return typeof src === "string" && matchSrc(src);
  };

  return {
    name: "mathjax",
    when: (tree) => hasScript(tree, isMathJax),
    prepare: (tree) => {
      prependToHead(tree, inlineScript(authorInit, { [MARKER]: "" }));
    },
    waitUntil: (page) =>
      page.waitForFunction(
        `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
        { timeout: 60_000 },
      ),
    cleanup: (tree) => {
      removeScripts(
        tree,
        (el) => isMathJax(el) || MARKER in (el.properties ?? {}),
      );
    },
  };
}
