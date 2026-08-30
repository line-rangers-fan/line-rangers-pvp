import assert from "node:assert/strict";
import test from "node:test";
import {setImmediate as turn} from "node:timers/promises";
import {getHealthSnapshot} from "../infra/cloudflare-watchdog/src/index.mjs";

const ENV = {DATA_URL: "https://line-rangers-fan.github.io/line-rangers-pvp/data/character_usage.json"};

test("watchdog deadline covers a response body stalled after headers", async (t) => {
  t.mock.method(console, "warn", () => {});
  t.mock.timers.enable({apis:["setTimeout"]});
  let controller;
  let signal;
  let result;
  const body = new ReadableStream({start(value) {controller=value;}});
  const pending = getHealthSnapshot(ENV, {fetchImpl: async (_url, options) => {
    signal=options.signal;
    return new Response(body);
  }}).then(value => {result=value;});
  try {
    await turn();
    t.mock.timers.tick(12_001);
    await turn();
    assert.equal(signal.aborted, true);
    assert.equal(result?.status, "unreadable");
  } finally {
    try {controller.close();} catch {}
    await pending;
  }
});

test("oversized chunked response stops at the existing byte limit", async (t) => {
  t.mock.method(console, "warn", () => {});
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      if (++chunks > 100) {controller.close(); return;}
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {cancelled=true;},
  });
  const health=await getHealthSnapshot(ENV,{fetchImpl:async()=>new Response(body)});
  assert.equal(health.status,"unreadable");
  assert.equal(cancelled,true);
  assert.ok(chunks <= 66, `read ${chunks} chunks after limit`);
});
