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

import { AWARDS, round2 } from "./engine.js";

/**
 * DARTSLIVE Official Rating & Flight Thresholds (from 規則＆術語.md)
 * Note: The 01 threshold in DARTSLIVE's table (40.0 ~ 130.0) corresponds to 3-dart average (PPR = PPD * 3).
 */
export const RATING_TABLE = Object.freeze([
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

export function ratingFromPpr(ppr) {
  if (ppr === null || ppr === undefined || Number.isNaN(ppr)) return null;
  for (const row of RATING_TABLE) {
    if (ppr >= row.ppr) return { rating: row.rating, flight: row.flight };
  }
  return { rating: 1, flight: "C" };
}

export function ratingFromMpr(mpr) {
  if (mpr === null || mpr === undefined || Number.isNaN(mpr)) return null;
  for (const row of RATING_TABLE) {
    if (mpr >= row.mpr) return { rating: row.rating, flight: row.flight };
  }
  return { rating: 1, flight: "C" };
}

export function flightFromRating(rating) {
  const r = Math.max(1, Math.min(18, Math.floor(rating || 1)));
  return RATING_TABLE.find((x) => x.rating === r)?.flight || "C";
}

/**
 * Filter history by mode selector:
 * - "ALL_01": 301 + 501 + 701
 * - "301" | "501" | "701" | "COUNT_UP" | "CRICKET"
 */
export function filterGames(history, filterMode) {
  if (!Array.isArray(history)) return [];
  if (filterMode === "ALL_01") {
    return history.filter((g) => g.mode === "301" || g.mode === "501" || g.mode === "701");
  }
  return history.filter((g) => g.mode === filterMode);
}

/**
 * Compute top-bar quick summary for the currently active game mode.
 */
export function computeQuickBanner(history, mode) {
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
export function compareGameWithRecent(summary, allHistory) {
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
export function computeDashboardStats(history, filterMode = "501") {
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

    if (Array.isArray(g.darts)) {
      for (const d of g.darts) {
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
export function renderTrendSvg(series, { unit = "", avgLine = null } = {}) {
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

