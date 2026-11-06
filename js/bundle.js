/* Auto-generated bundle for file:// and http(s):// compatibility */
(function () {
"use strict";

/**
 * Home Darts Arcade Tracker — scoring engine.
 *
 * Pure, DOM-free functions shared by the browser app and the Node tests.
 *
 * Game state is a plain JSON-serialisable object:
 *   { v, id, mode, startedAt, endedAt, rounds: string[][], current: string[] }
 *
 * `rounds` only stores the darts the player actually entered. Auto-fills
 * (`M` when a round is confirmed early, `X` after a bust) are derived on
 * replay, so undo can reopen a round exactly as it was typed.
 */
const DARTS_PER_ROUND = 3;
const BULL = 25;
const CRICKET_TARGETS = Object.freeze([20, 19, 18, 17, 16, 15, BULL]);
const MODES = Object.freeze({
  301: Object.freeze({ kind: "x01", label: "301", start: 301, maxRounds: 10 }),
  501: Object.freeze({ kind: "x01", label: "501", start: 501, maxRounds: 10 }),
  701: Object.freeze({ kind: "x01", label: "701", start: 701, maxRounds: 15 }),
  COUNT_UP: Object.freeze({ kind: "countup", label: "Count-Up", maxRounds: 8 }),
  CRICKET: Object.freeze({ kind: "cricket", label: "Cricket", maxRounds: 15 }),
});
const AWARDS = Object.freeze({
  ton80: "TON 80",
  threeInBlack: "THREE IN THE BLACK",
  hatTrick: "HAT TRICK",
  highTon: "HIGH TON",
  lowTon: "LOW TON",
  whiteHorse: "WHITE HORSE",
  threeInBed: "THREE IN A BED",
});

const FAT_BULL_POINTS = 50;
const CLOSED = 3;
const MULTIPLIERS = { S: 1, D: 2, T: 3 };
const NUMBER_DART = /^([SDT])([1-9]|1\d|20)$/;

/* ------------------------------------------------------------------ */
/* Dart codes                                                          */
/* ------------------------------------------------------------------ */

const dartCache = new Map();

/**
 * Parse a dart code: S1–S20, D1–D20, T1–T20, SB, DB, M (miss), X (bust fill).
 * Bulls use Fat Bull scoring (50/50) for points and 1/2 marks for Cricket.
 */
function parseDart(code) {
  let dart = dartCache.get(code);
  if (!dart) {
    dart = Object.freeze(buildDart(code));
    dartCache.set(code, dart);
  }
  return dart;
}

function buildDart(code) {
  switch (code) {
    case "SB":
      return dart(code, BULL, 1, FAT_BULL_POINTS, 1);
    case "DB":
      return dart(code, BULL, 2, FAT_BULL_POINTS, 2);
    case "M":
    case "X":
      return dart(code, 0, 0, 0, 0);
  }
  const match = typeof code === "string" ? NUMBER_DART.exec(code) : null;
  if (!match) throw new Error(`Invalid dart code: ${String(code)}`);
  const multiplier = MULTIPLIERS[match[1]];
  const segment = Number(match[2]);
  const rawMarks = segment >= 15 ? multiplier : 0;
  return dart(code, segment, multiplier, segment * multiplier, rawMarks);
}

function dart(code, segment, multiplier, points, rawMarks) {
  return { code, segment, multiplier, points, rawMarks };
}

/* ------------------------------------------------------------------ */
/* State transitions                                                   */
/* ------------------------------------------------------------------ */
function createGame(mode, { id = newId(), now = new Date() } = {}) {
  if (!MODES[mode]) throw new Error(`Unknown mode: ${mode}`);
  return {
    v: 1,
    id,
    mode,
    startedAt: toIso(now),
    endedAt: null,
    rounds: [],
    current: [],
  };
}
function throwDart(state, code) {
  if (code === "X") throw new Error("X is reserved for bust fills");
  parseDart(code);
  const { over, current } = replay(state);
  if (over) throw new Error("Game is over");
  if (current.bust || current.gameShot) {
    throw new Error("Round is locked — confirm or undo");
  }
  if (state.current.length >= DARTS_PER_ROUND) {
    throw new Error("Round already has 3 darts");
  }
  return { ...state, current: [...state.current, code] };
}

/**
 * Close the current round. Needs at least one entered dart so an accidental
 * double tap on the confirm button can't skip a whole round.
 */
function confirmRound(state, { now = new Date() } = {}) {
  const { over, mode, current } = replay(state);
  if (over) throw new Error("Game is over");
  if (state.current.length === 0) {
    throw new Error("Enter at least one dart before confirming");
  }
  const rounds = [...state.rounds, [...state.current]];
  const ends = current.gameShot || rounds.length >= mode.maxRounds;
  return {
    ...state,
    rounds,
    current: [],
    endedAt: ends ? toIso(now) : null,
  };
}

/** Remove the last dart; with an empty round, reopen the previous round. */
function undo(state) {
  if (state.current.length > 0) {
    return { ...state, current: state.current.slice(0, -1) };
  }
  if (state.rounds.length > 0) {
    return {
      ...state,
      rounds: state.rounds.slice(0, -1),
      current: [...state.rounds.at(-1)],
      endedAt: null,
    };
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Replay                                                              */
/* ------------------------------------------------------------------ */

function replay(state) {
  const mode = MODES[state?.mode];
  if (!mode) throw new Error(`Unknown mode: ${state?.mode}`);
  if (state.rounds.length > mode.maxRounds) corrupt("too many rounds");

  const ctx = {
    kind: mode.kind,
    remaining: mode.kind === "x01" ? mode.start : null,
    score: 0,
    effective: 0,
    marks: Object.fromEntries(CRICKET_TARGETS.map((t) => [t, 0])),
  };

  const rounds = [];
  for (const entered of state.rounds) {
    if (rounds.at(-1)?.gameShot) corrupt("round after game shot");
    if (entered.length === 0) corrupt("empty confirmed round");
    rounds.push(playRound(ctx, entered, true, rounds.length + 1));
  }

  const last = rounds.at(-1);
  const over =
    Boolean(last) && (last.gameShot || rounds.length >= mode.maxRounds);
  if (over && state.current.length > 0) corrupt("darts after game over");

  const number = over ? rounds.length : rounds.length + 1;
  const current = playRound(ctx, state.current, false, number);
  return { state, mode, ctx, rounds, current, over };
}

function playRound(ctx, entered, confirmed, number) {
  if (entered.length > DARTS_PER_ROUND) corrupt("more than 3 darts in round");

  const startRemaining = ctx.remaining;
  const darts = [];
  let bust = false;
  let gameShot = false;
  let points = 0;
  let effectiveMarks = 0;
  let rawMarks = 0;

  for (const code of entered) {
    if (bust || gameShot) corrupt("dart after round was locked");
    if (code === "X") corrupt("X entered as a dart");
    const d = parseDart(code);
    let effective = 0;

    if (ctx.kind === "cricket") {
      if (d.rawMarks > 0) {
        const have = ctx.marks[d.segment];
        effective = Math.min(d.rawMarks, CLOSED - have);
        ctx.marks[d.segment] = have + effective;
      }
      effectiveMarks += effective;
      rawMarks += d.rawMarks;
      gameShot = CRICKET_TARGETS.every((t) => ctx.marks[t] >= CLOSED);
    } else {
      points += d.points;
      if (ctx.kind === "x01") {
        const left = startRemaining - points;
        bust = left < 0;
        gameShot = left === 0;
      }
    }
    darts.push({ ...d, effectiveMarks: effective, filled: false });
  }

  const score = ctx.kind === "cricket" || bust ? 0 : points;
  ctx.score += score;
  ctx.effective += effectiveMarks;
  if (ctx.kind === "x01") ctx.remaining = startRemaining - score;

  if (confirmed && !gameShot) {
    const fill = parseDart(bust ? "X" : "M");
    while (darts.length < DARTS_PER_ROUND) {
      darts.push({ ...fill, effectiveMarks: 0, filled: true });
    }
  }

  const round = {
    number,
    darts,
    entered: entered.length,
    bust,
    gameShot,
    score,
    rawPoints: points,
    effectiveMarks,
    rawMarks,
    after:
      ctx.kind === "x01"
        ? ctx.remaining
        : ctx.kind === "countup"
          ? ctx.score
          : ctx.effective,
    award: null,
  };
  round.award = detectAward(ctx.kind, round);
  return round;
}

function corrupt(reason) {
  throw new Error(`Corrupt game state: ${reason}`);
}

/* ------------------------------------------------------------------ */
/* Awards                                                              */
/* ------------------------------------------------------------------ */

/** One award per round, highest priority wins. Bust rounds earn nothing. */
function detectAward(kind, round) {
  const darts = round.darts.filter((d) => !d.filled);
  const three = darts.length === DARTS_PER_ROUND;
  const allBull = three && darts.every((d) => d.segment === BULL);

  if (kind === "cricket") {
    const triples = darts.filter((d) => d.multiplier === 3 && d.rawMarks > 0);
    if (three && triples.length === 3) {
      const segments = new Set(triples.map((d) => d.segment));
      // White Horse: three different targets, none already closed.
      if (segments.size === 3 && triples.every((d) => d.effectiveMarks > 0)) {
        return "whiteHorse";
      }
      if (segments.size === 1) return "threeInBed";
    }
    return allBull ? "hatTrick" : null;
  }

  if (round.bust) return null;
  if (three && darts.every((d) => d.code === "T20")) return "ton80";
  if (three && darts.every((d) => d.code === "DB")) return "threeInBlack";
  if (allBull) return "hatTrick";
  if (round.score >= 151) return "highTon";
  if (round.score >= 100) return "lowTon";
  return null;
}

/* ------------------------------------------------------------------ */
/* Derived views                                                       */
/* ------------------------------------------------------------------ */

function totals({ mode, ctx, rounds, current }) {
  const isCricket = mode.kind === "cricket";
  let totalDarts = 0;
  let sBullHits = 0;
  let dBullHits = 0;
  let bustRounds = 0;
  let rawMarks = 0;

  for (const round of [...rounds, current]) {
    // Confirmed rounds include fills; the open round only has entered darts.
    totalDarts += round.darts.length;
    rawMarks += round.rawMarks;
    if (round.bust) bustRounds += 1;
    for (const d of round.darts) {
      if (d.segment !== BULL) continue;
      if (d.multiplier === 2) dBullHits += 1;
      else sBullHits += 1;
    }
  }

  const ppd = !isCricket && totalDarts > 0 ? ctx.score / totalDarts : null;
  const mpr =
    isCricket && totalDarts > 0
      ? (ctx.effective / totalDarts) * DARTS_PER_ROUND
      : null;

  return {
    totalDarts,
    score: isCricket ? 0 : ctx.score,
    remaining: ctx.remaining,
    ppd: round2(ppd),
    ppr: round2(ppd === null ? null : ppd * DARTS_PER_ROUND),
    mpr: round2(mpr),
    effectiveMarks: isCricket ? ctx.effective : null,
    rawMarks: isCricket ? rawMarks : null,
    sBullHits,
    dBullHits,
    bustRounds,
    awards: countAwards(rounds),
  };
}

function countAwards(rounds) {
  const counts = {};
  for (const { award } of rounds) {
    if (award) counts[award] = (counts[award] ?? 0) + 1;
  }
  return counts;
}

function isFinished({ mode, rounds, over }) {
  if (!over) return false;
  return mode.kind === "countup" ? true : rounds.at(-1).gameShot;
}

/**
 * Everything the UI needs to render, derived from the state.
 * `locked`: null | "full" | "bust" | "gameShot" | "over".
 */
function getView(state) {
  const r = replay(state);
  const { mode, ctx, rounds, current, over } = r;

  let locked = null;
  if (over) locked = "over";
  else if (current.bust) locked = "bust";
  else if (current.gameShot) locked = "gameShot";
  else if (current.entered >= DARTS_PER_ROUND) locked = "full";
  const dartsLeft = locked ? 0 : DARTS_PER_ROUND - current.entered;

  return {
    id: state.id,
    mode: state.mode,
    kind: mode.kind,
    label: mode.label,
    maxRounds: mode.maxRounds,
    round: current.number,
    over,
    finished: isFinished(r),
    locked,
    canThrow: locked === null,
    canConfirm: !over && current.entered > 0,
    dartsLeft,
    remaining: ctx.remaining,
    current,
    rounds,
    stats: totals(r),
    cricket:
      mode.kind === "cricket"
        ? CRICKET_TARGETS.map((target) => ({
            target,
            marks: ctx.marks[target],
            closed: ctx.marks[target] >= CLOSED,
          }))
        : null,
    checkout:
      mode.kind === "x01" && dartsLeft > 0
        ? checkoutRoute(ctx.remaining, dartsLeft)
        : null,
  };
}

/** Flattened record for the Games / Darts sheets. Only for finished games. */
function summarize(state) {
  const r = replay(state);
  if (!r.over) throw new Error("Game is not over yet");
  const { mode, rounds } = r;
  const t = totals(r);
  const isCricket = mode.kind === "cricket";

  const darts = rounds.flatMap((round) =>
    round.darts.map((d, i) => ({
      round: round.number,
      dartNo: i + 1,
      code: d.code,
      segment: d.segment,
      multiplier: d.multiplier,
      points: isCricket ? null : d.points,
      effectiveMarks: isCricket ? d.effectiveMarks : null,
      rawMarks: isCricket ? d.rawMarks : null,
      isBustRound: round.bust,
    })),
  );

  return {
    gameId: state.id,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    mode: state.mode,
    maxRounds: mode.maxRounds,
    finished: isFinished(r),
    roundsPlayed: rounds.length,
    totalDarts: t.totalDarts,
    totalScore: t.score,
    remainScore: mode.kind === "x01" ? t.remaining : null,
    ppd: t.ppd,
    ppr: t.ppr,
    mpr: t.mpr,
    effectiveMarks: t.effectiveMarks,
    rawMarks: t.rawMarks,
    sBullHits: t.sBullHits,
    dBullHits: t.dBullHits,
    bustRounds: t.bustRounds,
    awards: t.awards,
    roundByRound: rounds.map((rd) => formatRound(rd, mode.kind)).join("|"),
    darts,
  };
}

function formatRound(round, kind) {
  const codes = round.darts.map((d) => d.code).join(",");
  let tag = String(round.score);
  if (round.bust) tag = "BUST";
  else if (kind === "cricket") tag = `${round.effectiveMarks}M`;
  return `R${round.number}:${codes}(${tag})`;
}

/* ------------------------------------------------------------------ */
/* Checkout guide (Open Out, Fat Bull)                                 */
/* ------------------------------------------------------------------ */

// Rough amateur hit-rate weights; the route maximises the product.
const HIT_RATE = { BULL: 0.45, S: 0.6, T: 0.1, D: 0.1 };

const CHECKOUT_TARGETS = (() => {
  const targets = [{ label: "BULL", points: 50, p: HIT_RATE.BULL }];
  for (const kind of ["S", "T", "D"]) {
    for (let n = 20; n >= 1; n--) {
      targets.push({
        label: `${kind}${n}`,
        points: n * MULTIPLIERS[kind],
        p: HIT_RATE[kind],
      });
    }
  }
  return targets;
})();

let checkoutTable = null;

function buildCheckoutTable() {
  const targets = CHECKOUT_TARGETS;
  const n = targets.length;
  const best = [null, [], [], []];

  const consider = (combo) => {
    let points = 0;
    let p = 1;
    for (const i of combo) {
      points += targets[i].points;
      p *= targets[i].p;
    }
    if (points > 180) return;
    // Fewer-dart combos are visited first and only replaced if strictly better.
    for (let allowed = combo.length; allowed <= 3; allowed++) {
      const cur = best[allowed][points];
      if (!cur || p > cur.p + 1e-12) best[allowed][points] = { combo, p };
    }
  };

  for (let i = 0; i < n; i++) consider([i]);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) consider([i, j]);
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (let k = j; k < n; k++) consider([i, j, k]);
    }
  }
  return best;
}

/**
 * Suggested finish for `remaining` with `dartsLeft` darts (Open Out), e.g.
 * 120 → ["BULL", "BULL", "S20"]. Returns null when not reachable.
 */
function checkoutRoute(remaining, dartsLeft = DARTS_PER_ROUND) {
  if (!Number.isInteger(remaining) || remaining < 1 || remaining > 180) {
    return null;
  }
  if (!Number.isInteger(dartsLeft) || dartsLeft < 1) return null;
  checkoutTable ??= buildCheckoutTable();
  const hit = checkoutTable[Math.min(dartsLeft, 3)][remaining];
  if (!hit) return null;
  return hit.combo
    .map((i) => CHECKOUT_TARGETS[i])
    .sort((a, b) => b.points - a.points)
    .map((t) => t.label);
}

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */
function round2(x) {
  return x === null || x === undefined || Number.isNaN(x)
    ? null
    : Math.round(x * 100) / 100;
}

function toIso(now) {
  return now instanceof Date ? now.toISOString() : String(now);
}

function newId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}



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
function onSyncStateChange(fn) {
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
function getSettings() {
  const raw = readJson(KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...raw };
}
function saveSettings(patch) {
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
function loadActiveGame() {
  return readJson(KEYS.ACTIVE_GAME, null);
}
function saveActiveGame(state) {
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
function getHistory() {
  const list = readJson(KEYS.HISTORY, []);
  return Array.isArray(list) ? list : [];
}
function getQueueIds() {
  const list = readJson(KEYS.SYNC_QUEUE, []);
  return Array.isArray(list) ? list : [];
}
function getSyncStatus() {
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
function recordFinishedGame(summary) {
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
function deleteGame(gameId) {
  const history = getHistory().filter((g) => g.gameId !== gameId);
  writeJson(KEYS.HISTORY, history);
  const queue = getQueueIds().filter((id) => id !== gameId);
  writeJson(KEYS.SYNC_QUEUE, queue);
  notifySync(getSyncStatus());
}

/**
 * Clear all local history and queue.
 */
function clearAllHistory() {
  writeJson(KEYS.HISTORY, []);
  writeJson(KEYS.SYNC_QUEUE, []);
  notifySync(getSyncStatus());
}

/* ------------------------------------------------------------------ */
/* Google Apps Script (GAS) Cloud Sync                                 */
/* ------------------------------------------------------------------ */
async function testGasConnection(customUrl, customPasscode) {
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
async function flushSyncQueue() {
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
async function pullFromCloud(limit = 150) {
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
async function pushAllLocalToCloud() {
  const history = getHistory();
  const ids = history.map((g) => g.gameId).filter(Boolean);
  writeJson(KEYS.SYNC_QUEUE, ids);
  notifySync(getSyncStatus());
  return flushSyncQueue();
}

/* ------------------------------------------------------------------ */
/* CSV & JSON Exports (for Gemini / Backup)                            */
/* ------------------------------------------------------------------ */
function buildGamesCsv(history = getHistory()) {
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
function buildDartsCsv(history = getHistory()) {
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



/**
 * Home Darts Arcade Tracker — Statistics, Rating & SVG Chart Engine
 *
 * Computes:
 * - Rolling Last-10 averages & Personal Bests (PB) per mode
 * - Official DARTSLIVE Rating (1~18) & Flight (C ~ SA) based on 01 PPR & Cricket MPR
 * - Dart #1 vs Dart #2 vs Dart #3 stability breakdown
 * - Bull accuracy (Total Bull %, Inner D-Bull ratio)
 * - Lifetime Awards wall
 * - Pure SVG trend chart & segment distribution
 */

/**
 * DARTSLIVE Official Rating & Flight Thresholds (from 規則＆術語.md)
 * Note: The 01 threshold in DARTSLIVE's table (40.0 ~ 130.0) corresponds to 3-dart average (PPR = PPD * 3).
 */
const RATING_TABLE = Object.freeze([
  { rating: 18, flight: "SA", ppr: 130.0, mpr: 4.75 },
  { rating: 17, flight: "SA", ppr: 123.0, mpr: 4.5 },
  { rating: 16, flight: "SA", ppr: 116.0, mpr: 4.25 },
  { rating: 15, flight: "AA", ppr: 109.0, mpr: 4.0 },
  { rating: 14, flight: "AA", ppr: 102.0, mpr: 3.75 },
  { rating: 13, flight: "AA", ppr: 95.0, mpr: 3.5 },
  { rating: 12, flight: "A", ppr: 90.0, mpr: 3.3 },
  { rating: 11, flight: "A", ppr: 85.0, mpr: 3.1 },
  { rating: 10, flight: "A", ppr: 80.0, mpr: 2.9 },
  { rating: 9, flight: "BB", ppr: 75.0, mpr: 2.7 },
  { rating: 8, flight: "BB", ppr: 70.0, mpr: 2.5 },
  { rating: 7, flight: "B", ppr: 65.0, mpr: 2.3 },
  { rating: 6, flight: "B", ppr: 60.0, mpr: 2.1 },
  { rating: 5, flight: "CC", ppr: 55.0, mpr: 1.9 },
  { rating: 4, flight: "CC", ppr: 50.0, mpr: 1.7 },
  { rating: 3, flight: "C", ppr: 45.0, mpr: 1.5 },
  { rating: 2, flight: "C", ppr: 40.0, mpr: 1.3 },
  { rating: 1, flight: "C", ppr: 0.0, mpr: 0.0 },
]);
function ratingFromPpr(ppr) {
  if (ppr === null || ppr === undefined || Number.isNaN(ppr)) return null;
  for (const row of RATING_TABLE) {
    if (ppr >= row.ppr) return { rating: row.rating, flight: row.flight };
  }
  return { rating: 1, flight: "C" };
}
function ratingFromMpr(mpr) {
  if (mpr === null || mpr === undefined || Number.isNaN(mpr)) return null;
  for (const row of RATING_TABLE) {
    if (mpr >= row.mpr) return { rating: row.rating, flight: row.flight };
  }
  return { rating: 1, flight: "C" };
}
function flightFromRating(rating) {
  const r = Math.max(1, Math.min(18, Math.floor(rating || 1)));
  return RATING_TABLE.find((x) => x.rating === r)?.flight || "C";
}

/**
 * Filter history by mode selector:
 * - "ALL_01": 301 + 501 + 701
 * - "301" | "501" | "701" | "COUNT_UP" | "CRICKET"
 */
function filterGames(history, filterMode) {
  if (!Array.isArray(history)) return [];
  if (filterMode === "ALL_01") {
    return history.filter((g) => g.mode === "301" || g.mode === "501" || g.mode === "701");
  }
  return history.filter((g) => g.mode === filterMode);
}

/**
 * Compute top-bar quick summary for the currently active game mode.
 */
function computeQuickBanner(history, mode) {
  const games = filterGames(history, mode);
  const last10 = games.slice(0, 10);

  if (mode === "CRICKET") {
    const avgMpr = avg(last10.map((g) => g.mpr));
    const bestMpr = maxVal(games.map((g) => g.mpr));
    const finishedGames = games.filter((g) => g.finished);
    const bestDarts = minVal(finishedGames.map((g) => g.totalDarts));
    const rt = ratingFromMpr(avgMpr);
    return {
      gamesCount: games.length,
      primaryLabel: "近10場 MPR",
      primaryValue: avgMpr !== null ? avgMpr.toFixed(2) : "—",
      secondaryLabel: "最佳 MPR",
      secondaryValue:
        bestMpr !== null
          ? `${bestMpr.toFixed(2)}${bestDarts ? ` (${bestDarts}鏢)` : ""}`
          : "—",
      badge: rt ? `RT ${rt.rating} (${rt.flight})` : null,
    };
  }

  if (mode === "COUNT_UP") {
    const avgScore = avg(last10.map((g) => g.totalScore));
    const bestScore = maxVal(games.map((g) => g.totalScore));
    const avgPpd = avg(last10.map((g) => g.ppd));
    return {
      gamesCount: games.length,
      primaryLabel: "近10場平均",
      primaryValue: avgScore !== null ? `${Math.round(avgScore)} 分` : "—",
      secondaryLabel: "最高紀錄 PB",
      secondaryValue: bestScore !== null ? `${bestScore} 分` : "—",
      badge: avgPpd !== null ? `PPD ${avgPpd.toFixed(1)}` : null,
    };
  }

  // 301 / 501 / 701
  const avgPpd = avg(last10.map((g) => g.ppd));
  const avgPpr = avgPpd !== null ? avgPpd * 3 : null;
  const bestPpd = maxVal(games.map((g) => g.ppd));
  const finishedGames = games.filter((g) => g.finished);
  const bestDarts = minVal(finishedGames.map((g) => g.totalDarts));
  const rt = ratingFromPpr(avgPpr);

  return {
    gamesCount: games.length,
    primaryLabel: `近10場 PPD`,
    primaryValue:
      avgPpd !== null ? `${avgPpd.toFixed(2)} (PPR ${avgPpr.toFixed(1)})` : "—",
    secondaryLabel: "最佳 PB",
    secondaryValue:
      bestPpd !== null
        ? `${bestPpd.toFixed(2)}${bestDarts ? ` (${bestDarts}鏢完賽)` : ""}`
        : "—",
    badge: rt ? `RT ${rt.rating} (${rt.flight})` : null,
  };
}

/**
 * Compare a newly finished game against the previous 10 games of the same mode.
 */
function compareGameWithRecent(summary, allHistory) {
  const prevGames = filterGames(allHistory, summary.mode).filter(
    (g) => g.gameId !== summary.gameId
  );
  const prev10 = prevGames.slice(0, 10);

  if (summary.mode === "CRICKET") {
    const prevAvg = avg(prev10.map((g) => g.mpr));
    const prevBest = maxVal(prevGames.map((g) => g.mpr));
    const delta = prevAvg !== null ? round2(summary.mpr - prevAvg) : null;
    const isPb = prevBest === null || summary.mpr > prevBest;
    return {
      metricName: "MPR",
      currentFormatted: summary.mpr.toFixed(2),
      prevAvgFormatted: prevAvg !== null ? prevAvg.toFixed(2) : "—",
      delta,
      isPb,
    };
  }

  if (summary.mode === "COUNT_UP") {
    const prevAvg = avg(prev10.map((g) => g.totalScore));
    const prevBest = maxVal(prevGames.map((g) => g.totalScore));
    const delta = prevAvg !== null ? Math.round(summary.totalScore - prevAvg) : null;
    const isPb = prevBest === null || summary.totalScore > prevBest;
    return {
      metricName: "總分",
      currentFormatted: `${summary.totalScore} 分`,
      prevAvgFormatted: prevAvg !== null ? `${Math.round(prevAvg)} 分` : "—",
      delta,
      isPb,
    };
  }

  const prevAvg = avg(prev10.map((g) => g.ppd));
  const prevBest = maxVal(prevGames.map((g) => g.ppd));
  const delta = prevAvg !== null ? round2(summary.ppd - prevAvg) : null;
  const isPb = prevBest === null || summary.ppd > prevBest;
  return {
    metricName: "PPD",
    currentFormatted: `${summary.ppd.toFixed(2)} (PPR ${summary.ppr.toFixed(1)})`,
    prevAvgFormatted: prevAvg !== null ? prevAvg.toFixed(2) : "—",
    delta,
    isPb,
  };
}

/**
 * Full analytics calculation for the Stats tab.
 */
function computeDashboardStats(history, filterMode = "501") {
  const games = filterGames(history, filterMode);
  const last10 = games.slice(0, 10);
  const last20 = games.slice(0, 20).reverse(); // chronological for trend chart
  const isCricket = filterMode === "CRICKET";
  const isCountUp = filterMode === "COUNT_UP";

  // Overall Rating across all 01 + Cricket games (last 30)
  const overall01 = filterGames(history, "ALL_01").slice(0, 30);
  const overallCrk = filterGames(history, "CRICKET").slice(0, 30);
  const avg01Ppr = avg(overall01.map((g) => g.ppr));
  const avgCrkMpr = avg(overallCrk.map((g) => g.mpr));
  const rt01 = ratingFromPpr(avg01Ppr);
  const rtCrk = ratingFromMpr(avgCrkMpr);
  let overallRating = null;
  if (rt01 && rtCrk) {
    const meanRt = (rt01.rating + rtCrk.rating) / 2;
    overallRating = {
      rating: meanRt.toFixed(1),
      flight: flightFromRating(meanRt),
      rt01: rt01.rating,
      rtCrk: rtCrk.rating,
    };
  } else if (rt01) {
    overallRating = { rating: String(rt01.rating), flight: rt01.flight, rt01: rt01.rating, rtCrk: null };
  } else if (rtCrk) {
    overallRating = { rating: String(rtCrk.rating), flight: rtCrk.flight, rt01: null, rtCrk: rtCrk.rating };
  }

  // Primary metrics for the selected filter
  const metricFn = (g) => (isCricket ? g.mpr : isCountUp ? g.totalScore : g.ppd);
  const last10Avg = avg(last10.map(metricFn));
  const allTimeAvg = avg(games.map(metricFn));
  const pbValue = maxVal(games.map(metricFn));
  const finishedCount = games.filter((g) => g.finished).length;
  const finishRate = games.length > 0 ? (finishedCount / games.length) * 100 : null;
  const bestDarts = minVal(games.filter((g) => g.finished).map((g) => g.totalDarts));

  // Bull & Darts breakdown across the filtered games
  let totalDarts = 0;
  let sBullHits = 0;
  let dBullHits = 0;
  const slotStats = {
    1: { count: 0, sumPoints: 0, sumMarks: 0, bulls: 0, misses: 0 },
    2: { count: 0, sumPoints: 0, sumMarks: 0, bulls: 0, misses: 0 },
    3: { count: 0, sumPoints: 0, sumMarks: 0, bulls: 0, misses: 0 },
  };
  const segmentCounts = new Map();

  for (const g of games) {
    totalDarts += g.totalDarts || 0;
    sBullHits += g.sBullHits || 0;
    dBullHits += g.dBullHits || 0;

    const dartsList =
      Array.isArray(g.darts) && g.darts.length > 0
        ? g.darts
        : parseDartsFromRoundByRound(g.roundByRound);

    for (const d of dartsList) {
      if (d.code === "X") continue; // bust auto-fill
      const slot = slotStats[d.dartNo];
      if (slot) {
        slot.count += 1;
        slot.sumPoints += d.points || 0;
        slot.sumMarks += d.effectiveMarks ?? d.rawMarks ?? 0;
        if (d.segment === 25) slot.bulls += 1;
        if (d.code === "M") slot.misses += 1;
      }
      const key = d.segment === 25 ? "BULL" : d.code === "M" ? "MISS" : String(d.segment);
      segmentCounts.set(key, (segmentCounts.get(key) || 0) + 1);
    }
  }

  const totalBulls = sBullHits + dBullHits;
  const bullRate = totalDarts > 0 ? (totalBulls / totalDarts) * 100 : 0;
  const dBullRatio = totalBulls > 0 ? (dBullHits / totalBulls) * 100 : 0;

  // Lifetime awards across ALL history (or filtered games)
  const awardsTotal = Object.fromEntries(Object.keys(AWARDS).map((k) => [k, 0]));
  for (const g of history) {
    if (!g.awards) continue;
    for (const [k, v] of Object.entries(g.awards)) {
      awardsTotal[k] = (awardsTotal[k] || 0) + (Number(v) || 0);
    }
  }

  // Dart 1 / 2 / 3 summary
  const byDartNo = [1, 2, 3].map((no) => {
    const s = slotStats[no];
    const avgVal =
      s.count > 0 ? (isCricket ? s.sumMarks / s.count : s.sumPoints / s.count) : 0;
    const missRate = s.count > 0 ? (s.misses / s.count) * 100 : 0;
    const bullHitRate = s.count > 0 ? (s.bulls / s.count) * 100 : 0;
    return {
      dartNo: no,
      count: s.count,
      avgVal: round2(avgVal),
      missRate: round2(missRate),
      bullHitRate: round2(bullHitRate),
    };
  });

  // Trend points for SVG chart
  const trendSeries = last20.map((g, idx) => ({
    index: idx + 1,
    value: Number(metricFn(g) || 0),
    label: formatShortDate(g.endedAt),
    finished: g.finished,
    darts: g.totalDarts,
    mode: g.mode,
  }));

  return {
    filterMode,
    isCricket,
    isCountUp,
    gamesCount: games.length,
    totalDarts,
    last10Avg: round2(last10Avg),
    allTimeAvg: round2(allTimeAvg),
    pbValue: round2(pbValue),
    finishRate: round2(finishRate),
    bestDarts,
    sBullHits,
    dBullHits,
    totalBulls,
    bullRate: round2(bullRate),
    dBullRatio: round2(dBullRatio),
    byDartNo,
    awardsTotal,
    overallRating,
    trendSeries,
    recentGames: games.slice(0, 15),
  };
}

/**
 * Build responsive SVG line chart for the last N games.
 */
function renderTrendSvg(series, { unit = "", avgLine = null } = {}) {
  if (!series || series.length === 0) {
    return `<div class="chart-empty">尚無此模式的完賽紀錄，打完第一場即自動繪製走勢圖！</div>`;
  }

  const width = 640;
  const height = 210;
  const padL = 44;
  const padR = 20;
  const padT = 24;
  const padB = 32;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const vals = series.map((p) => p.value);
  const minV = Math.min(...vals, avgLine ?? Infinity);
  const maxV = Math.max(...vals, avgLine ?? -Infinity);
  const span = Math.max(maxV - minV, maxV * 0.2, 1);
  const low = Math.max(0, minV - span * 0.15);
  const high = maxV + span * 0.15;

  const xAt = (i) =>
    series.length === 1
      ? padL + plotW / 2
      : padL + (i / (series.length - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - low) / (high - low || 1)) * plotH;

  const points = series.map((p, i) => ({
    ...p,
    x: round2(xAt(i)),
    y: round2(yAt(p.value)),
  }));

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath =
    points.length > 1
      ? `M ${points[0].x},${padT + plotH} L ${points
          .map((p) => `${p.x},${p.y}`)
          .join(" L ")} L ${points.at(-1).x},${padT + plotH} Z`
      : "";

  const yTicks = [low, (low + high) / 2, high].map((v) => ({
    y: round2(yAt(v)),
    label: v >= 100 ? Math.round(v) : v.toFixed(1),
  }));

  const avgY = avgLine !== null && avgLine !== undefined ? round2(yAt(avgLine)) : null;

  return `
    <svg viewBox="0 0 ${width} ${height}" class="trend-svg" role="img" aria-label="近期表現走勢圖">
      <defs>
        <linearGradient id="trendAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7170FF" stop-opacity="0.32" />
          <stop offset="100%" stop-color="#7170FF" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${yTicks
        .map(
          (t) => `
        <line x1="${padL}" y1="${t.y}" x2="${width - padR}" y2="${t.y}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
        <text x="${padL - 8}" y="${t.y + 4}" text-anchor="end" class="svg-axis-label">${t.label}</text>
      `
        )
        .join("")}
      ${
        avgY !== null
          ? `<line x1="${padL}" y1="${avgY}" x2="${width - padR}" y2="${avgY}" stroke="#FFBC33" stroke-width="1.5" stroke-dasharray="5 4" />
             <text x="${width - padR - 4}" y="${avgY - 6}" text-anchor="end" fill="#FFBC33" class="svg-avg-tag">近10場均 ${avgLine}${unit}</text>`
          : ""
      }
      ${areaPath ? `<path d="${areaPath}" fill="url(#trendAreaGrad)" />` : ""}
      ${
        points.length > 1
          ? `<polyline fill="none" stroke="#7170FF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${polyline}" />`
          : ""
      }
      ${points
        .map(
          (p) => `
        <g class="svg-point">
          <circle cx="${p.x}" cy="${p.y}" r="4.2" fill="${p.finished ? "#7170FF" : "#62666D"}" stroke="#0F1012" stroke-width="2" />
          <text x="${p.x}" y="${p.y - 10}" text-anchor="middle" class="svg-point-val">${
            p.value >= 100 ? Math.round(p.value) : p.value.toFixed(1)
          }</text>
          <text x="${p.x}" y="${height - 8}" text-anchor="middle" class="svg-axis-label">${p.label}</text>
        </g>
      `
        )
        .join("")}
    </svg>
  `;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function avg(arr) {
  const nums = arr.filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function maxVal(arr) {
  const nums = arr.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return nums.length ? Math.max(...nums) : null;
}

function minVal(arr) {
  const nums = arr.filter((x) => typeof x === "number" && !Number.isNaN(x));
  return nums.length ? Math.min(...nums) : null;
}

function formatShortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(5, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Reconstruct per-dart objects from `roundByRound` string (e.g. "R1:T20,T20,S1(121)|R2:SB,DB,M(100)")
 * so that games pulled from the single-sheet `Games` table still support Dart 1/2/3 stability diagnostics.
 */
function parseDartsFromRoundByRound(roundByRound) {
  if (!roundByRound || typeof roundByRound !== "string") return [];
  const out = [];
  const rounds = roundByRound.split("|");
  for (let rIdx = 0; rIdx < rounds.length; rIdx++) {
    const chunk = rounds[rIdx].trim();
    if (!chunk) continue;
    // Strip "R1:" prefix and "(180)" or "(+3M)" suffix
    const withoutPrefix = chunk.replace(/^R\d+:/i, "");
    const codesPart = withoutPrefix.replace(/\([^)]*\)\s*$/, "");
    const codes = codesPart.split(",").map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < codes.length; i++) {
      try {
        const parsed = parseDart(codes[i]);
        out.push({
          round: rIdx + 1,
          dartNo: i + 1,
          code: parsed.code,
          segment: parsed.segment,
          multiplier: parsed.multiplier,
          points: parsed.points,
          rawMarks: parsed.rawMarks,
          effectiveMarks: parsed.rawMarks,
        });
      } catch (_) {}
    }
  }
  return out;
}



/**
 * Home Darts Arcade Tracker — Main UI Controller
 */

/* ------------------------------------------------------------------ */
/* Application State                                                   */
/* ------------------------------------------------------------------ */

let gameState = loadOrInitGame();
let activeMult = "S"; // "S" | "D" | "T"
let currentTab = "play"; // "play" | "stats"
let statsFilter = gameState.mode;
let pendingConfirmAction = null;
let wakeLockSentinel = null;

function loadOrInitGame() {
  const saved = loadActiveGame();
  if (saved && saved.mode) {
    try {
      const v = getView(saved);
      if (!v.over) return saved;
    } catch (_) {}
  }
  const fresh = createGame("501");
  saveActiveGame(fresh);
  return fresh;
}

/* ------------------------------------------------------------------ */
/* DOM References                                                      */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);

const els = {
  modeBtns: [...document.querySelectorAll(".mode-btn")],
  btnNewGame: $("btn-new-game"),
  bannerPrimaryLabel: $("banner-primary-label"),
  bannerPrimaryVal: $("banner-primary-val"),
  bannerSecLabel: $("banner-sec-label"),
  bannerSecVal: $("banner-sec-val"),
  bannerBadge: $("banner-badge"),
  wakelockIndicator: $("wakelock-indicator"),
  wakelockText: $("wakelock-text"),
  btnToggleView: $("btn-toggle-view"),
  toggleViewIcon: $("toggle-view-icon"),
  toggleViewLabel: $("toggle-view-label"),
  btnOpenSettings: $("btn-open-settings"),
  syncStatusText: $("sync-status-text"),

  viewPlay: $("view-play"),
  viewStats: $("view-stats"),

  scoreboardCard: $("scoreboard-card"),
  roundCurrent: $("round-current"),
  roundMax: $("round-max"),
  livePrimaryLabel: $("live-primary-label"),
  livePrimaryVal: $("live-primary-val"),
  liveSecLabel: $("live-sec-label"),
  liveSecVal: $("live-sec-val"),
  boardNumeric: $("board-numeric"),
  scoreCaption: $("score-caption"),
  giantScore: $("giant-score"),
  boardCricket: $("board-cricket"),
  cricketGrid: $("cricket-grid"),
  checkoutBanner: $("checkout-banner"),
  checkoutRouteText: $("checkout-route-text"),
  statusBanner: $("status-banner"),

  dartSlots: [...document.querySelectorAll(".dart-slot")],
  subtotalLabel: $("subtotal-label"),
  subtotalVal: $("subtotal-val"),
  btnUndo: $("btn-undo"),
  liveDartsCount: $("live-darts-count"),
  roundLogList: $("round-log-list"),

  expressBtns: [...document.querySelectorAll(".express-row .key-btn")],
  subSbull: $("sub-sbull"),
  subDbull: $("sub-dbull"),
  btnMult2: $("btn-mult-2"),
  btnMult3: $("btn-mult-3"),
  btnCricketPadMode: $("btn-cricket-pad-mode"),
  cricketPadLabel: $("cricket-pad-label"),
  numberGrid: $("number-grid"),
  btnConfirmRound: $("btn-confirm-round"),
  confirmBtnText: $("confirm-btn-text"),
  confirmBtnSub: $("confirm-btn-sub"),

  // Stats View
  filterBtns: [...document.querySelectorAll(".filter-btn")],
  statsRatingText: $("stats-rating-text"),
  statsKpiGrid: $("stats-kpi-grid"),
  chartTitle: $("chart-title"),
  chartSubtitle: $("chart-subtitle"),
  trendChartBox: $("trend-chart-box"),
  dartSlotBreakdown: $("dart-slot-breakdown"),
  bullBreakdown: $("bull-breakdown"),
  awardsWall: $("awards-wall"),
  historyTbody: $("history-tbody"),
  btnExportGamesCsv: $("btn-export-games-csv"),
  btnExportDartsCsv: $("btn-export-darts-csv"),

  // Modals
  dialogGameover: $("dialog-gameover"),
  gameoverEyebrow: $("gameover-eyebrow"),
  gameoverTitle: $("gameover-title"),
  gameoverPbBadge: $("gameover-pb-badge"),
  goMainLabel: $("go-main-label"),
  goMainVal: $("go-main-val"),
  goDeltaText: $("go-delta-text"),
  goSubGrid: $("go-sub-grid"),
  goAwardsRow: $("go-awards-row"),
  goRoundsPreview: $("go-rounds-preview"),
  btnGameoverUndo: $("btn-gameover-undo"),
  btnPlayAgain: $("btn-play-again"),

  dialogConfirm: $("dialog-confirm"),
  confirmTitle: $("confirm-title"),
  confirmDesc: $("confirm-desc"),

  dialogSettings: $("dialog-settings"),
  btnCloseSettings: $("btn-close-settings"),
  inputGasUrl: $("input-gas-url"),
  inputPasscode: $("input-passcode"),
  selectCricketPad: $("select-cricket-pad"),
  settingsSyncFeedback: $("settings-sync-feedback"),
  btnSaveSettings: $("btn-save-settings"),
  btnPushCloud: $("btn-push-cloud"),
  btnPullCloud: $("btn-pull-cloud"),
};

/* ------------------------------------------------------------------ */
/* Rendering: Play View                                                */
/* ------------------------------------------------------------------ */

function renderAll({ popScore = false } = {}) {
  const view = getView(gameState);
  renderTopbar(view);
  renderScoreboard(view, popScore);
  renderSlots(view);
  renderRoundHistory(view);
  renderKeypad(view);
  if (currentTab === "stats") {
    renderStatsView();
  }
}

function renderTopbar(view) {
  for (const btn of els.modeBtns) {
    btn.classList.toggle("is-active", btn.dataset.mode === view.mode);
  }
  const banner = computeQuickBanner(getHistory(), view.mode);
  els.bannerPrimaryLabel.textContent = banner.primaryLabel;
  els.bannerPrimaryVal.textContent = banner.primaryValue;
  els.bannerSecLabel.textContent = banner.secondaryLabel;
  els.bannerSecVal.textContent = banner.secondaryValue;
  if (banner.badge) {
    els.bannerBadge.hidden = false;
    els.bannerBadge.textContent = banner.badge;
  } else {
    els.bannerBadge.hidden = true;
  }
}

function renderScoreboard(view, popScore) {
  const isCricket = view.kind === "cricket";
  const isCountUp = view.kind === "countup";

  els.scoreboardCard.dataset.kind = view.kind;
  els.scoreboardCard.classList.toggle("is-bust", Boolean(view.current.bust));

  els.roundCurrent.textContent = String(view.round);
  els.roundMax.textContent = String(view.maxRounds);

  if (isCricket) {
    els.livePrimaryLabel.textContent = "LIVE MPR";
    els.livePrimaryVal.textContent =
      view.stats.mpr !== null ? view.stats.mpr.toFixed(2) : "0.00";
    els.liveSecLabel.textContent = "MARKS (RAW)";
    els.liveSecVal.textContent = `${view.stats.effectiveMarks ?? 0}/21 (${view.stats.rawMarks ?? 0})`;
  } else {
    els.livePrimaryLabel.textContent = "PPD / PPR";
    const ppd = view.stats.ppd !== null ? view.stats.ppd.toFixed(2) : "0.00";
    const ppr = view.stats.ppr !== null ? view.stats.ppr.toFixed(1) : "0.0";
    els.livePrimaryVal.textContent = `${ppd} / ${ppr}`;
    els.liveSecLabel.textContent = "BULL (D-BULL)";
    const totalB = view.stats.sBullHits + view.stats.dBullHits;
    els.liveSecVal.textContent = `${totalB} (DB ${view.stats.dBullHits})`;
  }

  if (isCricket) {
    els.boardNumeric.hidden = true;
    els.boardCricket.hidden = false;
    renderCricketBoard(view.cricket);
  } else {
    els.boardNumeric.hidden = false;
    els.boardCricket.hidden = true;
    els.scoreCaption.textContent = isCountUp ? "TOTAL SCORE" : "REMAINING";
    const displayNum = isCountUp ? view.stats.score : view.remaining;
    els.giantScore.textContent = String(displayNum);

    if (popScore) {
      els.giantScore.classList.remove("is-popping");
      void els.giantScore.offsetWidth;
      els.giantScore.classList.add("is-popping");
    }
  }

  // Footer: Checkout Guide or Bust / Game Shot / Award Banner
  els.checkoutBanner.hidden = true;
  els.statusBanner.hidden = true;
  els.statusBanner.className = "status-banner";

  if (view.current.bust) {
    els.statusBanner.hidden = false;
    els.statusBanner.classList.add("is-bust");
    els.statusBanner.textContent = `BUST! 分數退回 ${view.remaining} — 請按確認換輪（或退格重按）`;
  } else if (view.current.gameShot) {
    els.statusBanner.hidden = false;
    els.statusBanner.classList.add("is-gameshot");
    els.statusBanner.textContent = `GAME SHOT! 請按底部確認鍵結算本局`;
  } else if (view.current.award) {
    els.statusBanner.hidden = false;
    els.statusBanner.classList.add("is-award");
    els.statusBanner.textContent = `AWARD · ${AWARDS[view.current.award]}!`;
  } else if (view.checkout && view.checkout.length > 0) {
    els.checkoutBanner.hidden = false;
    els.checkoutRouteText.textContent = view.checkout.join(" ➔ ");
  }
}

function renderCricketBoard(cricketTargets) {
  if (!cricketTargets) return;
  els.cricketGrid.innerHTML = cricketTargets
    .map((item) => {
      const label = item.target === BULL ? "BULL" : String(item.target);
      const symbol =
        item.marks === 0
          ? "·"
          : item.marks === 1
            ? "/"
            : item.marks === 2
              ? "X"
              : "⊗";
      const cls =
        item.marks >= 3
          ? "is-closed"
          : item.marks === 2
            ? "has-2"
            : item.marks === 1
              ? "has-1"
              : "";
      return `
        <div class="cricket-cell ${cls}">
          <span class="crk-target">${label}</span>
          <span class="crk-symbol">${symbol}</span>
          <div class="crk-dots" aria-hidden="true">
            <span class="crk-dot ${item.marks >= 1 ? "is-on" : ""}"></span>
            <span class="crk-dot ${item.marks >= 2 ? "is-on" : ""}"></span>
            <span class="crk-dot ${item.marks >= 3 ? "is-on" : ""}"></span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSlots(view) {
  const isCricket = view.kind === "cricket";
  const darts = view.current.darts;

  els.dartSlots.forEach((slotEl, idx) => {
    const d = darts[idx];
    const codeEl = slotEl.querySelector(".slot-code");
    const subEl = slotEl.querySelector(".slot-sub");

    slotEl.className = "dart-slot";
    if (!d) {
      if (idx === darts.length && view.canThrow) {
        slotEl.classList.add("is-active");
      }
      codeEl.textContent = "—";
      subEl.textContent = "";
      return;
    }

    slotEl.classList.add("is-filled");
    if (d.segment === BULL) slotEl.classList.add("is-bull");
    else if (d.multiplier === 3) slotEl.classList.add("is-triple");
    else if (d.multiplier === 2) slotEl.classList.add("is-double");

    codeEl.textContent = d.code;
    if (isCricket) {
      subEl.textContent = d.effectiveMarks > 0 ? `+${d.effectiveMarks}M` : "0M";
    } else {
      subEl.textContent = `${d.points}`;
    }
  });

  if (isCricket) {
    els.subtotalLabel.textContent = "本輪記號";
    els.subtotalVal.textContent = `+${view.current.effectiveMarks}M`;
  } else {
    els.subtotalLabel.textContent = "本輪小計";
    els.subtotalVal.textContent = view.current.bust
      ? "BUST"
      : `${view.current.rawPoints}`;
  }

  const canUndo =
    gameState.current.length > 0 || gameState.rounds.length > 0;
  els.btnUndo.disabled = !canUndo;
}

function renderRoundHistory(view) {
  els.liveDartsCount.textContent = `已投 ${view.stats.totalDarts} 鏢`;
  if (view.rounds.length === 0) {
    els.roundLogList.innerHTML = `<div class="round-log-empty">投出第一輪後將顯示各輪軌跡</div>`;
    return;
  }

  const isCricket = view.kind === "cricket";
  els.roundLogList.innerHTML = [...view.rounds]
    .reverse()
    .map((r) => {
      const codes = r.darts.map((d) => d.code).join(" · ");
      const right = r.bust
        ? "BUST"
        : isCricket
          ? `+${r.effectiveMarks}M (${r.after}/21)`
          : `${r.score} (${r.after})`;
      return `
        <div class="round-log-item">
          <strong>R${r.number}</strong>
          <span>${codes}</span>
          <strong>${right}</strong>
        </div>
      `;
    })
    .join("");
}

function renderKeypad(view) {
  const isCricket = view.kind === "cricket";
  const settings = getSettings();

  // Bull subtitles
  els.subSbull.textContent = isCricket ? "外紅心 1 Mark" : "外紅心 50";
  els.subDbull.textContent = isCricket ? "內黑心 2 Marks" : "內黑心 50";

  // Express buttons disabled when round is locked
  for (const btn of els.expressBtns) {
    btn.disabled = !view.canThrow;
  }

  // Multiplier buttons
  els.btnMult2.disabled = !view.canThrow;
  els.btnMult3.disabled = !view.canThrow;
  updateMultiplierUI();

  // Cricket compact vs full toggle
  if (isCricket) {
    els.btnCricketPadMode.hidden = false;
    els.cricketPadLabel.textContent =
      settings.cricketKeypad === "compact" ? "1~14 展開" : "精簡 15~20";
  } else {
    els.btnCricketPadMode.hidden = true;
  }

  // Build number grid
  const useCompact = isCricket && settings.cricketKeypad === "compact";
  els.numberGrid.classList.toggle("is-cricket-compact", useCompact);
  els.numberGrid.dataset.multActive = activeMult;

  const closedMap = new Map(
    (view.cricket || []).map((c) => [c.target, c.closed])
  );

  const numbers = useCompact
    ? [20, 19, 18, 17, 16, 15]
    : [
        20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      ];

  const multNum = activeMult === "T" ? 3 : activeMult === "D" ? 2 : 1;
  const prefix = activeMult === "S" ? "" : activeMult;

  els.numberGrid.innerHTML = numbers
    .map((n) => {
      const code = `${activeMult}${n}`;
      const isHigh = n >= 15;
      const isClosed = isCricket && closedMap.get(n);
      const subText = isCricket
        ? isClosed
          ? "已關門"
          : isHigh
            ? `${multNum} Mark${multNum > 1 ? "s" : ""}`
            : "0 Mark"
        : `${n * multNum} 分`;
      return `
        <button
          type="button"
          class="num-key ${isHigh ? "is-high-tier" : ""} ${isClosed ? "is-closed-target" : ""}"
          data-segment="${n}"
          data-dart="${code}"
          ${!view.canThrow ? "disabled" : ""}
        >
          <span>${prefix}${n}</span>
          <small>${subText}</small>
        </button>
      `;
    })
    .join("");

  // Confirm button state
  els.btnConfirmRound.disabled = !view.canConfirm;
  const isReady =
    view.canConfirm &&
    (view.current.entered === 3 || view.current.bust || view.current.gameShot);
  els.btnConfirmRound.classList.toggle("is-ready", isReady);

  const endsIfConfirmed =
    view.current.gameShot || view.round >= view.maxRounds;

  if (!view.canConfirm) {
    els.confirmBtnText.textContent = "CONFIRM ROUND · 確認換輪";
    els.confirmBtnSub.textContent = "請先點選至少 1 鏢（全脫靶請點 MISS）";
  } else if (view.current.gameShot) {
    els.confirmBtnText.textContent = "FINISH GAME · 完賽結算";
    els.confirmBtnSub.textContent = `恭喜完賽！共投 ${view.stats.totalDarts} 鏢`;
  } else if (view.current.bust) {
    els.confirmBtnText.textContent = endsIfConfirmed
      ? "CONFIRM BUST · 確認爆鏢並結束本局"
      : "CONFIRM BUST · 確認爆鏢並進入下一輪";
    els.confirmBtnSub.textContent = "本輪得分歸零，剩餘分數已退回";
  } else if (view.current.entered < 3) {
    const missCount = 3 - view.current.entered;
    els.confirmBtnText.textContent = endsIfConfirmed
      ? `補 ${missCount} 鏢 MISS 並結算本局`
      : `確認本輪（自動補 ${missCount} 鏢 MISS）`;
    els.confirmBtnSub.textContent = "未點滿 3 鏢按確認將自動補記 MISS";
  } else {
    els.confirmBtnText.textContent = endsIfConfirmed
      ? "FINISH FINAL ROUND · 確認最後一輪"
      : `CONFIRM R${view.round} ➔ NEXT R${view.round + 1}`;
    els.confirmBtnSub.textContent = "3 鏢已滿，確認無誤請點擊換輪";
  }
}

function updateMultiplierUI() {
  const isD = activeMult === "D";
  const isT = activeMult === "T";
  els.btnMult2.setAttribute("aria-pressed", String(isD));
  els.btnMult3.setAttribute("aria-pressed", String(isT));
  els.btnMult2.querySelector(".mult-indicator").textContent = isD ? "●" : "○";
  els.btnMult3.querySelector(".mult-indicator").textContent = isT ? "●" : "○";
}

/* ------------------------------------------------------------------ */
/* Rendering: Analytics Dashboard (#view-stats)                        */
/* ------------------------------------------------------------------ */

function renderStatsView() {
  const history = getHistory();
  const data = computeDashboardStats(history, statsFilter);

  for (const btn of els.filterBtns) {
    btn.classList.toggle("is-active", btn.dataset.filter === statsFilter);
  }

  if (data.overallRating) {
    const rt = data.overallRating;
    const parts = [];
    if (rt.rt01) parts.push(`01 RT ${rt.rt01}`);
    if (rt.rtCrk) parts.push(`Crk RT ${rt.rtCrk}`);
    els.statsRatingText.textContent = `RT ${rt.rating} · ${rt.flight} Flight (${parts.join(" / ")})`;
  } else {
    els.statsRatingText.textContent = "累積對局後自動換算 Rating";
  }

  const unit = data.isCricket ? "" : data.isCountUp ? " 分" : "";
  const metricTitle = data.isCricket
    ? "MPR"
    : data.isCountUp
      ? "總分"
      : "PPD";

  const fmtVal = (v) => {
    if (v === null || v === undefined) return "—";
    if (data.isCountUp) return `${Math.round(v)} 分`;
    if (data.isCricket) return v.toFixed(2);
    return `${v.toFixed(2)} (PPR ${(v * 3).toFixed(1)})`;
  };

  els.statsKpiGrid.innerHTML = `
    <div class="kpi-card">
      <span class="kpi-label">近 10 場平均 ${metricTitle}</span>
      <strong class="kpi-value">${fmtVal(data.last10Avg)}</strong>
      <span class="kpi-sub">生涯總平均：${fmtVal(data.allTimeAvg)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">歷史最佳紀錄 (PB)</span>
      <strong class="kpi-value">${fmtVal(data.pbValue)}</strong>
      <span class="kpi-sub">${
        data.bestDarts ? `最快完賽：${data.bestDarts} 鏢` : `已累計 ${data.gamesCount} 場`
      }</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">完賽率 &amp; 總投鏢數</span>
      <strong class="kpi-value">${
        data.finishRate !== null ? `${data.finishRate.toFixed(0)}%` : "—"
      }</strong>
      <span class="kpi-sub">共 ${data.gamesCount} 場 · 累計 ${data.totalDarts} 鏢</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">紅心命中率 (Bull %)</span>
      <strong class="kpi-value">${data.bullRate.toFixed(1)}%</strong>
      <span class="kpi-sub">共 ${data.totalBulls} 顆 (內黑心佔 ${data.dBullRatio.toFixed(0)}%)</span>
    </div>
  `;

  els.chartTitle.textContent = `近 ${data.trendSeries.length || 20} 場 ${metricTitle} 走勢圖`;
  els.chartSubtitle.textContent = `黃色虛線為近 10 場滾動平均`;
  els.trendChartBox.innerHTML = renderTrendSvg(data.trendSeries, {
    unit,
    avgLine: data.last10Avg,
  });

  // Dart 1 / 2 / 3 Breakdown
  const maxSlotVal = Math.max(...data.byDartNo.map((s) => s.avgVal), 1);
  els.dartSlotBreakdown.innerHTML = data.byDartNo
    .map((s) => {
      const pct = Math.min(100, Math.round((s.avgVal / maxSlotVal) * 100));
      const valStr = data.isCricket
        ? `平均 ${s.avgVal.toFixed(2)} Marks`
        : `平均 ${s.avgVal.toFixed(1)} 分`;
      return `
        <div class="slot-stat-row">
          <div class="slot-stat-top">
            <strong>第 ${s.dartNo} 鏢 (Dart #${s.dartNo})</strong>
            <span>${valStr} · Bull ${s.bullHitRate.toFixed(1)}% · 脫靶 ${s.missRate.toFixed(1)}%</span>
          </div>
          <div class="slot-bar-track">
            <div class="slot-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    })
    .join("");

  // Bull breakdown
  const sbPct =
    data.totalBulls > 0
      ? Math.round((data.sBullHits / data.totalBulls) * 100)
      : 50;
  const dbPct = data.totalBulls > 0 ? 100 - sbPct : 50;
  els.bullBreakdown.innerHTML = `
    <div class="bull-split-bar" aria-label="內外紅心比例">
      <div class="bull-seg-sb" style="width: ${sbPct}%"></div>
      <div class="bull-seg-db" style="width: ${dbPct}%"></div>
    </div>
    <div class="bull-legend-grid">
      <div class="bull-stat-box">
        <div class="kpi-label">外紅心 S-BULL</div>
        <div class="kpi-value" style="color: var(--accent-amber)">${data.sBullHits}</div>
        <div class="kpi-sub">佔紅心 ${data.totalBulls ? sbPct : 0}%</div>
      </div>
      <div class="bull-stat-box">
        <div class="kpi-label">內黑心 D-BULL</div>
        <div class="kpi-value" style="color: var(--accent-red)">${data.dBullHits}</div>
        <div class="kpi-sub">真準度比 ${data.totalBulls ? dbPct : 0}%</div>
      </div>
    </div>
  `;

  // Awards Wall
  els.awardsWall.innerHTML = Object.entries(AWARDS)
    .map(([key, label]) => {
      const count = data.awardsTotal[key] || 0;
      return `
        <div class="award-tile ${count > 0 ? "is-earned" : ""}">
          <span class="award-name">${label}</span>
          <strong class="award-count">${count}</strong>
        </div>
      `;
    })
    .join("");

  // Recent Games Table
  if (data.recentGames.length === 0) {
    els.historyTbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 1.5rem; color: var(--text-muted)">
          尚無對局紀錄
        </td>
      </tr>
    `;
  } else {
    els.historyTbody.innerHTML = data.recentGames
      .map((g) => {
        const dt = formatDateTime(g.endedAt);
        const statusBadge = g.finished ? "✓ 完賽" : "未完賽";
        const perf =
          g.mode === "CRICKET"
            ? `MPR ${Number(g.mpr || 0).toFixed(2)} (${g.effectiveMarks}/21M)`
            : g.mode === "COUNT_UP"
              ? `${g.totalScore} 分 (PPD ${Number(g.ppd || 0).toFixed(1)})`
              : `PPD ${Number(g.ppd || 0).toFixed(2)} (PPR ${Number(g.ppr || 0).toFixed(1)})`;
        return `
          <tr>
            <td>${dt}</td>
            <td><strong>${g.mode}</strong></td>
            <td>${statusBadge}</td>
            <td>${g.roundsPlayed}R / ${g.totalDarts}鏢</td>
            <td><strong>${perf}</strong></td>
            <td>${g.sBullHits || 0} / ${g.dBullHits || 0}</td>
            <td class="history-rounds-cell" title="${escapeHtml(g.roundByRound || "")}">
              ${escapeHtml(g.roundByRound || "")}
            </td>
            <td>
              <button type="button" class="del-row-btn" data-delete-id="${g.gameId}">
                刪除
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  }
}

/* ------------------------------------------------------------------ */
/* Event Handlers: Throwing Darts, Multipliers, Confirm & Undo         */
/* ------------------------------------------------------------------ */

function handleThrow(code) {
  try {
    gameState = throwDart(gameState, code);
    activeMult = "S"; // Auto-spring back to Single after throwing
    saveActiveGame(gameState);
    renderAll({ popScore: true });
  } catch (_) {}
}

function handleConfirmRound() {
  try {
    gameState = confirmRound(gameState);
    activeMult = "S";
    saveActiveGame(gameState);
    const view = getView(gameState);
    renderAll({ popScore: true });

    if (view.over) {
      const summary = summarize(gameState);
      recordFinishedGame(summary);
      renderTopbar(view);
      openGameOverModal(summary);
    }
  } catch (_) {}
}

function handleUndo() {
  gameState = undo(gameState);
  activeMult = "S";
  saveActiveGame(gameState);
  renderAll({ popScore: true });
}

function openGameOverModal(summary) {
  const history = getHistory();
  const cmp = compareGameWithRecent(summary, history);
  const isCricket = summary.mode === "CRICKET";
  const isCountUp = summary.mode === "COUNT_UP";

  els.gameoverEyebrow.textContent = summary.finished
    ? "GAME FINISHED · 完賽結算"
    : "ROUND LIMIT REACHED · 達回合上限";
  els.gameoverTitle.textContent = `${summary.mode} 對局結算`;
  els.gameoverPbBadge.hidden = !cmp.isPb;

  els.goMainLabel.textContent = `本場 ${cmp.metricName}`;
  els.goMainVal.textContent = cmp.currentFormatted;

  els.goDeltaText.className = "hero-delta";
  if (cmp.delta === null) {
    els.goDeltaText.textContent = "首場該模式紀錄！";
  } else if (cmp.delta >= 0) {
    els.goDeltaText.classList.add("is-up");
    els.goDeltaText.textContent = `▲ +${cmp.delta} vs 近10場均 (${cmp.prevAvgFormatted})`;
  } else {
    els.goDeltaText.classList.add("is-down");
    els.goDeltaText.textContent = `▼ ${cmp.delta} vs 近10場均 (${cmp.prevAvgFormatted})`;
  }

  els.goSubGrid.innerHTML = isCricket
    ? `
      <div>
        <div class="kpi-label">完賽輪數 / 鏢數</div>
        <strong>${summary.roundsPlayed}R / ${summary.totalDarts}鏢</strong>
      </div>
      <div>
        <div class="kpi-label">有效 / 總記號</div>
        <strong>${summary.effectiveMarks}/21 (${summary.rawMarks})</strong>
      </div>
      <div>
        <div class="kpi-label">紅心 (SB / DB)</div>
        <strong>${summary.sBullHits} / ${summary.dBullHits}</strong>
      </div>
    `
    : `
      <div>
        <div class="kpi-label">完賽輪數 / 鏢數</div>
        <strong>${summary.roundsPlayed}R / ${summary.totalDarts}鏢</strong>
      </div>
      <div>
        <div class="kpi-label">${isCountUp ? "PPD / PPR" : "實扣總分 / 剩餘"}</div>
        <strong>${
          isCountUp
            ? `${summary.ppd.toFixed(2)} / ${summary.ppr.toFixed(1)}`
            : `${summary.totalScore} / 剩 ${summary.remainScore}`
        }</strong>
      </div>
      <div>
        <div class="kpi-label">紅心 (SB / DB)</div>
        <strong>${summary.sBullHits} / ${summary.dBullHits}</strong>
      </div>
    `;

  const awardEntries = Object.entries(summary.awards || {}).filter(
    ([, c]) => c > 0
  );
  if (awardEntries.length > 0) {
    els.goAwardsRow.hidden = false;
    els.goAwardsRow.innerHTML = awardEntries
      .map(
        ([k, c]) =>
          `<span class="pb-badge">🏆 ${AWARDS[k] || k} ×${c}</span>`
      )
      .join("");
  } else {
    els.goAwardsRow.hidden = true;
  }

  els.goRoundsPreview.textContent = summary.roundByRound
    .split("|")
    .join("   ");

  els.dialogGameover.showModal();
}

/* ------------------------------------------------------------------ */
/* Top-Layer Dialog Exit Animation Helper                              */
/* ------------------------------------------------------------------ */

let supportsDisplayTransition;
function canTransitionDisplay() {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit() {
  return window.CSS?.supports?.("overlay", "auto") && canTransitionDisplay();
}

async function closeDialogSmoothly(dialog) {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    dialog.removeAttribute("data-closing");
  }
  dialog.close();
}

function setupDialogs() {
  // Light-dismiss polyfill for browsers without closedBy support (e.g. Safari)
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    const outside = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e, dialog)) {
          void closeDialogSmoothly(dialog);
        }
      });
    }
  }

  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      void closeDialogSmoothly(dialog);
    });
  }

  els.dialogConfirm.addEventListener("close", () => {
    const val = els.dialogConfirm.returnValue;
    els.dialogConfirm.returnValue = "";
    if (val === "confirm" && typeof pendingConfirmAction === "function") {
      const fn = pendingConfirmAction;
      pendingConfirmAction = null;
      fn();
    } else {
      pendingConfirmAction = null;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Screen Wake Lock API                                                */
/* ------------------------------------------------------------------ */

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    els.wakelockIndicator.dataset.active = "false";
    els.wakelockText.textContent = "無常亮支援";
    return;
  }
  try {
    wakeLockSentinel = await navigator.wakeLock.request("screen");
    els.wakelockIndicator.dataset.active = "true";
    els.wakelockText.textContent = "螢幕常亮";
    wakeLockSentinel.addEventListener("release", () => {
      els.wakelockIndicator.dataset.active = "false";
    });
  } catch (_) {
    els.wakelockIndicator.dataset.active = "false";
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void requestWakeLock();
  }
});

/* ------------------------------------------------------------------ */
/* Event Listeners Wiring                                              */
/* ------------------------------------------------------------------ */

function startNewGame(mode) {
  gameState = createGame(mode);
  activeMult = "S";
  statsFilter = mode;
  saveActiveGame(gameState);
  if (currentTab !== "play") switchTab("play");
  renderAll({ popScore: true });
}

function requestModeOrRestart(targetMode) {
  const isMidGame =
    !getView(gameState).over &&
    (gameState.rounds.length > 0 || gameState.current.length > 0);

  if (!isMidGame) {
    startNewGame(targetMode);
    return;
  }

  els.confirmTitle.textContent =
    targetMode === gameState.mode
      ? `確定重開新的 ${targetMode} 對局？`
      : `切換至 ${targetMode} 並放棄目前對局？`;
  pendingConfirmAction = () => startNewGame(targetMode);
  els.dialogConfirm.showModal();
}

function switchTab(nextTab) {
  const apply = () => {
    currentTab = nextTab;
    const isStats = currentTab === "stats";
    els.viewPlay.hidden = isStats;
    els.viewStats.hidden = !isStats;
    els.btnToggleView.setAttribute("aria-pressed", String(isStats));
    els.toggleViewLabel.textContent = isStats ? "返回計分板" : "數據分析";
    if (isStats) renderStatsView();
  };

  if (document.startViewTransition) {
    document.startViewTransition(apply);
  } else {
    apply();
  }
}

function showSyncFeedback(msg, isError = false) {
  els.settingsSyncFeedback.hidden = false;
  els.settingsSyncFeedback.className = `sync-feedback-box ${
    isError ? "is-error" : "is-ok"
  }`;
  els.settingsSyncFeedback.textContent = msg;
}

function downloadFile(filename, content, mime = "text/csv;charset=utf-8;") {
  const blob = new Blob(["\uFEFF" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initEvents() {
  // Mode buttons
  for (const btn of els.modeBtns) {
    btn.addEventListener("click", () => {
      const m = btn.dataset.mode;
      if (m === gameState.mode && currentTab === "play") return;
      requestModeOrRestart(m);
    });
  }

  // Restart button
  els.btnNewGame.addEventListener("click", () => {
    requestModeOrRestart(gameState.mode);
  });

  // View toggle
  els.btnToggleView.addEventListener("click", () => {
    switchTab(currentTab === "play" ? "stats" : "play");
  });

  // Express buttons (SB, DB, M)
  for (const btn of els.expressBtns) {
    btn.addEventListener("click", () => {
      handleThrow(btn.dataset.dart);
    });
  }

  // Multiplier buttons (D / T toggle)
  const toggleMult = (m) => {
    activeMult = activeMult === m ? "S" : m;
    renderKeypad(getView(gameState));
  };
  els.btnMult2.addEventListener("click", () => toggleMult("D"));
  els.btnMult3.addEventListener("click", () => toggleMult("T"));

  // Cricket keypad compact/full toggle
  els.btnCricketPadMode.addEventListener("click", () => {
    const cur = getSettings().cricketKeypad;
    saveSettings({ cricketKeypad: cur === "compact" ? "full" : "compact" });
    renderKeypad(getView(gameState));
  });

  // Number grid delegation
  els.numberGrid.addEventListener("click", (e) => {
    const key = e.target.closest(".num-key");
    if (!key || key.disabled) return;
    handleThrow(key.dataset.dart);
  });

  // Confirm & Undo
  els.btnConfirmRound.addEventListener("click", handleConfirmRound);
  els.btnUndo.addEventListener("click", handleUndo);

  // Game Over Modal actions
  els.btnPlayAgain.addEventListener("click", async () => {
    await closeDialogSmoothly(els.dialogGameover);
    startNewGame(gameState.mode);
  });

  els.btnGameoverUndo.addEventListener("click", async () => {
    // Delete the just-recorded game from history before reopening the final round
    deleteGame(gameState.id);
    await closeDialogSmoothly(els.dialogGameover);
    handleUndo();
  });

  // Stats Filter buttons
  for (const btn of els.filterBtns) {
    btn.addEventListener("click", () => {
      statsFilter = btn.dataset.filter;
      renderStatsView();
    });
  }

  // Delete game row in history table
  els.historyTbody.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-delete-id]");
    if (!delBtn) return;
    const id = delBtn.dataset.deleteId;
    deleteGame(id);
    renderAll();
  });

  // Settings Modal
  els.btnOpenSettings.addEventListener("click", () => {
    const s = getSettings();
    els.inputGasUrl.value = s.gasUrl || "";
    els.inputPasscode.value = s.passcode || "";
    els.selectCricketPad.value = s.cricketKeypad || "compact";
    els.settingsSyncFeedback.hidden = true;
    els.dialogSettings.showModal();
  });

  els.btnCloseSettings.addEventListener("click", () => {
    void closeDialogSmoothly(els.dialogSettings);
  });

  els.btnSaveSettings.addEventListener("click", async () => {
    const gasUrl = els.inputGasUrl.value.trim();
    const passcode = els.inputPasscode.value.trim();
    const cricketKeypad = els.selectCricketPad.value;

    saveSettings({ gasUrl, passcode, cricketKeypad });
    renderKeypad(getView(gameState));

    if (!gasUrl) {
      showSyncFeedback("✓ 已儲存設定（目前使用純本機儲存模式）", false);
      return;
    }

    showSyncFeedback("⏳ 正在測試 Google Sheets 連線…", false);
    try {
      const res = await testGasConnection(gasUrl, passcode);
      await flushSyncQueue();
      showSyncFeedback(
        `✓ 連線成功！已連結試算表「${res.sheetName}」（雲端共 ${res.totalGames} 場紀錄）`,
        false
      );
    } catch (err) {
      showSyncFeedback(`✕ 連線失敗：${err.message || err}`, true);
    }
  });

  els.btnPushCloud.addEventListener("click", async () => {
    const gasUrl = els.inputGasUrl.value.trim();
    const passcode = els.inputPasscode.value.trim();
    saveSettings({ gasUrl, passcode });
    if (!gasUrl) {
      showSyncFeedback("請先填入 GAS Web App 網址", true);
      return;
    }
    showSyncFeedback("⏳ 正在將本機所有紀錄同步至 Google Sheets…", false);
    const res = await pushAllLocalToCloud();
    if (res.ok) {
      showSyncFeedback(
        `✓ 同步完成！新增上傳 ${res.uploaded} 場，略過已存在 ${res.skipped} 場（試算表共 ${res.totalGames} 場）`,
        false
      );
    } else {
      showSyncFeedback(`✕ 上傳失敗：${res.error || "請檢查網址或網路"}`, true);
    }
  });

  els.btnPullCloud.addEventListener("click", async () => {
    const gasUrl = els.inputGasUrl.value.trim();
    const passcode = els.inputPasscode.value.trim();
    saveSettings({ gasUrl, passcode });
    if (!gasUrl) {
      showSyncFeedback("請先填入 GAS Web App 網址", true);
      return;
    }
    showSyncFeedback("⏳ 正在從 Google Sheets 拉取歷史對局…", false);
    try {
      const res = await pullFromCloud(200);
      renderAll();
      showSyncFeedback(
        `✓ 拉取完成！合併新增 ${res.added} 場紀錄（本機目前共 ${res.totalLocal} 場）`,
        false
      );
    } catch (err) {
      showSyncFeedback(`✕ 拉取失敗：${err.message || err}`, true);
    }
  });

  // Sync status listener
  const updateSyncBadge = (st) => {
    els.btnOpenSettings.dataset.syncState = st.state;
    els.syncStatusText.textContent = st.label;
  };
  onSyncStateChange(updateSyncBadge);
  updateSyncBadge(getSyncStatus());

  window.addEventListener("online", () => {
    void flushSyncQueue();
  });
}

/* ------------------------------------------------------------------ */
/* Helpers & Bootstrap                                                 */
/* ------------------------------------------------------------------ */

function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) {
    return;
  }
  const isLocalhost =
    location.hostname === "127.0.0.1" || location.hostname === "localhost";
  if (isLocalhost) {
    // On localhost, unregister any old SW and purge caches so edits are always live
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const r of regs) r.unregister();
    });
    if ("caches" in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  });
}

setupDialogs();
initEvents();
renderAll();
void requestWakeLock();
void flushSyncQueue();
registerServiceWorker();


})();
