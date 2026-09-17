// File: docs/assets/community-entry.js
"use strict";

// Keep the board isolated from PvP data loading: this entry performs no board
// API fetches. A board outage therefore cannot stop the ranking from rendering.
const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: true,
  state: true,
  // The board is published as an in-site entrance from the PvP top page. Link directly to /boards so users do not encounter the obsolete landing/intermediate page.
  url: "https://line-rangers-pvp-community-production.n-yu1791.workers.dev/boards",
  allowedHosts: Object.freeze([
    "line-rangers-pvp-community-production.n-yu1791.workers.dev",
  ]),
  allowedPath: "/boards",
});

// September 2026 board target is the ultimate-evolution form only. Keep this
// local and deterministic so a remote image outage cannot leave the entry
// blank. Do not substitute the blue hyper-evolution form.
const COMMUNITY_FEATURED_CHARACTER = Object.freeze({
  unitCode: "u1631e-sally",
  name: "かに座 サリー",
  image: "./assets/characters/crab-sally-ultimate-fallback.jpg",
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

function buildFeaturedCharacter() {
  const character = document.createElement("div");
  character.className = "community-board-entry-character";
  character.dataset.unitCode = COMMUNITY_FEATURED_CHARACTER.unitCode;

  const image = document.createElement("img");
  image.className = "community-board-entry-character-image";
  image.src = COMMUNITY_FEATURED_CHARACTER.image;
  image.alt = `${COMMUNITY_FEATURED_CHARACTER.name}のキャラクター画像`;
  image.width = 88;
  image.height = 88;
  image.loading = "eager";
  image.decoding = "async";

  const copy = document.createElement("div");
  copy.className = "community-board-entry-character-copy";
  const badge = textElement("span", "community-board-entry-character-badge", "NEW CHARACTER");
  const name = textElement("strong", "community-board-entry-character-name", COMMUNITY_FEATURED_CHARACTER.name);
  copy.append(badge, name);
  character.append(image, copy);
  return character;
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

  card.append(headingRow, buildFeaturedCharacter(), featured, button);
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
