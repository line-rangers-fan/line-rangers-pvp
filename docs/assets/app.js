// File: docs/assets/app.js
"use strict";

const DATA_PATH = "./data/character_usage.json";
const HISTORY_PATH = "./data/character_usage_history.json";
const DATA_RETRY_DELAYS_MS = [0, 500, 1500];
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const DELAYED_AFTER_MS = 90 * 60 * 1000;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const HISTORY_MAX_SNAPSHOTS = 24 * 31;
const RANK_CHANGE_PERIODS = [
  ["day", "rankDay"],
  ["week", "rankWeek"],
  ["month", "rankMonth"],
];

const LANGUAGES = [
  "ja",
  "en",
  "zh",
  "th",
  "id",
  "vi",
  "ko",
];

// Browser time zone is preferred; these language zones are safe fallbacks.
const TIMEZONES = {
  ja: "Asia/Tokyo",
  en: "America/New_York",
  zh: "Asia/Taipei",
  th: "Asia/Bangkok",
  id: "Asia/Jakarta",
  vi: "Asia/Ho_Chi_Minh",
  ko: "Asia/Seoul",
};

// 「◯位の画像」の文言は言語ごとに語順が違うため関数で管理
const RANK_IMAGE_LABEL = {
  ja: (rank) => `${rank}位のキャラクター画像`,
  en: (rank) => `Rank ${rank} character image`,
  zh: (rank) => `第${rank}名角色圖片`,
  th: (rank) => `รูปตัวละครอันดับที่ ${rank}`,
  id: (rank) => `Gambar karakter peringkat ${rank}`,
  vi: (rank) => `Hình ảnh nhân vật hạng ${rank}`,
  ko: (rank) => `${rank}위 캐릭터 이미지`,
};

// 件数表示も言語ごとに単位付きの完全な文を関数で組み立てる
const RESULT_COUNT_LABEL = {
  ja: (n) => `${n}件`,
  en: (n) => `${n} characters`,
  zh: (n) => `${n}項`,
  th: (n) => `${n} รายการ`,
  id: (n) => `${n} karakter`,
  vi: (n) => `${n} nhân vật`,
  ko: (n) => `${n}건`,
};

const equipmentTranslations = {
  ja: {
    dialogTitle: "キャラクター装備ランキング",
    dialogDescription:
      "装備数は同じキャラを複数編成した分も数え、使用率は同じプレイヤーを1人として計算します。",
    characterPlayers: "キャラ使用人数",
    weapon: "武器",
    armor: "防具",
    accessory: "アクセサリー",
    equipment: "装備",
    equipmentCount: "装備数",
    equipmentPlayers: "使用人数",
    rate: "使用率",
    noEquipment: "このカテゴリの装備データはありません。",
    equipmentUnit: "件",
    close: "閉じる",
  },
  en: {
    dialogTitle: "Character Equipment Ranking",
    dialogDescription:
      "Every character copy counts toward equipment count; each player counts once for usage rate.",
    characterPlayers: "Character players",
    weapon: "Weapon",
    armor: "Armor",
    accessory: "Accessory",
    equipment: "Equipment",
    equipmentCount: "Equipment count",
    equipmentPlayers: "Players using",
    rate: "Usage rate",
    noEquipment: "No equipment data is available for this category.",
    equipmentUnit: " items",
    close: "Close",
  },
  zh: {
    dialogTitle: "角色裝備排行",
    dialogDescription: "裝備數會計入重複編成；使用率則以每位玩家僅計一次。",
    characterPlayers: "角色使用人數",
    weapon: "武器",
    armor: "防具",
    accessory: "飾品",
    equipment: "裝備",
    equipmentCount: "裝備數",
    equipmentPlayers: "使用人數",
    rate: "使用率",
    noEquipment: "此分類沒有裝備資料。",
    equipmentUnit: "件",
    close: "關閉",
  },
  th: {
    dialogTitle: "อันดับอุปกรณ์ตัวละคร",
    dialogDescription: "จำนวนอุปกรณ์นับตัวละครที่ซ้ำ ส่วนอัตราใช้จะนับผู้เล่นเพียงครั้งเดียว",
    characterPlayers: "ผู้ใช้ตัวละคร",
    weapon: "อาวุธ",
    armor: "เกราะ",
    accessory: "เครื่องประดับ",
    equipment: "อุปกรณ์",
    equipmentCount: "จำนวนอุปกรณ์",
    equipmentPlayers: "ผู้ใช้",
    rate: "อัตราการใช้",
    noEquipment: "ไม่มีข้อมูลอุปกรณ์สำหรับหมวดหมู่นี้",
    equipmentUnit: " ชิ้น",
    close: "ปิด",
  },
  id: {
    dialogTitle: "Peringkat Perlengkapan Karakter",
    dialogDescription:
      "Jumlah perlengkapan menghitung karakter ganda, sedangkan tingkat penggunaan menghitung tiap pemain sekali.",
    characterPlayers: "Pemain karakter",
    weapon: "Senjata",
    armor: "Pelindung",
    accessory: "Aksesori",
    equipment: "Perlengkapan",
    equipmentCount: "Jumlah perlengkapan",
    equipmentPlayers: "Pemain pengguna",
    rate: "Tingkat penggunaan",
    noEquipment: "Tidak ada data perlengkapan untuk kategori ini.",
    equipmentUnit: " item",
    close: "Tutup",
  },
  vi: {
    dialogTitle: "Xếp hạng trang bị nhân vật",
    dialogDescription:
      "Số trang bị tính cả nhân vật trùng lặp, còn tỷ lệ sử dụng chỉ tính mỗi người chơi một lần.",
    characterPlayers: "Người dùng nhân vật",
    weapon: "Vũ khí",
    armor: "Giáp",
    accessory: "Phụ kiện",
    equipment: "Trang bị",
    equipmentCount: "Số trang bị",
    equipmentPlayers: "Người sử dụng",
    rate: "Tỷ lệ sử dụng",
    noEquipment: "Không có dữ liệu trang bị cho danh mục này.",
    equipmentUnit: " món",
    close: "Đóng",
  },
  ko: {
    dialogTitle: "캐릭터 장비 순위",
    dialogDescription:
      "장비 수는 중복 편성도 모두 세고, 사용률은 플레이어를 한 명으로만 계산합니다.",
    characterPlayers: "캐릭터 사용 인원",
    weapon: "무기",
    armor: "방어구",
    accessory: "액세서리",
    equipment: "장비",
    equipmentCount: "장비 수",
    equipmentPlayers: "사용 인원",
    rate: "사용률",
    noEquipment: "이 분류의 장비 데이터가 없습니다.",
    equipmentUnit: "개",
    close: "닫기",
  },
};

const EQUIPMENT_TYPES = [
  ["WEAPON", "weapon"],
  ["ARMOR", "armor"],
  ["ACC", "accessory"],
];

const TAP_HINT = {
  ja: "キャラクターをタップすると、装備ランキングが見れます。",
  en: "Tap a character to view its equipment ranking.",
  zh: "點選角色即可查看裝備排名。",
  th: "แตะตัวละครเพื่อดูอันดับอุปกรณ์",
  id: "Ketuk karakter untuk melihat peringkat perlengkapannya.",
  vi: "Chạm vào nhân vật để xem xếp hạng trang bị.",
  ko: "캐릭터를 탭하면 장비 순위를 볼 수 있습니다.",
};

const WEEKLY_NOTICE = {
  ja: "土曜のPVPランキング初期化直後は、200人分が揃うまで前回の正常データを表示する場合があります。部分集計は公開しません。",
  en: "After Saturday's PVP reset, the last verified data may remain visible until all 200 players are available. Partial results are never published.",
  zh: "週六 PVP 排名重置後，在湊齊 200 名玩家前可能會繼續顯示上次驗證成功的資料，不會發布不完整的統計。",
  th: "หลังรีเซ็ตอันดับ PVP วันเสาร์ ระบบอาจแสดงข้อมูลที่ตรวจสอบแล้วครั้งล่าสุดจนกว่าจะครบ 200 คน และจะไม่เผยแพร่ผลลัพธ์ที่ไม่ครบ",
  id: "Setelah reset PVP hari Sabtu, data terverifikasi terakhir dapat tetap ditampilkan hingga 200 pemain lengkap. Hasil parsial tidak dipublikasikan.",
  vi: "Sau khi xếp hạng PVP được đặt lại vào thứ Bảy, dữ liệu đã xác minh gần nhất có thể tiếp tục hiển thị cho đến khi đủ 200 người chơi. Kết quả chưa đầy đủ sẽ không được công bố.",
  ko: "토요일 PVP 랭킹 초기화 직후에는 200명이 모두 확인될 때까지 마지막 정상 데이터를 표시할 수 있습니다. 일부만 집계된 결과는 공개하지 않습니다.",
};

const STATUS_TEXT = {
  ja: {
    healthy: "正常更新",
    delayed: "更新が少し遅れています。監視処理が再集計を試みます。",
    stale: "更新が2時間以上遅れています。前回の正常データを表示中です。",
    refresh: "今すぐ再読込",
    refreshing: "再読込中…",
    refreshError:
      "最新データの取得に失敗しました。表示中の正常データは保持しています。",
    separator: "・",
    coverageSuffix: "人",
    errors: "取得エラー",
    equipment: "装備",
    duration: "集計",
    seconds: "秒",
    rankNew: "新",
    rankDay: "1日",
    rankWeek: "1週",
    rankMonth: "1月",
  },
  en: {
    healthy: "Up to date",
    delayed: "The update is delayed. The watchdog will retry collection.",
    stale: "Over two hours late. Showing the last verified dataset.",
    refresh: "Refresh now",
    refreshing: "Refreshing…",
    refreshError:
      "Could not fetch the latest data. The verified data on screen was kept.",
    separator: " · ",
    coverageSuffix: " players",
    errors: "fetch errors ",
    equipment: "equipment ",
    duration: "collected in ",
    seconds: "s",
    rankNew: "NEW",
    rankDay: "1d",
    rankWeek: "7d",
    rankMonth: "30d",
  },
  zh: {
    healthy: "更新正常",
    delayed: "更新稍有延遲，監控程序將嘗試重新收集。",
    stale: "更新已延遲超過2小時，目前顯示上次驗證成功的資料。",
    refresh: "立即重新載入",
    refreshing: "重新載入中…",
    refreshError: "無法取得最新資料，畫面上的已驗證資料仍會保留。",
    separator: "・",
    coverageSuffix: "人",
    errors: "取得錯誤",
    equipment: "裝備",
    duration: "收集",
    seconds: "秒",
    rankNew: "新",
    rankDay: "1日",
    rankWeek: "1週",
    rankMonth: "1月",
  },
  th: {
    healthy: "อัปเดตปกติ",
    delayed: "การอัปเดตล่าช้า ระบบตรวจสอบจะลองรวบรวมใหม่",
    stale: "ล่าช้าเกิน 2 ชั่วโมง กำลังแสดงข้อมูลล่าสุดที่ผ่านการตรวจสอบ",
    refresh: "โหลดใหม่ตอนนี้",
    refreshing: "กำลังโหลดใหม่…",
    refreshError: "ดึงข้อมูลล่าสุดไม่ได้ แต่ยังคงข้อมูลที่ตรวจสอบแล้วบนหน้าจอ",
    separator: " · ",
    coverageSuffix: " คน",
    errors: "ข้อผิดพลาด ",
    equipment: "อุปกรณ์ ",
    duration: "รวบรวม ",
    seconds: " วินาที",
    rankNew: "ใหม่",
    rankDay: "1 วัน",
    rankWeek: "1 สัปดาห์",
    rankMonth: "1 เดือน",
  },
  id: {
    healthy: "Pembaruan normal",
    delayed: "Pembaruan terlambat. Pengawas akan mencoba mengumpulkan ulang.",
    stale: "Terlambat lebih dari 2 jam. Menampilkan data terverifikasi terakhir.",
    refresh: "Muat ulang",
    refreshing: "Memuat ulang…",
    refreshError:
      "Data terbaru gagal diambil. Data terverifikasi di layar tetap dipertahankan.",
    separator: " · ",
    coverageSuffix: " pemain",
    errors: "galat ",
    equipment: "perlengkapan ",
    duration: "dikumpulkan ",
    seconds: " dtk",
    rankNew: "BARU",
    rankDay: "1h",
    rankWeek: "7h",
    rankMonth: "30h",
  },
  vi: {
    healthy: "Cập nhật bình thường",
    delayed: "Cập nhật bị chậm. Trình giám sát sẽ thử thu thập lại.",
    stale: "Chậm hơn 2 giờ. Đang hiển thị dữ liệu đã xác minh gần nhất.",
    refresh: "Tải lại ngay",
    refreshing: "Đang tải lại…",
    refreshError:
      "Không lấy được dữ liệu mới nhất. Dữ liệu đã xác minh trên màn hình vẫn được giữ.",
    separator: " · ",
    coverageSuffix: " người",
    errors: "lỗi ",
    equipment: "trang bị ",
    duration: "thu thập ",
    seconds: " giây",
    rankNew: "MỚI",
    rankDay: "1 ngày",
    rankWeek: "1 tuần",
    rankMonth: "1 tháng",
  },
  ko: {
    healthy: "정상 업데이트",
    delayed: "업데이트가 지연되었습니다. 감시 작업이 재집계를 시도합니다.",
    stale: "2시간 이상 지연되어 마지막 정상 데이터를 표시하고 있습니다.",
    refresh: "지금 새로고침",
    refreshing: "새로고침 중…",
    refreshError:
      "최신 데이터를 가져오지 못했습니다. 화면의 정상 데이터는 유지됩니다.",
    separator: " · ",
    coverageSuffix: "명",
    errors: "수집 오류 ",
    equipment: "장비 ",
    duration: "집계 ",
    seconds: "초",
    rankNew: "신규",
    rankDay: "1일",
    rankWeek: "1주",
    rankMonth: "1개월",
  },
};

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
      "主集計と独立した監視処理が更新時刻を確認し、遅延時は再集計します。",
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
      "The collector and an independent watchdog verify freshness and retry delayed updates.",
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
    rank: "排名",
    character: "角色",
    occurrence: "編成數",
    playerCount: "使用人數",
    rate: "使用率",
    method: "統計方法",
    method1: "編成數是所有統計玩家防守隊伍中使用的角色總數。",
    method2: "如果同一玩家使用相同角色多次，每一隻都會分別計算。",
    method3: "使用人數是至少使用該角色一次的玩家人數。",
    method4: "即使同一玩家使用相同角色多次，使用人數仍只計算1人。",
    method5: "使用率 = 使用人數 ÷ 統計人數。",
    method6: "主收集程序與獨立監控會檢查資料新鮮度，延遲時自動重試。",
    method7: "本網站為非官方粉絲製作，與遊戲營運商沒有關係。",
    source: "資料來源：",
    footer: "非官方・粉絲製作的統計頁面",
    noData: "目前還沒有統計資料。請執行 GitHub Actions。",
    stale: "距離最後更新已超過2天，統計程序可能已停止。",
    dataError: "統計資料格式不正確。",
    charactersMissing: "找不到角色列表。",
    playersInvalid: "統計人數不正確。",
    characterInvalid: "角色資料不正確。",
    imageInvalid: "角色圖片不正確。",
    occurrenceInvalid: "編成數不正確。",
    playerCountInvalid: "使用人數不正確。",
    playerCountTooHigh: "使用人數超過統計人數。",
    occurrenceTooLow: "編成數少於使用人數。",
    fetchError: "無法取得統計資料。",
    loadError: "統計資料載入失敗。",
    notCollected: "尚未統計",
    unknown: "未知",
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
    rankingDescription: "เรียงตามจำนวนการจัดทีมจากมากไปน้อย",
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
    method5: "อัตราการใช้งาน = จำนวนผู้ใช้ ÷ จำนวนผู้เล่นที่รวบรวม",
    method6: "ตัวรวบรวมหลักและระบบตรวจสอบอิสระจะตรวจเวลาและลองใหม่เมื่ออัปเดตล่าช้า",
    method7:
      "เว็บไซต์นี้เป็นเว็บไซต์แฟนเมดอย่างไม่เป็นทางการและไม่มีความเกี่ยวข้องกับผู้ให้บริการเกม",
    source: "แหล่งข้อมูล:",
    footer: "หน้าสถิติที่สร้างโดยแฟนคลับอย่างไม่เป็นทางการ",
    noData: "ยังไม่มีข้อมูลสถิติ กรุณาเรียกใช้ GitHub Actions",
    stale:
      "ผ่านไปมากกว่า 2 วันนับจากการอัปเดตครั้งล่าสุด กระบวนการรวบรวมข้อมูลอาจหยุดทำงาน",
    dataError: "รูปแบบข้อมูลสถิติไม่ถูกต้อง",
    charactersMissing: "ไม่พบรายการตัวละคร",
    playersInvalid: "จำนวนผู้เล่นที่รวบรวมไม่ถูกต้อง",
    characterInvalid: "ข้อมูลตัวละครไม่ถูกต้อง",
    imageInvalid: "รูปภาพตัวละครไม่ถูกต้อง",
    occurrenceInvalid: "จำนวนการจัดทีมไม่ถูกต้อง",
    playerCountInvalid: "จำนวนผู้ใช้ไม่ถูกต้อง",
    playerCountTooHigh: "จำนวนผู้ใช้มากกว่าจำนวนผู้เล่นที่รวบรวม",
    occurrenceTooLow: "จำนวนการจัดทีมต่ำกว่าจำนวนผู้ใช้",
    fetchError: "ไม่สามารถรับข้อมูลสถิติได้",
    loadError: "ไม่สามารถโหลดข้อมูลสถิติได้",
    notCollected: "ยังไม่ได้รวบรวม",
    unknown: "ไม่ทราบ",
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
    rankingDescription: "Diurutkan berdasarkan jumlah penggunaan.",
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
    method5: "Tingkat penggunaan = Pemain yang Menggunakan ÷ Jumlah Pemain.",
    method6:
      "Pengumpul utama dan pengawas independen memeriksa kesegaran serta mencoba ulang jika terlambat.",
    method7:
      "Situs ini adalah situs penggemar tidak resmi dan tidak berafiliasi dengan pengelola game.",
    source: "Sumber Data:",
    footer: "Halaman statistik buatan penggemar tidak resmi",
    noData: "Belum ada data statistik. Silakan jalankan GitHub Actions.",
    stale:
      "Sudah lebih dari 2 hari sejak pembaruan terakhir. Proses statistik mungkin berhenti.",
    dataError: "Format data statistik tidak valid.",
    charactersMissing: "Daftar karakter tidak ditemukan.",
    playersInvalid: "Jumlah pemain tidak valid.",
    characterInvalid: "Data karakter tidak valid.",
    imageInvalid: "Gambar karakter tidak valid.",
    occurrenceInvalid: "Jumlah penggunaan tidak valid.",
    playerCountInvalid: "Jumlah pemain tidak valid.",
    playerCountTooHigh:
      "Jumlah pemain yang menggunakan melebihi jumlah pemain yang dihitung.",
    occurrenceTooLow:
      "Jumlah penggunaan lebih rendah daripada jumlah pemain yang menggunakan.",
    fetchError: "Tidak dapat mengambil data statistik.",
    loadError: "Gagal memuat data statistik.",
    notCollected: "Belum dikumpulkan",
    unknown: "Tidak diketahui",
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
    rankingDescription: "Sắp xếp theo số lần xếp đội từ cao xuống thấp.",
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
    method5: "Tỷ lệ sử dụng = Số người sử dụng ÷ Số người được thống kê.",
    method6: "Bộ thu thập chính và trình giám sát độc lập kiểm tra độ mới và thử lại khi chậm.",
    method7:
      "Đây là trang do người hâm mộ tạo ra, không chính thức và không liên quan đến nhà vận hành trò chơi.",
    source: "Nguồn dữ liệu:",
    footer: "Trang thống kê không chính thức do người hâm mộ tạo",
    noData: "Chưa có dữ liệu thống kê. Vui lòng chạy GitHub Actions.",
    stale:
      "Đã hơn 2 ngày kể từ lần cập nhật cuối. Quá trình thống kê có thể đã dừng.",
    dataError: "Định dạng dữ liệu thống kê không hợp lệ.",
    charactersMissing: "Không tìm thấy danh sách nhân vật.",
    playersInvalid: "Số người được thống kê không hợp lệ.",
    characterInvalid: "Dữ liệu nhân vật không hợp lệ.",
    imageInvalid: "Hình ảnh nhân vật không hợp lệ.",
    occurrenceInvalid: "Số lần xếp đội không hợp lệ.",
    playerCountInvalid: "Số người sử dụng không hợp lệ.",
    playerCountTooHigh: "Số người sử dụng vượt quá số người được thống kê.",
    occurrenceTooLow: "Số lần xếp đội thấp hơn số người sử dụng.",
    fetchError: "Không thể lấy dữ liệu thống kê.",
    loadError: "Không thể tải dữ liệu thống kê.",
    notCollected: "Chưa thống kê",
    unknown: "Không rõ",
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
    rankingDescription: "편성 수가 많은 순서로 표시합니다.",
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
    method3: "사용 인원은 해당 캐릭터를 1개 이상 사용한 플레이어 수입니다.",
    method4:
      "한 플레이어가 같은 캐릭터를 여러 개 사용해도 사용 인원에서는 1명으로 계산합니다.",
    method5: "사용률 = 사용 인원 ÷ 집계 인원",
    method6: "주 집계와 독립 감시 작업이 최신 상태를 확인하고 지연 시 다시 집계합니다.",
    method7: "이 사이트는 비공식 팬 제작 사이트이며 게임 운영사와 관련이 없습니다.",
    source: "데이터 출처:",
    footer: "비공식 팬 제작 통계 페이지",
    noData: "아직 통계 데이터가 없습니다. GitHub Actions를 실행해 주세요.",
    stale: "마지막 업데이트 후 2일 이상 지났습니다. 통계 처리가 중단되었을 수 있습니다.",
    dataError: "통계 데이터 형식이 올바르지 않습니다.",
    charactersMissing: "캐릭터 목록이 없습니다.",
    playersInvalid: "집계 인원이 올바르지 않습니다.",
    characterInvalid: "캐릭터 데이터가 올바르지 않습니다.",
    imageInvalid: "캐릭터 이미지가 올바르지 않습니다.",
    occurrenceInvalid: "편성 수가 올바르지 않습니다.",
    playerCountInvalid: "사용 인원이 올바르지 않습니다.",
    playerCountTooHigh: "사용 인원이 집계 인원을 초과했습니다.",
    occurrenceTooLow: "편성 수가 사용 인원보다 적습니다.",
    fetchError: "통계 데이터를 가져올 수 없습니다.",
    loadError: "통계 데이터를 불러오지 못했습니다.",
    notCollected: "집계되지 않음",
    unknown: "알 수 없음",
    units: {
      occurrence: "개",
      players: "명",
      characters: "종류",
    },
  },
};

const state = {
  data: null,
  history: null,
  historyPromise: null,
  characters: [],
  language: "ja",
  selectedCharacter: null,
  selectedEquipmentType: "WEAPON",
  selectedRankPeriod: "day",
  rankingScrollTop: 0,
  suppressCharacterTapUntil: 0,
  isLoading: false,
  lastLoadAttempt: 0,
  lastLoadError: false,
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
  freshness: document.querySelector("#summary-freshness"),
  health: document.querySelector("#summary-health"),
  body: document.querySelector("#ranking-body"),
  resultCount: document.querySelector("#result-count"),
  sourceLink: document.querySelector("#source-link"),
};

function t(key) {
  return translations[state.language][key];
}

function et(key) {
  return equipmentTranslations[state.language][key];
}

function st(key) {
  const language = STATUS_TEXT[state.language] || STATUS_TEXT.en;
  return language[key];
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

function getDisplayTimeZone() {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browserTimeZone || TIMEZONES[state.language] || "UTC";
}

function updateWeeklyNotice() {
  const notice = document.querySelector("#sunday-notice");
  if (!notice) return;

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  notice.textContent = WEEKLY_NOTICE[state.language] || WEEKLY_NOTICE.en;
  notice.hidden = weekday !== "Sun";
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
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getDisplayTimeZone(),
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

function characterLabel(character) {
  if (!character) {
    return t("unknown");
  }

  if (typeof character.name === "string" && character.name.trim()) {
    return character.name.trim();
  }

  return t("unknown");
}

function applyTranslations() {
  const tr = translations[state.language];

  document.documentElement.lang =
    state.language === "zh" ? "zh-TW" : state.language;

  document.title = tr.title;

  setText("#page-title", tr.title);
  setText("#page-description", tr.description);
  setText("#ranking-tap-hint", TAP_HINT[state.language] || TAP_HINT.en);
  updateWeeklyNotice();

  setText("#label-league", tr.league);
  setText("#label-players", tr.players);
  setText("#label-slots", tr.slots);
  setText("#label-characters", tr.characters);
  setText("#label-updated", tr.updated);

  setText("#ranking-title", tr.ranking);
  setText("#ranking-description", tr.rankingDescription);
  renderRankPeriodSelector();

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
    updateFreshnessWarning();
  }

  const dialog = document.querySelector("#equipment-dialog");
  if (dialog?.open && state.selectedCharacter) {
    renderEquipment(state.selectedCharacter);
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

function getFreshnessLevel() {
  const updatedTime = new Date(state.data?.updated_at || "").getTime();
  if (Number.isNaN(updatedTime)) return "stale";
  const age = Math.max(0, Date.now() - updatedTime);
  if (age >= STALE_AFTER_MS) return "stale";
  if (age >= DELAYED_AFTER_MS) return "delayed";
  return "healthy";
}

function formatQualitySummary() {
  if (!state.data) return "";
  const text = STATUS_TEXT[state.language] || STATUS_TEXT.en;
  const sampled = formatInteger(state.data.sampled_players);
  const target = formatInteger(state.data.target_players);
  const failures = Number(
    state.data.collection_quality?.detail_fetch_failures ??
      state.data.diagnostics?.detail_fetch_failures?.length ??
      0
  );
  const parts = [
    `${sampled}/${target}${text.coverageSuffix}`,
    `${text.errors}${formatInteger(failures)}`,
  ];
  const fillRate = Number(state.data.collection_quality?.equipment_fill_rate);
  if (Number.isFinite(fillRate)) {
    parts.push(`${text.equipment}${fillRate.toFixed(1)}%`);
  }
  const duration = Number(
    state.data.collection_quality?.collection_duration_seconds
  );
  if (Number.isFinite(duration) && duration > 0) {
    parts.push(
      `${text.duration}${formatInteger(Math.round(duration))}${text.seconds}`
    );
  }
  return parts.join(text.separator);
}

function ensureDataWarning() {
  let banner = document.querySelector("#data-warning");
  if (banner) return banner;

  banner = document.createElement("section");
  banner.id = "data-warning";
  banner.setAttribute("role", "status");

  const message = document.createElement("span");
  message.className = "data-warning-text";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "data-refresh-button";
  refresh.addEventListener("click", () => {
    loadData({ background: Boolean(state.data) });
  });
  banner.append(message, refresh);
  elements.summary.insertAdjacentElement("beforebegin", banner);
  return banner;
}

function updateFreshnessWarning() {
  if (!elements.summary || !state.data) return;

  const level = getFreshnessLevel();
  if (elements.freshness) {
    elements.freshness.textContent = st(
      level === "healthy" ? "healthy" : level
    );
    elements.freshness.className = `freshness-badge freshness-${level}`;
  }

  const existing = document.querySelector("#data-warning");
  if (level === "healthy" && !state.lastLoadError) {
    if (existing) existing.hidden = true;
    return;
  }

  const banner = ensureDataWarning();
  const message = banner.querySelector(".data-warning-text");
  const refresh = banner.querySelector(".data-refresh-button");
  banner.className =
    level === "stale"
      ? "message message-error data-warning"
      : "message message-warning data-warning";
  message.textContent = state.lastLoadError ? st("refreshError") : st(level);
  refresh.textContent = state.isLoading ? st("refreshing") : st("refresh");
  refresh.disabled = state.isLoading;
  banner.hidden = false;
}

function renderSummary() {
  if (!state.data) return;

  elements.league.textContent = translateLeague(state.data.league);
  elements.players.textContent = formatUnit(state.data.sampled_players, "players");
  elements.slots.textContent = formatUnit(state.data.character_slots, "occurrence");
  elements.characters.textContent = formatUnit(state.data.unique_characters, "characters");
  elements.updated.textContent = formatDate(state.data.updated_at);
  if (elements.health) {
    elements.health.textContent = formatQualitySummary();
  }
  updateFreshnessWarning();
}

function renderRankPeriodChanges(container, change, options = {}) {
  const alwaysShowZero = options.alwaysShowZero === true;
  const selectedPeriod = String(options.period || "");
  const currentRank = Number(options.currentRank);
  const compactTransition = options.compactTransition === true;
  const includePeriodLabel = options.includePeriodLabel !== false;
  const periods = change?.periods;
  if (!alwaysShowZero && (!periods || typeof periods !== "object")) return;

  const periodDefinitions = selectedPeriod
    ? RANK_CHANGE_PERIODS.filter(([key]) => key === selectedPeriod)
    : RANK_CHANGE_PERIODS;
  const comparablePeriods = periodDefinitions
    .map(([key, labelKey]) => ({
      key,
      label: st(labelKey),
      value: periods?.[key],
    }))
    .filter(({ value }) => alwaysShowZero || value?.comparable === true);
  if (!alwaysShowZero && comparablePeriods.length === 0) return;

  const list = document.createElement("span");
  list.className = "rank-period-changes";
  list.setAttribute("aria-label", "rank period changes");
  comparablePeriods.forEach(({ key, label, value }) => {
    const parsedDelta = Number(value?.rank);
    const delta = Number.isInteger(parsedDelta) && Number.isFinite(parsedDelta)
      ? parsedDelta
      : 0;
    const badge = document.createElement("span");
    badge.className =
      delta > 0
        ? "rank-period-change rank-period-up"
        : delta < 0
          ? "rank-period-change rank-period-down"
          : "rank-period-change rank-period-neutral";
    const symbol = delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : "0";
    const previousRank =
      Number.isInteger(currentRank) && Number.isFinite(currentRank)
        ? currentRank + delta
        : null;
    const movement =
      delta !== 0 && compactTransition && previousRank !== null
        ? `${previousRank}→${currentRank}`
        : symbol;
    const visibleLabel = includePeriodLabel ? `${label} ${movement}` : movement;
    const detail =
      delta !== 0 && previousRank !== null
        ? `${label}: ${previousRank} → ${currentRank} (${symbol})`
        : `${label}: ${movement}`;
    badge.textContent = visibleLabel;
    badge.title = detail;
    badge.setAttribute("aria-label", detail);
    list.appendChild(badge);
  });
  container.appendChild(list);
}

function renderRankPeriodSelector() {
  document.querySelectorAll("[data-rank-period]").forEach((button) => {
    const period = button.dataset.rankPeriod;
    const definition = RANK_CHANGE_PERIODS.find(([key]) => key === period);
    if (!definition) return;

    const [, labelKey] = definition;
    const label = st(labelKey);
    const active = period === state.selectedRankPeriod;
    button.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(active));
    button.classList.toggle("rank-period-selected", active);
  });
}

function setupRankPeriodSelector() {
  document.querySelectorAll("[data-rank-period]").forEach((button) => {
    button.addEventListener("click", () => {
      const period = button.dataset.rankPeriod;
      if (!RANK_CHANGE_PERIODS.some(([key]) => key === period)) return;

      state.selectedRankPeriod = period;
      renderRankPeriodSelector();
      renderTable();

      const dialog = document.querySelector("#equipment-dialog");
      if (dialog?.open && state.selectedCharacter) {
        renderEquipment(state.selectedCharacter);
      }
    });
  });
}

function renderTable() {
  if (!elements.body) return;

  elements.body.innerHTML = "";

  if (!state.characters || state.characters.length === 0) {
    elements.resultCount.textContent = t("noData");
    return;
  }

  const fragment = document.createDocumentFragment();
  const barsToAnimate = [];

  state.characters.forEach((char, index) => {
    const tr = document.createElement("tr");
    const rank = char.rank || index + 1;

    // 順位セル
    const tdRank = document.createElement("td");
    tdRank.className = "rank-cell";
    tdRank.setAttribute("data-rank", rank);
    const rankNumber = document.createElement("span");
    rankNumber.className = "rank-number";
    rankNumber.textContent = rank;
    tdRank.appendChild(rankNumber);

    const change = char.change;
    // Every character reserves the same compact three-line area.  A zero is
    // shown both for an unchanged rank and while a new period baseline is
    // being accumulated, preventing cells from jumping between updates.
    renderRankPeriodChanges(tdRank, change, {
      alwaysShowZero: true,
      period: state.selectedRankPeriod,
      currentRank: rank,
      compactTransition: true,
      includePeriodLabel: false,
    });
    tr.appendChild(tdRank);

    // キャラクターセル
    const tdChar = document.createElement("td");
    tdChar.className = "character-cell";

    const characterButton = document.createElement("button");
    characterButton.type = "button";
    characterButton.className = "character-button";
    characterButton.dataset.unitCode = char.unit_code || "";
    characterButton.setAttribute(
      "aria-label",
      `${characterLabel(char)}: ${et("dialogTitle")}`
    );

    const img = document.createElement("img");
    img.src = char.image || "";
    img.alt = RANK_IMAGE_LABEL[state.language](rank);
    img.className = "character-image";
    img.loading = index < 8 ? "eager" : "lazy";
    img.decoding = "async";
    img.width = 64;
    img.height = 64;
    characterButton.appendChild(img);
    tdChar.appendChild(characterButton);
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
    tr.appendChild(tdPlayers);

    // 採用率（プログレスバー）
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
    bar.style.width = "0%";

    track.appendChild(bar);
    rateContainer.appendChild(spanVal);
    rateContainer.appendChild(track);
    tdRate.appendChild(rateContainer);
    tr.appendChild(tdRate);

    barsToAnimate.push({
      element: bar,
      width: Math.min(Math.max(rateValue, 0), 100),
    });

    fragment.appendChild(tr);
  });

  elements.body.appendChild(fragment);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      barsToAnimate.forEach(({ element, width }) => {
        element.style.width = `${width}%`;
      });
    });
  });

  const label = RESULT_COUNT_LABEL[state.language] || RESULT_COUNT_LABEL.en;
  elements.resultCount.textContent = label(formatInteger(state.characters.length));
}

function validateData(data) {
  if (!data || typeof data !== "object") {
    throw new Error(t("dataError"));
  }

  if (!Array.isArray(data.characters)) {
    throw new Error(t("charactersMissing"));
  }

  const sampled = Number(data.sampled_players);
  const target = Number(data.target_players);
  const slots = Number(data.character_slots);

  if (
    !Number.isFinite(sampled) ||
    !Number.isFinite(target) ||
    sampled <= 0 ||
    sampled !== target ||
    data.complete_target !== true
  ) {
    throw new Error(t("playersInvalid"));
  }
  if (!Number.isFinite(slots) || slots < sampled || slots > sampled * 10) {
    throw new Error(t("occurrenceInvalid"));
  }
  const quality = data.collection_quality;
  const collectionDuration = Number(quality?.collection_duration_seconds);
  const detailDuration = Number(quality?.detail_fetch_duration_seconds);
  const equipmentFillRate = Number(quality?.equipment_fill_rate);
  if (
    !quality ||
    Number(quality.sample_coverage) !== 100 ||
    Number(quality.detail_fetch_failures) !== 0 ||
    Number(quality.invalid_player_records) !== 0 ||
    !Number.isFinite(collectionDuration) ||
    collectionDuration < 0 ||
    collectionDuration > 15 * 60 ||
    !Number.isFinite(detailDuration) ||
    detailDuration < 0 ||
    detailDuration > collectionDuration ||
    !Number.isFinite(equipmentFillRate) ||
    equipmentFillRate < 0 ||
    equipmentFillRate > 100
  ) {
    throw new Error(t("dataError"));
  }

  let slotTotal = 0;
  let previousCount = null;
  let previousRank = 0;
  const unitCodes = new Set();

  data.characters.forEach((char, index) => {
    if (!char || typeof char !== "object") {
      throw new Error(t("characterInvalid"));
    }

    if (typeof char.image !== "string" || char.image.length === 0) {
      throw new Error(t("imageInvalid"));
    }

    if (
      typeof char.unit_code !== "string" ||
      char.unit_code.length === 0 ||
      unitCodes.has(char.unit_code)
    ) {
      throw new Error(t("characterInvalid"));
    }
    unitCodes.add(char.unit_code);

    if (typeof char.name !== "string" || char.name.trim().length === 0) {
      throw new Error(t("characterInvalid"));
    }

    const occurrence = Number(char.occurrence_count);

    if (!Number.isFinite(occurrence) || occurrence <= 0) {
      throw new Error(t("occurrenceInvalid"));
    }
    slotTotal += occurrence;

    const players = Number(char.player_count);

    if (!Number.isFinite(players) || players <= 0) {
      throw new Error(t("playerCountInvalid"));
    }

    if (players > sampled) {
      throw new Error(t("playerCountTooHigh"));
    }

    if (occurrence < players) {
      throw new Error(t("occurrenceTooLow"));
    }

    const expectedRank =
      occurrence === previousCount ? previousRank : index + 1;
    if (Number(char.rank) !== expectedRank) {
      throw new Error(t("characterInvalid"));
    }
    previousCount = occurrence;
    previousRank = expectedRank;

    const actualRate = Number(char.adoption_rate);
    const expectedRate = Math.round((players / sampled) * 1000) / 10;
    if (
      !Number.isFinite(actualRate) ||
      Math.abs(actualRate - expectedRate) > 0.11
    ) {
      throw new Error(t("characterInvalid"));
    }

    const rankings = char.equipment_rankings;
    if (!rankings || typeof rankings !== "object") {
      throw new Error(t("characterInvalid"));
    }

    EQUIPMENT_TYPES.forEach(([type]) => {
      const category = rankings[type];
      if (!category || !Array.isArray(category.items)) {
        throw new Error(t("characterInvalid"));
      }
    });
  });

  if (
    slotTotal !== slots ||
    Number(data.unique_characters) !== data.characters.length
  ) {
    throw new Error(t("dataError"));
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchVerifiedData() {
  let lastError = null;

  for (const delay of DATA_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await wait(delay);
    }

    try {
      const response = await fetch(`${DATA_PATH}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(t("fetchError"));
      }
      const data = await response.json();
      validateData(data);
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(t("loadError"));
}

function validateHistory(history) {
  if (!history || !Array.isArray(history.snapshots)) {
    throw new Error("Invalid history data.");
  }
  if (history.snapshots.length > HISTORY_MAX_SNAPSHOTS) {
    throw new Error("History contains too many snapshots.");
  }

  let previousTimestamp = 0;
  history.snapshots.forEach((snapshot) => {
    const snapshotTimestamp = new Date(snapshot?.updated_at || "").getTime();
    if (
      !snapshot ||
      !Number.isFinite(snapshotTimestamp) ||
      !Array.isArray(snapshot.characters)
    ) {
      throw new Error("Invalid history snapshot.");
    }
    if (snapshotTimestamp <= previousTimestamp) {
      throw new Error("History snapshots are not in chronological order.");
    }
    previousTimestamp = snapshotTimestamp;
    if (
      snapshot.calendar_date !== undefined &&
      (typeof snapshot.calendar_date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.calendar_date))
    ) {
      throw new Error("Invalid history calendar date.");
    }
    if (!Number.isInteger(Number(snapshot.sampled_players)) || snapshot.sampled_players <= 0) {
      throw new Error("Invalid history sample size.");
    }
    const unitCodes = new Set();
    snapshot.characters.forEach((character) => {
      const unitCode = String(character?.unit_code || "");
      const rate = Number(character?.adoption_rate);
      const rank = Number(character?.rank);
      if (
        !unitCode ||
        unitCodes.has(unitCode) ||
        !Number.isFinite(rate) ||
        rate < 0 ||
        rate > 100 ||
        !Number.isInteger(rank) ||
        rank < 1
      ) {
        throw new Error("Invalid character history.");
      }
      unitCodes.add(unitCode);

      const equipmentRankings = character.equipment_rankings;
      if (equipmentRankings !== undefined) {
        if (!equipmentRankings || typeof equipmentRankings !== "object") {
          throw new Error("Invalid equipment history.");
        }
        EQUIPMENT_TYPES.forEach(([equipmentType]) => {
          const category = equipmentRankings[equipmentType];
          const items = category?.items;
          if (!category || !Array.isArray(items)) {
            throw new Error("Invalid equipment history.");
          }
          const itemCodes = new Set();
          items.forEach((item) => {
            const itemCode = String(item?.item_code || "");
            const rank = Number(item?.rank);
            if (
              !itemCode ||
              itemCodes.has(itemCode) ||
              !Number.isInteger(rank) ||
              rank < 1
            ) {
              throw new Error("Invalid equipment history.");
            }
            itemCodes.add(itemCode);
          });
        });
      }
    });
  });

  return history;
}

async function fetchVerifiedHistory() {
  let lastError = null;
  for (const delay of DATA_RETRY_DELAYS_MS) {
    if (delay > 0) await wait(delay);
    try {
      const response = await fetch(`${HISTORY_PATH}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error("Could not retrieve history.");
      }
      return validateHistory(await response.json());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not retrieve history.");
}

function ensureHistoryLoaded() {
  if (state.history) return Promise.resolve(state.history);
  if (state.historyPromise) return state.historyPromise;

  state.historyPromise = fetchVerifiedHistory()
    .then((history) => {
      state.history = history;
      return history;
    })
    .catch((error) => {
      console.warn("Character history is unavailable.", error);
      return null;
    })
    .finally(() => {
      state.historyPromise = null;
    });
  return state.historyPromise;
}

function showInitialLoadError(error) {
  const currentTranslations = translations[state.language];
  const knownMessages = Object.values(currentTranslations).filter(
    (value) => typeof value === "string"
  );
  const message = knownMessages.includes(error?.message)
    ? error.message
    : t("loadError");

  elements.status.textContent = "";
  elements.status.className = "message message-error";
  const text = document.createElement("span");
  text.textContent = message;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "data-refresh-button";
  retry.textContent = st("refresh");
  retry.addEventListener("click", () => loadData());
  elements.status.append(text, retry);
  elements.status.hidden = false;
}

async function loadData({ background = false } = {}) {
  if (state.isLoading) return;

  const keepCurrentView = background && Boolean(state.data);
  const previousUpdatedAt = state.data?.updated_at || null;
  const rankingScrollTop = elements.rankingSection?.scrollTop || 0;
  state.isLoading = true;
  state.lastLoadAttempt = Date.now();

  try {
    if (!keepCurrentView) {
      elements.status.className = "message";
      elements.status.textContent = t("loading");
      elements.status.hidden = false;
      elements.summary.hidden = true;
      elements.rankingSection.hidden = true;
    } else {
      updateFreshnessWarning();
    }

    const data = await fetchVerifiedData();

    state.lastLoadError = false;
    state.data = data;
    if (previousUpdatedAt !== data.updated_at) {
      state.history = null;
    }
    state.characters = Array.isArray(data.characters) ? data.characters : [];
    if (state.selectedCharacter) {
      state.selectedCharacter =
        state.characters.find(
          (row) => row.unit_code === state.selectedCharacter.unit_code
        ) || null;
    }

    elements.status.hidden = true;
    elements.summary.hidden = false;
    elements.rankingSection.hidden = false;

    applyTranslations();
    setupRankingTapHint();
    setupRankingScrollGuard();
    if (keepCurrentView && elements.rankingSection) {
      requestAnimationFrame(() => {
        elements.rankingSection.scrollTop = rankingScrollTop;
      });
    }
  } catch (error) {
    console.error(error);
    state.lastLoadError = true;
    if (state.data) {
      elements.status.hidden = true;
      elements.summary.hidden = false;
      elements.rankingSection.hidden = false;
      updateFreshnessWarning();
    } else {
      showInitialLoadError(error);
    }
  } finally {
    state.isLoading = false;
    if (state.data) {
      updateFreshnessWarning();
    }
  }
}

function setupRankingTapHint() {
  const hint = document.querySelector("#ranking-tap-hint");
  if (!hint) return;

  hint.textContent = TAP_HINT[state.language] || TAP_HINT.en;
}

function setupRankingScrollGuard() {
  const scroller = document.querySelector("#ranking-section");
  if (!scroller || scroller.dataset.scrollGuardReady === "true") return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  scroller.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") return;
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
  });

  scroller.addEventListener("pointermove", (event) => {
    if (!tracking) return;
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) {
      state.suppressCharacterTapUntil = Date.now() + 350;
      tracking = false;
    }
  });

  scroller.addEventListener("pointerup", () => {
    tracking = false;
  });
  scroller.addEventListener("pointercancel", () => {
    tracking = false;
  });
  scroller.dataset.scrollGuardReady = "true";
}

document.addEventListener("DOMContentLoaded", () => {
  const initialLang = detectLanguage();
  setLanguage(initialLang);
  setupRankPeriodSelector();

  loadData();

  window.setInterval(() => {
    loadData({ background: true });
  }, AUTO_REFRESH_MS);

  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      Date.now() - state.lastLoadAttempt > 60 * 1000
    ) {
      loadData({ background: true });
    }
  });

  window.addEventListener("online", () => {
    loadData({ background: true });
  });

  document.querySelectorAll("[data-language]").forEach((button) => {
    button.addEventListener("click", () => {
      const lang = button.dataset.language;
      if (lang) {
        setLanguage(lang);
      }
    });
  });
});


function formatEquipmentCount(value) {
  return formatInteger(value) + et("equipmentUnit");
}

function createEquipmentTab(type, label, isSelected, character) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "equipment-tab";
  button.dataset.equipmentType = type;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-selected", String(isSelected));
  button.textContent = label;
  button.addEventListener("click", () => {
    state.selectedEquipmentType = type;
    renderEquipment(character);
  });
  return button;
}

function renderEquipment(character) {
  const dialog = document.querySelector("#equipment-dialog");
  const title = document.querySelector("#equipment-title");
  const content = document.querySelector("#equipment-content");
  const closeButton = document.querySelector("#equipment-close");
  if (!dialog || !title || !content || !character) return;

  const rankings = character.equipment_rankings;
  if (!rankings || typeof rankings !== "object") return;

  state.selectedCharacter = character;
  if (!rankings[state.selectedEquipmentType]) {
    state.selectedEquipmentType = "WEAPON";
  }

  title.textContent = et("dialogTitle");
  closeButton.setAttribute("aria-label", et("close"));
  content.textContent = "";

  const summary = document.createElement("div");
  summary.className = "equipment-summary";

  const characterImage = document.createElement("img");
  characterImage.className = "equipment-character-image";
  characterImage.src = character.image || "";
  characterImage.alt = characterLabel(character);
  characterImage.decoding = "async";
  characterImage.width = 64;
  characterImage.height = 64;

  const summaryText = document.createElement("div");
  const description = document.createElement("p");
  description.textContent = et("dialogDescription");
  const characterMeta = document.createElement("p");
  characterMeta.className = "equipment-meta";
  characterMeta.textContent =
    et("characterPlayers") +
    ": " +
    formatUnit(character.player_count, "players") +
    " · " +
    t("occurrence") +
    ": " +
    formatUnit(character.occurrence_count, "occurrence");
  summaryText.append(description, characterMeta);
  summary.append(characterImage, summaryText);
  content.appendChild(summary);

  const tabList = document.createElement("div");
  tabList.className = "equipment-tabs";
  tabList.setAttribute("role", "tablist");
  EQUIPMENT_TYPES.forEach(([type, labelKey]) => {
    tabList.appendChild(
      createEquipmentTab(
        type,
        et(labelKey),
        type === state.selectedEquipmentType,
        character
      )
    );
  });
  content.appendChild(tabList);

  const category = rankings[state.selectedEquipmentType];
  const items = Array.isArray(category.items) ? category.items : [];

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "equipment-empty";
    empty.textContent = et("noEquipment");
    content.appendChild(empty);
  } else {
    const wrapper = document.createElement("div");
    wrapper.className = "equipment-table-wrapper";
    const table = document.createElement("table");
    table.className = "equipment-table";

    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    [t("rank"), et("equipment"), et("equipmentCount"), et("equipmentPlayers"), et("rate")].forEach(
      (text) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = text;
        headRow.appendChild(cell);
      }
    );
    head.appendChild(headRow);

    const body = document.createElement("tbody");
    items.forEach((item) => {
      const row = document.createElement("tr");

      const rank = document.createElement("td");
      rank.className = "rank-cell equipment-rank-cell";
      rank.dataset.rank = String(item.rank || "");
      const rankNumber = document.createElement("span");
      rankNumber.className = "rank-number";
      rankNumber.textContent = String(item.rank || "-");
      rank.appendChild(rankNumber);
      // Equipment rows use the same compact day/week/month movement badges as
      // the character table.  Missing history is intentionally rendered as 0
      // instead of hiding the comparison, so every item has the same layout.
      renderRankPeriodChanges(rank, item.change, {
        alwaysShowZero: true,
        period: state.selectedRankPeriod,
        currentRank: item.rank,
        compactTransition: true,
      });

      const itemCell = document.createElement("td");
      itemCell.className = "equipment-icon-cell";
      const image = document.createElement("img");
      image.className = "equipment-image";
      image.src = item.image || "";
      image.alt = et("equipment");
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 36;
      image.height = 36;
      itemCell.append(image);

      const count = document.createElement("td");
      count.className = "number-cell";
      count.textContent = formatEquipmentCount(item.occurrence_count);

      const players = document.createElement("td");
      players.className = "number-cell";
      players.textContent = formatUnit(item.player_count, "players");

      const rate = document.createElement("td");
      rate.className = "number-cell";
      rate.textContent = Number(item.adoption_rate || 0).toFixed(1) + "%";

      row.append(rank, itemCell, count, players, rate);
      body.appendChild(row);
    });

    table.append(head, body);
    wrapper.appendChild(table);
    content.appendChild(wrapper);
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

function rememberRankingPosition() {
  const scroller = document.querySelector("#ranking-section");
  state.rankingScrollTop = scroller?.scrollTop || 0;
}

function restoreRankingPosition() {
  const scroller = document.querySelector("#ranking-section");
  if (!scroller) return;

  requestAnimationFrame(() => {
    scroller.scrollTop = state.rankingScrollTop;
  });
}

document.addEventListener("click", (event) => {
  const characterButton = event.target.closest(".character-button");
  if (characterButton) {
    if (Date.now() < state.suppressCharacterTapUntil) {
      event.preventDefault();
      return;
    }
    const unitCode = characterButton.dataset.unitCode;
    const character = state.characters.find((item) => item.unit_code === unitCode);
    if (character) {
      rememberRankingPosition();
      renderEquipment(character);
    }
    return;
  }

  const dialog = document.querySelector("#equipment-dialog");
  if (
    event.target.matches("#equipment-close") ||
    (dialog?.open && event.target === dialog)
  ) {
    dialog.close();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.querySelector("#equipment-dialog");
  dialog?.addEventListener("close", restoreRankingPosition);
});
