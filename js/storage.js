/**
 * Home Darts Arcade Tracker — Offline-First Storage & GAS Cloud Sync
 *
 * - Persists active game, completed game history, pending upload queue, and user settings in localStorage.
 * - Uses Content-Type: text/plain;charset=utf-8 for POST to Google Apps Script Web App to avoid CORS preflight.
 * - Deduplicates games by UUID (`gameId`) across local and cloud records.
 */

const KEYS = Object.freeze({
  ACTIVE_GAME: "darts_active_game_v1",
  HISTORY: "darts_history_v1",
  SYNC_QUEUE: "darts_sync_queue_v1",
  SETTINGS: "darts_settings_v1",
});

const DEFAULT_SETTINGS = Object.freeze({
  gasUrl: "",
  passcode: "",
  cricketKeypad: "compact", // "compact" (15~20 only) | "full" (1~20)
  animations: true,
});

let syncInFlight = false;
const listeners = new Set();

export function onSyncStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifySync(status) {
  for (const fn of listeners) {
    try {
      fn(status);
    } catch (_) {}
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function getSettings() {
  const raw = readJson(KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...raw };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  if (typeof next.gasUrl === "string") next.gasUrl = next.gasUrl.trim();
  if (typeof next.passcode === "string") next.passcode = next.passcode.trim();
  writeJson(KEYS.SETTINGS, next);
  notifySync(getSyncStatus());
  return next;
}

/* ------------------------------------------------------------------ */
/* Active in-progress game                                             */
/* ------------------------------------------------------------------ */

export function loadActiveGame() {
  return readJson(KEYS.ACTIVE_GAME, null);
}

export function saveActiveGame(state) {
  const commit = () => {
    if (!state) {
      try {
        localStorage.removeItem(KEYS.ACTIVE_GAME);
      } catch (_) {}
      return;
    }
    writeJson(KEYS.ACTIVE_GAME, state);
  };
  if (typeof queueMicrotask === "function") queueMicrotask(commit);
  else commit();
}

/* ------------------------------------------------------------------ */
/* Completed game history & offline sync queue                         */
/* ------------------------------------------------------------------ */

export function getHistory() {
  const list = readJson(KEYS.HISTORY, []);
  return Array.isArray(list) ? list : [];
}

export function getQueueIds() {
  const list = readJson(KEYS.SYNC_QUEUE, []);
  return Array.isArray(list) ? list : [];
}

export function getSyncStatus() {
  const { gasUrl } = getSettings();
  const pending = getQueueIds().length;
  if (!gasUrl) {
    return {
      state: "local",
      pending,
      label: "本機儲存",
    };
  }
  if (syncInFlight) {
    return {
      state: "syncing",
      pending,
      label: "同步中…",
    };
  }
  if (pending > 0) {
    return {
      state: "pending",
      pending,
      label: `待傳 ${pending}`,
    };
  }
  return {
    state: "synced",
    pending: 0,
    label: "雲端已同步",
  };
}

/**
 * Record a finished game summary locally and enqueue it for GAS upload.
 */
export function recordFinishedGame(summary) {
  if (!summary?.gameId) throw new Error("Missing gameId in summary");
  const history = getHistory();
  const exists = history.some((g) => g.gameId === summary.gameId);
  if (!exists) {
    history.unshift(summary);
    writeJson(KEYS.HISTORY, history);
  }

  const queue = getQueueIds();
  if (!queue.includes(summary.gameId)) {
    queue.push(summary.gameId);
    writeJson(KEYS.SYNC_QUEUE, queue);
  }

  notifySync(getSyncStatus());
  void flushSyncQueue();
  return summary;
}

/**
 * Remove a specific game from local history (and queue if pending).
 */
export function deleteGame(gameId) {
  const history = getHistory().filter((g) => g.gameId !== gameId);
  writeJson(KEYS.HISTORY, history);
  const queue = getQueueIds().filter((id) => id !== gameId);
  writeJson(KEYS.SYNC_QUEUE, queue);
  notifySync(getSyncStatus());
}

/**
 * Clear all local history and queue.
 */
export function clearAllHistory() {
  writeJson(KEYS.HISTORY, []);
  writeJson(KEYS.SYNC_QUEUE, []);
  notifySync(getSyncStatus());
}

/* ------------------------------------------------------------------ */
/* Google Apps Script (GAS) Cloud Sync                                 */
/* ------------------------------------------------------------------ */

export async function testGasConnection(customUrl, customPasscode) {
  const settings = getSettings();
  const url = (customUrl ?? settings.gasUrl).trim();
  const passcode = (customPasscode ?? settings.passcode).trim();
  if (!url) throw new Error("請先填入 GAS Web App 網址");

  // Attempt 1: POST via text/plain (most reliable against CORS issues in modern browsers)
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "ping",
        passcode: passcode || undefined,
      }),
      redirect: "follow",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) return data;
      if (data.error) throw new Error(data.error);
    }
  } catch (postErr) {
    // If POST fails, fallback to GET ping
  }

  // Attempt 2: GET with searchParams
  const endpoint = new URL(url);
  endpoint.searchParams.set("action", "ping");
  if (passcode) endpoint.searchParams.set("passcode", passcode);

  const res = await fetch(endpoint.toString(), {
    method: "GET",
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "GAS 回傳錯誤");
  return data;
}

export async function flushSyncQueue() {
  const { gasUrl, passcode } = getSettings();
  if (!gasUrl || syncInFlight) return { ok: false, skipped: true };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    notifySync(getSyncStatus());
    return { ok: false, offline: true };
  }

  const queueIds = getQueueIds();
  if (queueIds.length === 0) {
    notifySync(getSyncStatus());
    return { ok: true, uploaded: 0 };
  }

  const history = getHistory();
  const historyMap = new Map(history.map((g) => [g.gameId, g]));
  const gamesToUpload = queueIds
    .map((id) => historyMap.get(id))
    .filter(Boolean);

  if (gamesToUpload.length === 0) {
    writeJson(KEYS.SYNC_QUEUE, []);
    notifySync(getSyncStatus());
    return { ok: true, uploaded: 0 };
  }

  syncInFlight = true;
  notifySync(getSyncStatus());

  try {
    // Use Content-Type: text/plain;charset=utf-8 to bypass CORS OPTIONS preflight on GAS
    const res = await fetch(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action: "syncBatch",
        passcode: passcode || undefined,
        games: gamesToUpload,
      }),
      redirect: "follow",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "GAS 寫入失敗");

    const doneSet = new Set([
      ...(data.savedIds || []),
      ...(data.skippedIds || []),
    ]);
    const remainingQueue = getQueueIds().filter((id) => !doneSet.has(id));
    writeJson(KEYS.SYNC_QUEUE, remainingQueue);

    return {
      ok: true,
      uploaded: (data.savedIds || []).length,
      skipped: (data.skippedIds || []).length,
      totalGames: data.totalGames,
    };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    syncInFlight = false;
    notifySync(getSyncStatus());
  }
}

/**
 * Pull recent games from Google Sheets and merge into local history.
 */
export async function pullFromCloud(limit = 150) {
  const { gasUrl, passcode } = getSettings();
  if (!gasUrl) throw new Error("尚未設定 GAS Web App 網址");

  syncInFlight = true;
  notifySync(getSyncStatus());

  try {
    const endpoint = new URL(gasUrl);
    endpoint.searchParams.set("action", "pull");
    endpoint.searchParams.set("limit", String(limit));
    if (passcode) endpoint.searchParams.set("passcode", passcode);

    const res = await fetch(endpoint.toString(), {
      method: "GET",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "拉取雲端紀錄失敗");

    const cloudGames = Array.isArray(data.games) ? data.games : [];
    const localHistory = getHistory();
    const byId = new Map();

    for (const g of localHistory) {
      if (g?.gameId) byId.set(g.gameId, g);
    }
    let added = 0;
    for (const cg of cloudGames) {
      if (!cg?.gameId) continue;
      if (!byId.has(cg.gameId)) {
        byId.set(cg.gameId, cg);
        added += 1;
      }
    }

    const merged = [...byId.values()].sort((a, b) =>
      String(b.endedAt || "").localeCompare(String(a.endedAt || ""))
    );
    writeJson(KEYS.HISTORY, merged);
    return { ok: true, added, totalLocal: merged.length, totalCloud: data.totalGames };
  } finally {
    syncInFlight = false;
    notifySync(getSyncStatus());
  }
}

/**
 * Enqueue all local history games so a newly connected Google Sheet gets all past local games.
 */
export async function pushAllLocalToCloud() {
  const history = getHistory();
  const ids = history.map((g) => g.gameId).filter(Boolean);
  writeJson(KEYS.SYNC_QUEUE, ids);
  notifySync(getSyncStatus());
  return flushSyncQueue();
}

/* ------------------------------------------------------------------ */
/* CSV & JSON Exports (for Gemini / Backup)                            */
/* ------------------------------------------------------------------ */

export function buildGamesCsv(history = getHistory()) {
  const headers = [
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
  const rows = [headers];
  for (const g of history) {
    rows.push([
      g.gameId,
      g.endedAt || g.startedAt || "",
      g.mode,
      g.maxRounds,
      g.finished ? "TRUE" : "FALSE",
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
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function buildDartsCsv(history = getHistory()) {
  const headers = [
    "Game_ID",
    "Timestamp",
    "Mode",
    "Round",
    "Dart_No",
    "Code",
    "Segment",
    "Multiplier",
    "Points",
    "Effective_Marks",
    "Raw_Marks",
    "Is_Bust_Round",
  ];
  const rows = [headers];
  for (const g of history) {
    if (!Array.isArray(g.darts)) continue;
    for (const d of g.darts) {
      rows.push([
        g.gameId,
        g.endedAt || g.startedAt || "",
        g.mode,
        d.round,
        d.dartNo,
        d.code,
        d.segment,
        d.multiplier,
        d.points ?? "",
        d.effectiveMarks ?? "",
        d.rawMarks ?? "",
        d.isBustRound ? "TRUE" : "FALSE",
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

function csvCell(val) {
  const s = val === null || val === undefined ? "" : String(val);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Safe LocalStorage Helpers                                           */
/* ------------------------------------------------------------------ */

function readJson(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

