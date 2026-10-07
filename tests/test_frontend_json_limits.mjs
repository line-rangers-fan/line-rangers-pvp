import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

function context() {
  const ctx = vm.createContext({
    console, URL, Date, Intl, TextDecoder, TextEncoder,
    document: { querySelector() { return null; }, addEventListener() {} },
    window: {},
  });
  vm.runInContext(fs.readFileSync(new URL("../docs/assets/app.js", import.meta.url), "utf8"), ctx);
  return ctx;
}

test("the published history loads within its separate budget and validates", async () => {
  const ctx = context();
  const bytes = fs.readFileSync(new URL("../docs/data/character_usage_history.json", import.meta.url));
  ctx.response = new Response(bytes);
  ctx.history = await vm.runInContext('readJsonWithLimits(response, MAX_HISTORY_JSON_BYTES, "limit")', ctx);
  assert.doesNotThrow(() => vm.runInContext("validateHistory(history)", ctx));
});

test("a chunked oversized response is stopped before the remaining body is read", async () => {
  const ctx = context();
  let reads = 0;
  let cancelled = false;
  let released = false;
  ctx.response = {
    headers: { get() { return null; } },
    body: { getReader() { return {
      async read() { reads += 1; return { done: false, value: new Uint8Array(8) }; },
      async cancel() { cancelled = true; },
      releaseLock() { released = true; },
    }; } },
  };
  await assert.rejects(vm.runInContext('readJsonWithLimits(response, 10, "limit")', ctx), /limit/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test("stream decoding preserves Japanese characters split across chunks", async () => {
  const ctx = context();
  const bytes = new TextEncoder().encode('{"name":"サリー"}');
  let offset = 0;
  ctx.response = {
    headers: { get() { return null; } },
    body: { getReader() { return {
      async read() {
        return offset < bytes.length
          ? { done: false, value: bytes.slice(offset, ++offset) }
          : { done: true };
      },
      releaseLock() {},
    }; } },
  };
  const result = await vm.runInContext('readJsonWithLimits(response, 100, "limit")', ctx);
  assert.equal(result.name, "サリー");
});
