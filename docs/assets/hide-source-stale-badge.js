"use strict";

// The source-stale state is still used internally for safety/comparison guards,
// but the public header should not show the old "source update pending" badge.
// Partial-update status remains visible because its text is different.
(() => {
  const hiddenLabels = new Set([
    "取得元更新待ち",
    "Source update pending",
    "等待來源更新",
    "รอแหล่งข้อมูลอัปเดต",
  ]);

  const apply = () => {
    const badge = document.getElementById("summary-freshness");
    if (!badge) return;
    badge.hidden = hiddenLabels.has((badge.textContent || "").trim());
  };

  const start = () => {
    apply();
    const badge = document.getElementById("summary-freshness");
    if (!badge) {
      window.setTimeout(start, 100);
      return;
    }
    new MutationObserver(apply).observe(badge, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
