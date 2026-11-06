/**
 * Home Darts Arcade Tracker — Main UI Controller
 */

import {
  AWARDS,
  CRICKET_TARGETS,
  BULL,
  createGame,
  throwDart,
  confirmRound,
  undo,
  getView,
  summarize,
} from "./engine.js";

import {
  getSettings,
  saveSettings,
  loadActiveGame,
  saveActiveGame,
  getHistory,
  getSyncStatus,
  onSyncStateChange,
  recordFinishedGame,
  deleteGame,
  testGasConnection,
  flushSyncQueue,
  pullFromCloud,
  pushAllLocalToCloud,
  buildGamesCsv,
  buildDartsCsv,
} from "./storage.js";

import {
  computeQuickBanner,
  compareGameWithRecent,
  computeDashboardStats,
  renderTrendSvg,
} from "./stats.js";

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

