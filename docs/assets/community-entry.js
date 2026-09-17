"use strict";

const COMMUNITY_BOARD_ENTRY_CONFIG = Object.freeze({
  defaultState: true,
  state: true,
  url: "https://line-rangers-pvp-community-production.n-yu1791.workers.dev/boards",
  allowedHosts: Object.freeze(["line-rangers-pvp-community-production.n-yu1791.workers.dev"]),
  allowedPath: "/boards",
});

const COMMUNITY_FEATURED_CHARACTER = Object.freeze({
  unitCode: "u1631e-sally",
  image: "./assets/characters/crab-sally-ultimate-fallback.jpg",
});

const COMMUNITY_ENTRY_I18N = Object.freeze({
  ja: Object.freeze({title:"新キャラ情報掲示板",description:"投票・コメント・写真・動画で、今月の新キャラについて話そう。",newCharacter:"新キャラクター",imageAlt:"新キャラクターの画像",featuredLabel:"注目コメント",featuredText:"最新の注目コメントは掲示板で確認できます。",openBoard:"掲示板を開く →",openBoardAria:"新キャラ情報掲示板を開く"}),
  en: Object.freeze({title:"New Character Community Board",description:"Share thoughts about this month's new character through polls, comments, photos, and videos.",newCharacter:"NEW CHARACTER",imageAlt:"New character image",featuredLabel:"Featured comment",featuredText:"See the latest featured comments on the board.",openBoard:"Open board →",openBoardAria:"Open the new character community board"}),
  zh: Object.freeze({title:"新角色資訊討論區",description:"透過投票、留言、照片與影片，一起討論本月的新角色。",newCharacter:"新角色",imageAlt:"新角色圖片",featuredLabel:"精選留言",featuredText:"最新的精選留言可在討論區查看。",openBoard:"開啟討論區 →",openBoardAria:"開啟新角色資訊討論區"}),
  th: Object.freeze({title:"กระดานข้อมูลตัวละครใหม่",description:"มาพูดคุยเกี่ยวกับตัวละครใหม่ประจำเดือนผ่านการโหวต ความคิดเห็น รูปภาพ และวิดีโอ",newCharacter:"ตัวละครใหม่",imageAlt:"รูปตัวละครใหม่",featuredLabel:"ความคิดเห็นเด่น",featuredText:"ดูความคิดเห็นเด่นล่าสุดได้บนกระดาน",openBoard:"เปิดกระดาน →",openBoardAria:"เปิดกระดานข้อมูลตัวละครใหม่"}),
  id: Object.freeze({title:"Papan Karakter Baru",description:"Bagikan pendapat tentang karakter baru bulan ini melalui jajak pendapat, komentar, foto, dan video.",newCharacter:"KARAKTER BARU",imageAlt:"Gambar karakter baru",featuredLabel:"Komentar unggulan",featuredText:"Lihat komentar unggulan terbaru di papan.",openBoard:"Buka papan →",openBoardAria:"Buka papan karakter baru"}),
  vi: Object.freeze({title:"Bảng thông tin nhân vật mới",description:"Hãy cùng thảo luận về nhân vật mới trong tháng qua bình chọn, bình luận, ảnh và video.",newCharacter:"NHÂN VẬT MỚI",imageAlt:"Hình ảnh nhân vật mới",featuredLabel:"Bình luận nổi bật",featuredText:"Xem bình luận nổi bật mới nhất trên bảng.",openBoard:"Mở bảng →",openBoardAria:"Mở bảng thông tin nhân vật mới"}),
  ko: Object.freeze({title:"신규 캐릭터 정보 게시판",description:"투표, 댓글, 사진과 동영상으로 이번 달 신규 캐릭터에 대해 이야기해 보세요.",newCharacter:"신규 캐릭터",imageAlt:"신규 캐릭터 이미지",featuredLabel:"주목 댓글",featuredText:"최신 주목 댓글은 게시판에서 확인할 수 있습니다.",openBoard:"게시판 열기 →",openBoardAria:"신규 캐릭터 정보 게시판 열기"}),
});
const COMMUNITY_ENTRY_LANGUAGES = Object.freeze(Object.keys(COMMUNITY_ENTRY_I18N));
let communityEntryLanguage = "ja";

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

function entryText(key) { return COMMUNITY_ENTRY_I18N[communityEntryLanguage][key]; }

function getApprovedCommunityBoardUrl(rawUrl, allowedHosts, allowedPath) {
  if (typeof rawUrl !== "string" || !Array.isArray(allowedHosts) || typeof allowedPath !== "string") return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || url.search !== "" || url.hash !== "" || url.pathname !== allowedPath || !allowedHosts.includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

function textElement(tagName, className, text, translationKey) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  if (translationKey) element.dataset.communityText = translationKey;
  return element;
}

function buildFeaturedCharacter() {
  const character = document.createElement("div");
  character.className = "community-board-entry-character";
  character.dataset.unitCode = COMMUNITY_FEATURED_CHARACTER.unitCode;
  const image = document.createElement("img");
  image.className = "community-board-entry-character-image";
  image.src = COMMUNITY_FEATURED_CHARACTER.image;
  image.alt = entryText("imageAlt");
  image.dataset.communityAlt = "imageAlt";
  image.width = 88;
  image.height = 88;
  image.loading = "eager";
  image.decoding = "async";
  const copy = document.createElement("div");
  copy.className = "community-board-entry-character-copy";
  copy.append(textElement("span", "community-board-entry-character-badge", entryText("newCharacter"), "newCharacter"));
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
  const title = textElement("h2", "community-board-entry-title", entryText("title"), "title");
  title.id = "community-board-entry-title";
  headingText.append(title, textElement("p", "community-board-entry-description", entryText("description"), "description"));
  headingRow.append(marker, headingText);
  const featured = document.createElement("div");
  featured.className = "community-board-entry-featured";
  featured.append(
    textElement("strong", "community-board-entry-featured-label", entryText("featuredLabel"), "featuredLabel"),
    textElement("p", "community-board-entry-featured-text", entryText("featuredText"), "featuredText"),
  );
  const button = document.createElement("a");
  button.className = "community-board-entry-button";
  button.href = url;
  button.textContent = entryText("openBoard");
  button.dataset.communityText = "openBoard";
  button.setAttribute("aria-label", entryText("openBoardAria"));
  button.dataset.communityAria = "openBoardAria";
  card.append(headingRow, buildFeaturedCharacter(), featured, button);
  return card;
}

function updateCommunityEntryLanguage() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
  for (const element of slot.querySelectorAll("[data-community-text]")) element.textContent = entryText(element.dataset.communityText);
  for (const element of slot.querySelectorAll("[data-community-alt]")) element.alt = entryText(element.dataset.communityAlt || "imageAlt");
  for (const element of slot.querySelectorAll("[data-community-aria]")) element.setAttribute("aria-label", entryText(element.dataset.communityAria || "openBoardAria"));
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

function renderCommunityBoardEntry() {
  const slot = document.querySelector("#community-board-entry-slot");
  if (!slot) return;
  slot.replaceChildren();
  slot.hidden = true;
  const enabled = COMMUNITY_BOARD_ENTRY_CONFIG.state === true || COMMUNITY_BOARD_ENTRY_CONFIG.defaultState === true;
  if (!enabled) return;
  const approvedUrl = getApprovedCommunityBoardUrl(COMMUNITY_BOARD_ENTRY_CONFIG.url, COMMUNITY_BOARD_ENTRY_CONFIG.allowedHosts, COMMUNITY_BOARD_ENTRY_CONFIG.allowedPath);
  if (!approvedUrl) return;
  communityEntryLanguage = detectCommunityLanguage();
  slot.appendChild(buildCommunityBoardEntry(approvedUrl));
  slot.hidden = false;
  updateCommunityEntryLanguage();
}

document.addEventListener("DOMContentLoaded", () => {
  installCommunityLanguageSync();
  renderCommunityBoardEntry();
});
