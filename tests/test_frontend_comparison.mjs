import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

// Exercise the real rendering/validation functions without network requests
// or a browser, so these regressions run in every publication quality gate.
function element() {
  return {children: [], textContent: "", setAttribute() {}, appendChild(child) {this.children.push(child);}};
}
const context = vm.createContext({
  console, URL, Date, Intl,
  document: {querySelector() {return null;}, addEventListener() {}, createElement: element},
  window: {}, element,
});
vm.runInContext(fs.readFileSync(new URL("../docs/assets/app.js", import.meta.url), "utf8"), context);
vm.runInContext('state.data={comparison:{reference_mode:CALENDAR_CLOSE_REFERENCE_MODE}};', context);

function render(value, unit = "体", comparable = true) {
  context.inputValue = value;
  context.inputComparable = comparable;
  context.inputUnit = unit;
  return vm.runInContext(`(() => {
    const container = element();
    renderRankPeriodChanges(container, {periods: {hour: {comparable: inputComparable, occurrence_count: inputValue}}}, {
      alwaysShow: true, period: 'hour', metric: 'occurrence', includePeriodLabel: false,
      formatOccurrence: count => count + inputUnit,
    });
    return container.children[0].children[0].textContent;
  })()`, context);
}

test("character and equipment changes preserve signs and units", () => {
  assert.equal(render(8), "+8体");
  assert.equal(render(-3), "-3体");
  assert.equal(render(0), "±0");
  assert.equal(render(8, "個"), "+8個");
  assert.equal(render(-3, "個"), "-3個");
  assert.equal(render(0, "個"), "±0");
});

test("unknown or coerced comparison values never display zero", () => {
  for (const value of [null, undefined, false, true, "", "0", "8", NaN, Infinity, 1.5, {}, []]) {
    assert.equal(render(value), "履歴待ち");
    assert.equal(render(value, "個"), "履歴待ち");
  }
  assert.equal(render(0, "体", false), "履歴待ち");
});

function historySample() {
  return {snapshots: [{updated_at: "2026-08-30T14:00:00Z", calendar_date: "2026-08-30", sampled_players: 200,
    characters: [{unit_code: "u-a", rank: 1, occurrence_count: 200, player_count: 200, adoption_rate: 100,
      equipment_rankings: Object.fromEntries(["WEAPON", "ARMOR", "ACC"].map(kind => [kind, {
        items: [{item_code: `item-${kind}`, rank: 1, occurrence_count: 200}],
      }])),
    }],
  }]};
}

test("history rejects unknown or invalid character and equipment counts", () => {
  context.inputHistory = historySample();
  assert.doesNotThrow(() => vm.runInContext("validateHistory(inputHistory)", context));
  for (const value of [null, undefined, -1, false, "200", 2001, 1.5]) {
    context.inputHistory = historySample();
    context.inputHistory.snapshots[0].characters[0].occurrence_count = value;
    assert.throws(() => vm.runInContext("validateHistory(inputHistory)", context));
    context.inputHistory = historySample();
    context.inputHistory.snapshots[0].characters[0].equipment_rankings.WEAPON.items[0].occurrence_count = value;
    assert.throws(() => vm.runInContext("validateHistory(inputHistory)", context));
  }
});
