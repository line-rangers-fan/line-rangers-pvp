const MAX_AGE_MS = 55 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;


function requiredEnvironment(env, name) {
  const value = String(env?.[name] || "").trim();
  if (!value) {
    throw new Error(`Missing Cloudflare secret or variable: ${name}`);
  }
  return value;
}


export function dataNeedsCollection(data, nowMs = Date.now()) {
  const updatedMs = Date.parse(data?.updated_at || "");
  if (!Number.isFinite(updatedMs)) return true;
  const ageMs = nowMs - updatedMs;
  return ageMs >= MAX_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS;
}


export async function runWatchdog(
  env,
  { fetchImpl = fetch, nowMs = Date.now() } = {},
) {
  const repository = requiredEnvironment(env, "GITHUB_REPOSITORY");
  const dataUrl = requiredEnvironment(env, "DATA_URL");
  const token = requiredEnvironment(env, "GITHUB_ACTIONS_TOKEN");

  let stale = true;
  try {
    const dataResponse = await fetchImpl(
      `${dataUrl}?watchdog=${nowMs}`,
      {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );
    if (dataResponse.ok) {
      stale = dataNeedsCollection(await dataResponse.json(), nowMs);
    }
  } catch (error) {
    console.warn("Freshness check failed; requesting a guarded repair.", error);
  }

  if (!stale) {
    return { dispatched: false, reason: "fresh" };
  }

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
  return { dispatched: true, reason: "stale_or_unreadable" };
}


export default {
  scheduled(_controller, env, context) {
    context.waitUntil(
      runWatchdog(env).then((result) => {
        console.log(JSON.stringify(result));
      }),
    );
  },
};
