// File: docs/assets/app.js
"use strict";

const DATA_PATH = "./data/character_usage.json";

const LANGUAGES = [
  "ja",
  "en",
  "zh",
  "th",
  "id",
  "vi",
  "ko",
];

const translations = {
  ja: {
    title: "LINEレンジャー レジェンド帯キャラ集計",
    description:
      "レジェンド帯プレイヤーの防衛チームから、キャラクターの編成数と採用率を集計しています。",
    loading: "集計データを読み込んでいます。",
    league: "リーグ",
    players: "集計人数",
    slots: "全編成キャラ数",
    characters: "キャラ種類数",
    updated: "最終更新",
    ranking: "キャラクターランキング",
    rankingDescription: "編成数が多い順に表示しています。",
    csv: "CSVダウンロード",
    rank: "順位",
    character: "キャラクター",
    occurrence: "編成数",
    playerCount: "採用人数",
    rate: "採用率",
    method: "集計方法",
    method1:
      "編成数は、各プレイヤーの防衛チームに編成されたキャラクターの総数です。",
    method2:
      "同じプレイヤーが同一キャラクターを複数体使用している場合、編成数には使用された体数分を加算します。",
    method3:
      "採用人数は、そのキャラクターを1体以上使用したプレイヤー数です。",
    method4:
      "同じプレイヤーが同一キャラクターを複数体使用していても、採用人数では1人として計算します。",
    method5:
      "採用率は「採用人数 ÷ 集計人数」で計算します。",
    method6:
      "GitHub Actions의混雑により、更新時刻が遅れる場合があります。",
    method7:
      "本サイトは非公式サイトであり、ゲーム運営元とは関係ありません。",
    source: "データ出典:",
    footer: "非公式・ファン作成の統計ページ",
    noData:
      "まだ集計データがありません。GitHub Actionsを実行してください。",
    stale:
      "最終更新から2日以上経過しています。集計処理が停止している可能性があります。",
    dataError: "集計データの形式が正しくありません。",
    charactersMissing: "キャラクター一覧が存在しません。",
    playersInvalid: "集計人数が正しくありません。",
    characterInvalid: "キャラクターデータが正しくありません。",
    imageInvalid: "キャラクター画像が正しくありません。",
    occurrenceInvalid: "編成数が正しくありません。",
    playerCountInvalid: "採用人数が正しくありません。",
    playerCountTooHigh: "採用人数が集計人数を超えています。",
    occurrenceTooLow: "編成数が採用人数より少なくなっています。",
    fetchError: "集計データを取得できませんでした。",
    loadError: "集計データの読み込みに失敗しました。",
    notCollected: "未集計",
    unknown: "不明",
    rankImage: "位のキャラクター画像",
    units: {
      occurrence: "体",
      players: "人",
      characters: "種類",
    },
  },

  en: {
    title: "LINE Rangers Legend Tier Character Statistics",
    description:
      "Character team counts and usage rates are calculated from defense teams of Legend-tier players.",
    loading: "Loading statistics...",
    league: "League",
    players: "Players Sampled",
    slots: "Total Character Slots",
    characters: "Character Types",
    updated: "Last Updated",
    ranking: "Character Ranking",
    rankingDescription: "Sorted by team count.",
    csv: "Download CSV",
    rank: "Rank",
    character: "Character",
    occurrence: "Team Count",
    playerCount: "Players Using",
    rate: "Usage Rate",
    method: "Methodology",
    method1:
      "Team count is the total number of characters used in the defense teams of all sampled players.",
    method2:
      "If a player uses the same character multiple times, each copy is counted separately.",
    method3:
      "Players using is the number of players who use the character at least once.",
    method4:
      "Multiple copies of the same character by one player still count as one player.",
    method5:
      "Usage rate is calculated as Players Using ÷ Players Sampled.",
    method6:
      "GitHub Actions congestion may delay the displayed update time.",
    method7:
      "This is an unofficial fan-made site and is not affiliated with the game operator.",
    source: "Data Source:",
    footer: "Unofficial fan-made statistics page",
    noData:
      "No statistics are available yet. Please run GitHub Actions.",
    stale:
      "More than two days have passed since the last update. The statistics process may have stopped.",
    dataError: "The statistics data format is invalid.",
    charactersMissing: "The character list is missing.",
    playersInvalid: "The number of sampled players is invalid.",
    characterInvalid: "The character data is invalid.",
    imageInvalid: "The character image is invalid.",
    occurrenceInvalid: "The team count is invalid.",
    playerCountInvalid: "The player count is invalid.",
    playerCountTooHigh:
      "The number of players using a character exceeds the number of sampled players.",
    occurrenceTooLow:
      "The team count is lower than the number of players using the character.",
    fetchError: "Could not retrieve the statistics.",
    loadError: "Failed to load the statistics.",
    notCollected: "Not collected",
    unknown: "Unknown",
    rankImage: "character image",
    units: {
      occurrence: "",
      players: "",
      characters: "",
    },
  },

  zh: {
    title: "LINE Rangers 傳奇聯盟角色統計",
    description:
      "根據傳奇聯盟玩家的防守隊伍，統計角色的編成數與使用率。",
    loading: "正在載入統計資料……",
    league: "聯盟",
    players: "統計人數",
    slots: "角色總編成數",
    characters: "角色種類數",
    updated: "最後更新",
    ranking: "角色排名",
    rankingDescription: "依編成數由高至低排列。",
    csv: "下載 CSV",
    rank: "排名",
    character: "角色",
    occurrence: "編成數",
    playerCount: "使用人數",
    rate: "使用率",
    method: "統計方法",
    method1:
      "編成數是所有統計玩家防守隊伍中使用的角色總數。",
    method2:
      "如果同一玩家使用相同角色多次，每一隻都會分別計算。",
    method3:
      "使用人數是至少使用該角色一次的玩家人數。",
    method4:
      "即使同一玩家使用相同角色多次，使用人數仍只計算1人。",
    method5:
      "使用率 = 使用人數 ÷ 統計人數。",
    method6:
      "GitHub Actions 繁忙時，更新時間可能會延遲。",
    method7:
      "本網站為非官方粉絲製作，與遊戲營運商沒有關係。",
    source: "資料來源：",
    footer: "非官方・粉絲製作的統計頁面",
    noData:
      "目前還沒有統計資料。請執行 GitHub Actions。",
    stale:
      "距離最後更新已超過2天，統計程序可能已停止。",
    dataError: "統計資料格式不正確。",
    charactersMissing: "找不到角色列表。",
    playersInvalid: "統計人數不正確。",
    characterInvalid: "角色資料不正確。",
    imageInvalid: "角色圖片不正確。",
    occurrenceInvalid: "編成數不正確。",
    playerCountInvalid: "使用人數不正確。",
    playerCountTooHigh:
      "使用人數超過統計人數。",
    occurrenceTooLow:
      "編成數少於使用人數。",
    fetchError: "無法取得統計資料。",
    loadError: "統計資料載入失敗。",
    notCollected: "尚未統計",
    unknown: "未知",
    rankImage: "名角色圖片",
    units: {
      occurrence: "體",
      players: "人",
      characters: "種",
    },
  },

  th: {
    title: "สถิติตัวละคร LINE Rangers ระดับ Legend",
    description:
      "สถิติจำนวนการจัดทีมและอัตราการใช้งานตัวละครจากทีมป้องกันของผู้เล่นระดับ Legend",
    loading: "กำลังโหลดข้อมูลสถิติ...",
    league: "ลีก",
    players: "จำนวนผู้เล่นที่รวบรวม",
    slots: "จำนวนตัวละครทั้งหมด",
    characters: "จำนวนประเภทตัวละคร",
    updated: "อัปเดตล่าสุด",
    ranking: "อันดับตัวละคร",
    rankingDescription:
      "เรียงตามจำนวนการจัดทีมจากมากไปน้อย",
    csv: "ดาวน์โหลด CSV",
    rank: "อันดับ",
    character: "ตัวละคร",
    occurrence: "จำนวนการจัดทีม",
    playerCount: "จำนวนผู้ใช้",
    rate: "อัตราการใช้งาน",
    method: "วิธีการรวบรวมข้อมูล",
    method1:
      "จำนวนการจัดทีมคือจำนวนตัวละครทั้งหมดที่ใช้ในทีมป้องกันของผู้เล่นที่นำมาคำนวณ",
    method2:
      "หากผู้เล่นคนเดียวใช้ตัวละครเดียวกันหลายตัว จะนับแยกตามจำนวนตัวละครที่ใช้",
    method3:
      "จำนวนผู้ใช้คือจำนวนผู้เล่นที่ใช้ตัวละครนั้นอย่างน้อย 1 ตัว",
    method4:
      "แม้ผู้เล่นคนเดียวจะใช้ตัวละครเดียวกันหลายตัว จะนับเป็นผู้เล่นเพียง 1 คน",
    method5:
      "อัตราการใช้งาน = จำนวนผู้ใช้ ÷ จำนวนผู้เล่นที่รวบรวม",
    method6:
      "การทำงานที่หนาแน่นของ GitHub Actions อาจทำให้เวลาอัปเดตล่าช้า",
    method7:
      "เว็บไซต์นี้เป็นเว็บไซต์แฟนเมดอย่างไม่เป็นทางการและไม่มีความเกี่ยวข้องกับผู้ให้บริการเกม",
    source: "แหล่งข้อมูล:",
    footer: "หน้าสถิติที่สร้างโดยแฟนคลับอย่างไม่เป็นทางการ",
    noData:
      "ยังไม่มีข้อมูลสถิติ กรุณาเรียกใช้ GitHub Actions",
    stale:
      "ผ่านไปมากกว่า 2 วันนับจากการอัปเดตครั้งล่าสุด กระบวนการรวบรวมข้อมูลอาจหยุดทำงาน",
    dataError: "รูปแบบข้อมูลสถิติไม่ถูกต้อง",
    charactersMissing: "ไม่พบรายการตัวละคร",
    playersInvalid: "จำนวนผู้เล่นที่รวบรวมไม่ถูกต้อง",
    characterInvalid: "ข้อมูลตัวละครไม่ถูกต้อง",
    imageInvalid: "รูปภาพตัวละครไม่ถูกต้อง",
    occurrenceInvalid: "จำนวนการจัดทีมไม่ถูกต้อง",
    playerCountInvalid: "จำนวนผู้ใช้ไม่ถูกต้อง",
    playerCountTooHigh:
      "จำนวนผู้ใช้มากกว่าจำนวนผู้เล่นที่รวบรวม",
    occurrenceTooLow:
      "จำนวนการจัดทีมต่ำกว่าจำนวนผู้ใช้",
    fetchError: "ไม่สามารถรับข้อมูลสถิติได้",
    loadError: "ไม่สามารถโหลดข้อมูลสถิติได้",
    notCollected: "ยังไม่ได้รวบรวม",
    unknown: "ไม่ทราบ",
    rankImage: "รูปตัวละครอันดับ",
    units: {
      occurrence: " ตัว",
      players: " คน",
      characters: " ประเภท",
    },
  },

  id: {
    title: "Statistik Karakter LINE Rangers Tier Legend",
    description:
      "Jumlah penggunaan karakter dan tingkat penggunaan dihitung dari tim pertahanan pemain Tier Legend.",
    loading: "Memuat statistik...",
    league: "Liga",
    players: "Jumlah Pemain",
    slots: "Total Slot Karakter",
    characters: "Jenis Karakter",
    updated: "Terakhir Diperbarui",
    ranking: "Peringkat Karakter",
    rankingDescription:
      "Diurutkan berdasarkan jumlah penggunaan.",
    csv: "Unduh CSV",
    rank: "Peringkat",
    character: "Karakter",
    occurrence: "Jumlah Penggunaan",
    playerCount: "Pemain yang Menggunakan",
    rate: "Tingkat Penggunaan",
    method: "Metode Pengumpulan",
    method1:
      "Jumlah penggunaan adalah total karakter yang digunakan dalam tim pertahanan seluruh pemain yang dihitung.",
    method2:
      "Jika satu pemain menggunakan karakter yang sama beberapa kali, setiap karakter dihitung secara terpisah.",
    method3:
      "Pemain yang menggunakan adalah jumlah pemain yang menggunakan karakter tersebut setidaknya satu kali.",
    method4:
      "Meskipun satu pemain menggunakan karakter yang sama beberapa kali, pemain tersebut tetap dihitung satu orang.",
    method5:
      "Tingkat penggunaan = Pemain yang Menggunakan ÷ Jumlah Pemain.",
    method6:
      "Kepadatan GitHub Actions dapat menyebabkan waktu pembaruan terlambat.",
    method7:
      "Situs ini adalah situs penggemar tidak resmi dan tidak berafiliasi dengan pengelola game.",
    source: "Sumber Data:",
    footer: "Halaman statistik buatan penggemar tidak resmi",
    noData:
      "Belum ada data statistik. Silakan jalankan GitHub Actions.",
    stale:
      "Sudah lebih dari 2 hari sejak pembaruan terakhir. Proses statistik mungkin berhenti.",
    dataError: "Format data statistik tidak valid.",
    charactersMissing:
      "Daftar karakter tidak ditemukan.",
    playersInvalid: "Jumlah pemain tidak valid.",
    characterInvalid:
      "Data karakter tidak valid.",
    imageInvalid:
      "Gambar karakter tidak valid.",
    occurrenceInvalid:
      "Jumlah penggunaan tidak valid.",
    playerCountInvalid:
      "Jumlah pemain tidak valid.",
    playerCountTooHigh:
      "Jumlah pemain yang menggunakan melebihi jumlah pemain yang dihitung.",
    occurrenceTooLow:
      "Jumlah penggunaan lebih rendah daripada jumlah pemain yang menggunakan.",
    fetchError:
      "Tidak dapat mengambil data statistik.",
    loadError:
      "Gagal memuat data statistik.",
    notCollected:
      "Belum dikumpulkan",
    unknown:
      "Tidak diketahui",
    rankImage:
      "gambar karakter peringkat",
    units: {
      occurrence: "",
      players: "",
      characters: " jenis",
    },
  },

  vi: {
    title: "Thống kê nhân vật LINE Rangers hạng Legend",
    description:
      "Thống kê số lần xếp đội và tỷ lệ sử dụng nhân vật từ đội phòng thủ của người chơi hạng Legend.",
    loading: "Đang tải dữ liệu thống kê...",
    league: "Giải đấu",
    players: "Số người được thống kê",
    slots: "Tổng số nhân vật",
    characters: "Số loại nhân vật",
    updated: "Cập nhật lần cuối",
    ranking: "Xếp hạng nhân vật",
    rankingDescription:
      "Sắp xếp theo số lần xếp đội từ cao xuống thấp.",
    csv: "Tải CSV",
    rank: "Hạng",
    character: "Nhân vật",
    occurrence: "Số lần xếp đội",
    playerCount: "Số người sử dụng",
    rate: "Tỷ lệ sử dụng",
    method: "Phương pháp thống kê",
    method1:
      "Số lần xếp đội là tổng số nhân vật được sử dụng trong đội phòng thủ của tất cả người chơi được thống kê.",
    method2:
      "Nếu một người chơi sử dụng cùng một nhân vật nhiều lần, mỗi nhân vật được tính riêng.",
    method3:
      "Số người sử dụng là số người chơi sử dụng nhân vật đó ít nhất một lần.",
    method4:
      "Dù một người chơi sử dụng cùng một nhân vật nhiều lần, người chơi đó vẫn chỉ được tính là một người.",
    method5:
      "Tỷ lệ sử dụng = Số người sử dụng ÷ Số người được thống kê.",
    method6:
      "GitHub Actions quá tải có thể khiến thời gian cập nhật bị chậm.",
    method7:
      "Đây là trang do người hâm mộ tạo ra, không chính thức và không liên quan đến nhà vận hành trò chơi.",
    source: "Nguồn dữ liệu:",
    footer:
      "Trang thống kê không chính thức do người hâm mộ tạo",
    noData:
      "Chưa có dữ liệu thống kê. Vui lòng chạy GitHub Actions.",
    stale:
      "Đã hơn 2 ngày kể từ lần cập nhật cuối. Quá trình thống kê có thể đã dừng.",
    dataError:
      "Định dạng dữ liệu thống kê không hợp lệ.",
    charactersMissing:
      "Không tìm thấy danh sách nhân vật.",
    playersInvalid:
      "Số người được thống kê không hợp lệ.",
    characterInvalid:
      "Dữ liệu nhân vật không hợp lệ.",
    imageInvalid:
      "Hình ảnh nhân vật không hợp lệ.",
    occurrenceInvalid:
      "Số lần xếp đội không hợp lệ.",
    playerCountInvalid:
      "Số người sử dụng không hợp lệ.",
    playerCountTooHigh:
      "Số người sử dụng vượt quá số người được thống kê.",
    occurrenceTooLow:
      "Số lần xếp đội thấp hơn số người sử dụng.",
    fetchError:
      "Không thể lấy dữ liệu thống kê.",
    loadError:
      "Không thể tải dữ liệu thống kê.",
    notCollected:
      "Chưa thống kê",
    unknown:
      "Không rõ",
    rankImage:
      "hình ảnh nhân vật hạng",
    units: {
      occurrence: "",
      players: "",
      characters: " loại",
    },
  },

  ko: {
    title: "LINE Rangers 레전드 티어 캐릭터 통계",
    description:
      "레전드 티어 플레이어의 방어팀을 기준으로 캐릭터 편성 수와 사용률을 집계합니다.",
    loading: "통계 데이터를 불러오는 중입니다...",
    league: "리그",
    players: "집계 인원",
    slots: "전체 캐릭터 편성 수",
    characters: "캐릭터 종류 수",
    updated: "최종 업데이트",
    ranking: "캐릭터 순위",
    rankingDescription:
      "편성 수가 많은 순서로 표시합니다.",
    csv: "CSV 다운로드",
    rank: "순위",
    character: "캐릭터",
    occurrence: "편성 수",
    playerCount: "사용 인원",
    rate: "사용률",
    method: "집계 방법",
    method1:
      "편성 수는 집계된 모든 플레이어의 방어팀에서 사용된 캐릭터의 총 수입니다.",
    method2:
      "한 플레이어가 같은 캐릭터를 여러 번 사용하면 사용한 개수만큼 각각 계산합니다.",
    method3:
      "사용 인원은 해당 캐릭터를 1개 이상 사용한 플레이어 수입니다.",
    method4:
      "한 플레이어가 같은 캐릭터를 여러 개 사용해도 사용 인원에서는 1명으로 계산합니다.",
    method5:
      "사용률 = 사용 인원 ÷ 집계 인원",
    method6:
      "GitHub Actions가 혼잡할 경우 업데이트 시간이 지연될 수 있습니다.",
    method7:
      "이 사이트는 비공식 팬 제작 사이트이며 게임 운영사와 관련이 없습니다.",
    source: "데이터 출처:",
    footer: "비공식 팬 제작 통계 페이지",
    noData:
      "아직 통계 데이터가 없습니다. GitHub Actions를 실행해 주세요.",
    stale:
      "마지막 업데이트 후 2일 이상 지났습니다. 통계 처리가 중단되었을 수 있습니다.",
    dataError:
      "통계 데이터 형식이 올바르지 않습니다.",
    charactersMissing:
      "캐릭터 목록이 없습니다.",
    playersInvalid:
      "집계 인원이 올바르지 않습니다.",
    characterInvalid:
      "캐릭터 데이터가 올바르지 않습니다.",
    imageInvalid:
      "캐릭터 이미지가 올바르지 않습니다.",
    occurrenceInvalid:
      "편성 수가 올바르지 않습니다.",
    playerCountInvalid:
      "사용 인원이 올바르지 않습니다.",
    playerCountTooHigh:
      "사용 인원이 집계 인원을 초과했습니다.",
    occurrenceTooLow:
      "편성 수가 사용 인원보다 적습니다.",
    fetchError:
      "통계 데이터를 가져올 수 없습니다.",
    loadError:
      "통계 데이터를 불러오지 못했습니다.",
    notCollected:
      "집계되지 않음",
    unknown:
      "알 수 없음",
    rankImage:
      "위 캐릭터 이미지",
    units: {
      occurrence: "개",
      players: "명",
      characters: "종류",
    },
  },
};

const state = {
  data: null,
  characters: [],
  language: "ja",
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

function t(key) {
  return translations[state.language][key];
}

function getLocale() {
  const locales = {
    ja: "ja-JP",
    en: "en-US",
    zh: "zh-TW",
    th: "th-TH",
    id: "id-ID",
    vi: "vi-VN",
    ko: "ko-KR",
  };

  return locales[state.language];
}

function formatInteger(value) {
  return new Intl.NumberFormat(getLocale()).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) {
    return t("notCollected");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return t("unknown");
  }

  return new Intl.DateTimeFormat(getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function formatUnit(value, unit) {
  const formatted = formatInteger(value);
  const suffix = translations[state.language].units[unit];

  return `${formatted}${suffix}`;
}

function translateLeague(value) {
  if (!value) {
    return "-";
  }

  const league = String(value);

  if (league === "レジェンド") {
    const names = {
      ja: "レジェンド",
      en: "Legend",
      zh: "傳奇",
      th: "Legend",
      id: "Legend",
      vi: "Legend",
      ko: "레전드",
    };

    return names[state.language];
  }

  return league;
}

function applyTranslations() {
  const tr = translations[state.language];

  document.documentElement.lang =
    state.language === "zh" ? "zh-TW" : state.language;

  document.title = tr.title;

  setText("#page-title", tr.title);
  setText("#page-description", tr.description);

  setText("#label-league", tr.league);
  setText("#label-players", tr.players);
  setText("#label-slots", tr.slots);
  setText("#label-characters", tr.characters);
  setText("#label-updated", tr.updated);

  setText("#ranking-title", tr.ranking);
  setText("#ranking-description", tr.rankingDescription);

  if (elements.csvButton) {
    elements.csvButton.textContent = tr.csv;
  }

  setText("#ranking-caption", tr.ranking);

  setText("#th-rank", tr.rank);
  setText("#th-character", tr.character);
  setText("#th-occurrence", tr.occurrence);
  setText("#th-players", tr.playerCount);
  setText("#th-rate", tr.rate);

  setText("#method-title", tr.method);

  for (let i = 1; i <= 7; i += 1) {
    setText(`#method-${i}`, tr[`method${i}`]);
  }

  setText("#source-label", tr.source);
  setText("#footer-text", tr.footer);

  document.querySelectorAll("[data-language]").forEach((button) => {
    const active = button.dataset.language === state.language;

    button.classList.toggle("language-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (state.data) {
    renderSummary();
    renderTable();
  }
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) {
    element.textContent = value;
  }
}

function setLanguage(language) {
  if (!LANGUAGES.includes(language)) {
    language = "en";
  }

  state.language = language;

  try {
    localStorage.setItem("line-rangers-language", language);
  } catch {
    // 
  }

  applyTranslations();
}

function detectLanguage() {
  let saved = null;

  try {
    saved = localStorage.getItem("line-rangers-language");
  } catch {
    saved = null;
  }

  if (LANGUAGES.includes(saved)) {
    return saved;
  }

  const browser = String(navigator.language || "").toLowerCase();

  if (browser.startsWith("ja")) return "ja";
  if (browser.startsWith("th")) return "th";
  if (browser.startsWith("zh")) return "zh";
  if (browser.startsWith("id")) return "id";
  if (browser.startsWith("vi")) return "vi";
  if (browser.startsWith("ko")) return "ko";

  return "en";
}

function renderSummary() {
  if (!state.data) return;

  elements.league.textContent = translateLeague(state.data.league);
  elements.players.textContent = formatUnit(state.data.sampled_players, "players");
  elements.slots.textContent = formatUnit(state.data.character_slots, "occurrence");
  elements.characters.textContent = formatUnit(state.data.unique_characters, "characters");
  elements.updated.textContent = formatDate(state.data.updated_at);
}

function renderTable() {
  if (!elements.body) return;

  elements.body.innerHTML = "";

  if (!state.characters || state.characters.length === 0) {
    elements.resultCount.textContent = t("noData");
    return;
  }

  const fragment = document.createDocumentFragment();
  const maxOccurrence = state.characters[0]?.occurrence_count || 1;

  state.characters.forEach((char, index) => {
    const tr = document.createElement("tr");
    const rank = char.rank || index + 1;

    // 順位セル（CSSの .rank-cell や data-rank を活用）
    const tdRank = document.createElement("td");
    tdRank.className = "rank-cell";
    tdRank.setAttribute("data-rank", rank);
    tdRank.textContent = rank;
    tr.appendChild(tdRank);

    // キャラクターセル（CSSの .character-cell と .character-image を活用して枠を復活！）
    const tdChar = document.createElement("td");
    tdChar.className = "character-cell";

    const img = document.createElement("img");
    img.src = char.image || "";
    img.alt = `${rank}${t("rankImage")}`;
    img.className = "character-image";
    img.loading = "lazy";
    tdChar.appendChild(img);
    tr.appendChild(tdChar);

    // 編成数
    const tdOccurrence = document.createElement("td");
    tdOccurrence.className = "number-cell";
    tdOccurrence.textContent = formatUnit(char.occurrence_count, "occurrence");
    tr.appendChild(tdOccurrence);

    // 採用人数
    const tdPlayers = document.createElement("td");
    tdPlayers.className = "number-cell";
    tdPlayers.textContent = formatUnit(char.player_count, "players");
    tr.api ? null : (tdPlayers.className = "number-cell");
    tr.appendChild(tdPlayers);

    // 採用率（プログレスバー付きのデザインを復元）
    const tdRate = document.createElement("td");
    tdRate.className = "rate-cell";

    const rateValue = Number(char.adoption_rate || 0);
    const rateContainer = document.createElement("div");
    rateContainer.style.display = "flex";
    rateContainer.style.alignItems = "center";
    rateContainer.style.gap = "0.75rem";

    const spanVal = document.createElement("span");
    spanVal.className = "rate-value";
    spanVal.textContent = `${rateValue.toFixed(1)}%`;

    const track = document.createElement("div");
    track.className = "rate-track";

    const bar = document.createElement("span");
    bar.className = "rate-bar";
    bar.style.width = `${Math.min(Math.max(rateValue, 0), 100)}%`;

    track.appendChild(bar);
    rateContainer.appendChild(spanVal);
    rateContainer.appendChild(track);
    tdRate.appendChild(rateContainer);
    tr.appendChild(tdRate);

    fragment.appendChild(tr);
  });

  elements.body.appendChild(fragment);
  elements.resultCount.textContent = `${state.characters.length} ${t("units").characters || "件"}`;
}

function downloadCSV() {
  if (!state.characters || state.characters.length === 0) return;

  const headers = [
    t("rank"),
    t("character"),
    t("occurrence"),
    t("playerCount"),
    t("rate"),
  ];

  const rows = [headers.join(",")];

  state.characters.forEach((char, index) => {
    const row = [
      char.rank || index + 1,
      `"${String(char.name || "").replace(/"/g, '""')}"`,
      char.occurrence_count || 0,
      char.player_count || 0,
      char.adoption_rate || 0,
    ];
    rows.push(row.join(","));
  });

  const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `line_rangers_legend_ranking_${state.language}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadData() {
  try {
    elements.status.textContent = t("loading");
    elements.status.hidden = false;
    elements.summary.hidden = true;
    elements.rankingSection.hidden = true;

    const response = await fetch(DATA_PATH);
    if (!response.ok) {
      throw new Error(t("fetchError"));
    }

    const data = await response.json();
    
    if (!data || typeof data !== "object") {
      throw new Error(t("dataError"));
    }

    state.data = data;
    state.characters = Array.isArray(data.characters) ? data.characters : [];

    elements.status.hidden = true;
    elements.summary.hidden = false;
    elements.rankingSection.hidden = false;

    applyTranslations();
  } catch (error) {
    console.error(error);
    elements.status.textContent = t("loadError");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const initialLang = detectLanguage();
  setLanguage(initialLang);

  loadData();

  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      const lang = button.dataset.language;
      if (lang) {
        setLanguage(lang);
      }
    });
  });

  if (elements.csvButton) {
    elements.csvButton.addEventListener("click", downloadCSV);
  }
});
