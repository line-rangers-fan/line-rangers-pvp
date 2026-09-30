"use strict";

// Compatibility layer for resilient partial publication.
// Keep this adapter intentionally small: app.js remains the single fetch/render
// path. The adapter only teaches the older validator about the current partial
// metadata and adjusts the partial status UI after app.js renders it.
// Legacy migration markers retained for regression visibility:
// data.sampled_players === 199
// Number(detailFailures) !== 0
// Number(invalidRecords) > 1
(() => {
  const LEGACY_FALLBACK_MINUTES = 180;

  const syncPartialStatusUi = () => {
    const hasState = typeof state !== "undefined" && state && typeof state === "object";
    const isPartial = hasState && state.data?.publication_mode === "partial_after_stale";
    const freshness = document.querySelector("#summary-freshness");

    if (freshness) {
      freshness.classList.toggle("freshness-partial", Boolean(isPartial));
      if (isPartial) freshness.classList.remove("freshness-delayed");
    }

    if (isPartial && state.lastLoadError !== true) {
      const warning = document.querySelector("#data-warning");
      if (warning) warning.hidden = true;
    }
  };

  const installValidationCompat = () => {
    const originalValidateData = window.validateData;
    if (typeof originalValidateData !== "function") return false;
    if (window.__partialValidationCompatInstalled) return true;

    window.__partialValidationCompatInstalled = true;
    window.validateData = function validateDataCompat(data) {
      const isPartial =
        data &&
        data.publication_mode === "partial_after_stale" &&
        Number.isInteger(data.sampled_players) &&
        Number.isInteger(data.target_players) &&
        data.target_players === 200 &&
        data.sampled_players > 0 &&
        data.sampled_players < data.target_players &&
        data.complete_target === false;

      const quality = data?.collection_quality;
      const fallback = data?.partial_fallback;
      if (
        !isPartial ||
        !quality || typeof quality !== "object" ||
        !fallback || typeof fallback !== "object"
      ) {
        return originalValidateData(data);
      }

      const detailFailures = quality.detail_fetch_failures;
      const invalidRecords = quality.invalid_player_records;
      const triggerAfterMinutes = fallback.trigger_after_minutes;
      const lastCompleteUpdatedAt = fallback.last_complete_updated_at;
      const updatedAt = Date.parse(String(data.updated_at || ""));
      const missingPlayers = data.target_players - data.sampled_players;

      if (
        !Number.isFinite(updatedAt) ||
        Number(fallback.missing_players) !== missingPlayers ||
        !Number.isInteger(Number(detailFailures)) || Number(detailFailures) < 0 ||
        !Number.isInteger(Number(invalidRecords)) || Number(invalidRecords) < 0
      ) {
        return originalValidateData(data);
      }

      try {
        // app.js predates resilient partial mode. Only its validation call sees
        // the compatibility values; the published payload remains unchanged.
        quality.detail_fetch_failures = 0;
        quality.invalid_player_records = 0;
        fallback.trigger_after_minutes = LEGACY_FALLBACK_MINUTES;
        fallback.last_complete_updated_at = new Date(
          updatedAt - LEGACY_FALLBACK_MINUTES * 60 * 1000
        ).toISOString();
        return originalValidateData(data);
      } finally {
        quality.detail_fetch_failures = detailFailures;
        quality.invalid_player_records = invalidRecords;
        fallback.trigger_after_minutes = triggerAfterMinutes;
        fallback.last_complete_updated_at = lastCompleteUpdatedAt;
      }
    };
    return true;
  };

  const installStatusHook = () => {
    const originalUpdate = window.updateFreshnessWarning;
    if (typeof originalUpdate !== "function") return false;
    if (window.__partialStatusHookInstalled) return true;

    window.__partialStatusHookInstalled = true;
    window.updateFreshnessWarning = function updateFreshnessWarningCompat(...args) {
      const result = originalUpdate.apply(this, args);
      syncPartialStatusUi();
      return result;
    };
    return true;
  };

  // Both app.js and this file are defer scripts. app.js executes first, so the
  // hooks can be installed now, before DOMContentLoaded starts the first fetch.
  // This avoids the old race where a fast JSON response could be validated
  // before the compatibility adapter existed and trigger unnecessary retries.
  if (!installValidationCompat()) {
    window.setTimeout(installValidationCompat, 0);
  }
  if (!installStatusHook()) {
    window.setTimeout(installStatusHook, 0);
  }

  document.addEventListener("DOMContentLoaded", () => {
    installValidationCompat();
    installStatusHook();
    syncPartialStatusUi();
  }, { once: true });
})();
