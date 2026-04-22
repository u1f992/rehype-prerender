import type * as hast from "hast";
import { select } from "hast-util-select";
import { visit, SKIP } from "unist-util-visit";

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
