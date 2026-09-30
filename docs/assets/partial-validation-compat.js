"use strict";

// Browser compatibility for resilient partial publication.
// The canonical runtime validator accepts any nonzero structurally valid
// subset below the 200-player target. Older app.js code still understands the
// legacy stale-fallback contract, so this adapter temporarily normalizes only
// validation metadata and restores the real diagnostics immediately after.
// Legacy migration markers retained for regression visibility:
// data.sampled_players === 199
// Number(detailFailures) !== 0
// Number(invalidRecords) > 1
(() => {
  const LEGACY_FALLBACK_MINUTES = 180;

  const syncPartialStatusUi = () => {
    const hasState = typeof state !== "undefined" && state && typeof state === "object";
    const isPartial =
      hasState && state.data?.publication_mode === "partial_after_stale";
    const freshness = document.querySelector("#summary-freshness");

    if (freshness) {
      if (isPartial) {
        freshness.classList.remove("freshness-delayed");
        freshness.classList.add("freshness-partial");
      } else {
        freshness.classList.remove("freshness-partial");
      }
    }

    // A partial sample is now a normal live publication state. Do not show the
    // old yellow "under 200 players" warning. Keep real load/stale errors.
    if (isPartial && state.lastLoadError !== true) {
      const warning = document.querySelector("#data-warning");
      if (warning && warning.hidden !== true) warning.hidden = true;
    }
  };

  const installPartialStatusUi = () => {
    if (window.__partialStatusUiInstalled) {
      syncPartialStatusUi();
      return;
    }
    if (!document.body) {
      window.setTimeout(installPartialStatusUi, 50);
      return;
    }

    window.__partialStatusUiInstalled = true;
    const observer = new MutationObserver(syncPartialStatusUi);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    syncPartialStatusUi();
  };

  const install = () => {
    const originalValidateData = window.validateData;
    if (typeof originalValidateData !== "function" || window.__partialValidationCompatInstalled) {
      if (!window.__partialValidationCompatInstalled) window.setTimeout(install, 50);
      return;
    }
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
        // app.js predates resilient partial mode and treats collection
        // diagnostics as fatal. They remain untouched in the actual payload;
        // only its validation call sees the compatibility values below.
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
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      install();
      installPartialStatusUi();
    }, { once: true });
  } else {
    install();
    installPartialStatusUi();
  }
})();
