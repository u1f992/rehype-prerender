import type * as hast from "hast";

import {
  hasMatch,
  inlineScript,
  prependToHead,
  removeScripts,
  type PrerenderSpec,
} from "rehype-prerender";

export const PRISM_CDN = "cdnjs.cloudflare.com/ajax/libs/prism";
export const MARKER = "dataPrerenderPrism";

export const isPrismScript = (el: hast.Element) => {
  const src = el.properties?.src;
  return typeof src === "string" && src.includes(PRISM_CDN);
};

export const runnerScript = `
window.Prism = window.Prism || {};
window.Prism.manual = true;

window.addEventListener('load', function () {
  if (window.Prism && typeof Prism.highlightAll === 'function') {
    Prism.highlightAll(false);
  }
});
`;

export const fileHighlightRunnerScript = `
window.addEventListener('load', function () {
  if (window.Prism && typeof Prism.highlightAll === 'function') {
    Prism.highlightAll(false);
  }
});
`;

export const prismSpec: PrerenderSpec = {
  name: "prism",
  when: (tree) =>
    hasMatch(tree, 'pre > code[class*="language-"]') ||
    hasMatch(tree, 'pre[class*="language-"] > code'),
  prepare: (tree) => {
    prependToHead(tree, inlineScript(runnerScript, { [MARKER]: "" }));
  },
  waitUntil: {
    type: "networkIdle",
    idleTime: 500,
    timeout: 30_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isPrismScript(el) || MARKER in (el.properties ?? {}),
    );
  },
};

export const fileHighlightSpec: PrerenderSpec = {
  name: "prism-file-highlight",
  when: (tree) => hasMatch(tree, "pre[data-src]"),
  prepare: (tree) => {
    prependToHead(
      tree,
      inlineScript(fileHighlightRunnerScript, { [MARKER]: "" }),
    );
  },
  waitUntil: {
    type: "function",
    expression: `document.querySelectorAll('pre[data-src]').length > 0
      && document.querySelectorAll('pre[data-src]:not([data-src-status="loaded"])').length === 0`,
    timeout: 30_000,
  },
  cleanup: (tree) => {
    removeScripts(
      tree,
      (el) => isPrismScript(el) || MARKER in (el.properties ?? {}),
    );
  },
};
