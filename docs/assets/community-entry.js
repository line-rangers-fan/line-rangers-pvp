// File: docs/assets/community-entry.js
"use strict";

// Keep the board isolated from PvP data loading: this entry performs no board
// API fetches. A board outage therefore cannot stop the ranking from rendering.
const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: false,
  state: true,
  // Latest approved development board. Link directly to /boards so users do
  // not encounter the obsolete landing/intermediate page.
  url: "https://line-rangers-community-dev.n-yu1791.chatgpt.site/boards",
  allowedHosts: Object.freeze([
    "line-rangers-community-dev.n-yu1791.chatgpt.site",
  ]),
  allowedPath: "/boards",
});

function normalizeCommunityBoardEntryState(value) {
  return value === true;
}

function getApprovedCommunityBoardUrl(rawUrl, allowedHosts, allowedPath) {
  if (
    typeof rawUrl !== "string" ||
    !Array.isArray(allowedHosts) ||
    typeof allowedPath !== "string"
  ) {
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
      url.pathname !== allowedPath ||
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
  const title = textElement("h2", "community-board-entry-title", "新キャラ情報掲示板");
  title.id = "community-board-entry-title";
  const description = textElement("p", "community-board-entry-description", "投票・コメント・動画で、新キャラについて話そう。");
  headingText.append(title, description);
  headingRow.append(marker, headingText);

  const featured = document.createElement("div");
  featured.className = "community-board-entry-featured";
  const featuredLabel = textElement("strong", "community-board-entry-featured-label", "注目コメント");
  const featuredText = textElement("p", "community-board-entry-featured-text", "最新の注目コメントは掲示板で確認できます。");
  featured.append(featuredLabel, featuredText);

  const button = document.createElement("a");
  button.className = "community-board-entry-button";
  button.href = url;
  // Same-tab navigation makes the board feel like one site and avoids the
  // previous extra window/landing-page hop.
  button.textContent = "掲示板を開く →";
  button.setAttribute("aria-label", "新キャラ情報掲示板を開く");

  card.append(headingRow, featured, button);
  return card;
}

function renderCommunityBoardEntry() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
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
    COMMUNITY_BOARD_ENTRY_CONFIG?.allowedHosts,
    COMMUNITY_BOARD_ENTRY_CONFIG?.allowedPath
  );
  if (!approvedUrl) return;

  slot.appendChild(buildCommunityBoardEntry(approvedUrl));
  slot.hidden = false;
}

document.addEventListener("DOMContentLoaded", renderCommunityBoardEntry);
