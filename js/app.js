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
  { v: 500000, cls: "d500k" },
  { v: 100000, cls: "d100k" },
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

/* ---------- デバイスモード(スマホ/タブレット) ---------- */
function deviceMode() {
  try {
    const saved = localStorage.getItem("pgt_device");
    if (saved) return saved;
  } catch (e) { }
  return window.innerWidth < 700 ? "phone" : "tablet";
}
function applyDeviceMode(mode, save) {
  document.body.classList.toggle("mode-phone", mode === "phone");
  if (save) { try { localStorage.setItem("pgt_device", mode); } catch (e) { } }
  const bp = $("dev-phone"), bt = $("dev-tablet");
  if (bp) bp.classList.toggle("active", mode === "phone");
  if (bt) bt.classList.toggle("active", mode !== "phone");
  // ゲーム中なら座席を組み直す
  if (G) { buildSeats(); render(G); }
}

/* ---------- 座席DOM ---------- */
const seatCoords = [];
function buildSeats() {
  const table = $("table");
  table.querySelectorAll(".seat, .bet-spot, #dealer-disc").forEach(e => e.remove());
  const phone = document.body.classList.contains("mode-phone");
  const rx = phone ? 40 : 44;
  const ry = phone ? 44 : 42;
  for (let s = 0; s < CFG.SEATS; s++) {
    const el = document.createElement("div");
    el.className = "seat";
    el.id = "seat-" + s;
    // ヒーロー(seat0)が下中央
    const theta = Math.PI / 2 + s * 2 * Math.PI / CFG.SEATS;
    const x = 50 + rx * Math.cos(theta);
    const y = 50 + ry * Math.sin(theta);
    seatCoords[s] = { x, y, theta };
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.innerHTML = `
      <div class="seat-box">
        <div class="seat-name"></div>
        <div class="seat-stack"></div>
        <div class="seat-cards"></div>
        <div class="stack-gauge"><div class="sg-fill"></div></div>
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
  const phone = document.body.classList.contains("mode-phone");
  const rx = phone ? 40 : 44;
  const ry = phone ? 44 : 42;
  // ボタン席の少し中央寄り・反時計側にずらして置く
  const t = seatCoords[state.btn].theta - 0.30;
  const x = 50 + rx * 0.70 * Math.cos(t);
  const y = 50 + ry * 0.68 * Math.sin(t);
  disc.style.left = x + "%";
  disc.style.top = y + "%";
}

function cardHTML(c, small) {
  const r = cardRank(c) === 8 ? "10" : RANK_CHARS[cardRank(c)];
  const s = SUIT_SYMBOLS[cardSuit(c)];
  return `<div class="card s${cardSuit(c)}${small ? " small" : ""}">` +
    `<div class="c-idx">${r}<span>${s}</span></div>` +
    `<div class="c-pip">${s}</div></div>`;
}
function backHTML(small) { return `<div class="card back${small ? " small" : ""}"></div>`; }

// カードDOMは変化した時だけ差し替える(配牌アニメを変化時のみ再生するため)
function setCards(el, key, html) {
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = html;
}

/* ---------- レンダリング ---------- */
function render(state) {
  if (!state) return;
  const hero = state.players[0];
  $("game-info").innerHTML =
    `#${state.handNo}　Lv${LIVE.level + 1}: ${fmtChips(LIVE.sb)}/${fmtChips(LIVE.bb)}(A)　` +
    `<span class="${state.finalTable ? "ft-badge" : "field-badge"}">${state.finalTable ? "🔥FT " : ""}残り${state.fieldLeft}人</span>　` +
    `あなた: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`;

  const pot = potTotal(state);
  $("pot-disp").textContent = state.street === "idle" ? "" : `ポット: ${fmtChips(pot)} (${fmtBB(pot)}BB)`;
  $("pot-chips").innerHTML = state.street === "idle" ? "" : chipStackHTML(pot, false, 14);
  setCards($("board-cards"), state.board.join(","), state.board.map(c => cardHTML(c)).join(""));
  moveDealerDisc(state);

  for (let s = 0; s < CFG.SEATS; s++) {
    const p = state.players[s];
    const el = $("seat-" + s);
    if (p.out) {
      el.classList.add("out");
      el.classList.remove("folded", "actor", "hero");
      el.querySelector(".seat-name").innerHTML = `<span class="out-label">空席</span>`;
      el.querySelector(".seat-stack").innerHTML = "";
      setCards(el.querySelector(".seat-cards"), "none", "");
      el.querySelector(".sg-fill").style.width = "0%";
      const bo = $("bet-" + s);
      if (bo) bo.innerHTML = "";
      continue;
    }
    el.classList.remove("out");
    const pos = posNameOf(state, s);
    el.classList.toggle("folded", p.folded && state.street !== "idle");
    el.classList.toggle("hero", p.isHero);
    el.classList.toggle("actor", state.actorSeat === s && state.street !== "idle");
    const badgeCls = pos === "BTN" ? "pb-btn" : pos === "SB" ? "pb-sb" : pos === "BB" ? "pb-bb" : "";
    el.querySelector(".seat-name").innerHTML =
      `${p.name}<span class="pos-badge ${badgeCls}">${pos}</span>`;
    // スタックゲージ: BB量を色で表現(赤<10 / 黄10-20 / 緑20-35 / 青35+)
    const bb = toBB(p.chips);
    const sgCls = bb < 10 ? "sg-danger" : bb < 20 ? "sg-warn" : bb < 35 ? "sg-ok" : "sg-big";
    el.querySelector(".seat-stack").innerHTML =
      `${fmtChips(p.chips)} <span class="bb ${sgCls}-t">(${fmtBB(p.chips)}BB)</span>`;
    const fill = el.querySelector(".sg-fill");
    fill.className = "sg-fill " + sgCls;
    fill.style.width = Math.min(100, bb / 40 * 100) + "%";
    const cardsEl = el.querySelector(".seat-cards");
    if (state.street === "idle" || p.folded) setCards(cardsEl, "none", "");
    else if (p.isHero || p.showCards) setCards(cardsEl, "f" + p.cards.join(","), p.cards.map(c => cardHTML(c, !p.isHero)).join(""));
    else setCards(cardsEl, "back" + state.handNo, backHTML(true) + backHTML(true));
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
  sound: n => Sfx.play(n),
};

function autoAction(legal) {
  return legal.find(a => a.id === "check") || legal.find(a => a.id === "fold") || legal[0];
}

async function heroActUI(ctx, legal) {
  if (aborting) return autoAction(legal);
  // 先にGTOアドバイスを計算(MC含む)
  const advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  Sfx.play("turn");
  const act = await showActionButtons(legal);
  const grade = gradeDecision(ctx, advice, act.id);

  tally.decisions++;
  tally[grade.verdict]++;
  tally.evLost += grade.evLoss;
  if (!tally.perHand[G.handNo]) tally.perHand[G.handNo] = [];
  tally.perHand[G.handNo].push({ verdict: grade.verdict, evLoss: grade.evLoss, action: act.id, phase: ctx.phase });

  const mode = coachMode();
  const isOK = grade.verdict === "best" || grade.verdict === "mixed";
  Sfx.play(isOK ? "good" : "bad");
  if (mode !== "off") {
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
function fieldSizeSel() {
  const v = parseInt(($("field-size") || {}).value) || 27;
  try { localStorage.setItem("pgt_field", String(v)); } catch (e) { }
  return v;
}

async function startTournament() {
  simCancel = true; // 実行中のシミュレーションがあれば停止
  showScreen("screen-game");
  $("log-panel").innerHTML = "";
  $("coach-panel").classList.add("hidden");
  buildSeats();
  aborting = false;
  G = newTournament("あなた", fieldSizeSel());
  tally = newTally();
  const hero = G.players[0];
  logMsg(`${G.fieldSize}人トーナメント開始! あなたのスタック: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`, "info");
  render(G);

  while (!G.over && !aborting) {
    await playHand(G, gameIO);
  }
  if (!aborting) {
    finishTournament(G.won);
  } else {
    showScreen("screen-home");
    renderHomeStats();
  }
}

function tallySummaryHTML() {
  const okRate = tally.decisions > 0 ? ((tally.best + tally.mixed) / tally.decisions * 100) : 100;
  return `<p>判断数: <b>${tally.decisions}</b>　GTO一致率: <b>${okRate.toFixed(1)}%</b><br>
    内訳 — ✓GTO通り ${tally.best} / ✓混合 ${tally.mixed} / △僅差 ${tally.minor} / ✗ブランダー ${tally.blunder}<br>
    ミスによる累計EV損失: <b>${tally.evLost.toFixed(2)} BB</b></p>`;
}

function recordTournament(result, place) {
  const lastDecisions = tally.perHand[G.handNo] || [];
  const mistakeInFinal = lastDecisions.some(d => d.verdict === "blunder" || (d.verdict === "minor" && d.evLoss >= 0.5));
  const cause = result === "win" ? "win" : (mistakeInFinal ? "mistake" : "variance");
  const rec = loadRecord();
  rec.tournaments.push({
    hands: G.handNo,
    decisions: tally.decisions,
    best: tally.best, mixed: tally.mixed, minor: tally.minor, blunder: tally.blunder,
    evLost: Math.round(tally.evLost * 100) / 100,
    cause, result, place, field: G.fieldSize,
    date: new Date().toISOString().slice(0, 10),
  });
  saveRecord(rec);
  return cause;
}

function finishTournament(won) {
  if (won) {
    recordTournament("win", 1);
    showVictory();
    return;
  }
  Sfx.play("bust");
  const place = Math.max(2, G.fieldLeft);
  const cause = recordTournament("bust", place);

  $("bust-title").textContent = `バスト — ${G.fieldSize}人中 ${place}位 (${G.handNo}ハンド生存)`;
  const causeHTML = cause === "variance"
    ? `<div class="bust-cause variance">⚖ 最終ハンドの判断はGTO通りでした。これは<b>分散</b>です。<br>正しくプレイしても飛ぶときは飛ぶ — それがトーナメント。次も同じ判断をしてください。</div>`
    : `<div class="bust-cause mistake">⚠ 最終ハンドに<b>ミスが含まれて</b>いました。下のコーチ解説を振り返りましょう。</div>`;
  $("bust-body").innerHTML = `
    <div class="big-num">${place}位 / ${G.fieldSize}人</div>
    ${causeHTML}
    ${tallySummaryHTML()}
    <p style="color:var(--dim)">GTO通りに打っても5〜30BBの中盤戦は分散が非常に大きい領域です。シミュレーションで「GTOボットの生存分布」も見てみてください。</p>`;
  $("bust-modal").classList.remove("hidden");
}

/* ---------- 優勝演出 ---------- */
function showVictory() {
  Sfx.play("victory");
  // 紙吹雪を生成
  const layer = $("confetti-layer");
  layer.innerHTML = "";
  const colors = ["#e8c352", "#e05252", "#46c47c", "#4da3ff", "#c2569d", "#e67e22", "#fff"];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    const sz = 6 + Math.random() * 8;
    c.style.cssText =
      `left:${Math.random() * 100}%;` +
      `width:${sz}px;height:${sz * (0.4 + Math.random() * 0.8)}px;` +
      `background:${colors[i % colors.length]};` +
      `animation-delay:${Math.random() * 2.5}s;` +
      `animation-duration:${2.6 + Math.random() * 2.4}s;`;
    layer.appendChild(c);
  }
  $("victory-body").innerHTML = `
    <div class="victory-place">🏆 ${G.fieldSize}人トーナメント 優勝 🏆</div>
    <p class="victory-hands">${G.handNo}ハンドの激闘を制しました!</p>
    ${tallySummaryHTML()}`;
  $("victory-modal").classList.remove("hidden");
}

/* ---------- シミュレーション ---------- */
let simCancel = false;
async function runSim() {
  const n = parseInt($("sim-count").value);
  $("sim-run").disabled = true;
  $("sim-result").innerHTML = "";
  simCancel = false;
  const results = [];
  let simWins = 0;

  for (let i = 0; i < n && !simCancel; i++) {
    const st = newTournament("GTOボット", fieldSizeSel());
    st.fastMode = true;
    const simIO = {
      delay: () => Promise.resolve(),
      render: () => { },
      log: () => { },
      heroAct: (ctx, legal) => botAct(st, st.players[0], ctx, legal, simIO),
    };
    while (!st.over && st.handNo < 300 && !simCancel) {
      await playHand(st, simIO);
    }
    if (simCancel) break;
    if (st.won) simWins++;
    results.push(st.handNo >= 300 ? 300 : st.handNo);
    $("sim-progress").textContent = `実行中… ${i + 1} / ${n} トーナメント`;
    await new Promise(r => setTimeout(r, 0));
  }
  $("sim-progress").textContent = simCancel ? "中断しました" : `完了: ${n}トーナメント`;
  $("sim-run").disabled = false;
  if (results.length > 0 && !simCancel) renderSimResult(results, simWins);
}

function renderSimResult(results, simWins) {
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
      優勝: <b>🏆${simWins || 0}回 / ${results.length}回 (${(100 * (simWins || 0) / results.length).toFixed(0)}%)</b><br>
      平均生存: <b>${avg.toFixed(1)}ハンド</b>　中央値: <b>${med}ハンド</b><br>
      10ハンド以内にバスト: <b>${under10.toFixed(0)}%</b>　30ハンド以内: <b>${under30.toFixed(0)}%</b>
      ${survived > 0 ? `<br>300ハンド生存(打ち切り): <b>${survived}回</b>` : ""}
      <br><br>
      <span style="color:var(--dim)">完璧なGTOでも優勝はこの程度の確率、早く飛ぶことも多い — これが分散です。
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
  const wins = ts.filter(t => t.result === "win").length;
  const dec = ts.reduce((s, t) => s + t.decisions, 0);
  const ok = ts.reduce((s, t) => s + t.best + t.mixed, 0);
  $("home-stats").innerHTML =
    `挑戦 <b>${ts.length}回</b> ・ 優勝 <b>🏆${wins}回</b> ・ GTO一致率 <b>${dec ? (ok / dec * 100).toFixed(1) : "—"}%</b>`;
}

function renderStats() {
  const rec = loadRecord();
  const ts = rec.tournaments;
  if (ts.length === 0) {
    $("stats-body").innerHTML = "<p>まだ記録がありません。</p>";
    return;
  }
  const avgHands = ts.reduce((s, t) => s + t.hands, 0) / ts.length;
  const wins = ts.filter(t => t.result === "win").length;
  const dec = ts.reduce((s, t) => s + t.decisions, 0);
  const ok = ts.reduce((s, t) => s + t.best + t.mixed, 0);
  const blunders = ts.reduce((s, t) => s + t.blunder, 0);
  const evLost = ts.reduce((s, t) => s + t.evLost, 0);
  const busts = ts.filter(t => t.result !== "win");
  const varBusts = busts.filter(t => t.cause === "variance").length;

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
      <div class="stat-card"><div class="num">🏆${wins}</div><div class="lbl">優勝回数</div></div>
      <div class="stat-card"><div class="num">${avgHands.toFixed(1)}</div><div class="lbl">平均生存ハンド</div></div>
      <div class="stat-card"><div class="num">${dec ? (ok / dec * 100).toFixed(1) : "—"}%</div><div class="lbl">GTO一致率</div></div>
      <div class="stat-card"><div class="num">${blunders}</div><div class="lbl">ブランダー数</div></div>
      <div class="stat-card"><div class="num">${evLost.toFixed(1)}BB</div><div class="lbl">累計EV損失(推定)</div></div>
      <div class="stat-card"><div class="num">${busts.length ? (varBusts / busts.length * 100).toFixed(0) : "—"}%</div><div class="lbl">分散によるバスト率</div></div>
    </div>
    <h3>生存ハンド数の分布</h3>
    ${bars}
    <p style="margin-top:14px;color:var(--dim)">「分散によるバスト率」が高いほど、あなたは正しくプレイして運に負けただけです。
    GTO一致率を上げつつ、この比率が高い状態を維持するのが理想です。</p>`;
}

/* ---------- イベント登録 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  renderHomeStats();
  applyDeviceMode(deviceMode(), false);
  // ハンド強度テーブルをバックグラウンドで事前計算
  setTimeout(() => { try { getHandPower(); } catch (e) { } }, 400);

  $("dev-phone").onclick = () => applyDeviceMode("phone", true);
  $("dev-tablet").onclick = () => applyDeviceMode("tablet", true);
  try {
    const f = localStorage.getItem("pgt_field");
    if (f) $("field-size").value = f;
  } catch (e) { }
  $("btn-mute").textContent = Sfx.isMuted() ? "🔇" : "🔊";
  $("btn-mute").onclick = () => { $("btn-mute").textContent = Sfx.toggle() ? "🔇" : "🔊"; };

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
  $("victory-again").onclick = () => { $("victory-modal").classList.add("hidden"); startTournament(); };
  $("victory-home").onclick = () => {
    $("victory-modal").classList.add("hidden");
    renderHomeStats();
    showScreen("screen-home");
  };

  $("sim-run").onclick = () => runSim();
  $("sim-back").onclick = () => { simCancel = true; showScreen("screen-home"); };
  $("stats-back").onclick = () => showScreen("screen-home");
  $("stats-reset").onclick = () => {
    if (confirm("成績をすべて削除しますか?")) { localStorage.removeItem(REC_KEY); renderStats(); renderHomeStats(); }
  };
  $("help-back").onclick = () => showScreen("screen-home");
});
