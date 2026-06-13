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

/* ---------- 先回りアクション(手番前の予約) ---------- */
let heroPre = null;       // {id:"fold"|"jam"|"raise"|"raiseTo", target?} 予約中のアクション
let heroPreBet = 0;       // 予約時点の「場の最大ベット額(チップ)」。変化したら予約取消
function clearHeroPre() { heroPre = null; if (G) renderPreBar(G); }
function curMaxStreetBet(state) {
  let m = 0;
  for (const p of state.players) if (!p.out && p.streetBet > m) m = p.streetBet;
  return m;
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
];
function chipBreakdown(amount, cap) {
  const chips = [];
  let rest = amount;
  for (const d of CHIP_DENOMS) {
    let n = Math.floor(rest / d.v);
    rest -= n * d.v;
    for (let i = 0; i < Math.min(n, 5); i++) chips.push(d.cls);
  }
  if (chips.length === 0 && amount > 0) chips.push("d1k");
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

// 横並びのチップ列(ベット用 — 縦に伸びないのでカードに被らない)
function chipRowHTML(amount, cap) {
  if (amount <= 0) return "";
  const chips = chipBreakdown(amount, cap || 6);
  const w = 24 + (chips.length - 1) * 9;
  let h = `<div class="chip-row" style="width:${w}px">`;
  chips.forEach((cls, i) => { h += `<div class="chip ${cls}" style="left:${i * 9}px"></div>`; });
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
        <div class="seat-act hidden"></div>
      </div>`;
    table.appendChild(el);
    // ベットチップ置き場: 座席ボックスのすぐ内側(中央方向に固定ピクセルで配置)
    const bet = document.createElement("div");
    bet.className = "bet-spot";
    bet.id = "bet-" + s;
    const tr = table.getBoundingClientRect();
    const sx = x / 100 * tr.width, sy = y / 100 * tr.height;
    const dx = tr.width / 2 - sx, dy = tr.height / 2 - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // 座席ボックスは横長なので方向に応じたクリアランス+余白
    // 自席(s=0)はカードが大きく箱が縦長なので、縦クリアランスを大きく取る
    // 下半分の席は中央へ向かう=上方向なので、自分の箱(名前行)に被らないよう多めに取る
    const lower = y > 52;
    const clearY = s === 0 ? (phone ? 112 : 124)
      : lower ? (phone ? 92 : 108)
      : (phone ? 44 : 56);
    const clear = Math.abs(ux) * (phone ? 52 : 68) + Math.abs(uy) * clearY + 16;
    let bx = sx + ux * clear;
    let by = sy + uy * clear;
    // ボード帯域(中央のカード・ポット領域)に入る場合は上下に退避
    // 帯域幅は実際のカード5枚分(+ポット文字余裕)から計算
    const cardW = phone ? 40 : 48;
    const bandHalfW = (5 * cardW + 24) / 2 + 26;
    const bandX0 = tr.width / 2 - bandHalfW, bandX1 = tr.width / 2 + bandHalfW;
    // ボードエリアは上端28%固定・コンテンツ約170px(ポット文字+カード+チップ)
    const bandY0 = tr.height * 0.28, bandY1 = tr.height * 0.28 + 175;
    if (s !== 0 && bx > bandX0 && bx < bandX1 && by > bandY0 - 20 && by < bandY1) {
      if (Math.abs(sx - tr.width / 2) > tr.width * 0.18) {
        // サイドの席: 横に逃がす(上に逃がすと自席の箱と重なって隠れるため)
        bx = sx > tr.width / 2 ? bandX1 + 18 : bandX0 - 18;
      } else {
        // 上下中央の席: 縦に逃がす
        by = (y < 50) ? bandY0 - 38 : bandY1 + 26;
      }
    }
    bet.style.left = bx + "px";
    bet.style.top = by + "px";
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
  // ボタン席の少し内側・反時計側(ボードに被らない距離)に置く
  const t = seatCoords[state.btn].theta - 0.30;
  const x = 50 + rx * 0.82 * Math.cos(t);
  const y = 50 + ry * 0.80 * Math.sin(t);
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
    `#${state.handNo}　` +
    `<span class="${state.finalTable ? "ft-badge" : "field-badge"}">${state.finalTable ? "🔥FT " : ""}残り${state.fieldLeft}人</span>　` +
    `あなた: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`;
  // FTはテーブルの色が変わる
  $("table").classList.toggle("ft", !!state.finalTable);

  const pot = potTotal(state);
  $("pot-disp").textContent = state.street === "idle" ? "" : `ポット: ${fmtChips(pot)} (${fmtBB(pot)}BB)`;
  $("pot-chips").innerHTML = state.street === "idle" ? "" : chipStackHTML(pot, false, 8);
  // プリフロップ: ポットはテーブルの真ん中(左上の席のチップと誤認しない位置)。
  // フロップが開いたら定位置(ボード上)へスライド。
  const potRow = document.querySelector(".pot-row");
  if (potRow) {
    const tbl = $("table");
    const dy = (state.board.length === 0 && state.street !== "idle") ? Math.round(tbl.clientHeight * 0.22) : 0;
    const tf = dy ? `translateY(${dy}px)` : "";
    if (potRow.style.transform !== tf) potRow.style.transform = tf;
  }
  setCards($("board-cards"), state.board.join(","), state.board.map(c => cardHTML(c)).join(""));
  moveDealerDisc(state);
  checkAARun(state);
  renderPreBar(state);
  // 右下の大型ブラインド表示(コーチパネル表示中は隠す)
  const bc = $("blind-corner");
  if (bc) {
    const coachOpen = !$("coach-panel").classList.contains("hidden");
    bc.classList.toggle("hidden", coachOpen);
    const txt = `LV ${LIVE.level + 1}|${fmtChips(LIVE.sb)} / ${fmtChips(LIVE.bb)}`;
    if (bc.dataset.t !== txt) {
      bc.dataset.t = txt;
      bc.innerHTML = `<div class="bc-lv">LV ${LIVE.level + 1}</div><div class="bc-blinds">${fmtChips(LIVE.sb)}<span>/</span>${fmtChips(LIVE.bb)}</div><div class="bc-ante">ANTE ${fmtChips(LIVE.ante)}</div>`;
    }
  }

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
    // 自分の席はフォールド後も読めるように重い減光をかけない(カードのみ薄くする)
    el.classList.toggle("folded", p.folded && state.street !== "idle" && !p.isHero);
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
    const heroFolded = p.isHero && p.folded && state.street !== "idle";
    if (state.street === "idle") { setCards(cardsEl, "none", ""); cardsEl.classList.remove("folded-cards"); }
    else if (heroFolded) {
      // 自分はフォールド後もハンド終了まで手札を薄く表示
      setCards(cardsEl, "hf" + p.cards.join(","), p.cards.map(c => cardHTML(c)).join(""));
      cardsEl.classList.add("folded-cards");
    }
    else if (p.folded) { setCards(cardsEl, "none", ""); cardsEl.classList.remove("folded-cards"); }
    else {
      cardsEl.classList.remove("folded-cards");
      if (p.isHero || p.showCards) setCards(cardsEl, "f" + p.cards.join(","), p.cards.map(c => cardHTML(c, !p.isHero)).join(""));
      else setCards(cardsEl, "back" + state.handNo, backHTML(true) + backHTML(true));
    }
    // アクションのドット文字バッジ(RAISE+FOLDの重ね表示、3BET/4BET/5BETは色分け)
    const actEl = el.querySelector(".seat-act");
    const tags = [];
    if (p.tagAgg) tags.push(p.tagAgg);
    if (p.tagPass) tags.push(p.tagPass);
    // 攻撃アクションには投入額を併記(RAISE/3BET/BET/ALL IN等。いくら入れたか一目で)
    const aggAmt = (p.tagAgg && p.streetBet > 0) ? p.streetBet : 0;
    if (tags.length && state.street !== "idle") {
      const key = tags.join("|") + "|" + aggAmt;
      if (actEl.dataset.k !== key) {
        actEl.dataset.k = key;
        actEl.className = "seat-act";
        actEl.innerHTML = tags.map(t => {
          const cls = t === "FOLD" ? "sa-fold" : t === "CHECK" ? "sa-check" : t === "CALL" ? "sa-call"
            : t === "ALL IN" ? "sa-allin" : t === "3BET" ? "sa-3bet" : t === "4BET" ? "sa-4bet"
            : /BET$/.test(t) && /^[5-9]/.test(t) ? "sa-5bet" : "sa-raise";
          const amt = (t === p.tagAgg && aggAmt) ? `<span class="sa-amt">${fmtChips(aggAmt)}</span>` : "";
          return `<div class="sa-tag ${cls}">${t}${amt}</div>`;
        }).join("");
      }
    } else if (actEl.dataset.k !== "") {
      actEl.dataset.k = "";
      actEl.className = "seat-act hidden";
      actEl.innerHTML = "";
    }
    // ベットチップ(座席と中央の中間に表示)。フォールドした人のチップは消す(混乱防止)
    const betEl = $("bet-" + s);
    if (betEl) {
      if (p.streetBet > 0 && !p.folded && state.street !== "idle") {
        // 攻撃バッジ側に金額を出している席は、チップ脇の数字を消して重複を防ぐ(CO等)
        const dupOnBadge = p.tagAgg && aggAmt;
        // ブラインド投稿は「SB/BB+額」のドット字で何の額か分かるように(BB4,000等)
        const lbl = (pos === "BB" || pos === "SB") ? pos + fmtChips(p.streetBet) : fmtChips(p.streetBet);
        betEl.innerHTML = chipRowHTML(p.streetBet, 6) + (dupOnBadge ? "" : `<div class="bet-amt">${lbl}</div>`);
      } else {
        betEl.innerHTML = "";
      }
    }
  }
}

function logMsg(msg, cls) {
  const el = document.createElement("div");
  if (cls) el.className = cls;
  el.textContent = msg;
  $("log-panel").appendChild(el);
  $("log-panel").scrollTop = $("log-panel").scrollHeight;
  // ブラインドアップ → KIMが旗を持って走る
  if (cls === "levelup" && msg.includes("ブラインドアップ") && typeof Mascot !== "undefined") {
    Mascot.run({ flagText: "BLIND UP!" });
  }
  // バブル(残り10人) → バニーガールが BUBBLE 看板で歩く
  if (cls === "levelup" && msg.includes("バブル!") && typeof Mascot !== "undefined") {
    Mascot.bunnyWalk(["BUBBLE", "あと1人で入賞!"]);
  }
  // ファイナルテーブル → バニーガールが FINAL TABLE 看板で歩く
  else if (cls === "levelup" && msg.includes("ファイナルテーブル!") && typeof Mascot !== "undefined") {
    Mascot.bunnyWalk(["FINAL TABLE", "IN THE MONEY"]);
  }
}

// AAが配られたらKIMが走り抜ける(ハンドごとに1回)
let lastAARun = 0;
function checkAARun(state) {
  if (typeof Mascot === "undefined" || !state || state.street !== "preflop") return;
  const hero = state.players[0];
  if (hero.out || hero.folded || !hero.cards || hero.cards.length < 2) return;
  if (state.handNo === lastAARun) return;
  if (handLabelOf(hero.cards[0], hero.cards[1]) === "AA") {
    lastAARun = state.handNo;
    Mascot.run({ callout: "AA!! 最強のハンド!" });
    Sfx.play("win");
  }
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

// 補助トースト(短い通知)
let toast2Timer = null;
function showToast2(msg) {
  const t = $("toast");
  t.textContent = msg; t.className = "v-minor";
  t.classList.remove("hidden");
  clearTimeout(toast2Timer);
  toast2Timer = setTimeout(() => t.classList.add("hidden"), 1400);
}

// 先回りアクションの予約バー(自分の手番が来る前に表示)
function renderPreBar(state) {
  const bar = $("prebar");
  if (!bar) return;
  const hero = state.players[0];
  const heroTurn = state.actorSeat === 0;
  const canShow = state && state.street !== "idle" && state.street !== "showdown" &&
    !hero.out && !hero.folded && !hero.allIn && !heroTurn &&
    $("action-bar").classList.contains("hidden");
  if (!canShow) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const sel = heroPre ? heroPre.id : null;
  const heroBB = (hero.chips / LIVE.bb).toFixed(1);
  bar.innerHTML =
    `<div class="prebar-label">⏩ 先に予約(手番が来たら自動実行)</div>` +
    `<div class="prebar-row">` +
    `<button class="pre-fold${sel === 'fold' ? ' on' : ''}" data-pre="fold">フォールド</button>` +
    `<button class="pre-raise${sel === 'raise' ? ' on' : ''}" data-pre="raise">レイズ</button>` +
    `<button class="pre-jam${sel === 'jam' ? ' on' : ''}" data-pre="jam">オールイン (${heroBB}BB)</button>` +
    `<button class="pre-sizer${sel === 'raiseTo' ? ' on' : ''}" data-pre="raiseTo">🎚 レイズ額指定</button>` +
    `</div>` +
    (sel === "raiseTo" ? `<div class="prebar-sizer">
        <input type="range" id="pre-range" min="${2 * LIVE.bb}" max="${hero.chips}" step="1000" value="${heroPre.target || 3 * LIVE.bb}">
        <span id="pre-val"></span></div>` : "") +
    (sel ? `<div class="prebar-status">予約中: <b>${preLabel(sel)}</b>(取り消すにはもう一度押す)</div>` : "");

  bar.querySelectorAll("button[data-pre]").forEach(b => {
    b.onclick = () => {
      const id = b.dataset.pre;
      if (heroPre && heroPre.id === id) { heroPre = null; }   // 同じボタン=取消
      else {
        heroPre = { id };
        if (id === "raiseTo") heroPre.target = 3 * LIVE.bb;
        heroPreBet = curMaxStreetBet(state);
      }
      Sfx.play("chip");
      renderPreBar(state);
    };
  });
  const range = bar.querySelector("#pre-range");
  if (range) {
    const upd = () => { bar.querySelector("#pre-val").textContent = `${fmtChips(+range.value)} (${(range.value / LIVE.bb).toFixed(1)}BB)`; heroPre.target = +range.value; };
    upd(); range.oninput = upd;
  }
}
function preLabel(id) {
  return { fold: "フォールド", raise: "レイズ", jam: "オールイン", raiseTo: "レイズ額指定" }[id] || id;
}

// 予約アクションを現在の合法手にマッピング
function mapPre(pre, legal) {
  const has = id => legal.find(a => a.id === id);
  if (pre.id === "fold") return has("fold") || has("check") || autoAction(legal);
  if (pre.id === "jam") return has("jam") || has("call") || has("check") || autoAction(legal);
  if (pre.id === "raise") {
    if (has("raise")) return has("raise");
    const rt = has("raiseTo");
    if (rt) { const t = rt.minTarget; return { id: "raiseTo", target: t, minTarget: rt.minTarget, maxTarget: rt.maxTarget, label: `レイズ ${fmtChips(t)}` }; }
    return has("jam") || autoAction(legal);
  }
  if (pre.id === "raiseTo") {
    const rt = has("raiseTo");
    if (rt) { const t = Math.max(rt.minTarget, Math.min(rt.maxTarget, pre.target)); return { id: "raiseTo", target: t, minTarget: rt.minTarget, maxTarget: rt.maxTarget, label: `レイズ ${fmtChips(t)}` }; }
    return has("jam") || autoAction(legal);
  }
  return null;
}

async function heroActUI(ctx, legal) {
  if (aborting) return autoAction(legal);

  // ① 予約アクションの消化
  if (heroPre) {
    const pre = heroPre;
    const changed = curMaxStreetBet(G) !== heroPreBet; // 予約後に誰かがレイズ/3ベットしたか
    heroPre = null; renderPreBar(G);
    // フォールドは常に有効。それ以外は状況が変わっていなければ実行
    if (pre.id === "fold" || !changed) {
      const act = mapPre(pre, legal);
      if (act) return await finalizeHeroAct(ctx, act, true);
    }
    // 状況が変わった → 予約取消、通常の手番で再提示(額は自動で最新に)
    showToast2("状況が変わったため予約を解除しました");
  }

  // ② 通常の手番
  Sfx.play("turn");
  const act = await showActionButtons(legal);
  return await finalizeHeroAct(ctx, act, false);
}

// アクション確定後の共通処理(採点・記録・コーチ表示)。fast=予約消化による即時実行
async function finalizeHeroAct(ctx, act, fast) {
  const advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  const grade = gradeDecision(ctx, advice, gradeIdFor(act, ctx), act);

  tally.decisions++;
  tally[grade.verdict]++;
  tally.evLost += grade.evLoss;
  if (!tally.perHand[G.handNo]) tally.perHand[G.handNo] = [];
  tally.perHand[G.handNo].push({ verdict: grade.verdict, evLoss: grade.evLoss, action: act.id, phase: ctx.phase });
  window.__lastReport = buildReport(ctx, advice, act, grade);

  const mode = coachMode();
  const isOK = grade.verdict === "best" || grade.verdict === "mixed" || grade.verdict === "caution";
  Sfx.play(isOK ? "good" : "bad");
  if (mode !== "off") {
    // 予約実行(fast)かつOK判定なら、止めずにトーストのみで最速進行。ミスは予約でも必ず止めて教える
    if (isOK && (mode !== "always" || fast)) showToast(grade.verdict);
    else await showCoachPanel(grade, advice, ctx, act.id);
  }
  return act;
}

function showActionButtons(legal) {
  return new Promise(resolve => {
    const bar = $("action-bar");
    bar.innerHTML = "";
    bar.classList.remove("hidden");
    const big = $("sizer-big");
    const done = a => { bar.classList.add("hidden"); big.classList.add("hidden"); resolve(a); };
    const raiseTo = legal.find(a => a.id === "raiseTo");

    const btnRow = document.createElement("div");
    btnRow.className = "act-row";
    for (const a of legal) {
      if (a.id === "raiseTo") continue;
      const b = document.createElement("button");
      b.className = "act-" + a.id;
      b.textContent = a.label;
      b.onclick = () => done(a);
      btnRow.appendChild(b);
    }
    // レイズ額指定(スライダー)トグル
    if (raiseTo) {
      const tg = document.createElement("button");
      tg.className = "act-sizer";
      tg.textContent = "🎚 " + raiseTo.label;
      btnRow.appendChild(tg);

      const panel = document.createElement("div");
      panel.className = "sizer-panel hidden";
      const min = raiseTo.minTarget, max = raiseTo.maxTarget;
      const init = Math.min(max, Math.max(min, Math.round((min * 2) / 1000) * 1000));
      panel.innerHTML = `
        <input type="range" id="sizer-range" min="${min}" max="${max}" step="1000" value="${init}">
        <div class="sizer-row">
          <button id="sizer-min" class="sizer-mini">最小</button>
          <span id="sizer-val"></span>
          <button id="sizer-semi" class="sizer-mini">1,000残し</button>
          <button id="sizer-ok" class="primary">確定</button>
        </div>`;
      bar.appendChild(btnRow);
      bar.appendChild(panel);
      const range = panel.querySelector("#sizer-range");
      const val = panel.querySelector("#sizer-val");
      const confirmRaise = () => {
        const target = parseInt(range.value);
        done({ id: "raiseTo", target, minTarget: min, maxTarget: max, label: `レイズ ${fmtChips(target)}` });
      };
      // 画面中央の巨大表示の直下に「決定」ボタン(スクロール不要で確定できる)
      let bigOk = $("sizer-big-ok");
      if (!bigOk) {
        bigOk = document.createElement("button");
        bigOk.id = "sizer-big-ok";
        big.appendChild(bigOk);
      }
      bigOk.textContent = "▼ 決 定 ▼";
      bigOk.onclick = confirmRaise;
      const update = () => {
        const v = parseInt(range.value);
        const isAllin = v >= max;
        val.textContent = `${fmtChips(v)} (${(v / LIVE.bb).toFixed(1)}BB)` + (isAllin ? " = オールイン" : "");
        // 画面中央のドット文字巨大表示
        if (!panel.classList.contains("hidden")) {
          big.classList.remove("hidden");
          $("sizer-big-amt").textContent = fmtChips(v);
          $("sizer-big-bb").textContent = `${(v / LIVE.bb).toFixed(1)} BB` + (isAllin ? "  ALL IN!" : "");
          big.classList.toggle("sb-allin", isAllin);
        }
      };
      update();
      range.oninput = update;
      tg.onclick = () => {
        panel.classList.toggle("hidden");
        if (panel.classList.contains("hidden")) big.classList.add("hidden");
        else update();
        Sfx.play("chip");
      };
      panel.querySelector("#sizer-min").onclick = () => { range.value = min; update(); };
      panel.querySelector("#sizer-semi").onclick = () => { range.value = Math.max(min, max - 1000); update(); };
      panel.querySelector("#sizer-ok").onclick = confirmRaise;
      return;
    }
    bar.appendChild(btnRow);
  });
}

// スライダー指定額を採点用の抽象アクションに変換
function gradeIdFor(act, ctx) {
  if (act.id !== "raiseTo") return act.id;
  if (act.target >= act.maxTarget - LIVE.bb) return "jam"; // 1,000残しセミオールイン等はジャム扱い
  if (ctx.phase === "preflop") return "raise";
  const potChips = ctx.potBB * LIVE.bb;
  return act.target <= potChips * 0.45 ? "bet33" : "bet66";
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

/* 判定報告用の完全スナップショット(貼り付けるだけで局面を再現できる) */
function buildReport(ctx, advice, act, grade) {
  const d = advice.data || {};
  const r2 = x => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
  return {
    app: "トナメ中盤戦、、ここでGTO!!",
    time: new Date().toISOString(),
    hand: G ? G.handNo : null,
    blinds: { sb: LIVE.sb, bb: LIVE.bb, ante: LIVE.ante, level: LIVE.level + 1 },
    fieldLeft: G ? G.fieldLeft : null,
    finalTable: G ? !!G.finalTable : null,
    street: ctx.street || "preflop",
    hero: {
      pos: ctx.seatName, hand: ctx.heroLabel,
      cards: (ctx.heroCards || []).map(cardText),
      stackBB: r2(ctx.stackBB), effBB: r2(ctx.effBB), effJamBB: r2(ctx.effJamBB),
    },
    board: (ctx.board || []).map(cardText),
    potBB: r2(ctx.potBB), toCallBB: r2(ctx.toCallBB),
    facing: ctx.facing, openerClass: ctx.openerClass || null,
    tableN: ctx.tableN, defendersN: ctx.defendersN,
    players: G ? G.players.filter(p => !p.out).map(p => ({
      name: p.name, pos: posNameOf(G, p.seat), chips: p.chips, bb: +fmtBB(p.chips),
      folded: p.folded, tags: [p.tagAgg, p.tagPass].filter(Boolean),
    })) : [],
    advice: {
      kind: d.kind, primary: advice.primary, freqs: advice.freqs,
      threshold: r2(d.threshold), marginBB: r2(d.marginBB), effS: r2(d.effS),
      rangePct: r2(d.rangePct), rejamPct: r2(d.rejamPct), callPct: r2(d.callPct),
      equity: r2(d.equity), breakeven: r2(d.breakeven),
      icmReq: r2(d.icmReq), icmPremium: r2(d.icmPremium),
      icmJamEval: d.icmJamEval ? { evJam: r2(d.icmJamEval.evJam), evFold: r2(d.icmJamEval.evFold) } : null,
      icmVeto: !!d.icmVeto, hu: !!d.hu, nash: !!d.nash, nashRejam: !!d.nashRejam,
    },
    userAction: { id: act.id, target: act.target || null },
    verdict: grade.verdict, evLoss: grade.evLoss,
  };
}

/* ワンタップ自動報告(Googleフォームへ裏側でPOST)。
 * REPORT_ENDPOINT/FIELDを設定すると有効化。未設定時はコピー動作にフォールバック。 */
const REPORT_ENDPOINT = "https://docs.google.com/forms/d/e/1FAIpQLSeWjiqVDUZJ6gSwopAbjweCfJX6bK4zlNMyQ75I3c4uAP7IrQ/formResponse";
const REPORT_FIELD = "entry.1854722243";
// 報告ボタン → 「①このまま送信 / ②コメントを書いて送る」を選ぶ
function openReportChoice() {
  if (!window.__lastReport) return;
  let ov = $("report-choice");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "report-choice";
    ov.innerHTML = `<div class="rc-inner">
      <p class="rc-title">⚠ この判定を開発に報告</p>
      <p class="rc-sub">局面データ(全員のスタック・判定根拠)は自動で添付されます。</p>
      <button id="rc-send" class="primary">① このまま送信</button>
      <button id="rc-comment">② コメントを書いて送る</button>
      <div id="rc-comment-area" class="hidden">
        <textarea id="rc-text" placeholder="例: フォールドが100%と出たが、相手のスタックを考えるとコールが正解では? / 解説の数字が食い違っている 等。詳しく書くほど助かります。"></textarea>
        <button id="rc-comment-send" class="primary">この内容で送信</button>
      </div>
      <button id="rc-cancel" class="rc-cancel">キャンセル</button>
    </div>`;
    document.body.appendChild(ov);
    ov.querySelector("#rc-send").onclick = () => { ov.classList.add("hidden"); sendReport(""); };
    ov.querySelector("#rc-comment").onclick = () => {
      ov.querySelector("#rc-comment-area").classList.remove("hidden");
      ov.querySelector("#rc-comment").classList.add("hidden");
      ov.querySelector("#rc-text").focus();
    };
    ov.querySelector("#rc-comment-send").onclick = () => {
      const txt = ov.querySelector("#rc-text").value.trim();
      ov.classList.add("hidden");
      sendReport(txt);
    };
    ov.querySelector("#rc-cancel").onclick = () => ov.classList.add("hidden");
  }
  // 毎回リセットして開く
  ov.querySelector("#rc-comment-area").classList.add("hidden");
  ov.querySelector("#rc-comment").classList.remove("hidden");
  ov.querySelector("#rc-text").value = "";
  ov.classList.remove("hidden");
}

function sendReport(comment) {
  if (!window.__lastReport) return;
  const payload = Object.assign({}, window.__lastReport, { comment: comment || "" });
  if (!REPORT_ENDPOINT || !REPORT_FIELD) { copyReport(); return; }
  const t = $("toast");
  try {
    const fd = new FormData();
    fd.append(REPORT_FIELD, JSON.stringify(payload));
    fetch(REPORT_ENDPOINT, { method: "POST", mode: "no-cors", body: fd });
    t.textContent = comment ? "📨 コメント付きで報告しました。ありがとう!" : "📨 報告を送信しました。ありがとう!";
    t.className = "v-mixed";
    Sfx.play("good");
  } catch (e) {
    t.textContent = "送信できなかったためコピーに切替えます";
    t.className = "v-minor";
    copyReport();
  }
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2400);
}

function copyReport() {
  if (!window.__lastReport) return;
  const text = "【判定報告】以下の局面の判定を検証してください:\n```json\n" +
    JSON.stringify(window.__lastReport, null, 1) + "\n```";
  const toast = ok => {
    const t = $("toast");
    t.textContent = "📋 コピーしました。そのまま貼り付けて送ってください";
    t.className = "v-mixed";
    t.classList.remove("hidden");
    setTimeout(() => t.classList.add("hidden"), 2200);
  };
  // 最終手段: 手動コピー用オーバーレイ(全選択済みテキスト)
  const manual = () => {
    let ov = $("report-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "report-overlay";
      ov.innerHTML = `<div class="ro-inner"><p>下のテキストを長押し(全選択済み)でコピーして送ってください:</p>
        <textarea id="ro-text" readonly></textarea>
        <button id="ro-close" class="primary">閉じる</button></div>`;
      document.body.appendChild(ov);
      ov.querySelector("#ro-close").onclick = () => ov.classList.add("hidden");
    }
    ov.classList.remove("hidden");
    const ta = ov.querySelector("#ro-text");
    ta.value = text;
    ta.focus();
    ta.select();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(toast, manual);
  } else {
    manual();
  }
}

function showCoachPanel(grade, advice, ctx, chosenId) {
  return new Promise(resolve => {
    const info = VERDICT_INFO[grade.verdict];
    $("coach-verdict").textContent = info.label +
      (grade.evLoss > 0 ? `　(推定EV損失 ${grade.evLoss.toFixed(2)}BB)` : "");
    $("coach-verdict").className = info.cls;
    $("coach-body").innerHTML = grade.explanation;
    $("coach-panel").classList.remove("hidden");
    $("blind-corner").classList.add("hidden");
    $("coach-continue").onclick = () => {
      $("coach-panel").classList.add("hidden");
      $("blind-corner").classList.remove("hidden");
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
function heroBBSel() {
  const raw = ($("hero-bb") || {}).value || "random";
  try { localStorage.setItem("pgt_herobb", raw); } catch (e) { }
  return raw === "random" ? null : parseInt(raw);
}

async function startTournament() {
  simCancel = true; // 実行中のシミュレーションがあれば停止
  showScreen("screen-game");
  $("log-panel").innerHTML = "";
  $("coach-panel").classList.add("hidden");
  buildSeats();
  aborting = false;
  G = newTournament("あなた", fieldSizeSel(), heroBBSel());
  tally = newTally();
  const hero = G.players[0];
  logMsg(`${G.fieldSize}人トーナメント開始! あなたのスタック: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`, "info");
  render(G);

  while (!G.over && !aborting) {
    heroPre = null;           // ハンド開始時に予約をクリア
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

  // イン・ザ・マネー判定(FT=9位以内が入賞)
  const itm = place <= 9;
  const payouts = (typeof Icm !== "undefined") ? Icm.payoutsFor(G.fieldSize, 9) : null;
  const prize = itm && payouts && payouts[place - 1] ? payouts[place - 1] : 0;
  $("bust-title").textContent = itm
    ? `🎉 入賞! ${G.fieldSize}人中 ${place}位 (${G.handNo}ハンド)`
    : `バスト — ${G.fieldSize}人中 ${place}位 (${G.handNo}ハンド生存)`;
  const itmHTML = itm
    ? `<div class="bust-cause variance">💰 イン・ザ・マネー! 賞金シェア <b>${(prize * 100).toFixed(0)}%</b>(プライズプール比)を獲得。</div>`
    : (place === 10 ? `<div class="bust-cause mistake">💥 バブル落ち… あと1人で入賞でした。この悔しさがバブルプレッシャーの正体です。</div>` : "");
  const causeHTML = cause === "variance"
    ? `<div class="bust-cause variance">⚖ 最終ハンドの判断はGTO通りでした。これは<b>分散</b>です。<br>正しくプレイしても飛ぶときは飛ぶ — それがトーナメント。次も同じ判断をしてください。</div>`
    : `<div class="bust-cause mistake">⚠ 最終ハンドに<b>ミスが含まれて</b>いました。下のコーチ解説を振り返りましょう。</div>`;
  $("bust-body").innerHTML = `
    <div class="big-num">${place}位 / ${G.fieldSize}人</div>
    ${itmHTML}
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
    const hb = localStorage.getItem("pgt_herobb");
    if (hb) $("hero-bb").value = hb;
  } catch (e) { }
  // ホームの対決シーン(KIM DWAN vs NGUYEN)
  if (typeof Scene !== "undefined") Scene.mount($("scene-home"));
  $("btn-mute").textContent = Sfx.isMuted() ? "🔇" : "🔊";
  $("btn-mute").onclick = () => { $("btn-mute").textContent = Sfx.toggle() ? "🔇" : "🔊"; };
  $("coach-report").onclick = copyReport;
  $("coach-report-top").onclick = openReportChoice;

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
