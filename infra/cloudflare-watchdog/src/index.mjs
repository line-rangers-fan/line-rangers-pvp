const MAX_AGE_MS = 55 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;
const SERVICE_NAME = "line-rangers-pvp-watchdog";
const SCHEDULE = "27 * * * *";


function requiredEnvironment(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) {
    throw new Error(`Missing Cloudflare secret or variable: ${name}`);
  }
  return value;
}


export function dataNeedsCollection(data, nowMs = Date.now()) {
  return inspectDataHealth(data, nowMs).status !== "ok";
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
    collectionDuration <= 15 * 60 &&
    Number.isFinite(detailDuration) &&
    detailDuration >= 0 &&
    detailDuration <= collectionDuration &&
    Number.isFinite(equipmentFillRate) &&
    equipmentFillRate >= 0 &&
    equipmentFillRate <= 100;
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
  const response = await fetchImpl(`${dataUrl}?${queryName}=${nowMs}`, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Published data request failed: HTTP ${response.status}`);
  }
  return response.json();
}


export async function getHealthSnapshot(
  env,
  { fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const dataUrl = requiredEnvironment(env, "DATA_URL");
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
  const repository = requiredEnvironment(env, "GITHUB_REPOSITORY");
  const dataUrl = requiredEnvironment(env, "DATA_URL");

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

  if (repairReason === "ok") {
    return { dispatched: false, reason: "fresh" };
  }

  const token = requiredEnvironment(env, "GITHUB_ACTIONS_TOKEN");
  const dispatchResponse = await fetchImpl(
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
        inputs: { force_collection: "false" },
      }),
    },
  );
  if (!dispatchResponse.ok) {
    throw new Error(
      `GitHub workflow dispatch failed: HTTP ${dispatchResponse.status}`,
    );
  }
  return { dispatched: true, reason: repairReason };
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
      }),
    );
  },
};
