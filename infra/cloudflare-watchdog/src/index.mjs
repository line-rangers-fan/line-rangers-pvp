// The workflow normally publishes once per hour. The watchdog checks more
// often and pins one verified collection to each hour, while still repairing
// stale or invalid data between those hourly baselines.
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const EXTERNAL_REQUEST_TIMEOUT_MS = 12_000;
const MAX_DATA_RESPONSE_BYTES = 4 * 1024 * 1024;
// Match the collector's deadline so a slow run is repaired promptly.
const MAX_COLLECTION_DURATION_SECONDS = 15 * 60;
const MIN_SCHEMA_VERSION = 11;
const CALENDAR_CLOSE_REFERENCE_MODE = "jst_calendar_close_v1";
const REQUIRED_PERIODS = ["hour", "day", "week", "month"];
const PUBLISHED_DATA_HOST = "line-rangers-fan.github.io";
const PUBLISHED_DATA_PATH = "/line-rangers-pvp/data/character_usage_health.json";
const SERVICE_NAME = "line-rangers-pvp-watchdog";
const SCHEDULE = "*/15 * * * *";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ACTIVE_WORKFLOW_STATUSES = new Set([
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
]);


function requiredEnvironment(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) {
    throw new Error(`Missing Cloudflare secret or variable: ${name}`);
  }
  return value;
}


function requiredRepository(env) {
  const repository = requiredEnvironment(env, "GITHUB_REPOSITORY");
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository value.");
  }
  return repository;
}


function requiredPublishedDataUrl(env) {
  const value = requiredEnvironment(env, "DATA_URL");
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== PUBLISHED_DATA_HOST ||
      url.pathname !== PUBLISHED_DATA_PATH ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid URL");
    }
    return url.toString();
  } catch {
    throw new Error("DATA_URL must be the published ranking JSON URL.");
  }
}


class WatchdogReadError extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}


function safeReadError(error) {
  // Never expose upstream bodies, URLs, credentials, or arbitrary exception
  // messages through this public health endpoint or scheduled-event logs.
  if (error instanceof WatchdogReadError) {
    return {code: error.code, http_status: error.httpStatus};
  }
  const code = error?.name === "AbortError" ? "timeout"
    : /illegal invocation|incorrect.*this/i.test(String(error?.message || "")) ? "runtime_binding"
    : error?.name === "TypeError" ? "fetch_type_error"
    : "fetch_error";
  return {code, http_status: null};
}


async function fetchWithTimeout(fetchImpl, url, options = {}, consumeResponse = null) {
  const controller = new AbortController();
  let timeoutId;
  const deadline = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new WatchdogReadError("timeout"));
    }, EXTERNAL_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          ...options,
          // workerd rejects the Fetch API's "error" mode before any I/O.
          // Return redirects without following them; both callers below reject
          // non-2xx responses, including all 3xx, before consuming/using them.
          redirect: "manual",
          signal: controller.signal,
        });
        return consumeResponse ? await consumeResponse(response, controller.signal) : response;
      })(),
      deadline,
    ]);
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}


export function dataNeedsCollection(data, nowMs = Date.now()) {
  return inspectDataHealth(data, nowMs).status !== "ok";
}


export function isCalendarAnchorWindow(nowMs = Date.now()) {
  // Japan Standard Time is permanently UTC+09:00, with no daylight-saving
  // transition. Use UTC accessors after the fixed offset so the schedule is
  // independent of the Worker runtime's locale and time zone.
  const tokyoTime = new Date(nowMs + 9 * 60 * 60 * 1000);
  const hour = tokyoTime.getUTCHours();
  const minute = tokyoTime.getUTCMinutes();
  // The Worker runs every 15 minutes. A short window tolerates a delayed
  // event without forcing normal collections throughout the evening.
  return (hour === 22 || hour === 23) && minute < 15;
}


export function isHourlyBaselineWindow(nowMs = Date.now()) {
  // The Worker runs every 15 minutes.  The first event in each clock hour is
  // intentionally forced so the public history always has an hourly sample.
  // UTC hour boundaries are also JST hour boundaries, so no date conversion
  // is needed here.
  return new Date(nowMs).getUTCMinutes() < 15;
}


function integerInRange(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}


function jstDate(timestamp) {
  return new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}


function validComparison(data, updatedMs) {
  const comparison = data.comparison;
  if (comparison?.calendar_date !== jstDate(updatedMs)) return false;
  const midnight = Date.parse(`${jstDate(updatedMs)}T00:00:00Z`);
  const currentDate = new Date(midnight);
  const dayMs = 24 * 60 * 60 * 1000;
  const closeDates = {
    day: new Date(midnight - dayMs).toISOString().slice(0, 10),
    week: new Date(midnight - (currentDate.getUTCDay() || 7) * dayMs).toISOString().slice(0, 10),
    month: new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 0)).toISOString().slice(0, 10),
  };
  return REQUIRED_PERIODS.every((period) => {
    const summary = comparison?.periods?.[period];
    if (typeof summary?.comparable !== "boolean") return false;
    if (!summary.comparable) return summary.updated_at == null && summary.calendar_date == null;
    const reference = typeof summary.updated_at === "string" ? Date.parse(summary.updated_at) : NaN;
    if (!Number.isFinite(reference) || summary.calendar_date !== jstDate(reference)) return false;
    const age = updatedMs - reference;
    if (period === "hour") return age >= 30 * 60_000 && age <= 90 * 60_000;
    const hour = new Date(reference + 9 * 60 * 60 * 1000).getUTCHours();
    return summary.calendar_date === closeDates[period] && (hour === 22 || hour === 23);
  });
}


function validRowPeriods(row, data, updatedMs) {
  return REQUIRED_PERIODS.every((period) => {
    const value = row?.change?.periods?.[period];
    if (typeof value?.comparable !== "boolean") return false;
    if (!value.comparable) {
      return ["rank", "occurrence_count", "from_updated_at", "interval_minutes"]
        .every((key) => value[key] == null);
    }
    const summary = data.comparison.periods[period];
    if (!summary.comparable || value.from_updated_at !== summary.updated_at) return false;
    const interval = (updatedMs - Date.parse(summary.updated_at)) / 60_000;
    return Number.isSafeInteger(value.occurrence_count) &&
      (value.rank === null || Number.isSafeInteger(value.rank)) &&
      typeof value.interval_minutes === "number" &&
      // Python rounds to one decimal and preserves microseconds; Date.parse
      // preserves milliseconds. Accept that rounding, not a changed baseline.
      Math.abs(value.interval_minutes - interval) <= 0.051;
  });
}


function validCountStructure(data, updatedMs) {
  const slots = data.character_slots;
  if (!integerInRange(slots, 200, 2000) || data.unique_characters !== data.characters.length) return false;
  if (!validComparison(data, updatedMs)) return false;
  const codes = new Set();
  let total = 0;
  let previousCount = Infinity;
  let previousRank = 0;
  return data.characters.every((row, index) => {
    const count = row?.occurrence_count;
    const players = row?.player_count;
    const rank = count === previousCount ? previousRank : index + 1;
    if (
      typeof row?.unit_code !== "string" || !row.unit_code || codes.has(row.unit_code) ||
      !integerInRange(count, 1, slots) || count > previousCount ||
      !integerInRange(players, 1, Math.min(count, 200)) || row.rank !== rank ||
      typeof row.adoption_rate !== "number" || !Number.isFinite(row.adoption_rate) ||
      Math.abs(row.adoption_rate - Math.round(players / 200 * 1000) / 10) > 0.001 ||
      !validRowPeriods(row, data, updatedMs)
    ) return false;
    codes.add(row.unit_code);
    previousCount = count;
    previousRank = rank;
    total += count;
    return ["WEAPON", "ARMOR", "ACC"].every((kind) => {
      const category = row.equipment_rankings?.[kind];
      if (!category || !Array.isArray(category.items) ||
          !integerInRange(category.equipped_occurrence_count, 0, count) ||
          !integerInRange(category.equipped_player_count, 0, Math.min(players, category.equipped_occurrence_count))) return false;
      let itemTotal = 0;
      let previousItemCount = Infinity;
      let previousItemRank = 0;
      const itemCodes = new Set();
      return category.items.every((item, itemIndex) => {
        const itemRank = item?.occurrence_count === previousItemCount ? previousItemRank : itemIndex + 1;
        if (
          typeof item?.item_code !== "string" || !item.item_code || itemCodes.has(item.item_code) ||
          !integerInRange(item.occurrence_count, 1, category.equipped_occurrence_count) ||
          item.occurrence_count > previousItemCount ||
          !integerInRange(item.player_count, 1, Math.min(item.occurrence_count, category.equipped_player_count)) ||
          item.rank !== itemRank || !validRowPeriods(item, data, updatedMs)
        ) return false;
        itemCodes.add(item.item_code);
        itemTotal += item.occurrence_count;
        previousItemCount = item.occurrence_count;
        previousItemRank = itemRank;
        return true;
      }) && itemTotal === category.equipped_occurrence_count;
    });
  }) && total === slots;
}


export function inspectDataHealth(data, nowMs = Date.now()) {
  const updatedAt = String(data?.updated_at || "");
  const updatedMs = Date.parse(updatedAt);
  const quality = data?.collection_quality;
  const sampledPlayers = Number(data?.sampled_players);
  const targetPlayers = Number(data?.target_players);
  const detailFailures = Number(quality?.detail_fetch_failures);
  const invalidRecords = Number(quality?.invalid_player_records);
  const equipmentFillRate = Number(quality?.equipment_fill_rate);
  const collectionDuration = Number(quality?.collection_duration_seconds);
  const detailDuration = Number(quality?.detail_fetch_duration_seconds);
  const compactHealth = data?.health_schema_version === 1;
  const schemaVersion = Number(compactHealth ? data?.source_schema_version : data?.schema_version);
  const referenceMode = data?.comparison?.reference_mode;
  const comparisonPeriods = data?.comparison?.periods;
  const metrics = {
    sampled_players: Number.isFinite(sampledPlayers) ? sampledPlayers : null,
    target_players: Number.isFinite(targetPlayers) ? targetPlayers : null,
    equipment_fill_rate: Number.isFinite(equipmentFillRate)
      ? equipmentFillRate
      : null,
    detail_fetch_failures: Number.isFinite(detailFailures)
      ? detailFailures
      : null,
    invalid_player_records: Number.isFinite(invalidRecords)
      ? invalidRecords
      : null,
    collection_duration_seconds: Number.isFinite(collectionDuration)
      ? collectionDuration
      : null,
    detail_fetch_duration_seconds: Number.isFinite(detailDuration)
      ? detailDuration
      : null,
  };
  if (!Number.isFinite(updatedMs)) {
    return {
      status: "unreadable",
      updated_at: null,
      age_minutes: null,
      ...metrics,
    };
  }

  const ageMs = nowMs - updatedMs;
  const ageMinutes = Math.round((ageMs / 60_000) * 10) / 10;
  if (ageMs < -MAX_FUTURE_SKEW_MS) {
    return {
      status: "invalid_timestamp",
      updated_at: updatedAt,
      age_minutes: ageMinutes,
      ...metrics,
    };
  }
  const completeSample =
    Number.isInteger(schemaVersion) &&
    schemaVersion >= MIN_SCHEMA_VERSION &&
    referenceMode === CALENDAR_CLOSE_REFERENCE_MODE &&
    data.target_players === 200 && data.sampled_players === 200 &&
    sampledPlayers === targetPlayers &&
    data?.complete_target === true &&
    (compactHealth
      ? data?.validated_full_sample === true &&
        integerInRange(data?.character_slots, 200, 2000) &&
        integerInRange(data?.unique_characters, 1, data.character_slots) &&
        validComparison(data, updatedMs)
      : Array.isArray(data?.characters) &&
        data.characters.length > 0 &&
        validCountStructure(data, updatedMs)) &&
    Number(quality?.sample_coverage) === 100 &&
    detailFailures === 0 &&
    invalidRecords === 0 &&
    Number.isFinite(collectionDuration) &&
    collectionDuration >= 0 &&
    collectionDuration <= MAX_COLLECTION_DURATION_SECONDS &&
    Number.isFinite(detailDuration) &&
    detailDuration >= 0 &&
    detailDuration <= collectionDuration &&
    Number.isFinite(equipmentFillRate) &&
    // A zero rate means the source's equipment structure disappeared.  It is
    // not a legitimate empty ranking and must request a repair collection.
    equipmentFillRate > 0 &&
    equipmentFillRate <= 100 &&
    REQUIRED_PERIODS.every(
      (period) =>
        comparisonPeriods &&
        typeof comparisonPeriods[period] === "object" &&
        typeof comparisonPeriods[period]?.comparable === "boolean",
    );
  if (!completeSample) {
    return {
      status: "invalid_data",
      updated_at: updatedAt,
      age_minutes: ageMinutes,
      ...metrics,
    };
  }
  return {
    status: ageMs >= MAX_AGE_MS ? "stale" : "ok",
    updated_at: updatedAt,
    age_minutes: ageMinutes,
    ...metrics,
  };
}


async function readPublishedData(response, signal) {
  if (!response.ok) {
    throw new WatchdogReadError("http_error", response.status);
  }
  const contentLength = Number(response.headers?.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DATA_RESPONSE_BYTES) {
    throw new WatchdogReadError("response_too_large");
  }
  // Enforce the existing byte limit while receiving, not after buffering an
  // arbitrarily large response. The same deadline covers headers and body.
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  if (reader) {
    const cancel = () => {reader.cancel().catch(() => {});};
    signal.addEventListener("abort", cancel, {once: true});
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (signal.aborted) throw new WatchdogReadError("timeout");
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DATA_RESPONSE_BYTES) {
          cancel();
          throw new WatchdogReadError("response_too_large");
        }
        body += decoder.decode(value, {stream: true});
      }
      body += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new WatchdogReadError("invalid_json");
  }
}


async function fetchPublishedData(dataUrl, fetchImpl, nowMs, queryName) {
  const url = new URL(dataUrl);
  url.searchParams.set(queryName, String(nowMs));
  return fetchWithTimeout(fetchImpl, url.toString(), {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  }, readPublishedData);
}


export async function hasActiveCollection(
  repository,
  token,
  {fetchImpl = fetch} = {},
) {
  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new Error("Invalid repository for workflow inspection.");
  }
  const response = await fetchWithTimeout(
    fetchImpl,
    `https://api.github.com/repos/${repository}/actions/workflows/update-character-usage.yml/runs?branch=main&per_page=20`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "line-rangers-pvp-cloudflare-watchdog",
      },
    },
    readPublishedData,
  );
  if (!Array.isArray(response?.workflow_runs)) {
    throw new WatchdogReadError("invalid_github_response");
  }
  return response.workflow_runs.some((run) =>
    run?.head_branch === "main" && ACTIVE_WORKFLOW_STATUSES.has(run?.status)
  );
}


export async function getHealthSnapshot(
  env,
  { fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const dataUrl = requiredPublishedDataUrl(env);
  let dataHealth;
  let readError = null;
  try {
    const data = await fetchPublishedData(dataUrl, fetchImpl, nowMs, "health");
    dataHealth = inspectDataHealth(data, nowMs);
  } catch (error) {
    readError = safeReadError(error);
    console.warn("Health check could not read published data.", readError);
    dataHealth = {
      status: "unreadable",
      updated_at: null,
      age_minutes: null,
      sampled_players: null,
      target_players: null,
      equipment_fill_rate: null,
      detail_fetch_failures: null,
      invalid_player_records: null,
      collection_duration_seconds: null,
      detail_fetch_duration_seconds: null,
    };
  }

  return {
    status: dataHealth.status,
    service: SERVICE_NAME,
    read_error: readError,
    schedule: SCHEDULE,
    updated_at: dataHealth.updated_at,
    age_minutes: dataHealth.age_minutes,
    sampled_players: dataHealth.sampled_players,
    target_players: dataHealth.target_players,
    equipment_fill_rate: dataHealth.equipment_fill_rate,
    detail_fetch_failures: dataHealth.detail_fetch_failures,
    invalid_player_records: dataHealth.invalid_player_records,
    collection_duration_seconds: dataHealth.collection_duration_seconds,
    detail_fetch_duration_seconds: dataHealth.detail_fetch_duration_seconds,
    stale_after_minutes: MAX_AGE_MS / 60_000,
    checked_at: new Date(nowMs).toISOString(),
  };
}


export async function runWatchdog(
  env,
  { fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const repository = requiredRepository(env);
  const dataUrl = requiredPublishedDataUrl(env);
  const calendarAnchor = isCalendarAnchorWindow(nowMs);
  const hourlyBaseline = isHourlyBaselineWindow(nowMs);

  let repairReason = "unreadable";
  try {
    const data = await fetchPublishedData(
      dataUrl,
      fetchImpl,
      nowMs,
      "watchdog",
    );
    repairReason = inspectDataHealth(data, nowMs).status;
  } catch (error) {
    console.warn("Freshness check failed; requesting a guarded repair.", safeReadError(error));
  }

  if (repairReason === "ok" && !calendarAnchor && !hourlyBaseline) {
    return { dispatched: false, reason: "fresh" };
  }

  const token = requiredEnvironment(env, "GITHUB_ACTIONS_TOKEN");
  try {
    if (await hasActiveCollection(repository, token, {fetchImpl})) {
      // Avoid building a long serialized queue during an upstream outage.
      // The active run keeps its full retry/time allowance, and the next
      // 15-minute event will check again if it fails.
      return {dispatched: false, reason: "collection_active"};
    }
  } catch (error) {
    // Failure to inspect GitHub must not disable the recovery path. A guarded
    // duplicate is safer than suppressing collection indefinitely.
    console.warn(
      "Could not inspect active collection; continuing guarded dispatch.",
      safeReadError(error),
    );
  }
  const dispatchResponse = await fetchWithTimeout(
    fetchImpl,
    `https://api.github.com/repos/${repository}/actions/workflows/update-character-usage.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "line-rangers-pvp-cloudflare-watchdog",
      },
      body: JSON.stringify({
        ref: "main",
        // A fixed close is deliberately collected even when the last normal
        // sample is fresh. The scraper keeps the current verified data if the
        // source is unavailable, rather than publishing a partial result.
        inputs: {
          force_collection: (calendarAnchor || hourlyBaseline || repairReason !== "ok") ? "true" : "false",
        },
      }),
    },
  );
  if (!dispatchResponse.ok) {
    throw new Error(
      `GitHub workflow dispatch failed: HTTP ${dispatchResponse.status}`,
    );
  }
  return {
    dispatched: true,
    // Preserve a repair diagnosis when health was already bad; the baseline
    // window only explains a forced collection of otherwise healthy data.
    reason: repairReason !== "ok"
      ? repairReason
      : calendarAnchor
        ? "calendar_anchor"
        : "hourly_baseline",
  };
}


export default {
  async fetch(_request, env) {
    const health = await getHealthSnapshot(env);
    return new Response(
      JSON.stringify(health),
      {
        status: health.status === "ok" ? 200 : 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/json; charset=utf-8",
        },
      },
    );
  },

  scheduled(_controller, env, context) {
    context.waitUntil(
      runWatchdog(env).then((result) => {
        console.log(JSON.stringify(result));
      }).catch((error) => {
        // Scheduled events have no caller to receive an exception. Log a
        // concise failure while allowing the next hourly event to retry.
        console.error("Watchdog run failed.", error);
      }),
    );
  },
};
