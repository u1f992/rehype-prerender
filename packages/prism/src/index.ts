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

const MARKER = "dataPrerenderPrism";

const initScript = `
(function () {
  window.Prism = window.Prism || {};
  window.Prism.manual = true;
  window.addEventListener("load", function () {
    if (window.Prism && typeof Prism.highlightAll === "function") {
      Prism.highlightAll(false);
    }
  });
})();
`;

export type PrismSpecOptions = {
  /**
   * The full set of `<script src="…">` values identifying the Prism loader
   * and plugins in the manuscript. Matched by strict string equality. The
   * spec activates only when every entry is present in the document, and
   * each matching `<script>` is removed after pre-rendering.
   */
  srcs: readonly string[];
};

/**
 * Create a PrerenderSpec for Prism. Handles any combination of plugins
 * (autoloader, file-highlight, etc.) with a single spec. Prism has no
 * library-level completion signal; completion is inferred entirely by
 * the core quiescence gate (pending-setTimeout drain alternated with
 * network idle). Tune that behavior via `PrerenderOptions`
 * (`networkIdleDuration`, `maxQuiescenceIterations`, `quiescenceTimeout`).
 */
export function prismSpec({ srcs }: PrismSpecOptions): PrerenderSpec {
  const targetSrcs = new Set(srcs);
  const isPrismScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    targetSrcs.has(el.properties.src);

  return {
    when: (tree) => {
      if (targetSrcs.size === 0) return false;
      for (const target of targetSrcs) {
        const found = hasElement(
          tree,
          (el) => el.tagName === "script" && el.properties?.src === target,
        );
        if (!found) return false;
      }
      return true;
    },
    prepare: (tree) => {
      prependToHead(tree, inlineScript(initScript, { [MARKER]: "" }));
    },
    cleanup: (tree) => {
      removeElements(
        tree,
        (el) =>
          isPrismScript(el) ||
          (el.tagName === "script" && MARKER in (el.properties ?? {})),
      );
    },
  };
}

export type PrerenderPrismOptions = Omit<PrerenderOptions, "specs"> &
  PrismSpecOptions;

/**
 * Rehype plugin: pre-render Prism syntax highlighting. Thin wrapper around
 * `prerender` with a single `prismSpec`. Use this when Prism is the only
 * library to bake; compose `prerender` directly when combining multiple
 * libraries in one pass.
 */
export function prerenderPrism(options: PrerenderPrismOptions) {
  return prerender({
    ...options,
    specs: [prismSpec({ srcs: options.srcs })],
  });
}
