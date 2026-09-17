// Owner-review copy of the original PvP community entry.
"use strict";

const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  state: true,
  url: "/boards",
  allowedPath: "/boards",
});

const COMMUNITY_FALLBACK_TOPICS = Object.freeze([
  Object.freeze({
    id: "2026-09:u1631e-sally",
    character: "u1631e-sally",
    name: "かに座 サリー",
    image: "https://rangers.lerico.net/res/u1631e-sally/u1631e-sally-thum.png",
    month: "2026-09",
  }),
]);

function getApprovedCommunityBoardUrl(rawUrl, allowedPath) {
  if (typeof rawUrl !== "string" || typeof allowedPath !== "string") return null;
  try {
    const url = new URL(rawUrl, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== allowedPath
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}

function topicBoardUrl(topic) {
  if (!topic || typeof topic.id !== "string" || typeof topic.month !== "string") return null;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(topic.month)) return null;
  if (!new RegExp(`^${topic.month.replace("-", "\\-")}:[A-Za-z0-9_-]+$`).test(topic.id)) return null;
  const url = new URL(COMMUNITY_BOARD_ENTRY_CONFIG.allowedPath, window.location.origin);
  url.searchParams.set("month", topic.month);
  url.searchParams.set("board", topic.id);
  return url.href;
}

function featuredBoardUrl(featured) {
  if (!featured || typeof featured.board !== "string") return null;
  const separator = featured.board.indexOf(":");
  if (separator <= 0) return null;
  const month = featured.board.slice(0, separator);
  return topicBoardUrl({ id: featured.board, month });
}

function textElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function clipText(value, max = 120) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((topic) => {
    if (!topic || typeof topic !== "object") return false;
    if (typeof topic.id !== "string" || typeof topic.character !== "string" || typeof topic.name !== "string" || typeof topic.image !== "string" || typeof topic.month !== "string") return false;
    if (!/^[A-Za-z0-9_-]+$/.test(topic.character) || seen.has(topic.id) || !topicBoardUrl(topic)) return false;
    try {
      const image = new URL(topic.image);
      if (image.protocol !== "https:" || image.hostname !== "rangers.lerico.net") return false;
    } catch {
      return false;
    }
    seen.add(topic.id);
    return true;
  });
}

function buildFeaturedCharacter(topic) {
  const href = topicBoardUrl(topic);
  const character = document.createElement(href ? "a" : "div");
  character.className = "community-board-entry-character";
  character.dataset.unitCode = topic.character;
  if (href) character.href = href;

  const image = document.createElement("img");
  image.className = "community-board-entry-character-image";
  image.src = topic.image;
  image.alt = "New character image";
  image.width = 88;
  image.height = 88;
  image.loading = "lazy";
  image.decoding = "async";

  const copy = document.createElement("div");
  copy.className = "community-board-entry-character-copy";
  copy.append(textElement("span", "community-board-entry-character-badge", "NEW CHARACTER"));
  character.append(image, copy);
  return character;
}

function buildCharacterList(topics) {
  const list = document.createElement("div");
  list.className = "community-board-entry-character-list";
  for (const topic of topics) list.appendChild(buildFeaturedCharacter(topic));
  return list;
}

function buildFeatured(featured, fallbackUrl) {
  const href = featuredBoardUrl(featured) || fallbackUrl;
  const wrapper = document.createElement(href ? "a" : "div");
  wrapper.className = "community-board-entry-featured";
  if (href) {
    wrapper.href = href;
    wrapper.setAttribute("aria-label", "注目コメントを掲示板で見る");
  }
  wrapper.appendChild(textElement("strong", "community-board-entry-featured-label", "注目コメント"));
  if (featured && typeof featured.body === "string" && featured.body.trim()) {
    wrapper.appendChild(textElement("p", "community-board-entry-featured-text", clipText(featured.body)));
    const reactions = document.createElement("div");
    reactions.className = "community-board-entry-featured-reactions";
    reactions.append(
      textElement("span", "", `♥ ${Number(featured.likes) || 0}`),
      textElement("span", "", `👍 役に立った ${Number(featured.helpful) || 0}`),
      textElement("span", "community-board-entry-featured-more", "掲示板で見る →"),
    );
    wrapper.appendChild(reactions);
  } else {
    wrapper.appendChild(textElement("p", "community-board-entry-featured-text", "まだ注目コメントはありません。掲示板で最初の感想を投稿できます。"));
  }
  return wrapper;
}

function buildCommunityBoardEntry(url, state) {
  const card = document.createElement("section");
  card.className = "community-board-entry-card";
  card.setAttribute("aria-labelledby", "community-board-entry-title");

  const headingRow = document.createElement("div");
  headingRow.className = "community-board-entry-heading";
  const marker = textElement("span", "community-board-entry-marker", "●");
  marker.setAttribute("aria-hidden", "true");
  const headingText = document.createElement("div");
  headingText.className = "community-board-entry-heading-text";
  const titleRow = document.createElement("div");
  titleRow.className = "community-board-entry-title-row";
  const title = textElement("h2", "community-board-entry-title", "新キャラ情報掲示板");
  title.id = "community-board-entry-title";
  titleRow.appendChild(title);
  if (Number(state.unread) > 0) titleRow.appendChild(textElement("span", "community-board-entry-new", `NEW ${Math.min(999, Number(state.unread))}`));
  headingText.append(
    titleRow,
    textElement("p", "community-board-entry-description", "投票・コメント・写真・動画で、今月の新キャラについて話そう。"),
  );
  headingRow.append(marker, headingText);

  const topics = state.topics.length ? state.topics : COMMUNITY_FALLBACK_TOPICS;
  const firstTopicUrl = topicBoardUrl(topics[0]);
  const button = document.createElement("a");
  button.className = "community-board-entry-button";
  button.href = firstTopicUrl || url;
  button.textContent = "掲示板を開く →";
  button.setAttribute("aria-label", "新キャラ情報掲示板を開く");

  card.append(headingRow, buildCharacterList(topics), buildFeatured(state.featured, firstTopicUrl || url), button);
  return card;
}

async function loadCommunityEntryState() {
  const fallback = { topics: [...COMMUNITY_FALLBACK_TOPICS], featured: null, unread: 0 };
  try {
    const response = await fetch("/api/activity", { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return fallback;
    const activity = await response.json();
    let topics = normalizeTopics(activity.topics);
    if (!topics.length) topics = [...COMMUNITY_FALLBACK_TOPICS];
    try {
      const rankingResponse = await fetch("/pvp/data/character_usage.json", { cache: "default", headers: { Accept: "application/json" } });
      if (rankingResponse.ok) {
        const ranking = await rankingResponse.json();
        const usage = new Map();
        if (Array.isArray(ranking.characters)) {
          for (const row of ranking.characters) {
            if (!row || typeof row.unit_code !== "string") continue;
            usage.set(row.unit_code, {
              adoption: Number.isFinite(Number(row.adoption_rate)) ? Number(row.adoption_rate) : -1,
              rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : Number.MAX_SAFE_INTEGER,
            });
          }
        }
        topics = [...topics].sort((a, b) => {
          const av = usage.get(a.character), bv = usage.get(b.character);
          if (!!av !== !!bv) return av ? -1 : 1;
          if (av && bv && bv.adoption !== av.adoption) return bv.adoption - av.adoption;
          if (av && bv && av.rank !== bv.rank) return av.rank - bv.rank;
          return a.name.localeCompare(b.name, "ja");
        });
      }
    } catch {
      // PvP ordering is an enhancement. Community access still works if the
      // ranking snapshot is temporarily unavailable.
    }
    return {
      topics,
      featured: activity.featured && typeof activity.featured === "object" ? activity.featured : null,
      unread: Number.isFinite(Number(activity.unread)) ? Number(activity.unread) : 0,
    };
  } catch {
    return fallback;
  }
}

async function renderCommunityBoardEntry() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
  slot.replaceChildren();
  slot.hidden = true;
  if (COMMUNITY_BOARD_ENTRY_CONFIG.state !== true) return;

  const approvedUrl = getApprovedCommunityBoardUrl(
    COMMUNITY_BOARD_ENTRY_CONFIG.url,
    COMMUNITY_BOARD_ENTRY_CONFIG.allowedPath,
  );
  if (!approvedUrl) return;

  const state = await loadCommunityEntryState();
  slot.appendChild(buildCommunityBoardEntry(approvedUrl, state));
  slot.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => { void renderCommunityBoardEntry(); });
