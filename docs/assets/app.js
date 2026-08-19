// File: docs/assets/app.js
"use strict";

const DATA_PATH = "./data/character_usage.json";

const state = {
  data: null,
  characters: [],
};

const elements = {
  status: document.querySelector("#status-message"),
  summary: document.querySelector("#summary"),
  rankingSection: document.querySelector("#ranking-section"),
  league: document.querySelector("#summary-league"),
  players: document.querySelector("#summary-players"),
  slots: document.querySelector("#summary-slots"),
  characters: document.querySelector("#summary-characters"),
  updated: document.querySelector("#summary-updated"),
  body: document.querySelector("#ranking-body"),
  resultCount: document.querySelector("#result-count"),
  csvButton: document.querySelector("#csv-button"),
  sourceLink: document.querySelector("#source-link"),
};

function formatInteger(value) {
  return new Intl.NumberFormat("ja-JP").format(
    Number(value) || 0,
  );
}

function formatDate(value) {
  if (!value) {
    return "未集計";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "不明";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function isStale(value) {
  if (!value) {
    return false;
  }

  const updatedAt = new Date(value).getTime();

  if (Number.isNaN(updatedAt)) {
    return false;
  }

  const twoDays = 2 * 24 * 60 * 60 * 1000;

  return Date.now() - updatedAt > twoDays;
}

function setStatus(message, type = "normal") {
  elements.status.textContent = message;
  elements.status.className = "message";

  if (type === "error") {
    elements.status.classList.add("message-error");
  }

  if (type === "warning") {
    elements.status.classList.add("message-warning");
  }

  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
}

function getOccurrenceCount(character) {
  return Number(character.occurrence_count || 0);
}

function getPlayerCount(character) {
  return Number(character.player_count || 0);
}

function getAdoptionRate(character) {
  const sampledPlayers = Number(
    state.data?.sampled_players || 0,
  );

  if (sampledPlayers <= 0) {
    return 0;
  }

  return (
    getPlayerCount(character)
    / sampledPlayers
    * 100
  );
}

function validateData(data) {
  if (!data || typeof data !== "object") {
    throw new Error(
      "集計データの形式が正しくありません。",
    );
  }

  if (!Array.isArray(data.characters)) {
    throw new Error(
      "キャラクター一覧が存在しません。",
    );
  }

  const sampledPlayers = Number(
    data.sampled_players,
  );

  if (
    !Number.isInteger(sampledPlayers)
    || sampledPlayers < 0
  ) {
    throw new Error(
      "集計人数が正しくありません。",
    );
  }

  for (const character of data.characters) {
    if (
      !character
      || typeof character !== "object"
    ) {
      throw new Error(
        "キャラクターデータが正しくありません。",
      );
    }

    if (
      typeof character.image !== "string"
      || !character.image
    ) {
      throw new Error(
        "キャラクター画像が正しくありません。",
      );
    }

    const occurrenceCount =
      getOccurrenceCount(character);

    const playerCount =
      getPlayerCount(character);

    if (
      !Number.isInteger(occurrenceCount)
      || occurrenceCount < 0
    ) {
      throw new Error(
        "編成数が正しくありません。",
      );
    }

    if (
      !Number.isInteger(playerCount)
      || playerCount < 0
    ) {
      throw new Error(
        "採用人数が正しくありません。",
      );
    }

    if (playerCount > sampledPlayers) {
      throw new Error(
        "採用人数が集計人数を超えています。",
      );
    }

    if (occurrenceCount < playerCount) {
      throw new Error(
        "編成数が採用人数より少なくなっています。",
      );
    }
  }
}

function getSortedCharacters() {
  return [...state.characters].sort(
    (left, right) => {
      return (
        getOccurrenceCount(right)
          - getOccurrenceCount(left)
        || getPlayerCount(right)
          - getPlayerCount(left)
        || String(left.image).localeCompare(
          String(right.image),
        )
      );
    },
  );
}

function renderSummary() {
  const data = state.data;

  elements.league.textContent =
    data.league || "-";

  elements.players.textContent =
    `${formatInteger(data.sampled_players)}人`;

  elements.slots.textContent =
    `${formatInteger(data.character_slots)}体`;

  elements.characters.textContent =
    `${formatInteger(data.characters.length)}種類`;

  elements.updated.textContent =
    formatDate(data.updated_at);

  if (data.source?.url) {
    elements.sourceLink.href =
      data.source.url;
  }

  if (data.source?.name) {
    elements.sourceLink.textContent =
      data.source.name;
  }

  elements.summary.hidden = false;
}

function createCharacterImage(character, rank) {
  const image = document.createElement("img");

  image.className = "character-image";
  image.loading = "lazy";
  image.decoding = "async";
  image.alt = `${rank}位のキャラクター画像`;
  image.width = 72;
  image.height = 72;
  image.src = character.image;

  image.addEventListener("error", () => {
    image.hidden = true;
  });

  return image;
}

function createRateCell(rate) {
  const cell = document.createElement("td");
  cell.className = "rate-cell";

  const normalizedRate = Math.min(
    100,
    Math.max(0, Number(rate) || 0),
  );

  const value = document.createElement("span");
  value.className = "rate-value";
  value.textContent =
    `${normalizedRate.toFixed(1)}%`;

  const track = document.createElement("span");
  track.className = "rate-track";
  track.setAttribute("aria-hidden", "true");

  const bar = document.createElement("span");
  bar.className = "rate-bar";
  bar.style.width = `${normalizedRate}%`;

  track.append(bar);
  cell.append(value, track);

  return cell;
}

function createTableRow(character, rank) {
  const row = document.createElement("tr");

  const rankCell = document.createElement("td");
  rankCell.className = "rank-cell";
  rankCell.dataset.rank = String(rank);
  rankCell.textContent = String(rank);

  const characterCell =
    document.createElement("td");

  const characterLayout =
    document.createElement("div");

  characterLayout.className =
    "character-cell";

  characterLayout.append(
    createCharacterImage(character, rank),
  );

  characterCell.append(characterLayout);

  const occurrenceCell =
    document.createElement("td");

  occurrenceCell.className = "number-cell";
  occurrenceCell.textContent =
    `${formatInteger(
      getOccurrenceCount(character),
    )}体`;

  const playerCell =
    document.createElement("td");

  playerCell.className = "number-cell";
  playerCell.textContent =
    `${formatInteger(
      getPlayerCount(character),
    )}人`;

  row.append(
    rankCell,
    characterCell,
    occurrenceCell,
    playerCell,
    createRateCell(
      getAdoptionRate(character),
    ),
  );

  return row;
}

function renderTable() {
  const characters = getSortedCharacters();
  const fragment =
    document.createDocumentFragment();

  elements.body.replaceChildren();

  characters.forEach((character, index) => {
    fragment.append(
      createTableRow(
        character,
        index + 1,
      ),
    );
  });

  elements.body.append(fragment);

  elements.resultCount.textContent =
    `${formatInteger(characters.length)}種類`;

  elements.rankingSection.hidden = false;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");

  if (
    text.includes(",")
    || text.includes("\"")
    || text.includes("\n")
  ) {
    return `"${text.replaceAll(
      "\"",
      "\"\"",
    )}"`;
  }

  return text;
}

function downloadCsv() {
  const rows = [
    [
      "順位",
      "画像URL",
      "編成数",
      "採用人数",
      "採用率",
      "リーグ",
      "集計人数",
      "全編成キャラ数",
      "更新日時",
    ],
  ];

  getSortedCharacters().forEach(
    (character, index) => {
      rows.push([
        index + 1,
        character.image,
        getOccurrenceCount(character),
        getPlayerCount(character),
        getAdoptionRate(character).toFixed(1),
        state.data.league,
        state.data.sampled_players,
        state.data.character_slots,
        state.data.updated_at,
      ]);
    },
  );

  const csv = rows
    .map((row) => {
      return row
        .map(escapeCsvCell)
        .join(",");
    })
    .join("\r\n");

  const blob = new Blob(
    [`\uFEFF${csv}`],
    {
      type: "text/csv;charset=utf-8",
    },
  );

  const objectUrl =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  anchor.href = objectUrl;
  anchor.download =
    "line-rangers-legend-usage.csv";

  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(objectUrl);
}

async function loadData() {
  try {
    const response = await fetch(
      `${DATA_PATH}?v=${Date.now()}`,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) {
      throw new Error(
        "集計データを取得できませんでした。"
        + ` HTTP ${response.status}`,
      );
    }

    const data = await response.json();

    validateData(data);

    state.data = data;
    state.characters = [
      ...data.characters,
    ];

    renderSummary();
    renderTable();

    if (data.characters.length === 0) {
      setStatus(
        "まだ集計データがありません。"
        + "GitHub Actionsを実行してください。",
        "warning",
      );
      return;
    }

    if (isStale(data.updated_at)) {
      setStatus(
        "最終更新から2日以上経過しています。"
        + "集計処理が停止している可能性があります。",
        "warning",
      );
      return;
    }

    hideStatus();
  } catch (error) {
    console.error(error);

    setStatus(
      error instanceof Error
        ? error.message
        : "集計データの読み込みに失敗しました。",
      "error",
    );
  }
}

elements.csvButton.addEventListener(
  "click",
  downloadCsv,
);

loadData();
