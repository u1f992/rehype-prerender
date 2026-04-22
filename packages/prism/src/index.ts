import type * as hast from "hast";

import {
  prerender,
  type PrerenderOptions,
  type PrerenderSpec,
} from "rehype-prerender";
import {
  hasElement,
  inlineScript,
  prependToHead,
  removeElements,
} from "rehype-prerender/helpers";

const MARKER = "dataPrerenderPrism";

/**
 * Recommended `networkIdleDuration` for the core quiescence gate when
 * pre-rendering Prism. Prism autoloader chains language fetches via
 * `<script>` onload handlers; between an `onload` firing and the next
 * `<script>` being registered there is a sub-millisecond window in
 * which the network appears idle. `idleTime = 0` races that window and
 * can return before the chain finishes. 500ms is conservative enough to
 * absorb the race on slow CDNs while still being tight enough not to
 * dominate build time. Exposed so users composing `prerender` with
 * `prismSpec` directly can forward it without duplicating the magic
 * number; `prerenderPrism` applies it as a default automatically.
 */
export const DEFAULT_PRISM_NETWORK_IDLE_DURATION = 500;

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
  /**
   * Network-idle buffer (ms) forwarded to the returned spec's
   * `networkIdleDuration` field, which the core quiescence gate aggregates
   * across applicable specs and uses as its `waitForNetworkIdle` idleTime.
   * Defaults to `DEFAULT_PRISM_NETWORK_IDLE_DURATION`. See that constant
   * for why Prism needs a non-zero buffer.
   */
  networkIdleDuration?: number;
};

/**
 * Create a PrerenderSpec for Prism. Handles any combination of plugins
 * (autoloader, file-highlight, etc.) with a single spec. Prism has no
 * library-level completion signal, so the spec does no `waitUntil`
 * polling of its own; completion is inferred by the core quiescence
 * gate using the `networkIdleDuration` this spec declares.
 */
export function prismSpec({
  srcs,
  networkIdleDuration = DEFAULT_PRISM_NETWORK_IDLE_DURATION,
}: PrismSpecOptions): PrerenderSpec {
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
    networkIdleDuration,
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
    specs: [
      prismSpec({
        srcs: options.srcs,
        ...(options.networkIdleDuration !== undefined && {
          networkIdleDuration: options.networkIdleDuration,
        }),
      }),
    ],
  });
}
