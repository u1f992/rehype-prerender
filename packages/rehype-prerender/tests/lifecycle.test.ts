import assert from "node:assert/strict";
import test from "node:test";

import rehype from "rehype";

import { prerender, type PrerenderSpec } from "../src/index.ts";
import { PRERENDER_TEST_OPTS } from "test-helpers";

const HTML =
  "<!doctype html><html><head></head><body><p>hello</p></body></html>";

test("when が true を返す spec のフックが prepare → waitUntil → finalize → cleanup の順に1回ずつ実行される", async () => {
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

test("when が false を返す spec はフックが一切実行されない", async () => {
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
