import assert from "node:assert/strict";
import test from "node:test";

import rehype from "rehype";

import { prerender, type PrerenderSpec } from "#self";
import { PRERENDER_TEST_OPTS } from "test-helpers";

const HTML =
  "<!doctype html><html><head></head><body><p>hello</p></body></html>";

test("hooks of a spec whose when returns true run once each in order: prepare -> waitUntil -> finalize -> cleanup", async () => {
  const calls: string[] = [];

  const spec: PrerenderSpec = {
    when: () => {
      calls.push("when");
      return true;
    },
    prepare: () => {
      calls.push("prepare");
    },
    waitUntil: (page) => page.waitForFunction("true", { timeout: 5_000 }),
    finalize: () => {
      calls.push("finalize");
    },
    cleanup: () => {
      calls.push("cleanup");
    },
  };

  await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process(HTML);

  assert.deepEqual(calls, ["when", "prepare", "finalize", "cleanup"]);
});

test("waitUntil is optional; other hooks still run in order when it is omitted", async () => {
  const calls: string[] = [];

  const spec: PrerenderSpec = {
    when: () => {
      calls.push("when");
      return true;
    },
    prepare: () => {
      calls.push("prepare");
    },
    finalize: () => {
      calls.push("finalize");
    },
    cleanup: () => {
      calls.push("cleanup");
    },
  };

  await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process(HTML);

  assert.deepEqual(calls, ["when", "prepare", "finalize", "cleanup"]);
});

test("baseUrl without a trailing slash is accepted and a slash is appended", async () => {
  const spec: PrerenderSpec = {
    when: () => true,
    waitUntil: (page) => page.waitForFunction("true", { timeout: 5_000 }),
  };

  await rehype()
    .use(prerender, {
      specs: [spec],
      baseUrl: "https://prerender.invalid",
      ...PRERENDER_TEST_OPTS,
    })
    .process(HTML);
});

test("no hook runs when a spec's when returns false", async () => {
  const calls: string[] = [];

  const spec: PrerenderSpec = {
    when: () => {
      calls.push("when");
      return false;
    },
    prepare: () => {
      calls.push("prepare");
    },
    waitUntil: (page) => page.waitForFunction("true", { timeout: 5_000 }),
    finalize: () => {
      calls.push("finalize");
    },
    cleanup: () => {
      calls.push("cleanup");
    },
  };

  await rehype()
    .use(prerender, {
      specs: [spec],
      ...PRERENDER_TEST_OPTS,
    })
    .process(HTML);

  assert.deepEqual(calls, ["when"]);
});
