import type * as hast from "hast";

import {
  hasElement,
  inlineScript,
  prependToHead,
  removeElements,
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

/**
 * Create a PrerenderSpec for Prism. Handles any combination of plugins
 * (autoloader, file-highlight, etc.) with a single spec.
 *
 * @param srcs - The full set of `<script src="…">` values identifying the
 *   Prism loader and plugins in the manuscript. Matched by strict string
 *   equality. The spec activates only when every entry is present in the
 *   document, and each matching `<script>` is removed after pre-rendering.
 */
export function prismSpec({
  srcs,
  timeout,
}: {
  srcs: readonly string[];
  timeout?: number | undefined;
}): PrerenderSpec {
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
    waitUntil: (page) =>
      page.waitForNetworkIdle({
        idleTime: 500,
        ...(timeout !== undefined && { timeout }),
      }),
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
