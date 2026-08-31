import assert from "node:assert/strict";
import test from "node:test";

import {
  dataNeedsCollection,
  getHealthSnapshot,
  isCalendarAnchorWindow,
  isHourlyBaselineWindow,
  inspectDataHealth,
  runWatchdog,
} from "../infra/cloudflare-watchdog/src/index.mjs";


const NOW = Date.parse("2026-08-27T04:00:00Z");
const ENV = {
  GITHUB_REPOSITORY: "line-rangers-fan/line-rangers-pvp",
  DATA_URL: "https://line-rangers-fan.github.io/line-rangers-pvp/data/character_usage_health.json",
  GITHUB_ACTIONS_TOKEN: "test-token",
};

function healthyData(updatedAt, overrides = {}) {
  const pending = () => Object.fromEntries(["hour", "day", "week", "month"].map((period) => [period, {
    comparable: false, rank: null, occurrence_count: null, from_updated_at: null, interval_minutes: null,
  }]));
  return {
    schema_version: 11,
    updated_at: updatedAt,
    target_players: 200,
    sampled_players: 200,
    complete_target: true,
    character_slots: 200,
    unique_characters: 1,
    characters: [{
      unit_code: "u-a", rank: 1, occurrence_count: 200, player_count: 200, adoption_rate: 100,
      change: { periods: pending() },
      equipment_rankings: Object.fromEntries(["WEAPON", "ARMOR", "ACC"].map((kind) => [kind, {
        equipped_occurrence_count: 200, equipped_player_count: 200,
        items: [{item_code: `item-${kind}`, rank: 1, occurrence_count: 200, player_count: 200, change: {periods: pending()}}],
      }])),
    }],
    collection_quality: {
      sample_coverage: 100,
      equipment_fill_rate: 99.9,
      detail_fetch_failures: 0,
      invalid_player_records: 0,
      collection_duration_seconds: 42.5,
      detail_fetch_duration_seconds: 40,
    },
    comparison: {
      reference_mode: "jst_calendar_close_v1",
      calendar_date: new Date(Date.parse(updatedAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
      periods: {
        hour: { comparable: false },
        day: { comparable: false },
        week: { comparable: false },
        month: { comparable: false },
      },
    },
    ...overrides,
  };
}


function healthySummary(updatedAt, overrides = {}) {
  const data = healthyData(updatedAt);
  return {
    health_schema_version: 1,
    source_schema_version: data.schema_version,
    updated_at: data.updated_at,
    target_players: data.target_players,
    sampled_players: data.sampled_players,
    character_slots: data.character_slots,
    unique_characters: data.unique_characters,
    complete_target: data.complete_target,
    validated_full_sample: true,
    collection_quality: data.collection_quality,
    comparison: data.comparison,
    ...overrides,
  };
}


test("compact verified health summary preserves strict collection checks", () => {
  const now = Date.parse("2026-08-27T04:00:00Z");
  assert.equal(inspectDataHealth(healthySummary("2026-08-27T03:50:00Z"), now).status, "ok");
  assert.equal(
    inspectDataHealth(healthySummary("2026-08-27T03:50:00Z", {validated_full_sample: false}), now).status,
    "invalid_data",
  );
  assert.equal(
    inspectDataHealth(healthySummary("2026-08-27T03:50:00Z", {unique_characters: 0}), now).status,
    "invalid_data",
  );
});


test("fresh data does not dispatch GitHub outside the hourly baseline window", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    return new Response(
      JSON.stringify(healthyData("2026-08-27T03:50:00Z")),
      { status: 200 },
    );
  };

  const result = await runWatchdog(ENV, {
    fetchImpl,
    nowMs: Date.parse("2026-08-27T04:20:00Z"),
  });

  assert.deepEqual(result, { dispatched: false, reason: "fresh" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "error");
});


test("hourly baseline forces a collection even when current data is fresh", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-27T03:50:00Z")),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  assert.equal(isHourlyBaselineWindow(NOW), true);
  assert.equal(isHourlyBaselineWindow(Date.parse("2026-08-27T04:20:00Z")), false);
  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, { dispatched: true, reason: "hourly_baseline" });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    ref: "main",
    inputs: { force_collection: "true" },
  });
});


test("JST calendar close forces a verified baseline collection", async () => {
  const calls = [];
  const closeWindow = Date.parse("2026-08-30T13:05:00Z"); // 22:05 JST
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-30T12:50:00Z")),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  assert.equal(isCalendarAnchorWindow(closeWindow), true);
  assert.equal(
    isCalendarAnchorWindow(Date.parse("2026-08-30T12:05:00Z")),
    false,
  );
  const result = await runWatchdog(ENV, { fetchImpl, nowMs: closeWindow });

  assert.deepEqual(result, { dispatched: true, reason: "calendar_anchor" });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    ref: "main",
    inputs: { force_collection: "true" },
  });
});


test("stale data dispatches the guarded collection workflow", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-27T02:54:00Z")),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, {
    dispatched: true,
    reason: "stale",
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /update-character-usage\.yml\/dispatches$/);
  assert.equal(calls[1].options.method, "POST");
  assert.equal(
    calls[1].options.headers.Authorization,
    "Bearer test-token",
  );
});


test("missing and future timestamps request repair", () => {
  assert.equal(dataNeedsCollection({}, NOW), true);
  assert.equal(
    dataNeedsCollection(healthyData("2026-08-27T04:11:00Z"), NOW),
    true,
  );
});


test("health snapshot reports freshness and age", async () => {
  const fetchImpl = async () => new Response(
    JSON.stringify(healthyData("2026-08-27T03:10:00Z")),
    { status: 200 },
  );

  const health = await getHealthSnapshot(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(health, {
    status: "ok",
    service: "line-rangers-pvp-watchdog",
    read_error: null,
    schedule: "*/15 * * * *",
    updated_at: "2026-08-27T03:10:00Z",
    age_minutes: 50,
    sampled_players: 200,
    target_players: 200,
    equipment_fill_rate: 99.9,
    detail_fetch_failures: 0,
    invalid_player_records: 0,
    collection_duration_seconds: 42.5,
    detail_fetch_duration_seconds: 40,
    stale_after_minutes: 60,
    checked_at: "2026-08-27T04:00:00.000Z",
  });
});


test("health inspection distinguishes stale and invalid data", () => {
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T02:54:00Z"),
      NOW,
    ).status,
    "stale",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", { schema_version: 9 }),
      NOW,
    ).status,
    "invalid_data",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", {
        comparison: {
          periods: {
            day: { comparable: false },
            week: { comparable: false },
            month: { comparable: false },
          },
        },
      }),
      NOW,
    ).status,
    "invalid_data",
  );
  assert.equal(inspectDataHealth({}, NOW).status, "unreadable");
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T04:11:00Z"),
      NOW,
    ).status,
    "invalid_timestamp",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", { sampled_players: 199 }),
      NOW,
    ).status,
    "invalid_data",
  );
  assert.equal(
    inspectDataHealth(
      healthyData("2026-08-27T03:10:00Z", {
        collection_quality: {
          ...healthyData("2026-08-27T03:10:00Z").collection_quality,
          detail_fetch_duration_seconds: 60,
          collection_duration_seconds: 30,
        },
      }),
      NOW,
    ).status,
    "invalid_data",
  );
});


test("fresh but incomplete data triggers repair", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.startsWith(ENV.DATA_URL)) {
      return new Response(
        JSON.stringify(healthyData("2026-08-27T03:50:00Z", {
          complete_target: false,
        })),
        { status: 200 },
      );
    }
    return new Response(null, { status: 204 });
  };

  const result = await runWatchdog(ENV, { fetchImpl, nowMs: NOW });

  assert.deepEqual(result, { dispatched: true, reason: "invalid_data" });
  assert.equal(calls.length, 2);
});


test("watchdog rejects unsafe repository and data URL configuration", async () => {
  await assert.rejects(
    runWatchdog({ ...ENV, GITHUB_REPOSITORY: "owner/repo/extra" }),
    /owner\/repository/,
  );
  await assert.rejects(
    getHealthSnapshot({ ...ENV, DATA_URL: "http://example.test/data.json" }),
    /published ranking JSON URL/,
  );
  await assert.rejects(
    getHealthSnapshot({ ...ENV, DATA_URL: "https://example.test/data.json" }),
    /published ranking JSON URL/,
  );
});


test("oversized published data is treated as unreadable", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let health;
  try {
    health = await getHealthSnapshot(ENV, {
      fetchImpl: async () => new Response(
        "x".repeat(4 * 1024 * 1024 + 1),
        { status: 200 },
      ),
      nowMs: NOW,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(health.status, "unreadable");
});


test("collection exceeding the deadline requests a repair", () => {
  const data = healthyData("2026-08-27T03:50:00Z", {
    collection_quality: {
      ...healthyData("2026-08-27T03:50:00Z").collection_quality,
      collection_duration_seconds: 15 * 60 + 1,
    },
  });

  assert.equal(inspectDataHealth(data, NOW).status, "invalid_data");
});


test("healthy flags cannot hide corrupt counts or comparison fields", () => {
  const corruptions = [
    data => {data.characters[0].occurrence_count = -1;},
    data => {data.characters[0].occurrence_count = null;},
    data => {data.characters[0].player_count = 201;},
    data => {data.character_slots = 201;},
    data => {data.characters.push(structuredClone(data.characters[0]));},
    data => {data.characters[0].equipment_rankings.WEAPON.items[0].occurrence_count = -1;},
    data => {data.characters[0].equipment_rankings.WEAPON.items[0].player_count = 201;},
    data => {data.characters[0].equipment_rankings.WEAPON.items[0].occurrence_count = 199;},
    data => {delete data.characters[0].change.periods.hour;},
    data => {delete data.characters[0].equipment_rankings.WEAPON.items[0].change;},
    data => {data.comparison.calendar_date = "1900-01-01";},
    data => {data.comparison.periods.hour.comparable = true;},
    data => {data.target_players = data.sampled_players = 199;},
  ];
  for (const corrupt of corruptions) {
    const data = healthyData("2026-08-27T03:50:00Z");
    corrupt(data);
    assert.equal(inspectDataHealth(data, NOW).status, "invalid_data");
  }
});


test("invalid data forces repair outside hourly and closing windows", async () => {
  const data = healthyData("2026-08-27T04:15:00Z");
  data.characters[0].occurrence_count = -1;
  const calls = [];
  const result = await runWatchdog(ENV, {
    nowMs: Date.parse("2026-08-27T04:20:00Z"),
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      return url.startsWith(ENV.DATA_URL)
        ? new Response(JSON.stringify(data), {status: 200})
        : new Response(null, {status: 204});
    },
  });
  assert.deepEqual(result, {dispatched: true, reason: "invalid_data"});
  assert.equal(JSON.parse(calls[1].options.body).inputs.force_collection, "true");
});


function attachPeriod(data, period, reference) {
  const interval = Math.round((Date.parse(data.updated_at) - Date.parse(reference)) / 6000) / 10;
  data.comparison.periods[period] = {
    comparable: true, updated_at: reference,
    calendar_date: new Date(Date.parse(reference) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  };
  for (const character of data.characters) {
    const rows = [character, ...Object.values(character.equipment_rankings).flatMap(category => category.items)];
    for (const row of rows) row.change.periods[period] = {
      comparable: true, rank: 0, occurrence_count: 0, from_updated_at: reference, interval_minutes: interval,
    };
  }
}


test("valid hourly and fixed closing references remain healthy", () => {
  const data = healthyData("2026-08-30T22:00:00Z"); // Monday 07:00 JST
  attachPeriod(data, "hour", "2026-08-30T21:20:00Z");
  attachPeriod(data, "day", "2026-08-30T13:15:00Z");
  attachPeriod(data, "week", "2026-08-30T13:15:00Z");
  assert.equal(inspectDataHealth(data, Date.parse(data.updated_at)).status, "ok");
  for (const minutes of [30, 60, 90]) {
    attachPeriod(data, "hour", new Date(Date.parse(data.updated_at) - minutes * 60_000).toISOString());
    assert.equal(inspectDataHealth(data, Date.parse(data.updated_at)).status, "ok");
  }
  for (const minutes of [29, 91]) {
    attachPeriod(data, "hour", new Date(Date.parse(data.updated_at) - minutes * 60_000).toISOString());
    assert.equal(inspectDataHealth(data, Date.parse(data.updated_at)).status, "invalid_data");
  }
});


test("wrong close dates and unknown comparable deltas request repair", () => {
  const data = healthyData("2026-08-30T22:00:00Z");
  attachPeriod(data, "day", "2026-08-30T14:15:00Z");
  const badDate = structuredClone(data);
  badDate.comparison.periods.day.calendar_date = "1900-01-01";
  assert.equal(inspectDataHealth(badDate, Date.parse(data.updated_at)).status, "invalid_data");
  const nullDelta = structuredClone(data);
  nullDelta.characters[0].change.periods.day.occurrence_count = null;
  assert.equal(inspectDataHealth(nullDelta, Date.parse(data.updated_at)).status, "invalid_data");
  attachPeriod(data, "day", "2026-08-30T12:59:00Z");
  assert.equal(inspectDataHealth(data, Date.parse(data.updated_at)).status, "invalid_data");
});


test("Python microsecond timestamps do not cause a false rounding alarm", () => {
  const data = healthyData("2026-08-30T22:00:00.000000Z");
  attachPeriod(data, "hour", "2026-08-30T21:00:57.000500Z");
  for (const character of data.characters) {
    const rows = [character, ...Object.values(character.equipment_rankings).flatMap(category => category.items)];
    for (const row of rows) row.change.periods.hour.interval_minutes = 59.0;
  }
  assert.equal(inspectDataHealth(data, Date.parse(data.updated_at)).status, "ok");
});
