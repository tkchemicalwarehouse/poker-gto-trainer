/* =========================================================
 * app.js — UI制御・トーナメント進行・シミュレーション・成績
 * ========================================================= */
"use strict";

const $ = id => document.getElementById(id);

/* ---------- 画面遷移 ---------- */
const SCREENS = ["screen-home", "screen-game", "screen-sim", "screen-stats", "screen-help", "screen-drill", "screen-learn", "screen-legal", "screen-unlocks"];
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

/* ---------- 漏れ(リーク)集計: あなた個人の弱点傾向 ---------- */
const LEAK_KEY = "pgt_leaks_v1";
function loadLeaks() {
  try { return JSON.parse(localStorage.getItem(LEAK_KEY)) || { cats: {}, total: 0 }; }
  catch (e) { return { cats: {}, total: 0 }; }
}
function saveLeaks(l) { try { localStorage.setItem(LEAK_KEY, JSON.stringify(l)); } catch (e) { } }
function recordLeak(ctx, advice, chosen, grade) {
  if (typeof classifyLeak !== "function") return;
  const leak = classifyLeak(ctx, advice, chosen, grade.verdict);
  if (!leak) return;
  const L = loadLeaks();
  const c = L.cats[leak.key] || (L.cats[leak.key] = { key: leak.key, label: leak.label, count: 0, evLost: 0, examples: [] });
  c.label = leak.label; // ラベル更新(文言改善に追随)
  c.count++; c.evLost += grade.evLoss || 0;
  // 復習ドリル用に「再出題できるスナップショット」を最大5件保持(間隔反復の sr フィールド付き)
  c.examples.unshift({
    hand: ctx.heroLabel, pos: ctx.seatName,
    eff: Math.round((ctx.effBB || ctx.stackBB || 0) * 10) / 10,
    phase: ctx.phase, facing: ctx.facing || "none", openerClass: ctx.openerClass || null,
    board: (ctx.board || []).map(cardText),
    freqs: advice.freqs, primary: advice.primary,
    chosen, verdict: grade.verdict, date: new Date().toISOString().slice(0, 10),
    sr: 0, srLast: null,   // sr=連続正解数(3で習得), srLast=最終復習日
  });
  if (c.examples.length > 5) c.examples.length = 5;
  L.total++; saveLeaks(L);
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
    `<div class="c-idx">${r}</div>` +
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
    `<span class="${state.finalTable ? "ft-badge" : "field-badge"}">${state.finalTable ? "🔥FT " : ""}残り${state.fieldLeft}人</span>`;
  // FTはテーブルの色が変わる
  $("table").classList.toggle("ft", !!state.finalTable);
  // ヘッズアップ(残り2人)突入でVS演出を一度だけ
  if (state.fieldLeft === 2 && !huSplashShown && state.street !== "idle") {
    huSplashShown = true;
    if (typeof Dog !== "undefined" && Dog.pickOpponent) Dog.pickOpponent();  // 相手犬をランダム選出
    const od0 = $("pov-opp-dog"); if (od0) od0.innerHTML = "";  // 新しい相手犬で再生成
    showHUSplash(state);
  }
  // ヘッズアップは一人称(POV)画面に切替(通常テーブルを隠す)
  const huMode = state.fieldLeft === 2 && state.street !== "idle";
  const huPov = $("hu-pov");
  if (huPov) {
    huPov.classList.toggle("hidden", !huMode);
    $("table-wrap").classList.toggle("hidden", huMode);
    document.body.classList.toggle("hu-mode", huMode);
    if (huMode) { renderHUPov(state); $("hero-corner").classList.add("hidden"); }
  }

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
  // 左下の大型「自分のスタック」表示(右下のブラインドと左右対称。一番大切な情報を大きく)
  const hc = $("hero-corner");
  if (hc) {
    const coachOpen = !$("coach-panel").classList.contains("hidden");
    hc.classList.toggle("hidden", coachOpen || state.street === "idle" || hero.out);
    const hbb = +fmtBB(hero.chips);
    const sgClsH = hbb < 10 ? "sg-danger" : hbb < 20 ? "sg-warn" : hbb < 35 ? "sg-ok" : "sg-big";
    const htxt = hero.chips + "|" + sgClsH;
    if (hc.dataset.t !== htxt) {
      hc.dataset.t = htxt;
      hc.innerHTML =
        `<div class="hc-bb ${sgClsH}-t">${fmtBB(hero.chips)}<span>BB</span></div>` +
        `<div class="hc-chips">${fmtChips(hero.chips)}</div>`;
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
    const showdownResult = state.street === "showdown" && p.showResult;
    // オールインのランアウト中は「勝率%」を大きく表示(ターン・リバーで動くのを見せる)
    const runoutEq = !showdownResult && state.runout && p.eqPct != null && !p.folded;
    const tags = [];
    if (!showdownResult && !runoutEq) {
      if (p.tagAgg) tags.push(p.tagAgg);
      if (p.tagPass) tags.push(p.tagPass);
    }
    // 攻撃アクションには投入額を併記(RAISE/3BET/BET/ALL IN等。いくら入れたか一目で)
    const aggAmt = (p.tagAgg && p.streetBet > 0) ? p.streetBet : 0;
    if (runoutEq) {
      const pctTxt = Math.round(p.eqPct * 100) + "%";
      const key = "eq:" + pctTxt;
      if (actEl.dataset.k !== key) {
        actEl.dataset.k = key;
        // カードに被らないよう、勝率バッジは座席枠の上に出す(自分・相手とも手札が見える)
        actEl.className = "seat-act sa-eq-pos";
        const cls = p.eqPct >= 0.55 ? "sa-eq-hi" : p.eqPct <= 0.45 ? "sa-eq-lo" : "sa-eq-ev";
        actEl.innerHTML = `<div class="sa-tag sa-eq ${cls}"><span class="sa-eq-lbl">勝率</span>${pctTxt}</div>`;
      }
    } else if (showdownResult) {
      // ショーダウンの勝敗を WIN/LOSE のドット字で大きく表示(速くても見分けられるように)
      const key = "result:" + p.showResult;
      if (actEl.dataset.k !== key) {
        actEl.dataset.k = key;
        // WIN/LOSEもカードに被らないよう座席枠の上に出す
        actEl.className = "seat-act sa-eq-pos";
        const cls = p.showResult === "win" ? "sa-win" : "sa-lose";
        actEl.innerHTML = `<div class="sa-tag ${cls}">${p.showResult === "win" ? "WIN" : "LOSE"}</div>`;
      }
    } else if (tags.length && state.street !== "idle") {
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
    // ベット額(座席と中央の中間に表示)。チップ画像は出さず金額テキストのみ(画面の混雑回避)
    const betEl = $("bet-" + s);
    if (betEl) {
      if (p.streetBet > 0 && !p.folded && state.street !== "idle") {
        // 攻撃バッジ側に金額を出している席は、脇の数字を消して重複を防ぐ(CO等)
        const dupOnBadge = p.tagAgg && aggAmt;
        // ブラインド投稿は「SB/BB+額」のドット字で何の額か分かるように(BB4,000等)
        const lbl = (pos === "BB" || pos === "SB") ? pos + fmtChips(p.streetBet) : fmtChips(p.streetBet);
        betEl.innerHTML = dupOnBadge ? "" : `<div class="bet-amt">${lbl}</div>`;
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
  // ブラインドアップ → 装備犬が旗を持って走る
  if (cls === "levelup" && msg.includes("ブラインドアップ") && typeof Dog !== "undefined") {
    Dog.run({ flagText: "BLIND UP!" });
  }
  // バブル(残り10人) → 装備犬が BUBBLE 看板で歩く
  if (cls === "levelup" && msg.includes("バブル!") && typeof Dog !== "undefined") {
    Dog.sign(["BUBBLE", "あと1人で入賞!"]);
  }
  // ファイナルテーブル → 装備犬が FINAL TABLE 看板で歩く
  else if (cls === "levelup" && msg.includes("ファイナルテーブル!") && typeof Dog !== "undefined") {
    Dog.sign(["FINAL TABLE", "IN THE MONEY"]);
  }
}

// AAが配られたらKIMが走り抜ける(ハンドごとに1回)
let lastAARun = 0;
let huSplashShown = false;  // ヘッズアップ突入VS演出(トーナメント中1回)
function checkAARun(state) {
  if (typeof Mascot === "undefined" || !state || state.street !== "preflop") return;
  const hero = state.players[0];
  if (hero.out || hero.folded || !hero.cards || hero.cards.length < 2) return;
  if (state.handNo === lastAARun) return;
  if (handLabelOf(hero.cards[0], hero.cards[1]) === "AA") {
    lastAARun = state.handNo;
    // 装備犬が走り抜ける(画像が無ければドットにフォールバック)
    if (typeof Dog !== "undefined") Dog.run({ callout: "AA!! 最強のハンド!" });
    else if (typeof Mascot !== "undefined") Mascot.run({ callout: "AA!! 最強のハンド!" });
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
  // 「予約フォールド」機能は廃止。先回り予約バーは常に非表示にする(画面を専有しないため)。
  const bar = $("prebar");
  if (bar) bar.classList.add("hidden");
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
  // 決定前に助言を計算(「先生に聞く」用)。採点でも再利用してムダ計算を避ける
  Sfx.play("turn");
  const advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  const act = await showActionButtons(legal, ctx, advice);
  return await finalizeHeroAct(ctx, act, false, advice);
}

// アクション確定後の共通処理(採点・記録・コーチ表示)。fast=予約消化による即時実行
async function finalizeHeroAct(ctx, act, fast, advice) {
  if (!advice) advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  const grade = gradeDecision(ctx, advice, gradeIdFor(act, ctx), act);

  tally.decisions++;
  tally[grade.verdict]++;
  tally.evLost += grade.evLoss;
  if (!tally.perHand[G.handNo]) tally.perHand[G.handNo] = [];
  tally.perHand[G.handNo].push({ verdict: grade.verdict, evLoss: grade.evLoss, action: act.id, phase: ctx.phase });
  recordLeak(ctx, advice, gradeIdFor(act, ctx), grade);  // 個人の弱点傾向を永続集計
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

function showActionButtons(legal, ctx, advice) {
  return new Promise(resolve => {
    const bar = $("action-bar");
    bar.innerHTML = "";
    bar.classList.remove("hidden");
    // 🧑‍🏫 先生に聞く(決定前の推奨を表示。間違えなくても学べる)
    if (ctx && advice) {
      const ask = document.createElement("button");
      ask.className = "ask-teacher";
      ask.title = "先生に聞く(推奨を表示)";
      const chip = (typeof Dog !== "undefined" && Dog.advisorChip) ? Dog.advisorChip() : null;
      ask.innerHTML = chip ? `<img class="ask-chip" src="${chip}" alt="先生">` : `<span class="ask-ico">🐶</span>`;
      ask.onclick = () => openHint(ctx, advice);
      bar.appendChild(ask);
    }
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

// 🧑‍🏫 「先生に聞く」: 決定前に現局面の推奨(GTO頻度・EV・ICM)を表示。閉じると手番に戻る(手は消費しない)
function openHint(ctx, advice) {
  let ov = $("hint-ov");
  if (!ov) { ov = document.createElement("div"); ov.id = "hint-ov"; ov.className = "hidden"; document.body.appendChild(ov); }
  let body = "";
  try { body = buildExplanation(ctx, advice, advice.primary, "best", null, true); } catch (e) { body = "推奨の生成に失敗しました。"; }
  ov.innerHTML = `<div class="hint-inner">
    <div class="hint-head">🧑‍🏫 先生のアドバイス<span class="hint-sub">(決定前のヒント・手は消費しません)</span></div>
    <div class="hint-body">${body}</div>
    <button id="hint-close" class="primary">閉じてプレイに戻る ▶</button>
  </div>`;
  ov.classList.remove("hidden");
  $("hint-close").onclick = () => ov.classList.add("hidden");
  Sfx.play("turn");
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

/* 講座(GTO講座)への意見・指摘を、判定報告と同じGoogleフォームへ送る。
 * 回答シートには kind:"lesson_feedback" でタグ付けされ、判定報告と一緒に吸い上げられる。 */
function sendLessonFeedback(lessonId, lessonTitle, comment) {
  if (!comment) return false;
  const payload = {
    app: "トナメ中盤戦、、ここでGTO!!", kind: "lesson_feedback",
    time: new Date().toISOString(), lessonId, lessonTitle, comment,
  };
  const t = $("toast");
  try {
    if (REPORT_ENDPOINT && REPORT_FIELD) {
      const fd = new FormData();
      fd.append(REPORT_FIELD, JSON.stringify(payload));
      fetch(REPORT_ENDPOINT, { method: "POST", mode: "no-cors", body: fd });
    }
    t.textContent = "📨 講座へのご意見を送信しました。ありがとう!";
    t.className = "v-mixed"; Sfx.play("good");
  } catch (e) {
    t.textContent = "送信できませんでした。時間をおいて再度お試しください";
    t.className = "v-minor";
  }
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
  return true;
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
    $("hero-corner").classList.add("hidden");   // 解説中は自分のスタックHUDも隠す(被って読めなくなるため)
    $("coach-continue").onclick = () => {
      $("coach-panel").classList.add("hidden");
      $("blind-corner").classList.remove("hidden");
      $("hero-corner").classList.remove("hidden");
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

/* ---------- 中断・再開(モバイルで進捗を失わない) ---------- */
const RESUME_KEY = "pgt_resume_v1";
function saveResume() {
  // ハンド開始前の clean state を保存(中断時の復帰点)。LIVE/デッキは handNo から再生成されるので不要
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ v: 1, ts: Date.now(), G, tally })); } catch (e) { }
}
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch (e) { } }
function loadResume() {
  try { const r = JSON.parse(localStorage.getItem(RESUME_KEY)); if (r && r.v === 1 && r.G && !r.G.over && r.G.players) return r; } catch (e) { }
  return null;
}

async function runTournamentLoop() {
  while (!G.over && !aborting) {
    heroPre = null;           // ハンド開始時に予約をクリア
    saveResume();             // 中断しても直前のハンド開始時点から再開できる
    await playHand(G, gameIO);
  }
  if (G.over) clearResume();
  if (!aborting) {
    finishTournament(G.won);
  } else {
    showScreen("screen-home");
    renderHomeStats();
  }
}

async function startTournament() {
  simCancel = true; // 実行中のシミュレーションがあれば停止
  clearResume();    // 新規開始時は古い中断データを破棄
  showScreen("screen-game");
  $("log-panel").innerHTML = "";
  $("coach-panel").classList.add("hidden");
  buildSeats();
  aborting = false;
  G = newTournament("あなた", fieldSizeSel(), heroBBSel());
  tally = newTally();
  huSplashShown = false;
  const hero = G.players[0];
  logMsg(`${G.fieldSize}人トーナメント開始! あなたのスタック: ${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)`, "info");
  render(G);
  await runTournamentLoop();
}

async function resumeTournament() {
  const r = loadResume();
  if (!r) { renderHomeStats(); return; }
  simCancel = true;
  showScreen("screen-game");
  $("log-panel").innerHTML = "";
  $("coach-panel").classList.add("hidden");
  buildSeats();
  aborting = false;
  G = r.G; tally = r.tally || newTally();
  logMsg(`▶ 中断したトーナメントを再開(${G.handNo}ハンド目 / 残り${G.fieldLeft}人)`, "info");
  render(G);
  await runTournamentLoop();
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

function freshUnlockHTML() {
  const fresh = (typeof refreshUnlocks === "function") ? refreshUnlocks() : [];
  const cosmo = (typeof Cosmetics !== "undefined" && Cosmetics.newlyUnlocked) ? Cosmetics.newlyUnlocked() : [];
  const all = [...fresh.map(u => `${u.icon} ${u.title}`), ...cosmo.map(c => `${c.icon} ${c.name}`)];
  if (!all.length) return "";
  return `<div class="unlock-toast">🎁 <b>解放!</b> ${all.join(" / ")}<br>
    <span class="dim">「🎁 実績・解放」で確認・装備できます</span></div>`;
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
    ${freshUnlockHTML()}
    ${causeHTML}
    ${tallySummaryHTML()}
    <p style="color:var(--dim)">GTO通りに打っても5〜30BBの中盤戦は分散が非常に大きい領域です。シミュレーションで「GTOボットの生存分布」も見てみてください。</p>`;
  $("bust-modal").classList.remove("hidden");
}

/* ---------- 優勝演出 ---------- */
// ヘッズアップ突入のVS演出(自分の装備犬 vs 相手犬・ディーラーなし)
function showHUSplash(state) {
  const me = state.players[0];
  const opp = state.players.find(p => !p.isHero && !p.out) || {};
  const ov = document.createElement("div"); ov.id = "hu-splash";
  // 相手犬(プレースホルダ=ドット絵・別配色)
  const ot = document.createElement("div"); ot.className = "hu-opp";
  const oImg = (typeof Dog !== "undefined" && Dog.oppImg) ? Dog.oppImg() : null;
  if (oImg) ot.insertAdjacentHTML("beforeend", `<img class="hu-medal" src="${oImg}" alt="">`);
  const oName = (typeof Dog !== "undefined" && Dog.oppName) ? Dog.oppName() : (opp.name || "RIVAL");
  ot.insertAdjacentHTML("beforeend", `<div class="hu-tag">${oName}　${opp.chips != null ? fmtBB(opp.chips) + "BB" : ""}</div>`);
  // 中央 VS / 決着戦
  const ct = document.createElement("div"); ct.className = "hu-center";
  ct.innerHTML = `<div class="hu-vs">VS</div><div class="hu-duel">決着戦</div>`;
  // 自分(装備犬イラスト)
  const mt = document.createElement("div"); mt.className = "hu-me";
  const src = (typeof Cosmetics !== "undefined" && Cosmetics.equippedDog && Cosmetics.equippedDog().img) || null;
  mt.innerHTML = (src ? `<img src="${src}" alt="">` : "") +
    `<div class="hu-tag"><b style="color:#5fd492">YOU</b>　${fmtBB(me.chips)}BB</div>`;
  ov.appendChild(ot); ov.appendChild(ct); ov.appendChild(mt);
  document.body.appendChild(ov);
  if (typeof Sfx !== "undefined") { try { Sfx.play("win"); } catch (e) { } }
  setTimeout(() => { ov.classList.add("out"); setTimeout(() => ov.remove(), 500); }, 2300);
}

// ヘッズアップ 一人称(POV)画面の中身を更新
function renderHUPov(state) {
  const hero = state.players[0];
  const opp = state.players.find(p => !p.isHero && !p.out);
  // 相手(メダル画像。差し替わった時だけ再設定)
  const od = $("pov-opp-dog");
  const oImg = (typeof Dog !== "undefined" && Dog.oppImg) ? Dog.oppImg() : null;
  if (od && oImg) { const cur = od.querySelector("img"); if (!cur || cur.getAttribute("src") !== oImg) od.innerHTML = `<img class="pov-medal" src="${oImg}" alt="">`; }
  // 相手の手札(ショーダウンのみ表向き)
  const showOpp = state.street === "showdown" && opp && opp.showCards;
  $("pov-opp-cards").innerHTML = !opp ? "" : (opp.folded ? "" : (showOpp ? opp.cards.map(c => cardHTML(c, true)).join("") : backHTML(true) + backHTML(true)));
  const oName = (typeof Dog !== "undefined" && Dog.oppName) ? Dog.oppName() : (opp ? opp.name : "");
  $("pov-opp-info").innerHTML = opp ? `${oName}　<b>${fmtChips(opp.chips)} (${fmtBB(opp.chips)}BB)</b>` : "";
  // 場札・ポット・チップ
  const pot = potTotal(state);
  $("pov-board").innerHTML = state.board.map(c => cardHTML(c)).join("");
  $("pov-pot").innerHTML = `ポット ${fmtChips(pot)} (${fmtBB(pot)}BB)`;
  $("pov-chips").innerHTML = chipStackHTML(pot, false, 8);
  // 自分の手札・スタック
  $("pov-hole").innerHTML = (hero.cards && hero.cards.length) ? hero.cards.map(c => cardHTML(c)).join("") : "";
  $("pov-hero-info").innerHTML = `<b style="color:#5fd492">YOU</b>　<b>${fmtChips(hero.chips)} (${fmtBB(hero.chips)}BB)</b>`;
  // 前景の手(一度だけ生成)
  const pw = $("pov-paws");
  if (pw && !pw.firstChild && typeof Dog !== "undefined" && Dog.pawsCanvas) { const c = Dog.pawsCanvas(document.body.classList.contains("mode-phone") ? 10 : 12); if (c) pw.appendChild(c); }
}

function showVictory() {
  Sfx.play("victory");
  const layer = $("confetti-layer");
  layer.innerHTML = "";
  // 二重フラッシュ
  const flash = document.createElement("div"); flash.className = "victory-flash"; layer.appendChild(flash);
  const flash2 = document.createElement("div"); flash2.className = "victory-flash f2"; layer.appendChild(flash2);
  // 中央から広がる衝撃波リング
  const shock = document.createElement("div"); shock.className = "vic-shock"; layer.appendChild(shock);
  // 花火バースト(放射)
  const fwc = ["#ffd75e", "#fff3c4", "#ff6b6b", "#6fc0ff", "#a06cff", "#5fd492"];
  for (let k = 0; k < 6; k++) {
    const fw = document.createElement("div"); fw.className = "vic-fw";
    fw.style.left = (12 + Math.random() * 76) + "%"; fw.style.top = (10 + Math.random() * 55) + "%";
    const delay = (0.3 + k * 0.45).toFixed(2);
    for (let j = 0; j < 12; j++) {
      const sp = document.createElement("i");
      sp.style.setProperty("--a", (j * 30) + "deg");
      sp.style.background = fwc[(k + j) % fwc.length];
      sp.style.animationDelay = delay + "s";
      fw.appendChild(sp);
    }
    layer.appendChild(fw);
  }
  // きらめき(✦)
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("div");
    s.className = "vic-sparkle"; s.textContent = "✦";
    s.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 86}%;` +
      `font-size:${10 + Math.random() * 22}px;animation-delay:${(Math.random() * 2).toFixed(2)}s;`;
    layer.appendChild(s);
  }
  // 金貨シャワー
  for (let i = 0; i < 26; i++) {
    const c = document.createElement("div"); c.className = "vic-coin";
    const sz = 12 + Math.random() * 12;
    c.style.cssText = `left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;` +
      `animation-delay:${(Math.random() * 3).toFixed(2)}s;animation-duration:${(2.6 + Math.random() * 2.4).toFixed(2)}s;`;
    layer.appendChild(c);
  }
  // 紙吹雪(ゴールド多め・前面)
  const colors = ["#ffd75e", "#e8c352", "#fff3c4", "#ffd75e", "#e8c352", "#e05252", "#46c47c", "#4da3ff", "#c2569d", "#fff"];
  for (let i = 0; i < 200; i++) {
    const c = document.createElement("div");
    c.className = "confetti";
    const sz = 6 + Math.random() * 9;
    c.style.cssText =
      `left:${Math.random() * 100}%;` +
      `width:${sz}px;height:${sz * (0.4 + Math.random() * 1.2)}px;` +
      `background:${colors[i % colors.length]};` +
      `animation-delay:${(Math.random() * 3).toFixed(2)}s;` +
      `animation-duration:${(2.4 + Math.random() * 2.6).toFixed(2)}s;`;
    layer.appendChild(c);
  }
  $("victory-body").innerHTML = `
    ${(typeof Dog !== "undefined") ? Dog.victoryImgTag() : ""}
    <div class="victory-place">👑 ${G.fieldSize}人トーナメント 制覇 👑</div>
    <p class="victory-hands">${G.handNo}ハンドの激闘を制しました!</p>
    ${freshUnlockHTML()}
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
  const resume = (typeof loadResume === "function") ? loadResume() : null;
  let html = "";
  if (resume && resume.G) {
    html += `<button id="btn-resume" class="big cta resume-cta">▶ 中断したトーナメントを再開<span class="resume-sub">${resume.G.handNo}ハンド目 / 残り${resume.G.fieldLeft}人</span></button>`;
  }
  if (ts.length === 0) {
    html += "まだ記録がありません。トーナメントに挑戦しましょう。";
  } else {
    const wins = ts.filter(t => t.result === "win").length;
    const dec = ts.reduce((s, t) => s + t.decisions, 0);
    const ok = ts.reduce((s, t) => s + t.best + t.mixed, 0);
    html += `挑戦 <b>${ts.length}回</b> ・ 優勝 <b>🏆${wins}回</b> ・ GTO一致率 <b>${dec ? (ok / dec * 100).toFixed(1) : "—"}%</b>`;
  }
  $("home-stats").innerHTML = html;
  const rb = $("btn-resume"); if (rb) rb.onclick = () => resumeTournament();
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

  // あなたの弱点(漏れ)TOP3: EV損失合計の大きい順
  const L = loadLeaks();
  const leakArr = Object.values(L.cats || {}).sort((a, b) => (b.evLost - a.evLost) || (b.count - a.count));
  let leakHtml = "";
  if (leakArr.length) {
    const top = leakArr.slice(0, 3);
    const items = top.map((c, i) => {
      const ex = c.examples && c.examples[0];
      const exTxt = ex ? `直近: ${ex.pos} ${ex.hand} ${ex.eff}BB(${({ fold: "降り", call: "コール", jam: "オールイン", raise: "レイズ", raiseTo: "レイズ", bet33: "ベット小", bet66: "ベット大", bet: "ベット", check: "チェック" })[ex.chosen] || ex.chosen})` : "";
      return `<div class="leak-item">
        <div class="leak-rank">${i + 1}</div>
        <div class="leak-main">
          <div class="leak-label">${c.label}</div>
          <div class="leak-sub">${c.count}回 ・ 推定損失 ${c.evLost.toFixed(1)}BB${exTxt ? " ・ " + exTxt : ""}</div>
        </div>
      </div>`;
    }).join("");
    leakHtml = `<h3>🎯 あなたの弱点 TOP3(直すと一番伸びる順)</h3>
      <div class="leak-list">${items}</div>
      <p style="color:var(--dim);font-size:12px;margin:6px 0 4px">ミスをEV損失の大きい順に集計。ここを意識して打つだけで一致率が上がります。${L.total ? `(総ミス記録 ${L.total}件)` : ""}</p>`;
  }

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
    ${leakHtml}
    <h3>生存ハンド数の分布</h3>
    ${bars}
    <p style="margin-top:14px;color:var(--dim)">「分散によるバスト率」が高いほど、あなたは正しくプレイして運に負けただけです。
    GTO一致率を上げつつ、この比率が高い状態を維持するのが理想です。</p>`;
}

/* ---------- 弱点復習ドリル(間隔反復) ---------- */
const ACT_JP = { fold: "フォールド", call: "コール", jam: "オールイン", raise: "レイズ", raiseTo: "レイズ", bet33: "小ベット(33%)", bet66: "大ベット(66%)", bet: "ベット", check: "チェック" };
let drillState = null;

function collectDrillSpots() {
  const L = loadLeaks();
  const spots = [];
  for (const c of Object.values(L.cats || {})) {
    for (const ex of (c.examples || [])) {
      if (!ex.freqs) continue;          // 旧形式(再出題不可)はスキップ
      if ((ex.sr || 0) >= 3) continue;  // 3連続正解=習得済みは除外
      spots.push(Object.assign({}, ex, { leakKey: c.key, leakLabel: c.label, catEv: c.evLost || 0 }));
    }
  }
  spots.sort((a, b) => (b.catEv - a.catEv) || ((a.sr || 0) - (b.sr || 0)));
  return spots.slice(0, 10);
}
function drillActionButtons(spot) {
  if (spot.phase === "preflop") {
    if (spot.facing === "jam") return [["fold", "フォールド"], ["call", "コール(=相手のオールインを受ける)"]];
    if (spot.facing === "open") return [["fold", "フォールド"], ["call", "コール"], ["jam", "オールイン(3ベット)"]];
    return [["fold", "フォールド"], ["raise", "レイズ(2.2BB)"], ["jam", "オールイン"]];
  }
  if (spot.facing === "bet") return [["fold", "フォールド"], ["call", "コール"], ["bet66", "レイズ"]];
  return [["check", "チェック"], ["bet33", "小ベット(33%)"], ["bet66", "大ベット(66%)"]];
}
function gradeQuiz(spot, chosen) {
  let ch = chosen;
  if (spot.facing === "jam" && ch === "jam") ch = "call"; // 単独オールインへの被せ=コール
  const f = (spot.freqs && spot.freqs[ch]) || 0;
  const verdict = f >= 0.6 ? "best" : f >= 0.25 ? "mixed" : f >= 0.05 ? "minor" : "blunder";
  return { verdict, correct: verdict === "best" || verdict === "mixed", f };
}
function spotSituation(spot) {
  if (spot.phase === "preflop") {
    if (spot.facing === "jam") return `${spot.pos}・<b>${spot.hand}</b>・${spot.eff}BB。<br>相手が<b>オールイン</b>してきた。受ける?降りる?`;
    if (spot.facing === "open") return `${spot.pos}・<b>${spot.hand}</b>・有効${spot.eff}BB。<br><b>${spot.openerClass || "前"}</b>ポジションがオープン(レイズ)。どうする?`;
    return `${spot.pos}・<b>${spot.hand}</b>・${spot.eff}BB。<br>あなたまで全員降り。最初のアクション。`;
  }
  return `${spot.pos}・<b>${spot.hand}</b>。<br>ボード: <b>${(spot.board || []).join("  ")}</b>${spot.facing === "bet" ? "。相手がベットしてきた" : "。あなたの番"}`;
}
function freqLabel(freqs) {
  const m = { fold: "降", call: "コ", jam: "全", raise: "レ", bet33: "小", bet66: "大", check: "チェ" };
  return Object.entries(freqs || {}).filter(([, v]) => v > 0.01).map(([k, v]) => `${m[k] || k}${Math.round(v * 100)}%`).join(" / ");
}
function renderDrill() {
  drillState = { spots: collectDrillSpots(), i: 0, correct: 0 };
  showQuiz();
}
function showQuiz() {
  const s = drillState, body = $("drill-body");
  if (!s.spots.length) {
    body.innerHTML = `<p>復習する弱点がまだありません 🎉<br>実戦でミス(△僅差・✗ブランダー)が出ると、その局面がここに溜まり、間隔反復で復習できます。<br>成績画面の「🎯 あなたの弱点TOP3」と連動しています。</p>`;
    return;
  }
  if (s.i >= s.spots.length) {
    body.innerHTML = `<div class="drill-done"><div class="drill-score">${s.correct} / ${s.spots.length} 正解</div>
      <p>${s.correct === s.spots.length ? "全問正解!この調子で実戦でも同じ判断を。" : "間違えた局面はまた出題されます。同じ局面を3回連続で正解すると『習得』となり卒業します。"}</p>
      <button id="drill-again" class="big cta">もう一周</button></div>`;
    $("drill-again").onclick = renderDrill;
    return;
  }
  const spot = s.spots[s.i];
  const btns = drillActionButtons(spot).map(([id, label]) => `<button class="drill-opt" data-id="${id}">${label}</button>`).join("");
  body.innerHTML = `
    <div class="drill-progress">問題 ${s.i + 1} / ${s.spots.length}　弱点「${spot.leakLabel}」</div>
    <div class="drill-spot">${spotSituation(spot)}</div>
    <div class="drill-opts">${btns}</div>
    <div id="drill-feedback"></div>`;
  body.querySelectorAll(".drill-opt").forEach(b => b.onclick = () => answerQuiz(spot, b.dataset.id));
}
function answerQuiz(spot, chosen) {
  const g = gradeQuiz(spot, chosen);
  const L = loadLeaks(), cat = L.cats[spot.leakKey];
  if (cat) {
    const ex = (cat.examples || []).find(e => e.hand === spot.hand && e.pos === spot.pos && e.eff === spot.eff && e.date === spot.date);
    if (ex) { ex.sr = g.correct ? (ex.sr || 0) + 1 : 0; ex.srLast = new Date().toISOString().slice(0, 10); saveLeaks(L); }
  }
  if (g.correct) drillState.correct++;
  const info = (typeof VERDICT_INFO !== "undefined") ? VERDICT_INFO[g.verdict] : null;
  document.querySelectorAll(".drill-opt").forEach(b => {
    b.disabled = true;
    if (b.dataset.id === spot.primary) b.classList.add("opt-correct");
    if (b.dataset.id === chosen && !g.correct) b.classList.add("opt-wrong");
  });
  const last = drillState.i + 1 >= drillState.spots.length;
  $("drill-feedback").innerHTML = `
    <div class="drill-result ${g.correct ? 'ok' : 'ng'}">${g.correct ? '⭕ 正解' : '❌ 不正解'}${info ? ' — ' + info.label : ''}</div>
    <p>GTO推奨: <b>${ACT_JP[spot.primary] || spot.primary}</b>　<span class="dim">(頻度 ${freqLabel(spot.freqs)})</span></p>
    <p class="drill-tip">この局面はあなたの弱点「<b>${spot.leakLabel}</b>」。意識して直すと一番伸びます。</p>
    <button id="drill-next" class="big cta">${last ? "結果を見る" : "次の問題 →"}</button>`;
  $("drill-next").onclick = () => { drillState.i++; showQuiz(); };
}

/* ---------- GTO講座(カリキュラム) ---------- */
const LEARN_KEY = "pgt_learn_v1";
const LESSON_CATS = [
  { key: "basics", title: "■ 基礎(まずここから)" },
  { key: "preflop", title: "■ プリフロップ" },
  { key: "postflop", title: "■ ポストフロップ" },
  { key: "tournament", title: "■ トーナメント特有" },
];
const LESSONS = [
  // ===== 基礎 =====
  { id: "position", cat: "basics", title: "① ポジション(席順)の力", body:
    `<p>ポーカーで最も大事な"無料の武器"が<b>ポジション</b>です。後ろの席ほど<b>相手の行動を見てから決められる</b>ので圧倒的に有利。</p>
    <ul><li>席の強さ: <b>BTN(ボタン)が最強</b> → CO → … → <b>UTG(最初に話す席)が最弱</b>。SB/BBは強制ベットの分だけ特殊。</li>
    <li>だから<b>参加できる手の広さは後ろほど広い</b>。UTGはごく強い手だけ、BTNは大幅に広げられる。</li>
    <li>ポストフロップでも、ポジションがある側は「最後に行動できる」ので主導権を握れる。</li></ul>
    <p>このアプリのオープン/ジャム/コールのレンジが「席ごとに違う」のはこのためです。</p>
    <p><b>覚えること:</b> 迷ったら「自分の後ろに何人残っているか」を数える。少ないほど強気でよい。</p>` },
  { id: "potodds", cat: "basics", title: "② ポットオッズと必要勝率", body:
    `<p>コールすべきかは<b>「払う額に対して、勝てばいくら返るか」</b>で決まります。式は1つ:</p>
    <p style="text-align:center"><b>必要勝率 = コール額 ÷ (ポット + コール額)</b></p>
    <ul><li>暗算の近道: 相手のベットがポットの<b>1/3→必要20% / 半分→25% / 2/3→28.5% / ポット大→33% / 2倍→40%</b>。</li>
    <li>オールインを受ける時もこの式そのまま。「コール額 ÷ (合計ポット+コール額)」。</li>
    <li>自分の<b>勝率(エクイティ)が必要勝率を上回ればコール</b>、下回れば降り。これだけ。</li></ul>
    <p>このアプリのコール判定の解説に出てくる「必要勝率○%」はすべてこの計算です。</p>
    <p><b>覚えること:</b> 安く受けられる(必要勝率が低い)ほど、弱い手でもコールできる。</p>` },
  { id: "equity", cat: "basics", title: "③ エクイティとアウツ(2/4の法則)", body:
    `<p><b>エクイティ=今の時点での勝率</b>です。代表的な対決の目安(暗記推奨):</p>
    <ul><li>ペア vs 2オーバーカード ≈ <b>55:45</b>(例 77 vs AK、いわゆるコインフリップ)</li>
    <li>オーバーペア vs 下のペア ≈ <b>80:20</b> / ドミネイト(AK vs AQ)≈ <b>73:27</b></li></ul>
    <p>未完成のドローは<b>2/4の法則</b>で完成率を概算: <b>アウツ(完成させる残り枚数)×4(フロップ)/×2(ターン)</b>。フラッシュドロー9枚→フロップで約36%。両面ストレート8枚→約32%。</p>
    <p>相手が1枚の手でなく"レンジ"の場合は、その中間を取ります(このアプリは169×169の厳密値で計算)。</p>
    <p><b>覚えること:</b> 役の対決の目安を暗記し、ドローはアウツ×4/×2で勝率を即概算。</p>` },
  // ===== プリフロップ =====
  { id: "pushfold", cat: "preflop", title: "④ プッシュ/フォールドの基礎", body:
    `<p>持ちスタックが浅い(目安<b>10〜15BB以下</b>)とき、中盤戦の基本は<b>「オールイン(ジャム)か、降りるか」</b>の二択です。なぜか:</p>
    <ul><li>小さくレイズしても、相手に3ベットされたら降りられない(スタックが浅すぎる)。だったら最初から全部入れて<b>フォールドエクイティ(相手を降ろす力)</b>を最大化する。</li>
    <li>毎周、ポットには<b>SB+BB+アンティ=約2.5BB</b>の"置きチップ"がある。これを取りに行くのがジャムの最大の動機。降り続けるとブラインドで削られて死ぬ。</li>
    <li>ジャムが通れば(全員降りれば)ノーリスクで2.5BBを獲得。コールされても、浅いのでエクイティの差が出にくい。</li></ul>
    <p><b>位置が後ろ(BTN/SB)ほどジャムは広く</b>、前(UTG)ほど狭くなります。後ろは降ろせる人数が少ない=通りやすいからです。当アプリの「ナッシュ・ジャムレンジ」は、この計算を全ハンド×全スタックで解いた答えです。</p>
    <p><b>覚えること:</b> 浅いほどジャム、後ろほど広く、降り続けは死。</p>` },
  { id: "openrange", cat: "preflop", title: "⑤ オープンレンジ(最初に入る手)", body:
    `<p>誰もまだ入っていない時に最初に参加するなら、原則<b>リンプ(コールで入る)ではなくレイズ</b>します。理由は、降ろす力(フォールドエクイティ)とポットの主導権を取るため。</p>
    <ul><li>開ける手の広さは<b>席で変わる</b>: UTGはタイト(上位<b>13〜15%</b>級)、COで25〜30%、<b>BTNは40〜50%</b>と大きく広がる。後ろほど降ろしやすく、ポジションも取れるから。</li>
    <li>SBは後ろにBBしか居ないので非常に広く開けるが、ポジションは渡す特殊な席。</li>
    <li><b>浅い(〜12BB)とき</b>はレイズの代わりに<b>ジャム</b>(④参照)。中途半端なレイズは3ベットに弱い。</li></ul>
    <p><b>覚えること:</b> 前の席は堅く、後ろの席は広く。浅ければレイズせずジャムで。</p>` },
  { id: "rejam", cat: "preflop", title: "⑥ リジャム(3ベットオールイン)", body:
    `<p>誰かがオープン(レイズ)した後、あなたが<b>オールインで被せる</b>のがリジャム(3ベットジャム)です。利益の正体:</p>
    <ul><li>利益の大半は<b>「相手のオープンレンジの多くが降りて、ポットをタダ取りする」</b>部分。コールされて勝つ部分ではありません。</li>
    <li>だから<b>相手のオープンが広いほど(レイトポジションのオープンほど)リジャムは広げられる</b>。降ろせる率が高いからです。</li>
    <li>コールされたときに最低限戦えるエクイティ(Aハイやポケットペアが優秀)も必要。AKやAQ、中ポケットが好適。</li></ul>
    <p>有効スタックが深いほどリスクが増えるので、リジャムできる上限スタックは手の強さで決まります(当アプリの閾値表)。<b>有効18BB超</b>になると、実戦GTOはオールインでなく<b>小さい3ベット</b>も混ぜ始めます。</p>
    <p><b>覚えること:</b> リジャムは"降ろして勝つ"。相手のオープンが広い席ほど広く。</p>` },
  { id: "bbdefense", cat: "preflop", title: "⑦ BBディフェンス(ビッグブラインドの守り)", body:
    `<p>あなたがBBのとき、誰かのオープンに対して<b>普通より広く守れます</b>。理由:</p>
    <ul><li>BBは既に1BBを払っている。だから追加で払う額に対して<b>ポットオッズが良い</b>(必要勝率が低い)。</li>
    <li>全員の最後に行動できるので、情報も多い。</li></ul>
    <p>守り方は2種類を使い分けます: <b>コール</b>(深い・ポストフロップで戦える手)と<b>リジャム</b>(中途半端な強さで、降ろしつつコールにも備える手)。相手のオープン位置で守る幅が変わり、<b>SBやBTNの広いオープンには非常に広く</b>、UTGの堅いオープンには絞って守ります。</p>
    <p><b>覚えること:</b> BBはオッズが良いので広く守る。相手が後ろの席ほどさらに広く。</p>` },
  { id: "squeeze", cat: "preflop", title: "⑧ スクイーズと多人数ポット", body:
    `<p>誰かがオープンし、さらに<b>誰かがコールした後</b>に大きく3ベットするのが<b>スクイーズ</b>です。</p>
    <ul><li>ポットには既にオープン+コールのデッドマネーがあり、<b>取れる報酬が大きい</b>。2人とも降ろせれば大きな利益。</li>
    <li>逆に言うと、<b>多人数のポットに弱い手で参加するのは危険</b>。人が増えるほど誰かが強い手を持っている確率が上がり、自分のエクイティは薄まる。</li>
    <li>後ろに残る人数が多いほどコールされやすいので、参加レンジを<b>締める</b>のが鉄則。</li></ul>
    <p><b>覚えること:</b> 人が増えるほどタイトに。スクイーズはデッドマネーが報酬源。</p>` },
  // ===== ポストフロップ =====
  { id: "postflop", cat: "postflop", title: "⑨ ポストフロップの基礎(SPR)", body:
    `<p>中盤戦はスタックが浅いので、フロップ以降は<b>SPR(スタック÷ポット)</b>が小さくなりがちです。</p>
    <ul><li><b>SPR3以下</b>: トップペア級でも全額入れてOK(コミット)。</li>
    <li><b>SPR6以上</b>: ワンペアで大きなポットを作らない。</li>
    <li><b>チェック・トゥ・ザ・レイザー</b>: 前のストリートで攻めた人(レイザー)が有利なので、コーラー側はほぼ全部チェックして相手に打たせるのが基本。自分から打つ(ドンク)のはモンスターや強ドローを少頻度だけ。</li></ul>
    <p><b>覚えること:</b> 浅いとワンペアでも入れ切る。攻めてない側はまずチェック。</p>` },
  { id: "cbet", cat: "postflop", title: "⑩ ボードテクスチャとCベット", body:
    `<p>フロップで自分がレイザーの時、打つ(Cベット)か否かは<b>ボードが自分のレンジに有利か</b>で決めます。</p>
    <ul><li><b>ドライ(バラバラ・ハイカード)</b>: 例 A♠7♦2♣。レイザー(あなた)のレンジが有利なので、<b>小さく・高頻度</b>で打てる(レンジベット)。</li>
    <li><b>ウェット(つながり・同スート)</b>: 例 8♥7♥6♠。コーラーにヒットしやすいので、Cベットは<b>絞り、打つならサイズを大きく</b>。</li>
    <li>中途半端な手は無理に打たず<b>チェック</b>で様子見。強い手と弱いブラフを混ぜるのが基本。</li></ul>
    <p><b>覚えること:</b> ドライは小さく多く、ウェットは選んで大きく。</p>` },
  { id: "balance", cat: "postflop", title: "⑪ バリューとブラフのバランス", body:
    `<p>ベットには2つの目的があります: <b>バリュー</b>(強い手で払わせる)と<b>ブラフ</b>(弱い手で降ろす)。片方しか打たないと読まれます。</p>
    <ul><li>強い手だけ打つ相手には、皆フォールドして<b>バリューが取れない</b>。だから適度にブラフを混ぜる。</li>
    <li>ブラフは<b>「外れても次に強くなれる手」=ドロー</b>から選ぶのが効率的(セミブラフ)。降ろせれば即利益、完成すれば大勝ち。</li>
    <li>リバーの理想的なブラフ比率は<b>ベットサイズで決まる</b>: 大きく打つほどブラフを増やせる(相手のオッズが悪くなるため)。</li></ul>
    <p><b>覚えること:</b> 強い手だけだと読まれる。ブラフはドローから、サイズと比率を意識。</p>` },
  // ===== トーナメント特有 =====
  { id: "icm", cat: "tournament", title: "⑫ ICMとファイナルテーブル", body:
    `<p>トーナメントのチップは、そのまま現金ではありません。順位ごとに賞金が決まるため、<b>「チップのEV」と「賞金のEV」がズレます</b>。これを計算するのがICM(Malmuth-Harville法)です。</p>
    <ul><li>1位になる確率 ≈ 自分のチップ ÷ 全体チップ。2位以下はその人を除いて同じ計算を繰り返して賞金期待値を出す。</li>
    <li><b>バブル(入賞直前)やファイナルテーブルでは、飛んだときに失う賞金が大きい</b>。だから<b>必要勝率が上がる(ICMプレミアム)</b>。チップ上は微益のコールでも、賞金的には降りが正解、という場面が増える。</li>
    <li>チップリーダーは"飛んでも痛くない"ので圧をかけ、ショートやミドルは"飛べないので耐える"。</li></ul>
    <p>当アプリはFTで「チップEV」と「賞金EV(ICM)」が割れる場面を<b>「注意(caution)」</b>として両視点で見せます。どちらか一方の正解に潰しません。</p>
    <p><b>覚えること:</b> 入賞が近いほど、飛ぶ手はより強くないとコールできない。</p>` },
  { id: "stacksize", cat: "tournament", title: "⑬ スタックサイズ別の戦い方", body:
    `<p>同じ手でも、<b>スタックの深さで最適な戦術が変わります</b>。常に「自分は何BBか」を意識しましょう。</p>
    <ul><li><b>〜10BB</b>: プッシュ/フォールド主体。レイズせずジャムか降り。</li>
    <li><b>10〜25BB</b>: <b>リジャム/3ベット</b>が最も効く帯域。降ろす力が高く、コミットもしやすい。</li>
    <li><b>25BB+</b>: 通常のオープン+ポストフロップも視野に。技術介入の余地が増える。</li>
    <li><b>バブル</b>では<b>ミドルスタックが一番動きにくい</b>(飛ぶと痛いが圧もかけにくい)。ショートは耐え、ビッグスタックは圧をかける。</li></ul>
    <p><b>覚えること:</b> 自分とテーブルのスタックで戦術を切り替える。バブルは生き残り優先。</p>` },
  { id: "variance", cat: "tournament", title: "⑭ 分散とメンタル — ミスと不運の違い", body:
    `<p>このアプリの<b>最重要メッセージ</b>です。GTO通りに正しくプレイしても、<b>短期では頻繁に負けます(分散)</b>。</p>
    <ul><li>1回の結果でプレイを変えてはいけない。<b>正しい+EVの判断を淡々と積み重ねた人</b>が長期で勝ちます。</li>
    <li><b>「正しい判断で飛んだ」</b>のと<b>「ミスで飛んだ」</b>を区別することが上達の核心。前者は反省不要、後者だけ直す。</li>
    <li>当アプリのバスト画面は、最後の判断が<b>分散</b>だったか<b>ミス</b>だったかを分解して表示します。「分散によるバスト率」が高いほど、あなたは正しく打てています。</li></ul>
    <p><b>覚えること:</b> 結果ではなく判断の質を見る。正しければ、飛んでも次も同じ判断を。</p>` },
];
function loadLearn() { try { return JSON.parse(localStorage.getItem(LEARN_KEY)) || { done: {} }; } catch (e) { return { done: {} }; } }
function saveLearn(l) { try { localStorage.setItem(LEARN_KEY, JSON.stringify(l)); } catch (e) { } }
function renderLearn() {
  const st = loadLearn();
  const doneN = LESSONS.filter(l => st.done[l.id]).length;
  const lessonHTML = l => `<div class="lesson ${st.done[l.id] ? 'done' : ''}">
      <div class="lesson-head" data-id="${l.id}"><span class="lesson-title">${st.done[l.id] ? '✅ ' : ''}${l.title}</span><span class="lesson-toggle">▼</span></div>
      <div class="lesson-body hidden" id="lb-${l.id}">${l.body}
        <button class="lesson-done" data-id="${l.id}">${st.done[l.id] ? '✓ 学習済み(もう一度読む場合はそのまま)' : 'この講座を学習した！'}</button>
        <div class="lesson-fb">
          <button class="lf-toggle" data-id="${l.id}">💬 この講座に意見・指摘を送る</button>
          <div class="lf-area hidden" id="lf-${l.id}">
            <textarea class="lf-text" placeholder="例: 「○○という新しい理論では…」/「この説明は△△の点で誤りでは?」/「もっと具体例が欲しい」など。開発に直接届き、確認して講座を改善します。"></textarea>
            <button class="lf-send" data-id="${l.id}">この内容で送信</button>
          </div>
        </div>
      </div>
    </div>`;
  const sections = LESSON_CATS.map(c => {
    const ls = LESSONS.filter(l => l.cat === c.key);
    if (!ls.length) return "";
    const cd = ls.filter(l => st.done[l.id]).length;
    const open = (typeof isChapterUnlocked === "function") ? isChapterUnlocked(c.key) : true;
    if (!open) {
      const goal = (typeof CHAPTER_UNLOCK !== "undefined" && CHAPTER_UNLOCK[c.key]) ? CHAPTER_UNLOCK[c.key].goal : "";
      return `<h3 class="lesson-cat">${c.title} <span class="lesson-cat-prog">🔒</span></h3>` +
        `<div class="lesson locked-chapter"><div class="lesson-head"><span class="lesson-title">🔒 この章はまだロック中</span></div>
          <div class="lesson-lock-msg">${goal}<br><span class="dim">条件を満たすと自動で解放されます(「🎁 実績・解放」で進捗を確認)。</span></div></div>`;
    }
    return `<h3 class="lesson-cat">${c.title} <span class="lesson-cat-prog">${cd}/${ls.length}</span></h3>` + ls.map(lessonHTML).join("");
  }).join("");
  $("learn-body").innerHTML =
    `<p class="learn-prog">進捗: <b>${doneN}/${LESSONS.length}</b> 完了　<span class="dim">基礎からトーナメント特化まで。実戦の判定・用語と完全に揃っています。気になる章から読んでOK。</span></p>` +
    sections;
  $("learn-body").querySelectorAll(".lesson-head").forEach(h => h.onclick = () => $("lb-" + h.dataset.id).classList.toggle("hidden"));
  $("learn-body").querySelectorAll(".lesson-done").forEach(btn => btn.onclick = () => {
    const st2 = loadLearn(); st2.done[btn.dataset.id] = true; saveLearn(st2); renderLearn();
    $("lb-" + btn.dataset.id).classList.remove("hidden");
  });
  // 意見・指摘の開閉と送信
  $("learn-body").querySelectorAll(".lf-toggle").forEach(btn => btn.onclick = () => {
    const a = $("lf-" + btn.dataset.id); a.classList.toggle("hidden");
    if (!a.classList.contains("hidden")) a.querySelector(".lf-text").focus();
  });
  $("learn-body").querySelectorAll(".lf-send").forEach(btn => btn.onclick = () => {
    const a = $("lf-" + btn.dataset.id), ta = a.querySelector(".lf-text");
    const txt = ta.value.trim();
    if (!txt) { ta.focus(); return; }
    const lesson = LESSONS.find(l => l.id === btn.dataset.id);
    if (sendLessonFeedback(btn.dataset.id, lesson ? lesson.title : btn.dataset.id, txt)) {
      ta.value = ""; a.classList.add("hidden");
    }
  });
}

/* ---------- 規約・プライバシー・運営情報(有料配信に必須) ----------
 * 【要記入】の箇所は、販売開始前に実際の事業者情報・価格・決済方法を必ず記入すること。 */
const LEGAL_UPDATED = "2026-06-14";
const LEGAL_DOCS = [
  { id: "gamble", title: "⚠ 重要なお知らせ(ギャンブルではありません)", body:
    `<p>本アプリは、テキサスホールデムのトーナメント中盤戦を<b>GTO(ゲーム理論的最適)で学ぶための教育・トレーニング用シミュレーター</b>です。</p>
    <ul>
    <li>使用するチップは<b>仮想のポイント</b>であり、<b>現実の金銭的・財産的価値は一切ありません</b>。</li>
    <li>本アプリ内で<b>現実の金銭を賭けることはできず</b>、賞金・換金性のある景品も<b>一切提供しません</b>。したがって本アプリは賭博(ギャンブル)に該当しません。</li>
    <li>本アプリでの学習・成績は、現実のギャンブルでの勝利や利益を<b>保証するものではありません</b>。ギャンブルには依存性・経済的損失のリスクがあります。</li>
    <li>対象年齢の目安: <b>18歳以上</b>。オンライン賭博は地域により違法です。本アプリを違法な賭博の目的に使用しないでください。</li>
    </ul>` },
  { id: "privacy", title: "プライバシーポリシー", body:
    `<p>本アプリは<b>アカウント登録不要</b>で、氏名・住所・メールアドレス等の個人情報を<b>収集しません</b>。</p>
    <ul>
    <li><b>端末内保存のみ</b>: 成績・設定・学習進捗は、お使いのブラウザ内(localStorage)に<b>のみ保存</b>され、運営者のサーバには送信されません。ブラウザのデータを消去すると失われます。</li>
    <li><b>任意送信</b>: 「判定の報告」「講座への意見」ボタンを<b>お客様自身が押したときのみ</b>、その局面データ・コメントがGoogleフォーム経由で運営者に送られます。氏名等は含まれず、品質改善の目的にのみ使用します。送信は任意です。</li>
    <li><b>外部サービス</b>: 画面表示にGoogle Fonts、上記の任意送信にGoogleフォームを利用します。これに伴いIPアドレス等がGoogle社へ送信される場合があります(同社のプライバシーポリシーに従います)。</li>
    <li><b>広告・トラッキングなし</b>: 広告配信や行動追跡を目的としたCookie・トラッキングは使用しません。</li>
    </ul>
    <p>本ポリシーは必要に応じて改定し、本ページで告知します。</p>` },
  { id: "terms", title: "利用規約", body:
    `<p><b>第1条(目的)</b> 本規約は、本アプリ(以下「本サービス」)の利用条件を定めます。本サービスはポーカーGTOの学習・娯楽を目的とします。</p>
    <p><b>第2条(禁止事項)</b> お客様は次の行為をしてはなりません: 法令・公序良俗に反する行為、本サービスを違法な賭博の目的に利用する行為、リバースエンジニアリング、私的利用の範囲を超える複製・再配布・転売、運営を妨害する行為。</p>
    <p><b>第3条(知的財産権)</b> 本サービスのプログラム・文章・画像・計算データ等の権利は運営者または正当な権利者に帰属します。</p>
    <p><b>第4条(免責)</b> 本サービスは「現状有姿」で提供され、学習効果・計算の正確性・無中断・無誤りを保証しません。GTOの計算には近似・簡略化を含みます(詳細は「遊び方」参照)。本サービスの利用により生じた損害について、運営者は法令が許す範囲で責任を負いません。特に、現実のギャンブルにおける損失について一切責任を負いません。</p>
    <p><b>第5条(サービスの変更・中断・終了)</b> 運営者は予告なく内容の変更・中断・終了を行うことがあります。</p>
    <p><b>第6条(規約の変更)</b> 本規約は必要に応じて変更し、本ページへの掲示をもって効力を生じます。</p>
    <p><b>第7条(準拠法・管轄)</b> 本規約は日本法に準拠します。紛争は運営者所在地を管轄する裁判所を専属的合意管轄とします。</p>
    <p class="legal-note">最終更新: ${LEGAL_UPDATED}</p>` },
  { id: "tokushoho", title: "特定商取引法に基づく表記", body:
    `<p class="legal-note">⚠ <b>販売開始前に必ず実際の情報を記入してください。</b>有料のデジタルサービスを日本国内で提供する場合、特定商取引法によりこの表記が義務付けられています。</p>
    <table class="legal-table">
    <tr><th>販売事業者</th><td>【要記入: 氏名 または 法人名】</td></tr>
    <tr><th>運営統括責任者</th><td>【要記入: 氏名】</td></tr>
    <tr><th>所在地</th><td>【要記入】(個人の場合、請求があれば遅滞なく開示する旨の記載でも可)</td></tr>
    <tr><th>連絡先</th><td>【要記入: メールアドレス】(電話番号は請求があれば遅滞なく開示)</td></tr>
    <tr><th>販売価格</th><td>【要記入: 例 月額○○円(税込)】(課金方式の決定後に記入)</td></tr>
    <tr><th>商品代金以外の必要料金</th><td>インターネット接続の通信料はお客様のご負担となります</td></tr>
    <tr><th>支払方法・支払時期</th><td>【要記入: 例 App Store / Google Play / クレジットカード。決済時に課金】</td></tr>
    <tr><th>提供時期</th><td>決済完了後、ただちにご利用いただけます</td></tr>
    <tr><th>返品・解約</th><td>【要記入】デジタルコンテンツの性質上、購入後の返金は原則お受けできません。月額課金の場合は次回更新日の前に解約手続きをすることで、次回以降の課金を停止できます</td></tr>
    </table>` },
];
function renderLegal() {
  $("legal-body").innerHTML =
    `<p class="legal-intro">本サービスをご利用の前に、以下をご確認ください。<span class="dim">(最終更新: ${LEGAL_UPDATED})</span></p>` +
    LEGAL_DOCS.map((d, i) => `<div class="lesson">
      <div class="lesson-head" data-id="lg-${d.id}"><span class="lesson-title">${d.title}</span><span class="lesson-toggle">▼</span></div>
      <div class="lesson-body${i === 0 ? '' : ' hidden'}" id="lgb-${d.id}">${d.body}</div>
    </div>`).join("");
  $("legal-body").querySelectorAll(".lesson-head").forEach(h => h.onclick = () => $("lgb-" + h.dataset.id.slice(3)).classList.toggle("hidden"));
}

/* ---------- 実績・解放(継続のための進捗エンジン) ----------
 * すべて端末内の既存記録から進捗を算出するゼロコスト方式。
 * 見た目(キャラ/オールイン演出/KO演出)は Unlocks.isUnlocked(id) を参照して差し込む(デザイン側で実装)。 */
const UNLOCK_KEY = "pgt_unlocks_v1";
function computeProgress() {
  const ts = (loadRecord().tournaments) || [];
  const L = loadLeaks(), learn = loadLearn();
  const decisions = ts.reduce((s, t) => s + (t.decisions || 0), 0);
  const okCount = ts.reduce((s, t) => s + (t.best || 0) + (t.mixed || 0), 0);
  const lessonsDoneSet = learn.done || {};
  const basicsDone = LESSONS.filter(l => l.cat === "basics" && lessonsDoneSet[l.id]).length;
  const leaksMastered = Object.values(L.cats || {}).reduce((s, c) => s + ((c.examples || []).filter(e => (e.sr || 0) >= 3).length), 0);
  return {
    tourneys: ts.length,
    wins: ts.filter(t => t.result === "win").length,
    hands: ts.reduce((s, t) => s + (t.hands || 0), 0),
    decisions, okCount, okRate: decisions > 0 ? okCount / decisions : 0,
    itm: ts.filter(t => t.place && t.place <= 9).length,   // ファイナルテーブル(入賞)到達
    lessonsDone: Object.values(lessonsDoneSet).filter(Boolean).length,
    basicsDone, leaksMastered,
  };
}
// 解放アイテム(見た目・称号)。cond(progress)→解放、goal=未解放時のヒント
const UNLOCKS = [
  { id: "anim_allin", icon: "⚡", title: "オールイン演出", cond: p => p.hands >= 30, goal: "累計30ハンドで解放" },
  { id: "char_bunny", icon: "🐰", title: "バニーガール(マスコット)", cond: p => p.tourneys >= 3, goal: "3回トーナメントに挑戦で解放" },
  { id: "anim_ko", icon: "💥", title: "KO(撃破)演出", cond: p => p.itm >= 1, goal: "初の入賞(FT到達)で解放" },
  { id: "title_grind", icon: "🔥", title: "称号「グラインダー」", cond: p => p.hands >= 200, goal: "累計200ハンドで解放" },
  { id: "char_champ", icon: "👑", title: "チャンピオン・スキン", cond: p => p.wins >= 1, goal: "初優勝で解放" },
  { id: "title_sharp", icon: "🎯", title: "称号「シャープ」", cond: p => p.decisions >= 100 && p.okRate >= 0.85, goal: "100判断でGTO一致率85%以上" },
  { id: "theme_neon", icon: "🌃", title: "ネオン・テーブル", cond: p => p.hands >= 500, goal: "累計500ハンドで解放" },
  { id: "char_master", icon: "🏆", title: "マスター・スキン", cond: p => p.wins >= 3, goal: "通算3回優勝で解放" },
];
// 講座の章ごとの解放条件(段階的に学べるように)
const CHAPTER_UNLOCK = {
  basics: { cond: () => true, goal: "" },
  preflop: { cond: p => p.basicsDone >= 3, goal: "「基礎」3講座をすべて学習すると解放" },
  postflop: { cond: p => p.hands >= 100, goal: "累計100ハンドのプレイで解放" },
  tournament: { cond: p => p.itm >= 1, goal: "ファイナルテーブル(入賞)に1回到達で解放" },
};
function loadUnlocks() { try { return JSON.parse(localStorage.getItem(UNLOCK_KEY)) || { ids: [] }; } catch (e) { return { ids: [] }; } }
function saveUnlocks(u) { try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(u)); } catch (e) { } }
// 条件を評価し、新たに解放されたものを永続化して返す
function refreshUnlocks() {
  const p = computeProgress(), u = loadUnlocks(), have = new Set(u.ids), fresh = [];
  for (const item of UNLOCKS) if (!have.has(item.id) && item.cond(p)) { have.add(item.id); fresh.push(item); }
  u.ids = [...have]; saveUnlocks(u);
  return fresh;
}
function isChapterUnlocked(catKey) { const c = CHAPTER_UNLOCK[catKey]; return !c || c.cond(computeProgress()); }
// 見た目側(デザイン)から参照する公開API
window.Unlocks = { isUnlocked: id => loadUnlocks().ids.includes(id), refresh: refreshUnlocks, progress: computeProgress };

// コレクション(犬舎): 装備可能なコスメ。所持=装備切替、未所持=シルエット+条件。
const COSMO_CATS = [
  { cat: "dogs",   label: "🐕 仲間" },
  { cat: "tables", label: "🟢 テーブル" },
  { cat: "fx",     label: "✨ 演出" },
];
function cosmeticsSectionHTML() {
  if (typeof Cosmetics === "undefined") return "";
  return COSMO_CATS.map(({ cat, label }) => {
    const equipped = Cosmetics.equippedId(cat);
    const items = Cosmetics.CATALOG[cat].map(it => {
      const open = Cosmetics.isUnlocked(cat, it.id);
      const isEq = open && it.id === equipped;
      const cls = isEq ? "equipped" : open ? "equipable" : "locked";
      const sub = isEq ? '<span class="cosmo-eq">装備中 ✓</span>'
        : open ? '<span class="cosmo-tap">タップで装備</span>'
        : it.goal;
      const ico = (open && it.img) ? `<img class="cosmo-img" src="${it.img}" alt="">` : (open ? it.icon : "🔒");
      return `<div class="cosmo-item ${cls}" ${open && !isEq ? `data-cat="${cat}" data-id="${it.id}"` : ""}>
        <div class="cosmo-ico">${ico}</div>
        <div class="cosmo-main"><div class="cosmo-name">${it.name}</div><div class="cosmo-sub">${sub}</div></div>
      </div>`;
    }).join("");
    return `<h3 class="unlock-cat">${label}</h3><div class="cosmo-grid">${items}</div>`;
  }).join("");
}
function wireCollection() {
  document.querySelectorAll("#unlocks-body .cosmo-item.equipable").forEach(el => {
    el.onclick = () => {
      if (Cosmetics.equip(el.dataset.cat, el.dataset.id)) {
        if (typeof Sfx !== "undefined") Sfx.play("win");
        renderUnlocks();   // 再描画して装備中表示を更新
      }
    };
  });
}

// ライバル(チップ/メダル)図鑑 — HUで出会う相手の一覧
function rivalsGalleryHTML() {
  if (typeof Dog === "undefined" || !Dog.rivals) return "";
  return `<div class="rival-grid">` + Dog.rivals().map(r =>
    `<div class="rival-cell"><img src="${r.img}" alt=""><div class="rival-name">${r.name}</div><div class="rival-val">$${r.value}</div></div>`
  ).join("") + `</div>`;
}

function renderUnlocks() {
  const p = computeProgress(), have = new Set(loadUnlocks().ids);
  const got = UNLOCKS.filter(u => have.has(u.id)).length;
  const items = UNLOCKS.map(u => {
    const open = have.has(u.id);
    return `<div class="unlock-item ${open ? 'got' : 'locked'}">
      <div class="unlock-ico">${open ? u.icon : '🔒'}</div>
      <div class="unlock-main">
        <div class="unlock-title">${u.title}</div>
        <div class="unlock-sub">${open ? '<span class="unlock-got">解放済み ✓</span>' : u.goal}</div>
      </div></div>`;
  }).join("");
  const chapters = LESSON_CATS.map(c => {
    const open = isChapterUnlocked(c.key);
    return `<div class="unlock-item ${open ? 'got' : 'locked'}">
      <div class="unlock-ico">${open ? '📖' : '🔒'}</div>
      <div class="unlock-main">
        <div class="unlock-title">講座: ${c.title.replace(/^■\s*/, '')}</div>
        <div class="unlock-sub">${open ? '<span class="unlock-got">学習可能 ✓</span>' : (CHAPTER_UNLOCK[c.key] ? CHAPTER_UNLOCK[c.key].goal : '')}</div>
      </div></div>`;
  }).join("");
  $("unlocks-body").innerHTML =
    `<p class="unlock-intro">プレイを続けると仲間(犬)・テーブル・演出が解放されます。所持済みはタップで装備できます。
     <span class="dim">(進捗: ${p.tourneys}挑戦 / ${p.hands}ハンド / ${p.wins}優勝 / 一致率${(p.okRate * 100).toFixed(0)}%)</span></p>
     <h2 class="collection-head">🐕 コレクション</h2>
     ${cosmeticsSectionHTML()}
     <h2 class="collection-head" style="margin-top:22px">🪙 ライバル</h2>
     ${rivalsGalleryHTML()}
     <h2 class="collection-head" style="margin-top:22px">🏅 称号・実績 <span class="dim" style="font-size:13px">${got}/${UNLOCKS.length}</span></h2>
     <div class="unlock-list">${items}</div>
     <h3 class="unlock-cat">📚 講座の解放</h3><div class="unlock-list">${chapters}</div>`;
  wireCollection();
}

/* ---------- イベント登録 ---------- */
window.addEventListener("DOMContentLoaded", () => {
  renderHomeStats();
  applyDeviceMode(deviceMode(), false);
  if (typeof Cosmetics !== "undefined") { Cosmetics.apply(); Cosmetics.newlyUnlocked(); }   // 装備適用 + 解放スナップショットのベースライン化
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
  $("btn-drill").onclick = () => { renderDrill(); showScreen("screen-drill"); };
  $("drill-back").onclick = () => showScreen("screen-home");
  $("btn-learn").onclick = () => { renderLearn(); showScreen("screen-learn"); };
  $("learn-back").onclick = () => showScreen("screen-home");
  $("btn-legal").onclick = () => { renderLegal(); showScreen("screen-legal"); };
  $("legal-back").onclick = () => showScreen("screen-help");
  $("btn-unlocks").onclick = () => { renderUnlocks(); showScreen("screen-unlocks"); };
  $("unlocks-back").onclick = () => showScreen("screen-home");
  // 設定メニュー(☰ MENU): 効果音/コーチ表示/速度/退出をまとめる
  $("btn-menu").onclick = () => $("game-menu").classList.remove("hidden");
  $("gm-close").onclick = () => $("game-menu").classList.add("hidden");
  $("game-menu").onclick = (e) => { if (e.target.id === "game-menu") $("game-menu").classList.add("hidden"); };
  $("btn-quit").onclick = () => { aborting = true; $("game-menu").classList.add("hidden"); };

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
    if (confirm("成績をすべて削除しますか?")) { localStorage.removeItem(REC_KEY); localStorage.removeItem(LEAK_KEY); renderStats(); renderHomeStats(); }
  };
  $("help-back").onclick = () => showScreen("screen-home");
});
