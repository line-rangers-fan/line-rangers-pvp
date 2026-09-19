"use strict";

const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: true,
  state: true,
  url: "https://line-rangers-pvp-community-production.n-yu1791.workers.dev/boards",
  activityUrl: "https://line-rangers-pvp-community-production.n-yu1791.workers.dev/api/activity?public=1",
  allowedHosts: Object.freeze(["line-rangers-pvp-community-production.n-yu1791.workers.dev"]),
  allowedPath: "/boards",
});

const COMMUNITY_FALLBACK_TOPICS = Object.freeze([
  Object.freeze({
    id: "2026-09:u1631e-sally",
    character: "u1631e-sally",
    image: "./assets/characters/crab-sally-ultimate-fallback.jpg",
    month: "2026-09",
  }),
]);

const COMMUNITY_ENTRY_I18N = Object.freeze({
  ja: Object.freeze({title:"新キャラ情報掲示板",description:"投票・コメント・写真・動画で、今月の新キャラについて話そう。",newCharacter:"新キャラクター",imageAlt:"新キャラクターの画像",featuredLabel:"注目コメント",featuredEmpty:"まだ注目コメントはありません。掲示板で最初の感想を投稿できます。",helpful:"役に立った",viewBoard:"掲示板で見る →",openBoard:"掲示板を開く →",openBoardAria:"新キャラ情報掲示板を開く",featuredAria:"注目コメントの掲示板を開く",newCount:"NEW {count}件",videos:"動画 {count}本",comments:"コメント {count}件"}),
  en: Object.freeze({title:"New Character Community Board",description:"Share thoughts about this month's new character through polls, comments, photos, and videos.",newCharacter:"NEW CHARACTER",imageAlt:"New character image",featuredLabel:"Featured comment",featuredEmpty:"No featured comments yet. Share your first thoughts on the board.",helpful:"Helpful",viewBoard:"View on board →",openBoard:"Open board →",openBoardAria:"Open the new character community board",featuredAria:"Open the featured comment board",newCount:"NEW {count}",videos:"Videos {count}",comments:"Comments {count}"}),
  zh: Object.freeze({title:"新角色資訊討論區",description:"透過投票、留言、照片與影片，一起討論本月的新角色。",newCharacter:"新角色",imageAlt:"新角色圖片",featuredLabel:"精選留言",featuredEmpty:"目前還沒有精選留言。歡迎到討論區分享第一則心得。",helpful:"實用",viewBoard:"在討論區查看 →",openBoard:"開啟討論區 →",openBoardAria:"開啟新角色資訊討論區",featuredAria:"開啟精選留言討論區",newCount:"新 {count}則",videos:"影片 {count}部",comments:"留言 {count}則"}),
  th: Object.freeze({title:"กระดานข้อมูลตัวละครใหม่",description:"มาพูดคุยเกี่ยวกับตัวละครใหม่ประจำเดือนผ่านการโหวต ความคิดเห็น รูปภาพ และวิดีโอ",newCharacter:"ตัวละครใหม่",imageAlt:"รูปตัวละครใหม่",featuredLabel:"ความคิดเห็นเด่น",featuredEmpty:"ยังไม่มีความคิดเห็นเด่น มาแบ่งปันความรู้สึกแรกบนกระดานกันเถอะ",helpful:"มีประโยชน์",viewBoard:"ดูบนกระดาน →",openBoard:"เปิดกระดาน →",openBoardAria:"เปิดกระดานข้อมูลตัวละครใหม่",featuredAria:"เปิดกระดานของความคิดเห็นเด่น",newCount:"ใหม่ {count}",videos:"วิดีโอ {count}",comments:"ความคิดเห็น {count}"}),
  id: Object.freeze({title:"Papan Karakter Baru",description:"Bagikan pendapat tentang karakter baru bulan ini melalui jajak pendapat, komentar, foto, dan video.",newCharacter:"KARAKTER BARU",imageAlt:"Gambar karakter baru",featuredLabel:"Komentar unggulan",featuredEmpty:"Belum ada komentar unggulan. Bagikan kesan pertama Anda di papan.",helpful:"Bermanfaat",viewBoard:"Lihat di papan →",openBoard:"Buka papan →",openBoardAria:"Buka papan karakter baru",featuredAria:"Buka papan komentar unggulan",newCount:"BARU {count}",videos:"Video {count}",comments:"Komentar {count}"}),
  vi: Object.freeze({title:"Bảng thông tin nhân vật mới",description:"Hãy cùng thảo luận về nhân vật mới trong tháng qua bình chọn, bình luận, ảnh và video.",newCharacter:"NHÂN VẬT MỚI",imageAlt:"Hình ảnh nhân vật mới",featuredLabel:"Bình luận nổi bật",featuredEmpty:"Chưa có bình luận nổi bật. Hãy chia sẻ cảm nhận đầu tiên trên bảng.",helpful:"Hữu ích",viewBoard:"Xem trên bảng →",openBoard:"Mở bảng →",openBoardAria:"Mở bảng thông tin nhân vật mới",featuredAria:"Mở bảng của bình luận nổi bật",newCount:"MỚI {count}",videos:"Video {count}",comments:"Bình luận {count}"}),
  ko: Object.freeze({title:"신규 캐릭터 정보 게시판",description:"투표, 댓글, 사진과 동영상으로 이번 달 신규 캐릭터에 대해 이야기해 보세요.",newCharacter:"신규 캐릭터",imageAlt:"신규 캐릭터 이미지",featuredLabel:"주목 댓글",featuredEmpty:"아직 주목 댓글이 없습니다. 게시판에 첫 감상을 남겨 보세요.",helpful:"도움이 됐어요",viewBoard:"게시판에서 보기 →",openBoard:"게시판 열기 →",openBoardAria:"신규 캐릭터 정보 게시판 열기",featuredAria:"주목 댓글 게시판 열기",newCount:"신규 {count}",videos:"동영상 {count}",comments:"댓글 {count}"}),
});
const COMMUNITY_ENTRY_LANGUAGES = Object.freeze(Object.keys(COMMUNITY_ENTRY_I18N));
let communityEntryLanguage = "ja";
const communityViewerStorageKey = "line-rangers-community-viewer-v1";
let communityViewerToken = "";
function readCommunityViewerToken() {
  try {
    const value = localStorage.getItem(communityViewerStorageKey) || "";
    return value.length <= 256 ? value : "";
  } catch { return ""; }
}
function saveCommunityViewerToken(value) {
  communityViewerToken = value;
  try { localStorage.setItem(communityViewerStorageKey, value); } catch {}
}
communityViewerToken = readCommunityViewerToken();
function withCommunityViewer(rawUrl) {
  if (!communityViewerToken || typeof rawUrl !== "string") return rawUrl;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("viewer", communityViewerToken);
    return url.href;
  } catch { return rawUrl; }
}

function readCommunityBoardState(value) { return value === true; }
function entryText(key) { return COMMUNITY_ENTRY_I18N[communityEntryLanguage][key]; }

function detectCommunityLanguage() {
  let saved = null;
  try { saved = localStorage.getItem("line-rangers-language"); } catch { saved = null; }
  if (COMMUNITY_ENTRY_LANGUAGES.includes(saved)) return saved;
  const value = `${document.documentElement.lang || ""} ${navigator.language || ""}`.toLowerCase();
  if (value.includes("ja")) return "ja";
  if (value.includes("zh")) return "zh";
  if (value.includes("th")) return "th";
  if (value.includes("id")) return "id";
  if (value.includes("vi")) return "vi";
  if (value.includes("ko")) return "ko";
  return "en";
}

function getApprovedCommunityBoardUrl(rawUrl, allowedHosts, allowedPath) {
  if (typeof rawUrl !== "string" || !Array.isArray(allowedHosts) || typeof allowedPath !== "string") return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.search !== "" || url.hash !== "" || url.pathname !== allowedPath || !allowedHosts.includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}

function getApprovedActivityUrl(rawUrl, allowedHosts) {
  if (typeof rawUrl !== "string" || !Array.isArray(allowedHosts)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || !allowedHosts.includes(url.hostname) || url.pathname !== "/api/activity" || url.hash !== "" || url.search !== "?public=1") return null;
    return url.href;
  } catch { return null; }
}

function topicBoardUrl(topic, baseUrl) {
  if (!topic || !baseUrl || typeof topic.id !== "string" || typeof topic.month !== "string") return null;
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(topic.month)) return null;
  if (!new RegExp(`^${topic.month.replace("-", "\\-")}:[A-Za-z0-9_-]+$`).test(topic.id)) return null;
  const url = new URL(baseUrl.href);
  url.searchParams.set("month", topic.month);
  url.searchParams.set("board", topic.id);
  return withCommunityViewer(url.href);
}

function featuredBoardUrl(featured, baseUrl) {
  if (!featured || typeof featured.board !== "string") return null;
  const separator = featured.board.indexOf(":");
  if (separator <= 0) return null;
  return topicBoardUrl({id: featured.board, month: featured.board.slice(0, separator)}, baseUrl);
}

function textElement(tagName, className, text, translationKey) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  if (translationKey) element.dataset.communityText = translationKey;
  return element;
}

function clipText(value, max = 120) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function normalizeTopics(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((topic) => {
    if (!topic || typeof topic !== "object" || typeof topic.id !== "string" || typeof topic.character !== "string" || typeof topic.image !== "string" || typeof topic.month !== "string") return false;
    if (!/^[A-Za-z0-9_-]+$/.test(topic.character) || seen.has(topic.id)) return false;
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(topic.month)) return false;
    try {
      const image = new URL(topic.image);
      if (image.protocol !== "https:" || image.hostname !== "rangers.lerico.net") return false;
    } catch { return false; }
    seen.add(topic.id);
    return true;
  });
}

function normalizeFeatured(value) {
  if (!value || typeof value !== "object" || typeof value.body !== "string" || typeof value.board !== "string") return null;
  const body = value.body.trim();
  if (!body) return null;
  return {body, board:value.board, likes:Math.max(0, Number(value.likes) || 0), helpful:Math.max(0, Number(value.helpful) || 0)};
}

function normalizeMetric(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function metricText(key, value) {
  return entryText(key).replace("{count}", String(normalizeMetric(value)));
}

function normalizeUnread(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function buildCharacter(topic, baseUrl) {
  const href = topicBoardUrl(topic, baseUrl);
  const element = document.createElement(href ? "a" : "div");
  element.className = "community-board-entry-character";
  if (href) element.href = href;
  const image = document.createElement("img");
  image.className = "community-board-entry-character-image";
  image.src = topic.image;
  image.alt = entryText("imageAlt");
  image.dataset.communityAlt = "imageAlt";
  image.width = 88;
  image.height = 88;
  image.loading = "lazy";
  image.decoding = "async";
  const copy = document.createElement("div");
  copy.className = "community-board-entry-character-copy";
  copy.append(textElement("span", "community-board-entry-character-badge", entryText("newCharacter"), "newCharacter"));
  element.append(image, copy);
  return element;
}

function buildCommunityStats(state) {
  const stats = document.createElement("div");
  stats.className = "community-board-entry-stats";
  const metricItems = [
    ["newCount", state.unread, "community-board-entry-stat community-board-entry-stat-unread"],
    ["videos", state.videos, "community-board-entry-stat"],
    ["comments", state.comments, "community-board-entry-stat"],
  ];
  for (const [key, value, className] of metricItems) {
    const count = normalizeMetric(value);
    const item = textElement("span", className, metricText(key, count), key);
    item.dataset.communityMetricCount = String(count);
    stats.appendChild(item);
  }
  return stats;
}

function buildFeatured(featured, baseUrl) {
  const href = featuredBoardUrl(featured, baseUrl) || withCommunityViewer(baseUrl.href);
  const wrapper = document.createElement("a");
  wrapper.className = "community-board-entry-featured";
  wrapper.href = href;
  wrapper.setAttribute("aria-label", entryText("featuredAria"));
  wrapper.dataset.communityAria = "featuredAria";
  const labelRow = document.createElement("div");
  labelRow.className = "community-board-entry-featured-heading";
  labelRow.append(textElement("strong", "community-board-entry-featured-label", entryText("featuredLabel"), "featuredLabel"));
  wrapper.append(labelRow);
  if (!featured) {
    wrapper.append(textElement("p", "community-board-entry-featured-text", entryText("featuredEmpty"), "featuredEmpty"));
    return wrapper;
  }
  wrapper.append(textElement("p", "community-board-entry-featured-text", clipText(featured.body)));
  const reactions = document.createElement("div");
  reactions.className = "community-board-entry-featured-reactions";
  const helpful = textElement("span", "", `👍 ${entryText("helpful")} ${featured.helpful}`);
  helpful.dataset.communityHelpful = "true";
  helpful.dataset.helpfulCount = String(featured.helpful);
  reactions.append(textElement("span", "", `♥ ${featured.likes}`), helpful, textElement("span", "community-board-entry-featured-more", entryText("viewBoard"), "viewBoard"));
  wrapper.append(reactions);
  return wrapper;
}

function buildCommunityBoardEntry(baseUrl, state) {
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
  const title = textElement("h2", "community-board-entry-title", entryText("title"), "title");
  title.id = "community-board-entry-title";
  titleRow.append(title, buildCommunityStats(state));
  headingText.append(titleRow, textElement("p", "community-board-entry-description", entryText("description"), "description"));
  headingRow.append(marker, headingText);

  const topics = state.topics.length ? state.topics : COMMUNITY_FALLBACK_TOPICS;
  const characterList = document.createElement("div");
  characterList.className = "community-board-entry-character-list";
  for (const topic of topics) characterList.append(buildCharacter(topic, baseUrl));

  const firstTopicUrl = topicBoardUrl(topics[0], baseUrl) || withCommunityViewer(baseUrl.href);
  const button = document.createElement("a");
  button.className = "community-board-entry-button";
  button.href = firstTopicUrl;
  button.textContent = entryText("openBoard");
  button.dataset.communityText = "openBoard";
  button.setAttribute("aria-label", entryText("openBoardAria"));
  button.dataset.communityAria = "openBoardAria";
  card.append(headingRow, characterList, buildFeatured(state.featured, baseUrl), button);
  return card;
}

function updateCommunityEntryLanguage() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
  for (const element of slot.querySelectorAll("[data-community-text]")) {
    const key = element.dataset.communityText;
    if (!key) continue;
    if (key === "newCount" || key === "videos" || key === "comments") {
      element.textContent = metricText(key, element.dataset.communityMetricCount || 0);
    } else {
      element.textContent = entryText(key);
    }
  }
  for (const element of slot.querySelectorAll("[data-community-alt]")) element.alt = entryText(element.dataset.communityAlt || "imageAlt");
  for (const element of slot.querySelectorAll("[data-community-aria]")) element.setAttribute("aria-label", entryText(element.dataset.communityAria || "openBoardAria"));
  const helpful = slot.querySelector("[data-community-helpful]");
  if (helpful) helpful.textContent = `👍 ${entryText("helpful")} ${helpful.dataset.helpfulCount || "0"}`;
}

function installCommunityLanguageSync() {
  for (const button of document.querySelectorAll("[data-language]")) {
    if (button.dataset.communityLanguageReady === "true") continue;
    button.dataset.communityLanguageReady = "true";
    button.addEventListener("click", () => {
      const language = button.dataset.language;
      if (!COMMUNITY_ENTRY_LANGUAGES.includes(language)) return;
      communityEntryLanguage = language;
      updateCommunityEntryLanguage();
    });
  }
}

function renderCommunityBoardEntry(state) {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
  slot.replaceChildren();
  slot.hidden = true;
  const enabled = readCommunityBoardState(COMMUNITY_BOARD_ENTRY_CONFIG.state) || readCommunityBoardState(COMMUNITY_BOARD_ENTRY_CONFIG.defaultState);
  if (!enabled) return;
  const baseUrl = getApprovedCommunityBoardUrl(COMMUNITY_BOARD_ENTRY_CONFIG.url, COMMUNITY_BOARD_ENTRY_CONFIG.allowedHosts, COMMUNITY_BOARD_ENTRY_CONFIG.allowedPath);
  if (!baseUrl) return;
  slot.append(buildCommunityBoardEntry(baseUrl, state));
  slot.hidden = false;
  updateCommunityEntryLanguage();
}

async function loadCommunityActivity() {
  const endpoint = getApprovedActivityUrl(COMMUNITY_BOARD_ENTRY_CONFIG.activityUrl, COMMUNITY_BOARD_ENTRY_CONFIG.allowedHosts);
  if (!endpoint) return;
  try {
    const headers = {Accept:"application/json"};
    if (communityViewerToken) headers["X-LR-Viewer"] = communityViewerToken;
    const response = await fetch(endpoint, {method:"GET", mode:"cors", credentials:"omit", cache:"no-store", headers});
    if (!response.ok) return;
    const payload = await response.json();
    if (typeof payload.viewerToken === "string" && payload.viewerToken.length <= 256) saveCommunityViewerToken(payload.viewerToken);
    const state = {topics:normalizeTopics(payload.topics), featured:normalizeFeatured(payload.featured), unread:normalizeUnread(payload.unread), videos:normalizeMetric(payload.videos), comments:normalizeMetric(payload.comments)};
    renderCommunityBoardEntry(state);
  } catch {
    // The ranking itself must remain usable if the community API is unavailable.
  }
}

document.addEventListener("DOMContentLoaded", () => {
  communityEntryLanguage = detectCommunityLanguage();
  installCommunityLanguageSync();
  renderCommunityBoardEntry({topics:COMMUNITY_FALLBACK_TOPICS, featured:null, unread:0, videos:0, comments:0});
  void loadCommunityActivity();
});

// Back/forward cache restores do not fire DOMContentLoaded again. Refresh the
// signed viewer's activity when the PvP page becomes visible so a board visit
// clears only that viewer's NEW count immediately after returning.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void loadCommunityActivity();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void loadCommunityActivity();
});
