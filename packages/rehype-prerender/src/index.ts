import fs from "node:fs";
import path from "node:path";

import {
  Browser,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
} from "@puppeteer/browsers";
import type * as hast from "hast";
import { fromHtml } from "hast-util-from-html";
import { select } from "hast-util-select";
import { toHtml } from "hast-util-to-html";
import mime from "mime";
import puppeteer, { type Page } from "puppeteer-core";
import type * as unist from "unist";
import { visit, SKIP } from "unist-util-visit";
import type { VFile } from "vfile";

export type PrerenderSpec = {
  /**
   * Whether this spec applies to the given tree. Runs before any mutation.
   */
  when: (tree: hast.Root) => boolean | Promise<boolean>;
  /**
   * Mutate the hast tree before serialization. Typical use: inject a
   * done-flag script into <head>.
   */
  prepare?: (tree: hast.Root) => unknown | Promise<unknown>;
  /**
   * Wait until the browser has finished running this library. Receives the
   * live Page; typical bodies call `page.waitForFunction` against an
   * injected done flag, or `page.waitForNetworkIdle` for libraries without
   * a deterministic completion signal. The resolved value is ignored.
   *
   * Omit when the library's work completes synchronously during
   * `page.setContent`'s "load" wait, so no further waiting is needed.
   */
  waitUntil?: (page: Page) => unknown | Promise<unknown>;
  /**
   * Runs against the live Page after waitUntil, before content extraction.
   * Typical use: unwrap iframes whose same-origin contents must be inlined
   * before serialization strips them.
   */
  finalize?: (page: Page) => unknown | Promise<unknown>;
  /**
   * Mutate the re-parsed hast tree after extraction. Typical use: remove the
   * injected done-flag script and the library's own <script> references.
   */
  cleanup?: (tree: hast.Root) => unknown | Promise<unknown>;
};

export type PrerenderOptions = {
  specs: readonly PrerenderSpec[];
  /**
   * Directory to install / find Chrome under. Required.
   */
  browserCacheDir: string;
  /**
   * Chrome build to install if absent. Defaults to a pinned version.
   */
  chromeBuildId?: string;
  /**
   * Additional flags passed to puppeteer.launch. Needed only for unusual
   * environments (e.g. ["--no-sandbox"] in sandbox-less Linux containers).
   */
  launchArgs?: readonly string[];
  /**
   * URL origin used as the document base during pre-render. Requests to this
   * origin are routed to resolveResource; other origins pass through. A
   * trailing "/" is appended automatically if absent.
   */
  baseUrl?: string;
  /**
   * Map a pathname under baseUrl to an absolute filesystem path, or null to
   * return 404. Defaults to resolving against file.dirname with
   * escape prevention.
   */
  resolveResource?: (pathname: string, file: VFile) => string | null;
  navigationTimeout?: number;
  /**
   * After every spec's `waitUntil` resolves, the core re-asserts quiescence
   * by alternating (a) a wait for all tracked short-delay setTimeouts to
   * drain and (b) a `page.waitForNetworkIdle`. `networkIdleDuration` is the
   * duration (in ms) the network must remain continuously idle before that
   * leg returns, forwarded as `idleTime` to puppeteer. Defaults to 0,
   * i.e. "idle right now is enough". Raise it to add a settle buffer when
   * legacy libraries fetch on microtask boundaries that briefly register as
   * idle; leave at 0 for libraries whose only async work is non-network
   * setTimeouts, since the pending-timer gate already covers those and any
   * positive value becomes pure wasted time.
   */
  networkIdleDuration?: number;
  /**
   * Upper bound on the number of (pending-tasks-drained → network-idle)
   * alternation passes before the core quiescence gate gives up. Defaults
   * to 20. Each pass absorbs one level of "the last callback scheduled
   * more work" cascade, so the cap only bites on pathological pages
   * (autoloader chain of 20+ hops, or an infinite setTimeout loop).
   */
  maxQuiescenceIterations?: number;
  /**
   * Per-step timeout for the core quiescence gate's `waitForFunction` and
   * `waitForNetworkIdle` calls. Unset by default (puppeteer defaults
   * apply). Separate from `navigationTimeout` (page load) and from
   * per-spec `waitUntil` timeouts (done-flag polling).
   */
  quiescenceTimeout?: number;
};

const DEFAULT_BASE_URL = "https://prerender.invalid/";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_NETWORK_IDLE_DURATION_MS = 0;
const DEFAULT_MAX_QUIESCENCE_ITERATIONS = 20;
export const DEFAULT_CHROME_BUILD_ID = "146.0.7680.153";

const PENDING_KEY = "__rehypePrerenderPendingTasks";
const TRACKER_MARKER = "dataRehypePrerender";

// Wraps window.setTimeout / clearTimeout so that short-delay timers (the
// dangerous ones that create macrotask gaps bypassing network-idle detection,
// e.g. autoloader's setTimeout(callback, 0)) are tracked in a counter exposed
// as window[PENDING_KEY]. Long-delay timers (backstop/error timeouts) pass
// through unmodified so they do not block completion. The counter is
// decremented in a finally block after the callback returns, so the counter
// remains non-zero while the callback is executing and its synchronous
// descendants run. The gate only opens once that entire synchronous cascade
// has finished.
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

/**
 * Ensure Chrome is installed under cacheDir and return its executable path.
 */
export async function ensureBrowserExecutable({
  browserCacheDir: cacheDir,
  chromeBuildId: buildId,
}: {
  browserCacheDir: string;
  chromeBuildId: string;
}) {
  const platform = detectBrowserPlatform();
  if (!platform) {
    throw new Error(
      `Unsupported platform: ${process.platform}/${process.arch}`,
    );
  }
  const browser = Browser.CHROME;
  const executablePath = computeExecutablePath({ cacheDir, browser, buildId });
  if (!fs.existsSync(executablePath)) {
    await install({
      cacheDir,
      browser,
      buildId,
      downloadProgressCallback: "default",
    });
  }
  return executablePath;
}

/**
 * Default resolver. Maps `baseUrl/<pathname>` to
 * `path.resolve(file.dirname, pathname)`, refusing to resolve outside the
 * document directory.
 */
function defaultResolveResource(pathname: string, file: VFile): string | null {
  const baseDir = file.dirname;
  if (!baseDir) {
    return null;
  }
  const decoded = decodeURIComponent(pathname.replace(/^\//, ""));
  if (!decoded) {
    return null;
  }
  const resolved = path.resolve(baseDir, decoded);
  const rel = path.relative(baseDir, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

function patchDoctypeName(root: hast.Root) {
  root.children
    .filter((child) => child.type === "doctype" && !("name" in child))
    .forEach(
      (child) =>
        // @ts-expect-error Patch the name back so the final serialization produces `<!doctype html>`.
        // hast-util-from-html@1 produces `{ type: "doctype" }` without `name`:
        //   https://github.com/syntax-tree/hast-util-from-parse5/blob/7.1.2/lib/index.js#L155
        // VFM's downstream rehype-stringify@8 bundles hast-util-to-html@7, which
        // still reads `node.name` at runtime; if absent it emits `<!doctype>`:
        //   https://github.com/syntax-tree/hast-util-to-html/blob/7.1.3/lib/doctype.js#L13-L14
        (child.name = "html"),
    );
}

/**
 * Built-in spec appended to every prerender pass with at least one
 * applicable user spec. Its three hooks match the surrounding lifecycle:
 * `prepare` injects the setTimeout tracker, `waitUntil` runs the
 * composite quiescence gate, `cleanup` strips the tracker from the final
 * tree. Appended (not prepended) to the spec list so that user specs
 * prepare first; that way the tracker lands at head[0] and user specs'
 * `waitUntil` (done-flag polling, etc.) run before the gate re-asserts
 * quiescence.
 */
function quiescenceSpec({
  networkIdleDuration,
  maxQuiescenceIterations,
  quiescenceTimeout,
}: {
  networkIdleDuration: number;
  maxQuiescenceIterations: number;
  quiescenceTimeout: number | undefined;
}): PrerenderSpec {
  const pendingProbe = `window[${JSON.stringify(PENDING_KEY)}] === 0`;
  const pendingRead = `window[${JSON.stringify(PENDING_KEY)}]`;
  const fnOpts =
    quiescenceTimeout !== undefined ? { timeout: quiescenceTimeout } : {};

  return {
    when: () => true,
    prepare: (tree) => {
      prependToHead(
        tree,
        inlineScript(TRACKER_SCRIPT, { [TRACKER_MARKER]: "" }),
      );
    },
    // Catches two blind spots of single-signal waiting: (1) done flags
    // that fire before the library's own trailing setTimeout(0) cleanup
    // runs, and (2) network-idle windows that open momentarily inside a
    // setTimeout(0) macrotask gap (autoloader chains). Alternates between
    // draining tracked timers and requiring network idleness, re-checking
    // after each pass because a draining callback may have scheduled new
    // work.
    waitUntil: async (page) => {
      for (let i = 0; i < maxQuiescenceIterations; i++) {
        await page.waitForFunction(pendingProbe, fnOpts);
        await page.waitForNetworkIdle({
          idleTime: networkIdleDuration,
          ...(quiescenceTimeout !== undefined && {
            timeout: quiescenceTimeout,
          }),
        });
        const pending = (await page.evaluate(pendingRead)) as number;
        if (pending === 0) return;
      }
      throw new Error(
        `prerender: failed to reach quiescence after ${maxQuiescenceIterations} iterations`,
      );
    },
    cleanup: (tree) => {
      removeElements(
        tree,
        (el) =>
          el.tagName === "script" && TRACKER_MARKER in (el.properties ?? {}),
      );
    },
  };
}

/**
 * Headless-browser pre-render plugin for unified. Each spec describes one
 * legacy library embedded in the manuscript: how to detect it, what to
 * inject so completion can be observed, how to wait, and how to clean up.
 */
export function prerender(options: PrerenderOptions) {
  const specs = options.specs;
  const rawBaseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const baseUrl = rawBaseUrl.endsWith("/") ? rawBaseUrl : rawBaseUrl + "/";
  const resolveResource = options.resolveResource ?? defaultResolveResource;
  const navigationTimeout = options.navigationTimeout ?? DEFAULT_TIMEOUT_MS;
  const browserCacheDir = options.browserCacheDir;
  const chromeBuildId = options.chromeBuildId ?? DEFAULT_CHROME_BUILD_ID;
  const launchArgs = options.launchArgs ?? [];
  const builtin = quiescenceSpec({
    networkIdleDuration:
      options.networkIdleDuration ?? DEFAULT_NETWORK_IDLE_DURATION_MS,
    maxQuiescenceIterations:
      options.maxQuiescenceIterations ?? DEFAULT_MAX_QUIESCENCE_ITERATIONS,
    quiescenceTimeout: options.quiescenceTimeout,
  });

  return async (node: unist.Node, file: VFile) => {
    const tree = node as hast.Root;
    const applicable: PrerenderSpec[] = [];
    for (const s of specs) {
      if (await s.when(tree)) {
        applicable.push(s);
      }
    }
    if (applicable.length === 0) {
      return tree;
    }
    applicable.push(builtin);
    // Setup phases (prepare, waitUntil) run forward through the spec list;
    // teardown phases (finalize, cleanup) run in reverse (LIFO), so that
    // specs unwind in the opposite order they were set up, matching the
    // conventions of try/finally, context managers, and middleware. For
    // the built-in spec this places its tracker injection at head[0] and
    // its gate after user waitUntil during setup, and its tracker removal
    // first during teardown.
    const reversed = [...applicable].reverse();

    for (const s of applicable) {
      await s.prepare?.(tree);
    }

    const html = toHtml(tree);
    const executablePath = await ensureBrowserExecutable({
      browserCacheDir,
      chromeBuildId,
    });
    const browser = await puppeteer.launch({
      executablePath,
      args: [...launchArgs],
    });
    let serialized;
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);

      const entryUrl = baseUrl + "__prerender_entry__.html";
      page.on("request", (req) => {
        const url = req.url();
        if (url === entryUrl) {
          req
            .respond({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: "<!doctype html><html><head></head><body></body></html>",
            })
            .catch(() => {});
          return;
        }
        if (url.startsWith(baseUrl)) {
          const u = new URL(url);
          const fsPath = resolveResource(u.pathname, file);
          if (fsPath && fs.existsSync(fsPath) && fs.statSync(fsPath).isFile()) {
            req
              .respond({
                status: 200,
                contentType:
                  mime.getType(fsPath) ?? "text/plain; charset=utf-8",
                body: fs.readFileSync(fsPath),
              })
              .catch(() => {});
            return;
          }
          req.respond({ status: 404, body: "" }).catch(() => {});
          return;
        }
        req.continue().catch(() => {});
      });

      await page.goto(entryUrl, {
        waitUntil: "domcontentloaded",
        timeout: navigationTimeout,
      });
      await page.setContent(html, {
        waitUntil: "load",
        timeout: navigationTimeout,
      });

      for (const s of applicable) {
        await s.waitUntil?.(page);
      }

      for (const s of reversed) {
        if (s.finalize) {
          await s.finalize(page);
        }
      }

      serialized = await page.content();
    } finally {
      await browser.close();
    }

    const rendered = fromHtml(serialized);
    patchDoctypeName(rendered);

    for (const s of reversed) {
      await s.cleanup?.(rendered);
    }

    return rendered;
  };
}

/**
 * Insert a child as the first element of <head>. Throws if <head> is absent
 * (the manuscript should always have one in well-formed HTML output).
 */
export function prependToHead(root: hast.Root, child: hast.Element) {
  const head = select("head", root);
  if (!head) {
    throw new Error("No <head> element to prepend into.");
  }
  head.children.unshift(child);
}

export function inlineScript(
  source: string,
  extraProps: Record<string, string> = {},
): hast.Element {
  return {
    type: "element",
    tagName: "script",
    properties: { ...extraProps },
    children: [{ type: "text", value: source }],
  };
}

/**
 * Remove every element matching `predicate` anywhere in the tree.
 */
export function removeElements(
  root: hast.Root,
  predicate: (el: hast.Element) => boolean,
) {
  visit(root, "element", (el, index, parent) => {
    if (predicate(el) && index !== null && parent) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
  });
}

/**
 * True if any element matches predicate.
 */
export function hasElement(
  root: hast.Root,
  predicate: (el: hast.Element) => boolean,
) {
  let found = false;
  visit(root, "element", (el) => {
    if (predicate(el)) {
      found = true;
    }
  });
  return found;
}

/**
 * True if any element matches the CSS selector.
 */
export function hasMatch(root: hast.Root, selector: string) {
  return select(selector, root) !== null;
}
