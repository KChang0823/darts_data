import test from "node:test";
import assert from "node:assert/strict";
import {
  ratingFromPpr,
  ratingFromMpr,
  computeQuickBanner,
  compareGameWithRecent,
  computeDashboardStats,
  renderTrendSvg,
} from "../js/stats.js";
import { buildGamesCsv, buildDartsCsv } from "../js/storage.js";

test("DARTSLIVE Rating & Flight lookup matches official table", () => {
  assert.deepEqual(ratingFromPpr(35), { rating: 1, flight: "C" });
  assert.deepEqual(ratingFromPpr(60), { rating: 6, flight: "B" });
  assert.deepEqual(ratingFromPpr(80), { rating: 10, flight: "A" });
  assert.deepEqual(ratingFromPpr(132), { rating: 18, flight: "SA" });

  assert.deepEqual(ratingFromMpr(2.1), { rating: 6, flight: "B" });
  assert.deepEqual(ratingFromMpr(3.85), { rating: 14, flight: "AA" });
});

test("computeDashboardStats & CSV builders aggregate Dart 1/2/3, Bulls, and Awards", () => {
  const sampleHistory = [
    {
      gameId: "g-2",
      endedAt: "2026-11-06T20:00:00Z",
      mode: "501",
      maxRounds: 10,
      finished: true,
      roundsPlayed: 6,
      totalDarts: 18,
      totalScore: 501,
      remainScore: 0,
      ppd: 27.83,
      ppr: 83.5,
      mpr: null,
      effectiveMarks: null,
      rawMarks: null,
      sBullHits: 4,
      dBullHits: 2,
      bustRounds: 0,
      awards: { hatTrick: 1, lowTon: 2 },
      roundByRound: "R1:SB,DB,SB(150)",
      darts: [
        { round: 1, dartNo: 1, code: "SB", segment: 25, multiplier: 1, points: 50, isBustRound: false },
        { round: 1, dartNo: 2, code: "DB", segment: 25, multiplier: 2, points: 50, isBustRound: false },
        { round: 1, dartNo: 3, code: "M", segment: 0, multiplier: 0, points: 0, isBustRound: false },
      ],
    },
    {
      gameId: "g-1",
      endedAt: "2026-11-05T20:00:00Z",
      mode: "501",
      maxRounds: 10,
      finished: true,
      roundsPlayed: 8,
      totalDarts: 24,
      totalScore: 501,
      remainScore: 0,
      ppd: 20.88,
      ppr: 62.63,
      mpr: null,
      effectiveMarks: null,
      rawMarks: null,
      sBullHits: 3,
      dBullHits: 1,
      bustRounds: 1,
      awards: { lowTon: 1 },
      roundByRound: "R1:SB,S20,S20(90)",
      darts: [],
    },
  ];

  const banner = computeQuickBanner(sampleHistory, "501");
  assert.equal(banner.gamesCount, 2);
  assert.match(banner.primaryValue, /24\.35/);

  const cmp = compareGameWithRecent(sampleHistory[0], sampleHistory);
  assert.equal(cmp.isPb, true);
  assert.equal(cmp.delta, 6.95);

  const dash = computeDashboardStats(sampleHistory, "501");
  assert.equal(dash.gamesCount, 2);
  assert.equal(dash.totalBulls, 10);
  assert.equal(dash.dBullHits, 3);
  assert.equal(dash.awardsTotal.hatTrick, 1);
  assert.equal(dash.awardsTotal.lowTon, 3);
  assert.equal(dash.byDartNo[0].avgVal, 50);
  assert.equal(dash.byDartNo[1].avgVal, 35); // (50 from g-2 + 20 from g-1 roundByRound) / 2
  assert.equal(dash.byDartNo[2].missRate, 50); // 1 miss in g-2, 1 hit (S20) in g-1 roundByRound

  const svg = renderTrendSvg(dash.trendSeries, { avgLine: dash.last10Avg });
  assert.match(svg, /<svg/);

  const gamesCsv = buildGamesCsv(sampleHistory);
  const dartsCsv = buildDartsCsv(sampleHistory);
  assert.match(gamesCsv, /Game_ID,Timestamp,Mode/);
  assert.match(dartsCsv, /g-2,2026-11-06T20:00:00Z,501,1,1,SB/);
});
