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
const PENDING_KEY = "__prerenderPrismPendingTasks";

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

// Wraps window.setTimeout / clearTimeout so that short-delay timers (the
// dangerous ones that create macrotask gaps bypassing network-idle detection,
// e.g. autoloader's setTimeout(callback, 0)) are tracked in a counter exposed
// as window[PENDING_KEY]. Long-delay timers (backstop/error timeouts) pass
// through unmodified so they do not block completion. The counter is
// decremented in a finally block after the callback returns, so the counter
// remains non-zero while the callback is executing and its synchronous
// descendants (complete hooks, recursive highlightElement) run — the gate
// only opens once that entire synchronous cascade has finished.
const TRACKER_SCRIPT = `
(function () {
  var count = 0;
  var pending = new Map();
  var origSet = window.setTimeout;
  var origClear = window.clearTimeout;
  var THRESHOLD_MS = 50;
  window.setTimeout = function (cb, delay) {
    if (typeof delay !== "number" || delay > THRESHOLD_MS) {
      return origSet.apply(window, arguments);
    }
    var extras = [];
    for (var i = 2; i < arguments.length; i++) extras.push(arguments[i]);
    var id;
    var wrapped = function () {
      try {
        return cb.apply(window, extras);
      } finally {
        if (pending.delete(id)) count--;
      }
    };
    id = origSet.call(window, wrapped, delay);
    pending.set(id, true);
    count++;
    return id;
  };
  window.clearTimeout = function (id) {
    if (pending.delete(id)) count--;
    return origClear.call(window, id);
  };
  Object.defineProperty(window, ${JSON.stringify(PENDING_KEY)}, {
    get: function () { return count; },
    configurable: true,
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
   * How long the network must be idle (no more than two in-flight requests)
   * before completion is declared, in milliseconds. Defaults to 500. Prism
   * plugins have no universal done signal, so completion is inferred from
   * network quiescence plus a short-timeout tracking counter that catches
   * the autoloader's setTimeout(callback, 0) macrotask gap. Raise this if
   * highlighting under slow CDNs or many chained language dependencies,
   * lower it to reduce build time when the page is known to be light.
   */
  idleTime?: number | undefined;
  timeout?: number | undefined;
  /**
   * Upper bound on the number of (pending-tasks-drained → network-idle)
   * alternation passes before giving up. Defaults to 20. Each pass absorbs
   * one level of "the last callback scheduled more work" cascade, so the
   * cap only bites on pathological pages (autoloader chain of 20+ hops,
   * or an infinite setTimeout loop). Raise if a manuscript legitimately
   * needs deeper cascades; lower to fail fast during debugging.
   */
  maxQuiescenceIterations?: number | undefined;
};

const DEFAULT_IDLE_TIME_MS = 500;
const DEFAULT_MAX_QUIESCENCE_ITERATIONS = 20;

/**
 * Create a PrerenderSpec for Prism. Handles any combination of plugins
 * (autoloader, file-highlight, etc.) with a single spec.
 */
export function prismSpec({
  srcs,
  idleTime = DEFAULT_IDLE_TIME_MS,
  timeout,
  maxQuiescenceIterations = DEFAULT_MAX_QUIESCENCE_ITERATIONS,
}: PrismSpecOptions): PrerenderSpec {
  const targetSrcs = new Set(srcs);
  const isPrismScript = (el: hast.Element) =>
    el.tagName === "script" &&
    typeof el.properties?.src === "string" &&
    targetSrcs.has(el.properties.src);

  const pendingProbe = `window[${JSON.stringify(PENDING_KEY)}] === 0`;
  const pendingRead = `window[${JSON.stringify(PENDING_KEY)}]`;

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
      // Prepend order matters: the tracker must execute before the init
      // script (and before any Prism CDN <script> in the manuscript), so
      // it is prepended last to land at head position 0.
      prependToHead(tree, inlineScript(initScript, { [MARKER]: "" }));
      prependToHead(tree, inlineScript(TRACKER_SCRIPT, { [MARKER]: "" }));
    },
    waitUntil: async (page) => {
      // Composite quiescence gate: network-idle alone can resolve during
      // the setTimeout(0) macrotask window autoloader creates between a
      // script's onload and the next language fetch. Require the tracked
      // pending-timer counter to be zero AND the network to be idle for
      // the full idleTime window, re-checking after each pass in case a
      // draining callback scheduled new work.
      for (let i = 0; i < maxQuiescenceIterations; i++) {
        await page.waitForFunction(
          pendingProbe,
          timeout !== undefined ? { timeout } : {},
        );
        await page.waitForNetworkIdle({
          idleTime,
          ...(timeout !== undefined && { timeout }),
        });
        const pending = (await page.evaluate(pendingRead)) as number;
        if (pending === 0) return;
      }
      throw new Error(
        `prismSpec: failed to reach quiescence after ${maxQuiescenceIterations} iterations`,
      );
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
    specs: [
      prismSpec({
        srcs: options.srcs,
        idleTime: options.idleTime,
        timeout: options.timeout,
        maxQuiescenceIterations: options.maxQuiescenceIterations,
      }),
    ],
  });
}
