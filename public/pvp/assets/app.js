// Faithful runtime for the pre-maintenance PvP surface.
// The HTML and CSS are byte-for-byte copies of source commit
// d6664b75502a73896b9d5b0c31667a2d4a0de95b. This runtime keeps the
// original interaction model while reading the isolated copy's validated data.
"use strict";

const DATA_PATH = "./data/character_usage.json";
const TARGET_PLAYERS = 200;
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const SAFE_CODE = /^[A-Za-z0-9_-]+$/;
const TRUSTED_ORIGIN = "https://rangers.lerico.net";
const PERIODS = ["hour", "day", "week", "month"];

const I18N = {
  ja: {
    title: "LINEレンジャー レジェンド帯キャラ集計",
    description: "レジェンド帯プレイヤーの防衛チームから、キャラクターの編成数と採用率を集計しています。",
    tap: "キャラクターをタップすると、装備ランキングが見れます。",
    loading: "集計データを読み込んでいます。",
    league: "リーグ", slots: "全編成キャラ数", updated: "最終更新",
    ranking: "キャラクターランキング", rankingDescription: "編成数が多い順に表示しています。",
    rank: "順位", character: "キャラクター", occurrence: "編成数", players: "採用人数", rate: "採用率",
    method: "集計方法", source: "データ出典:", footer: "非公式・ファン作成の統計ページ",
    period: {hour: "1時間前", day: "前日締め", week: "先週締め", month: "先月締め"},
    comparison: "選択した基準時点からのキャラ数の増減です。",
    pending: "履歴待ち", healthy: "正常更新", delayed: "更新が少し遅れています", stale: "前回の正常データを表示中",
    loadError: "集計データの読み込みに失敗しました。",
    dialog: "キャラクター装備ランキング", dialogDescription: "装備数は同じキャラを複数編成した分も数え、使用率は同じプレイヤーを1人として計算します。",
    weapon: "武器", armor: "防具", accessory: "アクセサリー", equipment: "装備", equipmentCount: "装備数", equipmentPlayers: "使用人数", noEquipment: "このカテゴリの装備データはありません。", close: "閉じる",
    board: "掲示板", result: n => `${n}件`, occUnit: "体", playerUnit: "人",
    methods: [
      "編成数は、各プレイヤーの防衛チームに編成されたキャラクターの総数です。",
      "同じプレイヤーが同一キャラクターを複数体使用している場合、編成数には使用された体数分を加算します。",
      "採用人数は、そのキャラクターを1体以上使用したプレイヤー数です。",
      "同じプレイヤーが同一キャラクターを複数体使用していても、採用人数では1人として計算します。",
      "採用率は「採用人数 ÷ 集計人数」で計算します。",
      "主集計と独立した監視処理が更新時刻を確認し、遅延時は再集計します。",
      "本サイトは非公式サイトであり、ゲーム運営元とは関係ありません。",
      "比較は、\n「1時間前」は直近1時間の正常集計。\n「前日締め」は前日22〜23時。\n「先週締め」は前週日曜日22〜23時。\n「先月締め」は前月末日22〜23時の正常集計を基準にしています。\n23時台を優先し、取得できない場合は22時台を使用します。"
    ]
  },
  en: {
    title: "LINE Rangers Legend Tier Character Statistics",
    description: "Character team counts and usage rates are calculated from defense teams of Legend-tier players.",
    tap: "Tap a character to view its equipment ranking.", loading: "Loading statistics...",
    league: "League", slots: "Total Character Slots", updated: "Last Updated",
    ranking: "Character Ranking", rankingDescription: "Sorted by team count.",
    rank: "Rank", character: "Character", occurrence: "Team Count", players: "Players Using", rate: "Usage Rate",
    method: "Methodology", source: "Data Source:", footer: "Unofficial fan-made statistics page",
    period: {hour: "1 hour ago", day: "Previous-day close", week: "Previous-week close", month: "Previous-month close"},
    comparison: "Character-count change from the selected baseline.", pending: "History pending",
    healthy: "Up to date", delayed: "Update delayed", stale: "Showing last verified data", loadError: "Failed to load statistics.",
    dialog: "Character Equipment Ranking", dialogDescription: "Every character copy counts toward equipment count; each player counts once for usage rate.",
    weapon: "Weapon", armor: "Armor", accessory: "Accessory", equipment: "Equipment", equipmentCount: "Equipment count", equipmentPlayers: "Players using", noEquipment: "No equipment data is available for this category.", close: "Close",
    board: "Community", result: n => `${n} characters`, occUnit: "", playerUnit: "",
    methods: [
      "Team count is the total number of characters used in sampled defense teams.",
      "If one player uses the same character multiple times, every copy is counted.",
      "Players using is the number of players who use the character at least once.",
      "Multiple copies by one player still count as one player for adoption.",
      "Usage rate is Players Using ÷ Players Sampled.",
      "The collector and an independent monitor verify freshness and retry delayed updates.",
      "This is an unofficial fan-made site and is not affiliated with the game operator.",
      "Comparisons use verified baselines for roughly one hour ago, previous-day close, previous-week close, or previous-month close."
    ]
  },
  zh: {
    title: "LINE Rangers 傳奇聯盟角色統計", description: "根據傳奇聯盟玩家的防守隊伍，統計角色的編成數與使用率。", tap: "點選角色即可查看裝備排名。", loading: "正在載入統計資料……",
    league: "聯盟", slots: "角色總編成數", updated: "最後更新", ranking: "角色排名", rankingDescription: "依編成數由高至低排列。", rank: "排名", character: "角色", occurrence: "編成數", players: "使用人數", rate: "使用率", method: "統計方法", source: "資料來源：", footer: "非官方・粉絲製作的統計頁面",
    period: {hour: "1小時前", day: "前日結算", week: "上週結算", month: "上月結算"}, comparison: "與所選基準相比的角色數變化。", pending: "等待歷史資料", healthy: "更新正常", delayed: "更新稍有延遲", stale: "顯示上次驗證資料", loadError: "統計資料載入失敗。",
    dialog: "角色裝備排行", dialogDescription: "裝備數會計入重複編成；使用率則以每位玩家僅計一次。", weapon: "武器", armor: "防具", accessory: "飾品", equipment: "裝備", equipmentCount: "裝備數", equipmentPlayers: "使用人數", noEquipment: "此分類沒有裝備資料。", close: "關閉", board: "討論區", result: n => `${n}項`, occUnit: "體", playerUnit: "人",
    methods: ["編成數是所有統計玩家防守隊伍中使用的角色總數。","如果同一玩家使用相同角色多次，每一隻都會分別計算。","使用人數是至少使用該角色一次的玩家人數。","即使同一玩家使用相同角色多次，使用人數仍只計算1人。","使用率 = 使用人數 ÷ 統計人數。","主收集程序與獨立監控會檢查資料新鮮度，延遲時自動重試。","本網站為非官方粉絲製作，與遊戲營運商沒有關係。","比較使用已驗證的1小時前、前日、上週或上月基準資料。"]
  },
  th: {
    title: "สถิติตัวละคร LINE Rangers ระดับ Legend", description: "สถิติจำนวนการจัดทีมและอัตราการใช้งานตัวละครจากทีมป้องกันของผู้เล่นระดับ Legend", tap: "แตะตัวละครเพื่อดูอันดับอุปกรณ์", loading: "กำลังโหลดข้อมูลสถิติ...", league: "ลีก", slots: "จำนวนตัวละครทั้งหมด", updated: "อัปเดตล่าสุด", ranking: "อันดับตัวละคร", rankingDescription: "เรียงตามจำนวนการจัดทีมจากมากไปน้อย", rank: "อันดับ", character: "ตัวละคร", occurrence: "จำนวนการจัดทีม", players: "จำนวนผู้ใช้", rate: "อัตราการใช้", method: "วิธีการรวบรวมข้อมูล", source: "แหล่งข้อมูล:", footer: "หน้าสถิติที่สร้างโดยแฟนคลับอย่างไม่เป็นทางการ", period: {hour: "1 ชั่วโมงก่อน", day: "ปิดยอดวันก่อน", week: "ปิดยอดสัปดาห์ก่อน", month: "ปิดยอดเดือนก่อน"}, comparison: "การเปลี่ยนแปลงจำนวนตัวละครจากจุดอ้างอิงที่เลือก", pending: "รอประวัติข้อมูล", healthy: "อัปเดตปกติ", delayed: "การอัปเดตล่าช้า", stale: "แสดงข้อมูลล่าสุดที่ตรวจสอบแล้ว", loadError: "โหลดข้อมูลสถิติไม่สำเร็จ", dialog: "อันดับอุปกรณ์ตัวละคร", dialogDescription: "จำนวนอุปกรณ์นับตัวละครที่ซ้ำ ส่วนอัตราใช้จะนับผู้เล่นเพียงครั้งเดียว", weapon: "อาวุธ", armor: "เกราะ", accessory: "เครื่องประดับ", equipment: "อุปกรณ์", equipmentCount: "จำนวนอุปกรณ์", equipmentPlayers: "ผู้ใช้", noEquipment: "ไม่มีข้อมูลอุปกรณ์สำหรับหมวดหมู่นี้", close: "ปิด", board: "ชุมชน", result: n => `${n} รายการ`, occUnit: " ตัว", playerUnit: " คน",
    methods: ["จำนวนการจัดทีมคือจำนวนตัวละครทั้งหมดในทีมป้องกันของผู้เล่นที่เก็บข้อมูล","ตัวละครซ้ำของผู้เล่นเดียวกันนับทุกตัว","จำนวนผู้ใช้คือผู้เล่นที่ใช้ตัวละครอย่างน้อยหนึ่งตัว","ตัวละครซ้ำของผู้เล่นเดียวกันนับผู้เล่นเพียงหนึ่งคน","อัตราการใช้ = จำนวนผู้ใช้ ÷ จำนวนผู้เล่นที่เก็บข้อมูล","ระบบเก็บข้อมูลและระบบตรวจสอบจะลองใหม่เมื่ออัปเดตล่าช้า","เว็บไซต์นี้เป็นเว็บไซต์แฟนเมดอย่างไม่เป็นทางการ","การเปรียบเทียบใช้ข้อมูลอ้างอิงที่ตรวจสอบแล้ว"]
  },
  id: {
    title: "Statistik Karakter LINE Rangers Tier Legend", description: "Jumlah penggunaan karakter dan tingkat penggunaan dihitung dari tim pertahanan pemain Tier Legend.", tap: "Ketuk karakter untuk melihat peringkat perlengkapannya.", loading: "Memuat statistik...", league: "Liga", slots: "Total Slot Karakter", updated: "Terakhir Diperbarui", ranking: "Peringkat Karakter", rankingDescription: "Diurutkan berdasarkan jumlah penggunaan.", rank: "Peringkat", character: "Karakter", occurrence: "Jumlah Penggunaan", players: "Pemain yang Menggunakan", rate: "Tingkat Penggunaan", method: "Metode Pengumpulan", source: "Sumber Data:", footer: "Halaman statistik buatan penggemar tidak resmi", period: {hour: "1 jam lalu", day: "Penutupan hari sebelumnya", week: "Penutupan minggu lalu", month: "Penutupan bulan lalu"}, comparison: "Perubahan jumlah karakter dari acuan terpilih.", pending: "Menunggu riwayat", healthy: "Pembaruan normal", delayed: "Pembaruan terlambat", stale: "Menampilkan data terverifikasi terakhir", loadError: "Gagal memuat statistik.", dialog: "Peringkat Perlengkapan Karakter", dialogDescription: "Jumlah perlengkapan menghitung karakter ganda, sedangkan tingkat penggunaan menghitung tiap pemain sekali.", weapon: "Senjata", armor: "Pelindung", accessory: "Aksesori", equipment: "Perlengkapan", equipmentCount: "Jumlah perlengkapan", equipmentPlayers: "Pemain pengguna", noEquipment: "Tidak ada data perlengkapan untuk kategori ini.", close: "Tutup", board: "Komunitas", result: n => `${n} karakter`, occUnit: "", playerUnit: "",
    methods: ["Jumlah penggunaan adalah total karakter di tim pertahanan pemain yang dihitung.","Karakter yang sama tetap dihitung per salinan.","Pemain yang menggunakan adalah pemain yang memakai karakter setidaknya sekali.","Karakter ganda dari satu pemain tetap dihitung satu pemain.","Tingkat penggunaan = Pemain Menggunakan ÷ Jumlah Pemain.","Pengumpul dan pengawas memeriksa kesegaran dan mencoba ulang jika terlambat.","Situs ini adalah situs penggemar tidak resmi.","Perbandingan memakai acuan terverifikasi."]
  },
  vi: {
    title: "Thống kê nhân vật LINE Rangers hạng Legend", description: "Thống kê số lần xếp đội và tỷ lệ sử dụng nhân vật từ đội phòng thủ của người chơi hạng Legend.", tap: "Chạm vào nhân vật để xem xếp hạng trang bị.", loading: "Đang tải dữ liệu thống kê...", league: "Giải đấu", slots: "Tổng số nhân vật", updated: "Cập nhật lần cuối", ranking: "Xếp hạng nhân vật", rankingDescription: "Sắp xếp theo số lần xếp đội từ cao xuống thấp.", rank: "Hạng", character: "Nhân vật", occurrence: "Số lần xếp đội", players: "Số người sử dụng", rate: "Tỷ lệ sử dụng", method: "Phương pháp thống kê", source: "Nguồn dữ liệu:", footer: "Trang thống kê không chính thức do người hâm mộ tạo", period: {hour: "1 giờ trước", day: "Chốt ngày trước", week: "Chốt tuần trước", month: "Chốt tháng trước"}, comparison: "Thay đổi số nhân vật từ mốc đã chọn.", pending: "Đang chờ lịch sử", healthy: "Cập nhật bình thường", delayed: "Cập nhật bị chậm", stale: "Hiển thị dữ liệu đã xác minh gần nhất", loadError: "Không thể tải dữ liệu thống kê.", dialog: "Xếp hạng trang bị nhân vật", dialogDescription: "Số trang bị tính cả nhân vật trùng lặp, còn tỷ lệ sử dụng chỉ tính mỗi người chơi một lần.", weapon: "Vũ khí", armor: "Giáp", accessory: "Phụ kiện", equipment: "Trang bị", equipmentCount: "Số trang bị", equipmentPlayers: "Người sử dụng", noEquipment: "Không có dữ liệu trang bị cho danh mục này.", close: "Đóng", board: "Cộng đồng", result: n => `${n} nhân vật`, occUnit: "", playerUnit: " người",
    methods: ["Số lần xếp đội là tổng số nhân vật trong đội phòng thủ được thống kê.","Nhân vật trùng lặp được tính theo từng bản sao.","Số người sử dụng là số người dùng nhân vật ít nhất một lần.","Một người dùng nhiều bản sao vẫn chỉ tính là một người.","Tỷ lệ sử dụng = Số người sử dụng ÷ Số người được thống kê.","Bộ thu thập và giám sát kiểm tra độ mới và thử lại khi chậm.","Đây là trang không chính thức do người hâm mộ tạo.","So sánh dùng mốc dữ liệu đã xác minh."]
  },
  ko: {
    title: "LINE Rangers 레전드 티어 캐릭터 통계", description: "레전드 티어 플레이어의 방어팀을 기준으로 캐릭터 편성 수와 사용률을 집계합니다.", tap: "캐릭터를 탭하면 장비 순위를 볼 수 있습니다.", loading: "통계 데이터를 불러오는 중입니다...", league: "리그", slots: "전체 캐릭터 편성 수", updated: "최종 업데이트", ranking: "캐릭터 순위", rankingDescription: "편성 수가 많은 순서로 표시합니다.", rank: "순위", character: "캐릭터", occurrence: "편성 수", players: "사용 인원", rate: "사용률", method: "집계 방법", source: "데이터 출처:", footer: "비공식 팬 제작 통계 페이지", period: {hour: "1시간 전", day: "전일 마감", week: "전주 마감", month: "전월 마감"}, comparison: "선택한 기준 시점 대비 캐릭터 수 변화입니다.", pending: "기록 대기", healthy: "정상 업데이트", delayed: "업데이트가 지연되었습니다", stale: "마지막 정상 데이터를 표시 중", loadError: "통계 데이터를 불러오지 못했습니다.", dialog: "캐릭터 장비 순위", dialogDescription: "장비 수는 중복 편성도 모두 세고, 사용률은 플레이어를 한 명으로만 계산합니다.", weapon: "무기", armor: "방어구", accessory: "액세서리", equipment: "장비", equipmentCount: "장비 수", equipmentPlayers: "사용 인원", noEquipment: "이 분류의 장비 데이터가 없습니다.", close: "닫기", board: "게시판", result: n => `${n}건`, occUnit: "개", playerUnit: "명",
    methods: ["편성 수는 집계된 방어팀의 캐릭터 총 수입니다.","같은 캐릭터를 여러 개 사용하면 각각 계산합니다.","사용 인원은 해당 캐릭터를 한 개 이상 사용한 플레이어 수입니다.","같은 플레이어가 여러 개를 사용해도 사용 인원은 한 명입니다.","사용률 = 사용 인원 ÷ 집계 인원.","수집기와 감시 작업이 최신 상태를 확인하고 지연 시 재시도합니다.","이 사이트는 비공식 팬 제작 사이트입니다.","비교는 검증된 기준 데이터를 사용합니다."]
  }
};

const EQUIPMENT_TYPES = [["WEAPON", "weapon"], ["ARMOR", "armor"], ["ACC", "accessory"]];
let data = null;
let language = "ja";
let selectedPeriod = "day";
let selectedCharacter = null;
let selectedEquipment = "WEAPON";
let loading = false;
let lastAttempt = 0;

const $ = selector => document.querySelector(selector);
const tr = () => I18N[language] || I18N.en;

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function locale() {
  return {ja:"ja-JP",en:"en-US",zh:"zh-TW",th:"th-TH",id:"id-ID",vi:"vi-VN",ko:"ko-KR"}[language] || "en-US";
}

function formatInteger(value) {
  return new Intl.NumberFormat(locale()).format(Number(value) || 0);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale(), {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tokyo"}).format(date);
}

function isTrustedCharacterImage(value, code) {
  if (typeof value !== "string" || !SAFE_CODE.test(String(code || ""))) return false;
  try {
    const url = new URL(value);
    return url.origin === TRUSTED_ORIGIN && !url.search && !url.hash && url.pathname === `/res/${code}/${code}-thum.png`;
  } catch { return false; }
}

function isTrustedEquipmentImage(value, code) {
  if (typeof value !== "string" || !SAFE_CODE.test(String(code || ""))) return false;
  try {
    const url = new URL(value);
    if (url.origin !== TRUSTED_ORIGIN || url.search || url.hash) return false;
    return url.pathname === `/res/${code}/${code}-icon.png` || url.pathname === `/res/gear_icon/${code}_icon.png`;
  } catch { return false; }
}

function validInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function validate(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.characters)) return false;
  if (payload.target_players !== TARGET_PLAYERS || payload.sampled_players !== TARGET_PLAYERS || payload.complete_target !== true) return false;
  if (!validInteger(payload.character_slots, TARGET_PLAYERS, TARGET_PLAYERS * 10)) return false;
  if (!validInteger(payload.unique_characters, 1, payload.character_slots) || payload.unique_characters !== payload.characters.length) return false;
  if (Number(payload.collection_quality?.detail_fetch_failures) !== 0 || Number(payload.collection_quality?.invalid_player_records) !== 0) return false;
  let total = 0;
  const seen = new Set();
  for (const row of payload.characters) {
    if (!row || !SAFE_CODE.test(String(row.unit_code || "")) || seen.has(row.unit_code)) return false;
    seen.add(row.unit_code);
    if (!isTrustedCharacterImage(row.image, row.unit_code)) return false;
    if (typeof row.name !== "string" || !row.name.trim()) return false;
    if (!validInteger(row.occurrence_count, 1, payload.character_slots)) return false;
    if (!validInteger(row.player_count, 1, TARGET_PLAYERS) || row.player_count > row.occurrence_count) return false;
    const expectedRate = Math.round((row.player_count / TARGET_PLAYERS) * 1000) / 10;
    if (!Number.isFinite(Number(row.adoption_rate)) || Math.abs(Number(row.adoption_rate) - expectedRate) > 0.11) return false;
    for (const [type] of EQUIPMENT_TYPES) {
      const category = row.equipment_rankings?.[type];
      if (!category || !Array.isArray(category.items)) return false;
      for (const item of category.items) {
        if (!SAFE_CODE.test(String(item?.item_code || "")) || !isTrustedEquipmentImage(item.image, item.item_code)) return false;
      }
    }
    total += row.occurrence_count;
  }
  return total === payload.character_slots;
}

function freshness() {
  const updated = new Date(data?.updated_at || "").getTime();
  const age = Date.now() - updated;
  if (!Number.isFinite(updated) || age >= 4 * 60 * 60 * 1000) return [tr().stale, "freshness-stale"];
  if (age >= 2 * 60 * 60 * 1000) return [tr().delayed, "freshness-delayed"];
  return [tr().healthy, "freshness-healthy"];
}

function periodDelta(row) {
  const ref = row?.change?.periods?.[selectedPeriod];
  if (!ref || ref.comparable !== true || !Number.isSafeInteger(ref.occurrence_count)) {
    return {text: tr().pending, className: "rank-period-pending"};
  }
  const value = ref.occurrence_count;
  return {
    text: value > 0 ? `+${formatInteger(value)}${tr().occUnit}` : value < 0 ? `-${formatInteger(Math.abs(value))}${tr().occUnit}` : "±0",
    className: value > 0 ? "rank-period-up" : value < 0 ? "rank-period-down" : "rank-period-neutral"
  };
}

function createCharacterImage(row, className, rank = null) {
  const frame = document.createElement("span");
  frame.className = `${className} character-image-frame`;
  const img = document.createElement("img");
  img.src = row.image;
  img.alt = rank ? `${rank} ${tr().character}` : row.name;
  img.loading = rank && rank > 8 ? "lazy" : "eager";
  img.decoding = "async";
  img.width = 64;
  img.height = 64;
  const pending = document.createElement("span");
  pending.className = "character-image-pending";
  pending.textContent = "Image\npending";
  pending.hidden = true;
  img.addEventListener("error", () => { img.hidden = true; pending.hidden = false; });
  img.addEventListener("load", () => { img.hidden = false; pending.hidden = true; });
  frame.append(img, pending);
  return frame;
}

function renderPeriodSelector() {
  setText("#rank-period-current", tr().period[selectedPeriod]);
  setText("#rank-period-comparison-label", tr().comparison);
  document.querySelectorAll("[data-rank-period]").forEach(button => {
    const key = button.dataset.rankPeriod;
    button.textContent = tr().period[key];
    button.classList.toggle("rank-period-selected", key === selectedPeriod);
    button.setAttribute("aria-selected", String(key === selectedPeriod));
  });
}

function renderSummary() {
  setText("#summary-league", data.league || "LEGEND");
  setText("#summary-slots", `${formatInteger(data.character_slots)}${tr().occUnit}`);
  setText("#summary-updated", formatDate(data.updated_at));
  const [label, className] = freshness();
  const badge = $("#summary-freshness");
  badge.textContent = label;
  badge.className = `freshness-badge ${className}`;
  setText("#summary-health", `${formatInteger(data.sampled_players)}/${formatInteger(data.target_players)}${tr().playerUnit}・取得エラー0`);
}

function renderRanking() {
  const body = $("#ranking-body");
  body.replaceChildren();
  const fragment = document.createDocumentFragment();
  const bars = [];

  data.characters.forEach((row, index) => {
    const rankValue = row.rank || index + 1;
    const rowNode = document.createElement("tr");

    const rankCell = document.createElement("td");
    rankCell.className = "rank-cell";
    rankCell.dataset.rank = String(rankValue);
    const rank = document.createElement("span");
    rank.className = "rank-number";
    rank.textContent = String(rankValue);
    rankCell.appendChild(rank);
    const delta = periodDelta(row);
    const changes = document.createElement("span");
    changes.className = "rank-period-changes";
    const badge = document.createElement("span");
    badge.className = `rank-period-change ${delta.className}`;
    badge.textContent = delta.text;
    badge.title = `${tr().period[selectedPeriod]}: ${delta.text}`;
    changes.appendChild(badge);
    rankCell.appendChild(changes);

    const characterCell = document.createElement("td");
    characterCell.className = "character-cell";
    const characterButton = document.createElement("button");
    characterButton.type = "button";
    characterButton.className = "character-button";
    characterButton.dataset.unitCode = row.unit_code;
    characterButton.setAttribute("aria-label", `${row.name}: ${tr().dialog}`);
    characterButton.appendChild(createCharacterImage(row, "character-image", rankValue));
    characterButton.addEventListener("click", () => openEquipment(row));
    characterCell.appendChild(characterButton);

    const occurrence = document.createElement("td");
    occurrence.className = "number-cell";
    occurrence.textContent = `${formatInteger(row.occurrence_count)}${tr().occUnit}`;

    const players = document.createElement("td");
    players.className = "number-cell";
    players.textContent = `${formatInteger(row.player_count)}${tr().playerUnit}`;

    const rate = document.createElement("td");
    rate.className = "rate-cell";
    const rateContainer = document.createElement("div");
    rateContainer.style.display = "flex";
    rateContainer.style.alignItems = "center";
    rateContainer.style.gap = "0.75rem";
    const rateValue = document.createElement("span");
    rateValue.className = "rate-value";
    rateValue.textContent = `${Number(row.adoption_rate).toFixed(1)}%`;
    const track = document.createElement("div");
    track.className = "rate-track";
    const bar = document.createElement("span");
    bar.className = "rate-bar";
    bar.style.width = "0%";
    track.appendChild(bar);
    rateContainer.append(rateValue, track);
    rate.appendChild(rateContainer);
    bars.push([bar, Math.max(0, Math.min(100, Number(row.adoption_rate) || 0))]);

    rowNode.append(rankCell, characterCell, occurrence, players, rate);
    fragment.appendChild(rowNode);
  });

  body.appendChild(fragment);
  requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(([bar, width]) => { bar.style.width = `${width}%`; })));
  setText("#result-count", tr().result(data.characters.length));
}

function renderEquipment() {
  if (!selectedCharacter) return;
  const dialog = $("#equipment-dialog");
  const content = $("#equipment-content");
  setText("#equipment-title", tr().dialog);
  $("#equipment-close").setAttribute("aria-label", tr().close);
  content.replaceChildren();

  const summary = document.createElement("div");
  summary.className = "equipment-summary";
  summary.appendChild(createCharacterImage(selectedCharacter, "equipment-character-image"));
  const summaryText = document.createElement("div");
  const description = document.createElement("p");
  description.textContent = tr().dialogDescription;
  const meta = document.createElement("p");
  meta.className = "equipment-meta";
  meta.textContent = `${selectedCharacter.name} · ${tr().players}: ${formatInteger(selectedCharacter.player_count)}${tr().playerUnit} · ${tr().occurrence}: ${formatInteger(selectedCharacter.occurrence_count)}${tr().occUnit}`;
  summaryText.append(description, meta);
  summary.appendChild(summaryText);
  content.appendChild(summary);

  const tabs = document.createElement("div");
  tabs.className = "equipment-tabs";
  tabs.setAttribute("role", "tablist");
  EQUIPMENT_TYPES.forEach(([type, labelKey]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "equipment-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(type === selectedEquipment));
    button.textContent = tr()[labelKey];
    button.addEventListener("click", () => { selectedEquipment = type; renderEquipment(); });
    tabs.appendChild(button);
  });
  content.appendChild(tabs);

  const items = selectedCharacter.equipment_rankings?.[selectedEquipment]?.items || [];
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "equipment-empty";
    empty.textContent = tr().noEquipment;
    content.appendChild(empty);
  } else {
    const wrapper = document.createElement("div");
    wrapper.className = "equipment-table-wrapper";
    const table = document.createElement("table");
    table.className = "equipment-table";
    const thead = document.createElement("thead");
    const head = document.createElement("tr");
    [tr().rank, tr().equipment, tr().equipmentCount, tr().equipmentPlayers, tr().rate].forEach(label => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.appendChild(th);
    });
    thead.appendChild(head);
    const tbody = document.createElement("tbody");
    items.forEach(item => {
      const row = document.createElement("tr");
      const rank = document.createElement("td");
      rank.className = "rank-cell equipment-rank-cell";
      rank.dataset.rank = String(item.rank || "");
      const rankNumber = document.createElement("span");
      rankNumber.className = "rank-number";
      rankNumber.textContent = String(item.rank || "-");
      rank.appendChild(rankNumber);

      const icon = document.createElement("td");
      icon.className = "equipment-icon-cell";
      if (isTrustedEquipmentImage(item.image, item.item_code)) {
        const img = document.createElement("img");
        img.className = "equipment-image";
        img.src = item.image;
        img.alt = tr().equipment;
        img.loading = "lazy";
        img.decoding = "async";
        img.width = 36;
        img.height = 36;
        icon.appendChild(img);
      }

      const count = document.createElement("td");
      count.className = "number-cell";
      count.textContent = `${formatInteger(item.occurrence_count)}${language === "ja" ? "個" : ""}`;
      const users = document.createElement("td");
      users.className = "number-cell";
      users.textContent = `${formatInteger(item.player_count)}${tr().playerUnit}`;
      const rate = document.createElement("td");
      rate.className = "number-cell";
      rate.textContent = `${Number(item.adoption_rate || 0).toFixed(1)}%`;
      row.append(rank, icon, count, users, rate);
      tbody.appendChild(row);
    });
    table.append(thead, tbody);
    wrapper.appendChild(table);
    content.appendChild(wrapper);
  }

  if (!dialog.open) dialog.showModal();
}

function openEquipment(row) {
  selectedCharacter = row;
  selectedEquipment = "WEAPON";
  renderEquipment();
}

function renderAll() {
  if (!data) return;
  renderSummary();
  renderPeriodSelector();
  renderRanking();
  $("#summary").hidden = false;
  $("#ranking-section").hidden = false;
  $("#status-message").hidden = true;
}

function applyLanguage() {
  const t = tr();
  document.documentElement.lang = language === "zh" ? "zh-TW" : language;
  document.title = t.title;
  setText("#page-title", t.title);
  setText("#page-description", t.description);
  setText("#ranking-tap-hint", t.tap);
  setText("#label-league", t.league);
  setText("#label-slots", t.slots);
  setText("#label-updated", t.updated);
  setText("#ranking-title", t.ranking);
  setText("#ranking-description", t.rankingDescription);
  setText("#ranking-caption", t.ranking);
  setText("#th-rank", t.rank);
  setText("#th-character", t.character);
  setText("#th-occurrence", t.occurrence);
  setText("#th-players", t.players);
  setText("#th-rate", t.rate);
  setText("#method-title", t.method);
  t.methods.forEach((value, index) => setText(`#method-${index + 1}`, value));
  setText("#source-label", t.source);
  setText("#footer-text", t.footer);
  document.querySelectorAll("[data-language]").forEach(button => {
    const active = button.dataset.language === language;
    button.classList.toggle("language-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const boardLink = $("#community-bridge-link");
  if (boardLink) boardLink.textContent = t.board;
  renderPeriodSelector();
  renderAll();
}

function detectLanguage() {
  try {
    const saved = localStorage.getItem("line-rangers-language");
    if (I18N[saved]) return saved;
  } catch {}
  const browser = String(navigator.language || "").toLowerCase();
  for (const key of ["ja", "th", "zh", "id", "vi", "ko"]) if (browser.startsWith(key)) return key;
  return "en";
}

function updateSundayNotice() {
  const notice = $("#sunday-notice");
  if (!notice) return;
  const weekday = new Intl.DateTimeFormat("en-US", {weekday:"short",timeZone:"Asia/Tokyo"}).format(new Date());
  notice.textContent = "土曜のPVPランキング初期化直後は、200人分が揃うまで前回データを表示します。";
  notice.hidden = weekday !== "Sun";
}

function installBoardBridge() {
  if ($("#community-bridge-link")) return;
  const style = document.createElement("style");
  style.textContent = `
    .community-bridge-link{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));z-index:60;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.62rem .95rem;border:1px solid rgb(50 213 131 / 70%);border-radius:999px;color:#052417;background:#32d583;box-shadow:0 12px 30px rgb(0 0 0 / 38%);font-size:.86rem;font-weight:900;text-decoration:none;letter-spacing:.02em}.community-bridge-link:hover{color:#041b11;background:#52df99}.community-bridge-link:focus-visible{outline:3px solid rgb(50 213 131 / 38%);outline-offset:3px}@media(max-width:480px){.community-bridge-link{min-height:40px;padding:.5rem .78rem;font-size:.78rem}}`;
  document.head.appendChild(style);
  const link = document.createElement("a");
  link.id = "community-bridge-link";
  link.className = "community-bridge-link";
  link.href = "/boards";
  link.textContent = tr().board;
  link.setAttribute("aria-label", tr().board);
  document.body.appendChild(link);
}

async function loadData({background = false} = {}) {
  if (loading) return;
  loading = true;
  lastAttempt = Date.now();
  if (!background || !data) {
    $("#status-message").hidden = false;
    $("#status-message").className = "message";
    $("#status-message").textContent = tr().loading;
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${DATA_PATH}?v=${Date.now()}`, {cache:"no-store",headers:{Accept:"application/json"},signal:controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    if (raw.length > 4 * 1024 * 1024) throw new Error("payload too large");
    const payload = JSON.parse(raw);
    if (!validate(payload)) throw new Error("invalid verified snapshot");
    data = payload;
    renderAll();
    $("#source-status-notice").hidden = true;
  } catch (error) {
    console.error("PvP data load failed", error?.message || "Error");
    if (!data) {
      $("#status-message").hidden = false;
      $("#status-message").className = "message message-error";
      $("#status-message").textContent = tr().loadError;
    }
  } finally {
    window.clearTimeout(timer);
    loading = false;
  }
}

function setPeriodMenu(open) {
  const trigger = $("#rank-period-trigger");
  const options = $("#rank-period-options");
  options.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  trigger.classList.toggle("rank-period-open", open);
}

language = detectLanguage();
installBoardBridge();
applyLanguage();
updateSundayNotice();

$("#rank-period-trigger").addEventListener("click", () => setPeriodMenu($("#rank-period-options").hidden));
document.querySelectorAll("[data-rank-period]").forEach(button => button.addEventListener("click", () => {
  const key = button.dataset.rankPeriod;
  if (!PERIODS.includes(key)) return;
  selectedPeriod = key;
  setPeriodMenu(false);
  renderPeriodSelector();
  renderRanking();
}));
document.querySelectorAll("[data-language]").forEach(button => button.addEventListener("click", () => {
  const key = button.dataset.language;
  if (!I18N[key]) return;
  language = key;
  try { localStorage.setItem("line-rangers-language", key); } catch {}
  applyLanguage();
}));

$("#equipment-close").addEventListener("click", () => $("#equipment-dialog").close());
$("#equipment-dialog").addEventListener("click", event => { if (event.target === $("#equipment-dialog")) $("#equipment-dialog").close(); });
document.addEventListener("click", event => { if (!$("#rank-period-selector").contains(event.target)) setPeriodMenu(false); });
document.addEventListener("keydown", event => { if (event.key === "Escape") setPeriodMenu(false); });

loadData();
window.setInterval(() => loadData({background:true}), AUTO_REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && Date.now() - lastAttempt > 60_000) loadData({background:true}); });
window.addEventListener("online", () => loadData({background:true}));
