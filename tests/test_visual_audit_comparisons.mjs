import assert from "node:assert/strict";
import test from "node:test";
import { assertComparisonBadgeState } from "../scripts/visual-audit-comparisons.mjs";

function health(comparable) {
  return {comparison:{periods:{hour:{comparable},day:{comparable},week:{comparable},month:{comparable}}}};
}

function state(overrides = {}) {
  return {rows:55,badges:55,pending:0,sourcePending:0,...overrides};
}

test("unavailable baselines require history-pending badges for every row", () => {
  const result = assertComparisonBadgeState("hour", health(false), state({pending:55}));
  assert.equal(result.comparable, false);
  assert.equal(result.expectedPending, 55);
});

test("comparable baselines require a real comparison state rather than pending", () => {
  const result = assertComparisonBadgeState("month", health(true), state());
  assert.equal(result.comparable, true);
  assert.equal(result.expectedPending, 0);
});

test("a missing baseline cannot be silently rendered as a zero-like ordinary badge", () => {
  assert.throws(
    () => assertComparisonBadgeState("day", health(false), state()),
    /expected 55 history-pending badges but found 0/,
  );
});

test("a verified baseline cannot be mislabeled as history pending", () => {
  assert.throws(
    () => assertComparisonBadgeState("month", health(true), state({pending:55})),
    /expected 0 history-pending badges but found 55/,
  );
});

test("partial badge coverage is rejected for either baseline state", () => {
  assert.throws(
    () => assertComparisonBadgeState("hour", health(false), state({badges:54,pending:55})),
    /badge count 54 does not match row count 55/,
  );
});

test("malformed health and badge counts fail closed", () => {
  assert.throws(() => assertComparisonBadgeState("hour", {}, state()), /missing a valid hour comparable flag/);
  assert.throws(() => assertComparisonBadgeState("quarter", health(true), state()), /unknown comparison period/);
  assert.throws(() => assertComparisonBadgeState("month", health(true), state({rows:0,badges:0})), /no rendered rows/);
  assert.throws(() => assertComparisonBadgeState("month", health(true), state({pending:1.5})), /invalid pending count/);
});

