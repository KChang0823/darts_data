import test from "node:test";
import assert from "node:assert/strict";
import {
  MODES,
  parseDart,
  createGame,
  throwDart,
  confirmRound,
  undo,
  getView,
  summarize,
  checkoutRoute,
} from "../js/engine.js";

function playRounds(game, rounds) {
  let state = game;
  for (const darts of rounds) {
    for (const code of darts) {
      state = throwDart(state, code);
    }
    state = confirmRound(state);
  }
  return state;
}

test("parseDart parses S1..S20, D1..D20, T1..T20, SB, DB, M, X", () => {
  assert.deepEqual(parseDart("S1"), {
    code: "S1",
    segment: 1,
    multiplier: 1,
    points: 1,
    rawMarks: 0,
  });
  assert.deepEqual(parseDart("D14"), {
    code: "D14",
    segment: 14,
    multiplier: 2,
    points: 28,
    rawMarks: 0,
  });
  assert.deepEqual(parseDart("T15"), {
    code: "T15",
    segment: 15,
    multiplier: 3,
    points: 45,
    rawMarks: 3,
  });
  assert.deepEqual(parseDart("T20"), {
    code: "T20",
    segment: 20,
    multiplier: 3,
    points: 60,
    rawMarks: 3,
  });
  assert.deepEqual(parseDart("SB"), {
    code: "SB",
    segment: 25,
    multiplier: 1,
    points: 50,
    rawMarks: 1,
  });
  assert.deepEqual(parseDart("DB"), {
    code: "DB",
    segment: 25,
    multiplier: 2,
    points: 50,
    rawMarks: 2,
  });
  assert.deepEqual(parseDart("M"), {
    code: "M",
    segment: 0,
    multiplier: 0,
    points: 0,
    rawMarks: 0,
  });
  assert.throws(() => parseDart("S0"), /Invalid dart code/);
  assert.throws(() => parseDart("T21"), /Invalid dart code/);
});

test("Mode round limits match specification (301/501=10R, 701/Cricket=15R, Count-Up=8R)", () => {
  assert.equal(MODES["301"].maxRounds, 10);
  assert.equal(MODES["501"].maxRounds, 10);
  assert.equal(MODES["701"].maxRounds, 15);
  assert.equal(MODES["COUNT_UP"].maxRounds, 8);
  assert.equal(MODES["CRICKET"].maxRounds, 15);
});

test("Count-Up finishes after 8 rounds (24 darts) with Fat Bull 50/50 and tracks SB vs DB", () => {
  let game = createGame("COUNT_UP", { id: "cu-1" });
  game = playRounds(game, [
    ["SB", "DB", "SB"], // 150 (Hat Trick)
    ["DB", "DB", "DB"], // 150 (Three in the Black)
    ["T20", "T20", "T20"], // 180 (Ton 80)
    ["T20", "T20", "S20"], // 140 (Low Ton)
    ["T20", "T20", "T19"], // 177 (High Ton)
    ["S20", "S19", "S18"], // 57
    ["D10", "S5"], // early confirm -> 3rd dart auto-fills M (25)
    ["M", "M", "S1"], // 1
  ]);

  const view = getView(game);
  assert.equal(view.over, true);
  assert.equal(view.finished, true);

  const summary = summarize(game);
  assert.equal(summary.roundsPlayed, 8);
  assert.equal(summary.totalDarts, 24);
  assert.equal(summary.totalScore, 880);
  assert.equal(summary.sBullHits, 2);
  assert.equal(summary.dBullHits, 4);
  assert.equal(summary.ppd, 36.67);
  assert.equal(summary.ppr, 110);
  assert.deepEqual(summary.awards, {
    hatTrick: 1,
    threeInBlack: 1,
    ton80: 1,
    lowTon: 1,
    highTon: 1,
  });
});

test("301 / 501 bust resets round score, locks round, counts 3 darts in PPD, and supports early game shot", () => {
  let game = createGame("301", { id: "g-301" });
  // R1: 3x SB = 150 -> remain 151
  game = playRounds(game, [["SB", "SB", "SB"]]);
  assert.equal(getView(game).remaining, 151);

  // R2: T20 (60), T20 (60), DB (50) -> 170 > 151 -> BUST!
  game = throwDart(game, "T20");
  game = throwDart(game, "T20");
  game = throwDart(game, "DB");
  let view = getView(game);
  assert.equal(view.current.bust, true);
  assert.equal(view.locked, "bust");
  assert.equal(view.remaining, 151);
  game = confirmRound(game);

  // R3: Bust on 1st dart when remaining is 151? No, let's score 101 -> remain 50
  game = playRounds(game, [["SB", "S20", "S1"]]); // 71 -> remain 80
  assert.equal(getView(game).remaining, 80);

  // R4: Bust on 2nd dart: SB (50) + SB (50) = 100 > 80 -> BUST on 2nd dart, 3rd dart auto-filled as X
  game = throwDart(game, "SB");
  game = throwDart(game, "SB");
  view = getView(game);
  assert.equal(view.current.bust, true);
  assert.throws(() => throwDart(game, "S1"), /Round is locked/);
  game = confirmRound(game);
  assert.equal(getView(game).remaining, 80);

  // R5: Checkout in 2 darts: SB (50) + D15 (30) = 80 -> remain 0 (Game Shot on dart 2!)
  game = throwDart(game, "SB");
  game = throwDart(game, "D15");
  view = getView(game);
  assert.equal(view.current.gameShot, true);
  assert.equal(view.locked, "gameShot");
  game = confirmRound(game);

  const summary = summarize(game);
  assert.equal(summary.finished, true);
  assert.equal(summary.roundsPlayed, 5);
  // R1(3) + R2(3 bust) + R3(3) + R4(3 bust with X fill) + R5(2 gameShot) = 14 darts!
  assert.equal(summary.totalDarts, 14);
  assert.equal(summary.totalScore, 301);
  assert.equal(summary.remainScore, 0);
  assert.equal(summary.bustRounds, 2);
  assert.equal(summary.ppd, 21.5);
});

test("501 hitting 10-round limit without reaching 0 ends with finished = false", () => {
  let game = createGame("501", { id: "g-501-unfin" });
  for (let r = 0; r < 10; r++) {
    game = playRounds(game, [["S20", "S1", "M"]]); // 21 per round -> 210 total
  }
  const summary = summarize(game);
  assert.equal(summary.finished, false);
  assert.equal(summary.roundsPlayed, 10);
  assert.equal(summary.totalDarts, 30);
  assert.equal(summary.totalScore, 210);
  assert.equal(summary.remainScore, 291);
});

test("Cricket Mode B caps each target at 3 effective marks, tracks rawMarks overflow, and computes MPR = (effective / darts) * 3", () => {
  let game = createGame("CRICKET", { id: "crk-1" });
  // R1: T20, T19, T18 -> 9 effective marks (White Horse!)
  // R2: T17, T16, T15 -> 9 effective marks (White Horse!)
  // R3: S20 (already closed -> 0 effective, 1 raw), SB (1 eff, 1 raw), DB (2 eff, 2 raw) -> closes Bull on dart 3!
  game = playRounds(game, [
    ["T20", "T19", "T18"],
    ["T17", "T16", "T15"],
    ["S20", "SB", "DB"],
  ]);

  const summary = summarize(game);
  assert.equal(summary.finished, true);
  assert.equal(summary.roundsPlayed, 3);
  assert.equal(summary.totalDarts, 9);
  assert.equal(summary.effectiveMarks, 21);
  assert.equal(summary.rawMarks, 22);
  // MPR = (21 / 9) * 3 = 7.0
  assert.equal(summary.mpr, 7);
  assert.equal(summary.awards.whiteHorse, 2);
});

test("Cricket closing on 1st dart of final round counts exact darts and caps over-hit triple", () => {
  let game = createGame("CRICKET", { id: "crk-2" });
  game = playRounds(game, [
    ["T20", "T19", "T18"], // 9 eff
    ["T17", "T16", "D15"], // 8 eff (15 has 2 marks)
    ["DB", "SB", "M"], // 3 eff (Bull closed, 20 marks total)
  ]);
  // R4 dart 1: hit T15 when 15 already has 2 marks -> only 1 effective mark needed to reach 21, 3 raw marks
  game = throwDart(game, "T15");
  const view = getView(game);
  assert.equal(view.current.gameShot, true);
  game = confirmRound(game);

  const summary = summarize(game);
  assert.equal(summary.finished, true);
  assert.equal(summary.totalDarts, 10); // 3*3 + 1 = 10 darts
  assert.equal(summary.effectiveMarks, 21);
  assert.equal(summary.rawMarks, 23);
  // MPR = (21 / 10) * 3 = 6.3
  assert.equal(summary.mpr, 6.3);
});

test("Undo works within a round and across confirmed rounds (even after Game Over)", () => {
  let game = createGame("301", { id: "undo-test" });
  game = playRounds(game, [
    ["SB", "SB", "SB"], // 150
    ["SB", "SB", "SB"], // 150 -> remain 1
  ]);
  game = throwDart(game, "S1");
  game = confirmRound(game);
  assert.equal(getView(game).over, true);

  // Undo reopens round 3 with ["S1"]
  game = undo(game);
  assert.equal(getView(game).over, false);
  assert.deepEqual(game.current, ["S1"]);

  // Undo again removes "S1"
  game = undo(game);
  assert.deepEqual(game.current, []);

  // Undo again reopens round 2 with ["SB", "SB", "SB"]
  game = undo(game);
  assert.equal(game.rounds.length, 1);
  assert.deepEqual(game.current, ["SB", "SB", "SB"]);
});

test("Checkout route returns optimal Open-Out Fat-Bull finishes", () => {
  assert.deepEqual(checkoutRoute(50, 3), ["BULL"]);
  assert.deepEqual(checkoutRoute(100, 2), ["BULL", "BULL"]);
  assert.deepEqual(checkoutRoute(120, 3), ["BULL", "BULL", "S20"]);
  assert.equal(checkoutRoute(181, 3), null);
  assert.deepEqual(checkoutRoute(120, 2), ["T20", "T20"]);
});
