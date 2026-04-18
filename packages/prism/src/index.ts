import type * as hast from "hast";

import {
  hasElement,
  inlineScript,
  prependToHead,
  removeElements,
  type PrerenderSpec,
} from "rehype-prerender";

const MARKER = "dataPrerenderPrism";

const runnerScript = `
window.Prism = window.Prism || {};
window.Prism.manual = true;

window.addEventListener('load', function () {
  if (window.Prism && typeof Prism.highlightAll === 'function') {
    Prism.highlightAll(false);
  }
});
`;

/**
 * Create a PrerenderSpec for Prism. Handles any combination of plugins
 * (autoloader, file-highlight, etc.) with a single spec.
 *
 * @param matchSrc - Predicate applied to each `<script src="…">` value.
 *   Return `true` for Prism-related scripts so they can be detected and
 *   removed after pre-rendering.
 */
export function prismSpec({
  matchSrc,
  timeout,
}: {
  matchSrc: (src: string) => boolean;
  timeout?: number | undefined;
}): PrerenderSpec {
  const isPrismScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    matchSrc(el.properties.src);

  return {
    when: (tree) => hasElement(tree, isPrismScript),
    prepare: (tree) => {
      prependToHead(tree, inlineScript(runnerScript, { [MARKER]: "" }));
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
