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
import puppeteer, { type Page } from "puppeteer-core";
import type * as unist from "unist";
import { visit, SKIP } from "unist-util-visit";
import type { VFile } from "vfile";

type WaitFunction = { type: "function"; expression: string; timeout?: number };
type WaitNetworkIdle = {
  type: "networkIdle";
  idleTime?: number;
  timeout?: number;
};
type WaitCondition = WaitFunction | WaitNetworkIdle;

export type PrerenderSpec = {
  name?: string;
  /**
   * Whether this spec applies to the given tree. Runs before any mutation.
   */
  when: (tree: hast.Root) => boolean;
  /**
   * Mutate the hast tree before serialization. Typical use: inject a
   * done-flag script into <head>.
   */
  prepare?: (tree: hast.Root) => void;
  /**
   * How to decide the browser has finished.
   */
  waitUntil: WaitCondition;
  /**
   * Runs against the live Page after waitUntil, before content extraction.
   * Typical use: unwrap iframes whose same-origin contents must be inlined
   * before serialization strips them.
   */
  finalize?: (page: Page) => Promise<void>;
  /**
   * Mutate the re-parsed hast tree after extraction. Typical use: remove the
   * injected done-flag script and the library's own <script> references.
   */
  cleanup?: (tree: hast.Root) => void;
};

type PrerenderOptions = {
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
   * origin are routed to resolveResource; other origins pass through. Must
   * end with "/".
   */
  baseUrl?: string;
  /**
   * Map a pathname under baseUrl to an absolute filesystem path, or null to
   * return 404. Defaults to resolving against file.dirname with
   * escape prevention.
   */
  resolveResource?: (pathname: string, file: VFile) => string | null;
  navigationTimeout?: number;
};

const DEFAULT_BASE_URL = "https://prerender.invalid/";
const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_CHROME_BUILD_ID = "146.0.7680.153";

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

/**
 * Pick a Content-Type heuristically. Puppeteer's request.respond is lenient
 * but some browsers are not.
 */
function guessContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".mjs":
      return "application/javascript";
    case ".json":
      return "application/json";
    case ".css":
      return "text/css";
    case ".html":
    case ".htm":
      return "text/html";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "text/plain; charset=utf-8";
  }
}

async function waitForCondition(page: Page, cond: WaitCondition) {
  switch (cond.type) {
    case "function":
      await page.waitForFunction(cond.expression, {
        timeout: cond.timeout ?? DEFAULT_TIMEOUT_MS,
      });
      return;
    case "networkIdle":
      await page.waitForNetworkIdle({
        idleTime: cond.idleTime ?? 500,
        timeout: cond.timeout ?? DEFAULT_TIMEOUT_MS,
      });
      return;
  }
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
 * Headless-browser pre-render plugin for unified. Each spec describes one
 * legacy library embedded in the manuscript: how to detect it, what to
 * inject so completion can be observed, how to wait, and how to clean up.
 */
export function prerender(options: PrerenderOptions) {
  const specs = options.specs;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  if (!baseUrl.endsWith("/")) {
    throw new Error(`baseUrl must end with "/": ${baseUrl}`);
  }
  const resolveResource = options.resolveResource ?? defaultResolveResource;
  const navigationTimeout = options.navigationTimeout ?? DEFAULT_TIMEOUT_MS;
  const browserCacheDir = options.browserCacheDir;
  const chromeBuildId = options.chromeBuildId ?? DEFAULT_CHROME_BUILD_ID;
  const launchArgs = options.launchArgs ?? [];

  return async (node: unist.Node, file: VFile) => {
    const tree = node as hast.Root;
    const applicable = specs.filter((s) => s.when(tree));
    if (applicable.length === 0) {
      return tree;
    }

    for (const s of applicable) {
      s.prepare?.(tree);
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
                contentType: guessContentType(fsPath),
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
        await waitForCondition(page, s.waitUntil);
      }

      for (const s of applicable) {
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

    for (const s of applicable) {
      s.cleanup?.(rendered);
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
 * Remove every <script> element matching `predicate` anywhere in the tree.
 */
export function removeScripts(
  root: hast.Root,
  predicate: (el: hast.Element) => boolean,
) {
  visit(root, "element", (el, index, parent) => {
    if (el.tagName === "script" && predicate(el) && index !== null && parent) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
  });
}

/**
 * True if any <script> element matches predicate.
 */
export function hasScript(
  root: hast.Root,
  predicate: (el: hast.Element) => boolean,
) {
  let found = false;
  visit(root, "element", (el) => {
    if (el.tagName === "script" && predicate(el)) {
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
