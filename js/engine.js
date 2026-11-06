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

export const DARTS_PER_ROUND = 3;
export const BULL = 25;
export const CRICKET_TARGETS = Object.freeze([20, 19, 18, 17, 16, 15, BULL]);

export const MODES = Object.freeze({
  301: Object.freeze({ kind: "x01", label: "301", start: 301, maxRounds: 10 }),
  501: Object.freeze({ kind: "x01", label: "501", start: 501, maxRounds: 10 }),
  701: Object.freeze({ kind: "x01", label: "701", start: 701, maxRounds: 15 }),
  COUNT_UP: Object.freeze({ kind: "countup", label: "Count-Up", maxRounds: 8 }),
  CRICKET: Object.freeze({ kind: "cricket", label: "Cricket", maxRounds: 15 }),
});

export const AWARDS = Object.freeze({
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
export function parseDart(code) {
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

export function createGame(mode, { id = newId(), now = new Date() } = {}) {
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

export function throwDart(state, code) {
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
export function confirmRound(state, { now = new Date() } = {}) {
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
export function undo(state) {
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
export function getView(state) {
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
export function summarize(state) {
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
export function checkoutRoute(remaining, dartsLeft = DARTS_PER_ROUND) {
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

export function round2(x) {
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

