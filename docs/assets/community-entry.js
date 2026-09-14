// File: docs/assets/community-entry.js
"use strict";

// Approved external community entry. The renderer is intentionally isolated
// from PvP data loading: it performs no fetches, no API calls, and no health
// checks against the community site.
const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: false,
  state: true,
  url: "https://rangers-community-review.n-yu1791.chatgpt.site/",
  allowedHosts: Object.freeze([
    "rangers-community-review.n-yu1791.chatgpt.site",
  ]),
});

function normalizeCommunityBoardEntryState(value) {
  if (value === true || value === false || value === "preview") {
    return value;
  }
  return false;
}

function isOwnerPreviewContext() {
  return (
    document.documentElement?.dataset?.ownerPreview === "true" ||
    document.body?.dataset?.ownerPreview === "true"
  );
}

function getApprovedCommunityBoardUrl(rawUrl, allowedHosts) {
  if (typeof rawUrl !== "string" || !Array.isArray(allowedHosts)) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/" ||
      !allowedHosts.includes(url.hostname)
    ) {
      return null;
    }
    return url.href;
  } catch (_error) {
    return null;
  }
}

function buildCommunityBoardEntry(url) {
  const link = document.createElement("a");
  link.className = "community-board-entry-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "新キャラ情報掲示板を新しいタブで開く");

  const title = document.createElement("strong");
  title.className = "community-board-entry-title";
  title.textContent = "新キャラ情報掲示板";

  const description = document.createElement("span");
  description.className = "community-board-entry-description";
  description.textContent = "新キャラの評価・コメント・動画を見る";

  link.append(title, description);
  return link;
}

function renderCommunityBoardEntry() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;

  // Fail closed first. A missing/invalid config never leaves a clickable area.
  slot.replaceChildren();
  slot.hidden = true;

  const configuredState = normalizeCommunityBoardEntryState(
    COMMUNITY_BOARD_ENTRY_CONFIG?.state ??
      COMMUNITY_BOARD_ENTRY_CONFIG?.defaultState ??
      false
  );

  if (configuredState === false) return;
  if (configuredState === "preview" && !isOwnerPreviewContext()) return;

  const approvedUrl = getApprovedCommunityBoardUrl(
    COMMUNITY_BOARD_ENTRY_CONFIG?.url,
    COMMUNITY_BOARD_ENTRY_CONFIG?.allowedHosts
  );
  if (!approvedUrl) return;

  slot.appendChild(buildCommunityBoardEntry(approvedUrl));
  slot.hidden = false;
}

document.addEventListener("DOMContentLoaded", renderCommunityBoardEntry);
