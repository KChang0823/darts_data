/**
 * Home Darts Arcade Tracker — Google Apps Script (GAS) 後端 (Single Sheet: Games Only)
 *
 * 使用方式：
 * 1. 新增一份空白 Google 試算表（Google Sheets）
 * 2. 點選頂部選單「擴充功能」➔「Apps Script」
 * 3. 將本檔案內容完整複製並覆蓋編輯器中的 Code.gs
 * 4. 點擊右上角「部署」➔「新增部署作業」：
 *    - 選取類型：「網頁應用程式 (Web App)」
 *    - 執行身分：「我 (Me)」
 *    - 誰可以存取：「任何人 (Anyone)」
 * 5. 複製產生的「網頁應用程式網址 (Web App URL)」，貼到打鏢 App 的「雲端設定」中即可！
 */

const GAMES_SHEET_NAME = "Games";

const GAMES_HEADERS = [
  "Game_ID",
  "Timestamp",
  "Mode",
  "Max_Rounds",
  "Finished",
  "Rounds_Played",
  "Total_Darts",
  "Total_Score",
  "Remain_Score",
  "PPD",
  "PPR",
  "MPR",
  "Effective_Marks",
  "Raw_Marks",
  "S_Bull_Hits",
  "D_Bull_Hits",
  "Bust_Rounds",
  "Awards_JSON",
  "Round_By_Round",
];

/**
 * 初始化試算表結構（第一次寫入或測試連線時會自動執行）
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, GAMES_SHEET_NAME, GAMES_HEADERS);
  return "Setup completed: Games sheet is ready.";
}

function ensureSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#18191B");
    headerRange.setFontColor("#F7F8F8");
  }
  return sheet;
}

/**
 * 處理 GET 請求：
 * - ?action=ping  ➔ 測試連線與回傳試算表目前總場數
 * - ?action=pull  ➔ 從試算表拉取歷史對局
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!verifyPasscode(params.passcode)) {
      return jsonResponse({ ok: false, error: "Invalid passcode" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const gamesSheet = ensureSheet(ss, GAMES_SHEET_NAME, GAMES_HEADERS);

    const action = params.action || "ping";
    const totalGames = Math.max(0, gamesSheet.getLastRow() - 1);

    if (action === "ping") {
      return jsonResponse({
        ok: true,
        sheetName: ss.getName(),
        totalGames: totalGames,
      });
    }

    if (action === "pull") {
      const limit = Math.min(Number(params.limit) || 100, 300);
      const games = readRecentGames(gamesSheet, limit);
      return jsonResponse({
        ok: true,
        totalGames: totalGames,
        games: games,
      });
    }

    return jsonResponse({ ok: false, error: "Unknown GET action: " + action });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/**
 * 處理 POST 請求（前端以 Content-Type: text/plain 傳送 JSON 字串，避開 CORS preflight）
 * 支援 action: "ping" | "saveGame" | "syncBatch"
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (lockErr) {
    return jsonResponse({ ok: false, error: "Server busy, please retry" });
  }

  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const body = JSON.parse(raw);

    if (!verifyPasscode(body.passcode)) {
      return jsonResponse({ ok: false, error: "Invalid passcode" });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const gamesSheet = ensureSheet(ss, GAMES_SHEET_NAME, GAMES_HEADERS);

    if (body.action === "ping") {
      return jsonResponse({
        ok: true,
        sheetName: ss.getName(),
        totalGames: Math.max(0, gamesSheet.getLastRow() - 1),
      });
    }

    if (body.action === "pull") {
      const limit = Math.min(Number(body.limit || 300), 1000);
      const games = readRecentGames(gamesSheet, limit);
      return jsonResponse({
        ok: true,
        games: games,
        totalGames: Math.max(0, gamesSheet.getLastRow() - 1),
      });
    }

    const incoming =
      body.action === "syncBatch" && Array.isArray(body.games)
        ? body.games
        : body.game
          ? [body.game]
          : [];

    if (incoming.length === 0) {
      return jsonResponse({ ok: false, error: "No game payload provided" });
    }

    const existingIds = getExistingGameIds(gamesSheet);
    const gameRows = [];
    const savedIds = [];
    const skippedIds = [];

    for (let i = 0; i < incoming.length; i++) {
      const g = incoming[i];
      if (!g || !g.gameId) continue;

      if (existingIds.has(String(g.gameId))) {
        skippedIds.push(g.gameId);
        continue;
      }
      existingIds.add(String(g.gameId));
      savedIds.push(g.gameId);

      const ts = formatTimestamp(g.endedAt || g.startedAt);
      gameRows.push([
        g.gameId,
        ts,
        g.mode,
        g.maxRounds,
        Boolean(g.finished),
        g.roundsPlayed,
        g.totalDarts,
        g.totalScore ?? 0,
        g.remainScore ?? "",
        g.ppd ?? "",
        g.ppr ?? "",
        g.mpr ?? "",
        g.effectiveMarks ?? "",
        g.rawMarks ?? "",
        g.sBullHits ?? 0,
        g.dBullHits ?? 0,
        g.bustRounds ?? 0,
        JSON.stringify(g.awards || {}),
        g.roundByRound || "",
      ]);
    }

    if (gameRows.length > 0) {
      const startRow = gamesSheet.getLastRow() + 1;
      gamesSheet
        .getRange(startRow, 1, gameRows.length, GAMES_HEADERS.length)
        .setValues(gameRows);
    }

    return jsonResponse({
      ok: true,
      savedIds: savedIds,
      skippedIds: skippedIds,
      totalGames: Math.max(0, gamesSheet.getLastRow() - 1),
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

function getExistingGameIds(gamesSheet) {
  const lastRow = gamesSheet.getLastRow();
  const set = new Set();
  if (lastRow <= 1) return set;
  const values = gamesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    const id = values[i][0];
    if (id) set.add(String(id));
  }
  return set;
}

function readRecentGames(gamesSheet, limit) {
  const lastRow = gamesSheet.getLastRow();
  if (lastRow <= 1) return [];

  const count = Math.min(limit, lastRow - 1);
  const startRow = lastRow - count + 1;
  const rows = gamesSheet
    .getRange(startRow, 1, count, GAMES_HEADERS.length)
    .getValues();

  const list = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const gameId = String(r[0]);
    if (!gameId) continue;
    let awards = {};
    try {
      awards = r[17] ? JSON.parse(String(r[17])) : {};
    } catch (_) {
      awards = {};
    }
    const item = {
      gameId: gameId,
      endedAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      mode: String(r[2]),
      maxRounds: Number(r[3]) || 0,
      finished: Boolean(r[4]),
      roundsPlayed: Number(r[5]) || 0,
      totalDarts: Number(r[6]) || 0,
      totalScore: Number(r[7]) || 0,
      remainScore: r[8] === "" || r[8] === null ? null : Number(r[8]),
      ppd: r[9] === "" || r[9] === null ? null : Number(r[9]),
      ppr: r[10] === "" || r[10] === null ? null : Number(r[10]),
      mpr: r[11] === "" || r[11] === null ? null : Number(r[11]),
      effectiveMarks: r[12] === "" || r[12] === null ? null : Number(r[12]),
      rawMarks: r[13] === "" || r[13] === null ? null : Number(r[13]),
      sBullHits: Number(r[14]) || 0,
      dBullHits: Number(r[15]) || 0,
      bustRounds: Number(r[16]) || 0,
      awards: awards,
      roundByRound: String(r[18] || ""),
    };
    list.push(item);
  }

  return list;
}

function verifyPasscode(incoming) {
  const expected = PropertiesService.getScriptProperties().getProperty("PASSCODE");
  if (!expected) return true;
  return String(incoming || "") === String(expected);
}

function formatTimestamp(isoStr) {
  const d = isoStr ? new Date(isoStr) : new Date();
  if (isNaN(d.getTime())) return String(isoStr || "");
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Taipei", "yyyy-MM-dd HH:mm:ss");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
