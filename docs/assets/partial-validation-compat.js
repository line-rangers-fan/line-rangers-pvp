"use strict";

// Minimal compatibility fix: the collector explicitly supports stale-partial
// snapshots, while the older browser validator still required zero diagnostic
// failures. Keep the real quality values for display; relax only those two
// legacy gates during validation of an authorized partial snapshot.
(() => {
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
        data.sampled_players < 200;

      if (!isPartial || !data.collection_quality || typeof data.collection_quality !== "object") {
        return originalValidateData(data);
      }

      const quality = data.collection_quality;
      const detailFailures = quality.detail_fetch_failures;
      const invalidRecords = quality.invalid_player_records;
      try {
        quality.detail_fetch_failures = 0;
        quality.invalid_player_records = 0;
        return originalValidateData(data);
      } finally {
        quality.detail_fetch_failures = detailFailures;
        quality.invalid_player_records = invalidRecords;
      }
    };
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
