/* =========================================================
 * app.js — UI制御・トーナメント進行・シミュレーション・成績
 * ========================================================= */
"use strict";

const $ = id => document.getElementById(id);

/* ---------- 画面遷移 ---------- */
const SCREENS = ["screen-home", "screen-game", "screen-sim", "screen-stats", "screen-help"];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle("hidden", s !== id);
}

/* ---------- 成績の永続化 ---------- */
const REC_KEY = "pgt_record_v1";
function loadRecord() {
  try { return JSON.parse(localStorage.getItem(REC_KEY)) || { tournaments: [] }; }
  catch (e) { return { tournaments: [] }; }
}
function saveRecord(rec) {
  try { localStorage.setItem(REC_KEY, JSON.stringify(rec)); } catch (e) { }
}

/* ---------- ゲーム状態 ---------- */
let G = null;            // 現在のトーナメント state
let aborting = false;
let tally = null;        // 今トーナメントの採点集計

function newTally() {
  return { decisions: 0, best: 0, mixed: 0, minor: 0, blunder: 0, evLost: 0, perHand: {} };
}

/* ---------- チップ描画 ----------
 * 額面: 25,000=紫 / 5,000=橙 / 1,000=黄 / 500=赤 / 100=白
 */
const CHIP_DENOMS = [
  { v: 25000, cls: "d25k" },
  { v: 5000, cls: "d5k" },
  { v: 1000, cls: "d1k" },
  { v: 500, cls: "d500" },
  { v: 100, cls: "d100" },
];
function chipBreakdown(amount, cap) {
  const chips = [];
  let rest = amount;
  for (const d of CHIP_DENOMS) {
    let n = Math.floor(rest / d.v);
    rest -= n * d.v;
    for (let i = 0; i < Math.min(n, 5); i++) chips.push(d.cls);
  }
  if (chips.length === 0 && amount > 0) chips.push("d100");
  return chips.slice(0, cap || 12);
}
function chipStackHTML(amount, mini, cap) {
  if (amount <= 0) return "";
  const chips = chipBreakdown(amount, cap || (mini ? 8 : 12));
  const step = mini ? 3 : 4;
  const base = mini ? 14 : 22;
  let h = `<div class="chip-stack${mini ? " mini" : ""}" style="height:${base + (chips.length - 1) * step}px">`;
  chips.forEach((cls, i) => { h += `<div class="chip ${cls}" style="bottom:${i * step}px"></div>`; });
  return h + `</div>`;
}

/* ---------- 座席DOM ---------- */
const seatCoords = [];
function buildSeats() {
  const table = $("table");
  table.querySelectorAll(".seat, .bet-spot, #dealer-disc").forEach(e => e.remove());
  for (let s = 0; s < CFG.SEATS; s++) {
    const el = document.createElement("div");
    el.className = "seat";
    el.id = "seat-" + s;
    // ヒーロー(seat0)が下中央
    const theta = Math.PI / 2 + s * 2 * Math.PI / CFG.SEATS;
    const x = 50 + 44 * Math.cos(theta);
    const y = 50 + 42 * Math.sin(theta);
    seatCoords[s] = { x, y, theta };
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.innerHTML = `
      <div class="seat-box">
        <div class="seat-pile"></div>
        <div class="seat-name"></div>
        <div class="seat-stack"></div>
        <div class="seat-cards"></div>
      </div>`;
    table.appendChild(el);
    // ベットチップ置き場(座席と中央の中間)
    const bet = document.createElement("div");
    bet.className = "bet-spot";
    bet.id = "bet-" + s;
    bet.style.left = (50 + (x - 50) * 0.56) + "%";
    bet.style.top = (50 + (y - 50) * 0.58) + "%";
    table.appendChild(bet);
  }
  // ディーラーボタン
  const disc = document.createElement("div");
  disc.id = "dealer-disc";
  disc.innerHTML = `<span>D</span>`;
  table.appendChild(disc);
}

function moveDealerDisc(state) {
  const disc = $("dealer-disc");
  if (!disc || !seatCoords[state.btn]) return;
  // ボタン席の少し中央寄り・反時計側にずらして置く
  const t = seatCoords[state.btn].theta - 0.30;
  const x = 50 + 44 * 0.70 * Math.cos(t);
  const y = 50 + 42 * 0.68 * Math.sin(t);
  disc.style.left = x + "%";
  disc.style.top = y + "%";
}

function cardHTML(c, small) {
  return `<div class="card s${cardSuit(c)}${small ? " small" : ""}">` +
    `<div>${RANK_CHARS[cardRank(c)]}</div><div class="suit">${SUIT_SYMBOLS[cardSuit(c)]}</div></div>`;
}
function backHTML(small) { return `<div class="card back${small ? " small" : ""}"></div>`; }

/* ---------- レンダリング ---------- */
function render(state) {
  if (!state) return;
  const hero = state.players[0];
  $("game-info").textContent =
    `ハンド #${state.handNo}　ブラインド 2,000/4,000(A4,000)　あなた: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`;

  const pot = potTotal(state);
  $("pot-disp").textContent = state.street === "idle" ? "" : `ポット: ${fmtChips(pot)} (${fmtBB(pot)}BB)`;
  $("pot-chips").innerHTML = state.street === "idle" ? "" : chipStackHTML(pot, false, 14);
  $("board-cards").innerHTML = state.board.map(c => cardHTML(c)).join("");
  moveDealerDisc(state);

  for (let s = 0; s < CFG.SEATS; s++) {
    const p = state.players[s];
    const el = $("seat-" + s);
    const pos = posNameOf(state, s);
    el.classList.toggle("folded", p.folded && state.street !== "idle");
    el.classList.toggle("hero", p.isHero);
    el.classList.toggle("actor", state.actorSeat === s && state.street !== "idle");
    const badgeCls = pos === "BTN" ? "pb-btn" : pos === "SB" ? "pb-sb" : pos === "BB" ? "pb-bb" : "";
    el.querySelector(".seat-name").innerHTML =
      `${p.name}<span class="pos-badge ${badgeCls}">${pos}</span>`;
    el.querySelector(".seat-stack").innerHTML =
      `${fmtChips(p.chips)} <span class="bb">(${fmtBB(p.chips)}BB)</span>`;
    el.querySelector(".seat-pile").innerHTML = chipStackHTML(p.chips, true);
    const cardsEl = el.querySelector(".seat-cards");
    if (state.street === "idle" || p.folded) cardsEl.innerHTML = "";
    else if (p.isHero || p.showCards) cardsEl.innerHTML = p.cards.map(c => cardHTML(c, !p.isHero)).join("");
    else cardsEl.innerHTML = backHTML(true) + backHTML(true);
    // ベットチップ(座席と中央の中間に表示)
    const betEl = $("bet-" + s);
    if (betEl) {
      betEl.innerHTML = (p.streetBet > 0 && state.street !== "idle")
        ? chipStackHTML(p.streetBet) + `<div class="bet-amt">${fmtChips(p.streetBet)}</div>`
        : "";
    }
  }
}

function logMsg(msg, cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  el.textContent = msg;
  $("log-panel").appendChild(el);
  $("log-panel").scrollTop = $("log-panel").scrollHeight;
}

/* ---------- IO(通常プレイ) ---------- */
function speedFactor() { return parseFloat($("game-speed").value) || 1; }
function coachMode() { return $("coach-mode").value; }

const gameIO = {
  delay: ms => new Promise(r => setTimeout(r, aborting ? 0 : ms * speedFactor())),
  render,
  log: logMsg,
  heroAct: heroActUI,
};

function autoAction(legal) {
  return legal.find(a => a.id === "check") || legal.find(a => a.id === "fold") || legal[0];
}

async function heroActUI(ctx, legal) {
  if (aborting) return autoAction(legal);
  // 先にGTOアドバイスを計算(MC含む)
  const advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  const act = await showActionButtons(legal);
  const grade = gradeDecision(ctx, advice, act.id);

  tally.decisions++;
  tally[grade.verdict]++;
  tally.evLost += grade.evLoss;
  if (!tally.perHand[G.handNo]) tally.perHand[G.handNo] = [];
  tally.perHand[G.handNo].push({ verdict: grade.verdict, evLoss: grade.evLoss, action: act.id, phase: ctx.phase });

  const mode = coachMode();
  if (mode !== "off") {
    const isOK = grade.verdict === "best" || grade.verdict === "mixed";
    if (isOK && mode !== "always") showToast(grade.verdict);
    else await showCoachPanel(grade, advice, ctx, act.id);
  }
  return act;
}

function showActionButtons(legal) {
  return new Promise(resolve => {
    const bar = $("action-bar");
    bar.innerHTML = "";
    bar.classList.remove("hidden");
    for (const a of legal) {
      const b = document.createElement("button");
      b.className = "act-" + a.id;
      b.textContent = a.label;
      b.onclick = () => { bar.classList.add("hidden"); resolve(a); };
      bar.appendChild(b);
    }
  });
}

let toastTimer = null;
function showToast(verdict) {
  const t = $("toast");
  const info = VERDICT_INFO[verdict];
  t.textContent = info.label;
  t.className = info.cls;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1100);
}

function showCoachPanel(grade, advice, ctx, chosenId) {
  return new Promise(resolve => {
    const info = VERDICT_INFO[grade.verdict];
    $("coach-verdict").textContent = info.label +
      (grade.evLoss > 0 ? `　(推定EV損失 ${grade.evLoss.toFixed(2)}BB)` : "");
    $("coach-verdict").className = info.cls;
    $("coach-body").innerHTML = grade.explanation;
    $("coach-panel").classList.remove("hidden");
    $("coach-continue").onclick = () => {
      $("coach-panel").classList.add("hidden");
      resolve();
    };
  });
}

/* ---------- トーナメント進行 ---------- */
async function startTournament() {
  showScreen("screen-game");
  $("log-panel").innerHTML = "";
  $("coach-panel").classList.add("hidden");
  buildSeats();
  aborting = false;
  G = newTournament("あなた");
  tally = newTally();
  const hero = G.players[0];
  logMsg(`トーナメント開始。あなたのスタック: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`, "info");
  render(G);

  while (!G.over && !aborting) {
    await playHand(G, gameIO);
  }
  if (!aborting) {
    finishTournament();
  } else {
    showScreen("screen-home");
    renderHomeStats();
  }
}

function finishTournament() {
  // 敗因分析: 最終ハンドにブランダー/大ミスがあったか
  const lastDecisions = tally.perHand[G.handNo] || [];
  const mistakeInFinal = lastDecisions.some(d => d.verdict === "blunder" || (d.verdict === "minor" && d.evLoss >= 0.5));
  const cause = mistakeInFinal ? "mistake" : "variance";

  const okRate = tally.decisions > 0 ? ((tally.best + tally.mixed) / tally.decisions * 100) : 100;
  const rec = loadRecord();
  rec.tournaments.push({
    hands: G.handNo,
    decisions: tally.decisions,
    best: tally.best, mixed: tally.mixed, minor: tally.minor, blunder: tally.blunder,
    evLost: Math.round(tally.evLost * 100) / 100,
    cause,
    date: new Date().toISOString().slice(0, 10),
  });
  saveRecord(rec);

  $("bust-title").textContent = `バスト — ${G.handNo}ハンド生存`;
  const causeHTML = cause === "variance"
    ? `<div class="bust-cause variance">⚖ 最終ハンドの判断はGTO通りでした。これは<b>分散</b>です。<br>正しくプレイしても飛ぶときは飛ぶ — それがトーナメント。次も同じ判断をしてください。</div>`
    : `<div class="bust-cause mistake">⚠ 最終ハンドに<b>ミスが含まれて</b>いました。下のコーチ解説を振り返りましょう。</div>`;
  $("bust-body").innerHTML = `
    <div class="big-num">${G.handNo} ハンド</div>
    ${causeHTML}
    <p>判断数: <b>${tally.decisions}</b>　GTO一致率: <b>${okRate.toFixed(1)}%</b><br>
    内訳 — ✓GTO通り ${tally.best} / ✓混合 ${tally.mixed} / △僅差 ${tally.minor} / ✗ブランダー ${tally.blunder}<br>
    ミスによる累計EV損失: <b>${tally.evLost.toFixed(2)} BB</b></p>
    <p style="color:var(--dim)">GTO通りに打っても5〜30BBの中盤戦は分散が非常に大きい領域です。シミュレーションで「GTOボットの生存分布」も見てみてください。</p>`;
  $("bust-modal").classList.remove("hidden");
}

/* ---------- シミュレーション ---------- */
async function runSim() {
  const n = parseInt($("sim-count").value);
  $("sim-run").disabled = true;
  $("sim-result").innerHTML = "";
  const results = [];

  for (let i = 0; i < n; i++) {
    const st = newTournament("GTOボット");
    st.fastMode = true;
    const heroP = st.players[0];
    const simIO = {
      delay: () => Promise.resolve(),
      render: () => { },
      log: () => { },
      heroAct: (ctx, legal) => botAct(st, st.players[0], ctx, legal, simIO),
    };
    while (!st.over && st.handNo < 300) {
      await playHand(st, simIO);
    }
    results.push(st.handNo >= 300 ? 300 : st.handNo);
    $("sim-progress").textContent = `実行中… ${i + 1} / ${n} トーナメント`;
    await new Promise(r => setTimeout(r, 0));
  }
  $("sim-progress").textContent = `完了: ${n}トーナメント`;
  $("sim-run").disabled = false;
  renderSimResult(results);
}

function renderSimResult(results) {
  const sorted = [...results].sort((a, b) => a - b);
  const avg = results.reduce((s, x) => s + x, 0) / results.length;
  const med = sorted[Math.floor(sorted.length / 2)];
  const under10 = results.filter(x => x <= 10).length / results.length * 100;
  const under30 = results.filter(x => x <= 30).length / results.length * 100;
  const survived = results.filter(x => x >= 300).length;

  // ヒストグラム(バケット幅: 自動)
  const max = Math.max(...results);
  const width = Math.max(10, Math.ceil(max / 100) * 10);
  const nb = Math.min(12, Math.ceil((max + 1) / width));
  const buckets = new Array(nb).fill(0);
  for (const x of results) buckets[Math.min(nb - 1, Math.floor(x / width))]++;
  const bmax = Math.max(...buckets);
  let bars = `<div class="histo">`;
  for (let i = 0; i < nb; i++) {
    const h = bmax > 0 ? (buckets[i] / bmax * 100) : 0;
    bars += `<div class="bar" style="height:${h}%"><div class="cnt">${buckets[i] || ""}</div></div>`;
  }
  bars += `</div><div class="histo-labels">`;
  for (let i = 0; i < nb; i++) bars += `<span>${i * width}〜</span>`;
  bars += `</div>`;

  $("sim-result").innerHTML = `
    <h3 style="margin-top:18px">GTOボットの生存ハンド数分布</h3>
    ${bars}
    <div class="sim-summary">
      平均生存: <b>${avg.toFixed(1)}ハンド</b>　中央値: <b>${med}ハンド</b><br>
      10ハンド以内にバスト: <b>${under10.toFixed(0)}%</b>　30ハンド以内: <b>${under30.toFixed(0)}%</b>
      ${survived > 0 ? `<br>300ハンド生存(打ち切り): <b>${survived}回</b>` : ""}
      <br><br>
      <span style="color:var(--dim)">完璧なGTOでもこれだけ早く飛ぶことがある — これが分散です。
      自分の成績がこの分布の範囲内なら、それはミスではなく運の問題です。</span>
    </div>`;
}

/* ---------- 成績画面 ---------- */
function renderHomeStats() {
  const rec = loadRecord();
  const ts = rec.tournaments;
  if (ts.length === 0) {
    $("home-stats").innerHTML = "まだ記録がありません。トーナメントに挑戦しましょう。";
    return;
  }
  const avgHands = ts.reduce((s, t) => s + t.hands, 0) / ts.length;
  const dec = ts.reduce((s, t) => s + t.decisions, 0);
  const ok = ts.reduce((s, t) => s + t.best + t.mixed, 0);
  $("home-stats").innerHTML =
    `挑戦 <b>${ts.length}回</b> ・ 平均生存 <b>${avgHands.toFixed(1)}ハンド</b> ・ GTO一致率 <b>${dec ? (ok / dec * 100).toFixed(1) : "—"}%</b>`;
}

function renderStats() {
  const rec = loadRecord();
  const ts = rec.tournaments;
  if (ts.length === 0) {
    $("stats-body").innerHTML = "<p>まだ記録がありません。</p>";
    return;
  }
  const avgHands = ts.reduce((s, t) => s + t.hands, 0) / ts.length;
  const best = Math.max(...ts.map(t => t.hands));
  const dec = ts.reduce((s, t) => s + t.decisions, 0);
  const ok = ts.reduce((s, t) => s + t.best + t.mixed, 0);
  const blunders = ts.reduce((s, t) => s + t.blunder, 0);
  const evLost = ts.reduce((s, t) => s + t.evLost, 0);
  const varBusts = ts.filter(t => t.cause === "variance").length;

  // 生存ヒストグラム
  const max = Math.max(...ts.map(t => t.hands));
  const width = Math.max(10, Math.ceil(max / 100) * 10);
  const nb = Math.min(12, Math.ceil((max + 1) / width));
  const buckets = new Array(nb).fill(0);
  for (const t of ts) buckets[Math.min(nb - 1, Math.floor(t.hands / width))]++;
  const bmax = Math.max(...buckets);
  let bars = `<div class="histo">`;
  for (let i = 0; i < nb; i++) {
    bars += `<div class="bar" style="height:${bmax ? buckets[i] / bmax * 100 : 0}%"><div class="cnt">${buckets[i] || ""}</div></div>`;
  }
  bars += `</div><div class="histo-labels">`;
  for (let i = 0; i < nb; i++) bars += `<span>${i * width}〜</span>`;
  bars += `</div>`;

  $("stats-body").innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${ts.length}</div><div class="lbl">挑戦回数</div></div>
      <div class="stat-card"><div class="num">${avgHands.toFixed(1)}</div><div class="lbl">平均生存ハンド</div></div>
      <div class="stat-card"><div class="num">${best}</div><div class="lbl">最長生存</div></div>
      <div class="stat-card"><div class="num">${dec ? (ok / dec * 100).toFixed(1) : "—"}%</div><div class="lbl">GTO一致率</div></div>
      <div class="stat-card"><div class="num">${blunders}</div><div class="lbl">ブランダー数</div></div>
      <div class="stat-card"><div class="num">${evLost.toFixed(1)}BB</div><div class="lbl">累計EV損失(推定)</div></div>
      <div class="stat-card"><div class="num">${(varBusts / ts.length * 100).toFixed(0)}%</div><div class="lbl">分散によるバスト率</div></div>
    </div>
    <h3>生存ハンド数の分布</h3>
    ${bars}
    <p style="margin-top:14px;color:var(--dim)">「分散によるバスト率」が高いほど、あなたは正しくプレイして運に負けただけです。
    GTO一致率を上げつつ、この比率が高い状態を維持するのが理想です。</p>`;
}

/* ---------- イベント登録 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  renderHomeStats();
  // ハンド強度テーブルをバックグラウンドで事前計算
  setTimeout(() => { try { getHandPower(); } catch (e) { } }, 400);

  $("btn-start").onclick = () => startTournament();
  $("btn-sim").onclick = () => { showScreen("screen-sim"); };
  $("btn-stats").onclick = () => { renderStats(); showScreen("screen-stats"); };
  $("btn-help").onclick = () => showScreen("screen-help");
  $("btn-quit").onclick = () => { aborting = true; };

  $("bust-again").onclick = () => { $("bust-modal").classList.add("hidden"); startTournament(); };
  $("bust-home").onclick = () => {
    $("bust-modal").classList.add("hidden");
    renderHomeStats();
    showScreen("screen-home");
  };

  $("sim-run").onclick = () => runSim();
  $("sim-back").onclick = () => showScreen("screen-home");
  $("stats-back").onclick = () => showScreen("screen-home");
  $("stats-reset").onclick = () => {
    if (confirm("成績をすべて削除しますか?")) { localStorage.removeItem(REC_KEY); renderStats(); renderHomeStats(); }
  };
  $("help-back").onclick = () => showScreen("screen-home");
});
