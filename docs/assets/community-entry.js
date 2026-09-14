// File: docs/assets/community-entry.js
"use strict";

// The community board remains an isolated external service for now, but its
// entry point is rendered natively inside this repository-owned PvP page.
// This script intentionally performs no fetches so a board outage can never
// prevent PvP ranking data from loading.
const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: false,
  state: true,
  url: "https://rangers-community-review.n-yu1791.chatgpt.site/",
  allowedHosts: Object.freeze([
    "rangers-community-review.n-yu1791.chatgpt.site",
  ]),
});

function normalizeCommunityBoardEntryState(value) {
  return value === true;
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

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function buildCommunityBoardEntry(url) {
  const card = document.createElement("section");
  card.className = "community-board-entry-card";
  card.setAttribute("aria-labelledby", "community-board-entry-title");

  const headingRow = document.createElement("div");
  headingRow.className = "community-board-entry-heading";

  const marker = textElement("span", "community-board-entry-marker", "●");
  marker.setAttribute("aria-hidden", "true");

  const headingText = document.createElement("div");
  headingText.className = "community-board-entry-heading-text";

  const title = textElement(
    "h2",
    "community-board-entry-title",
    "新キャラ情報掲示板"
  );
  title.id = "community-board-entry-title";

  const description = textElement(
    "p",
    "community-board-entry-description",
    "投票・コメント・動画で、新キャラについて話そう。"
  );

  headingText.append(title, description);
  headingRow.append(marker, headingText);

  const featured = document.createElement("div");
  featured.className = "community-board-entry-featured";

  const featuredLabel = textElement(
    "strong",
    "community-board-entry-featured-label",
    "注目コメント"
  );
  const featuredText = textElement(
    "p",
    "community-board-entry-featured-text",
    "最新の注目コメントは掲示板で確認できます。"
  );
  featured.append(featuredLabel, featuredText);

  const button = document.createElement("a");
  button.className = "community-board-entry-button";
  button.href = url;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  button.textContent = "掲示板を開く ↗";
  button.setAttribute("aria-label", "新キャラ情報掲示板を新しいタブで開く");

  card.append(headingRow, featured, button);
  return card;
}

function renderCommunityBoardEntry() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;

  // Fail closed first. Missing or malformed config never creates a link.
  slot.replaceChildren();
  slot.hidden = true;

  const enabled = normalizeCommunityBoardEntryState(
    COMMUNITY_BOARD_ENTRY_CONFIG?.state ??
      COMMUNITY_BOARD_ENTRY_CONFIG?.defaultState ??
      false
  );
  if (!enabled) return;

  const approvedUrl = getApprovedCommunityBoardUrl(
    COMMUNITY_BOARD_ENTRY_CONFIG?.url,
    COMMUNITY_BOARD_ENTRY_CONFIG?.allowedHosts
  );
  if (!approvedUrl) return;

  slot.appendChild(buildCommunityBoardEntry(approvedUrl));
  slot.hidden = false;
}

document.addEventListener("DOMContentLoaded", renderCommunityBoardEntry);
