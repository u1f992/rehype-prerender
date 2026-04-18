import type * as hast from "hast";

import {
  hasScript,
  inlineScript,
  prependToHead,
  removeScripts,
  type PrerenderSpec,
} from "rehype-prerender";

/**
 * Recognize the MathJax CDN reference VFM emits, as well as any extension
 * scripts MathJax itself appended to the DOM during execution.
 */
const isMathJax = (el: hast.Element) => {
  const src = el.properties?.src;
  return (
    typeof src === "string" &&
    src.includes("cdnjs.cloudflare.com/ajax/libs/mathjax")
  );
};

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

export const mathjaxSpec: PrerenderSpec = {
  name: "mathjax",
  when: (tree) => hasScript(tree, isMathJax),
  prepare: (tree) => {
    prependToHead(tree, inlineScript(authorInit, { [MARKER]: "" }));
  },
  waitUntil: {
    type: "function",
    expression: `window[Symbol.for(${JSON.stringify(DONE_KEY)})] === true`,
    timeout: 60_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isMathJax(el) || MARKER in (el.properties ?? {}),
    );
  },
};
