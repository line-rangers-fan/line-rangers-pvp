// The workflow normally publishes once per hour. The watchdog checks more
// often, but dispatches a collection only after a full hour has elapsed.
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
const PUBLISHED_DATA_PATH = "/line-rangers-pvp/data/character_usage.json";
const SERVICE_NAME = "line-rangers-pvp-watchdog";
const SCHEDULE = "*/15 * * * *";
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;


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


async function fetchWithTimeout(fetchImpl, url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    EXTERNAL_REQUEST_TIMEOUT_MS,
  );
  try {
    return await fetchImpl(url, {
      ...options,
      redirect: "error",
      signal: controller.signal,
    });
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
  const schemaVersion = Number(data?.schema_version);
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
    targetPlayers > 0 &&
    sampledPlayers === targetPlayers &&
    data?.complete_target === true &&
    Array.isArray(data?.characters) &&
    data.characters.length > 0 &&
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
    equipmentFillRate >= 0 &&
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


async function fetchPublishedData(dataUrl, fetchImpl, nowMs, queryName) {
  const url = new URL(dataUrl);
  url.searchParams.set(queryName, String(nowMs));
  const response = await fetchWithTimeout(fetchImpl, url.toString(), {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Published data request failed: HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers?.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DATA_RESPONSE_BYTES) {
    throw new Error("Published data response exceeds the safety limit.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_DATA_RESPONSE_BYTES) {
    throw new Error("Published data response exceeds the safety limit.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Published data response is not valid JSON.");
  }
}


export async function getHealthSnapshot(
  env,
  { fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const dataUrl = requiredPublishedDataUrl(env);
  let dataHealth;
  try {
    const data = await fetchPublishedData(dataUrl, fetchImpl, nowMs, "health");
    dataHealth = inspectDataHealth(data, nowMs);
  } catch (error) {
    console.warn("Health check could not read published data.", error);
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
    console.warn("Freshness check failed; requesting a guarded repair.", error);
  }

  if (repairReason === "ok" && !calendarAnchor) {
    return { dispatched: false, reason: "fresh" };
  }

  const token = requiredEnvironment(env, "GITHUB_ACTIONS_TOKEN");
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
        inputs: { force_collection: calendarAnchor ? "true" : "false" },
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
    reason: calendarAnchor ? "calendar_anchor" : repairReason,
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
