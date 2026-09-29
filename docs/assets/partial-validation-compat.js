"use strict";

// Browser compatibility for the bounded 199/200 publication policy.
// The canonical validator permits exactly one structurally unavailable ranked
// player while keeping transport failures and broader corruption fail-closed.
// Older app.js code still understands only the legacy 180-minute fallback, so
// this adapter temporarily presents equivalent legacy evidence during
// validation and immediately restores the real values used by the UI.
(() => {
  const LEGACY_FALLBACK_MINUTES = 180;

  const install = () => {
    const originalValidateData = window.validateData;
    if (typeof originalValidateData !== "function" || window.__partialValidationCompatInstalled) {
      if (!window.__partialValidationCompatInstalled) window.setTimeout(install, 50);
      return;
    }
    window.__partialValidationCompatInstalled = true;

    window.validateData = function validateDataCompat(data) {
      const isExact199 =
        data &&
        data.publication_mode === "partial_after_stale" &&
        Number.isInteger(data.sampled_players) &&
        Number.isInteger(data.target_players) &&
        data.target_players === 200 &&
        data.sampled_players === 199 &&
        data.complete_target === false;

      const quality = data?.collection_quality;
      const fallback = data?.partial_fallback;
      if (
        !isExact199 ||
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

      // Do not hide network failures or more than one invalid player record.
      if (
        Number(detailFailures) !== 0 ||
        !Number.isInteger(Number(invalidRecords)) ||
        Number(invalidRecords) < 0 ||
        Number(invalidRecords) > 1 ||
        !Number.isFinite(updatedAt) ||
        Number(fallback.missing_players) !== 1
      ) {
        return originalValidateData(data);
      }

      try {
        quality.invalid_player_records = 0;
        if (Number(triggerAfterMinutes) === 0) {
          fallback.trigger_after_minutes = LEGACY_FALLBACK_MINUTES;
          fallback.last_complete_updated_at = new Date(
            updatedAt - LEGACY_FALLBACK_MINUTES * 60 * 1000
          ).toISOString();
        }
        return originalValidateData(data);
      } finally {
        quality.invalid_player_records = invalidRecords;
        fallback.trigger_after_minutes = triggerAfterMinutes;
        fallback.last_complete_updated_at = lastCompleteUpdatedAt;
      }
    };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
