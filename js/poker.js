/* =========================================================
 * poker.js — トーナメントエンジン
 * ブラインド 2000/4000 スタート(BBアンティ=BB)。2周(18ハンド)ごとにアップ。
 * 全員5〜30BBで開始。バストしたボットは新しいボットと入れ替わり(常に9人)。
 * ========================================================= */
"use strict";

const CFG = {
  MIN_BB: 5,
  MAX_BB: 30,
  SEATS: 9,
  OPEN_SIZE: 2.2,       // オープンレイズはBBの2.2倍
  HANDS_PER_LEVEL: 18,  // 2周(9人×2)ごとにブラインドアップ
};

// ブラインド構成 [SB, BB] (BBアンティ = BB、全額1,000チップ単位)
const BLIND_LEVELS = [
  [2000, 4000], [3000, 6000], [4000, 8000], [5000, 10000], [6000, 12000],
  [8000, 16000], [10000, 20000], [12000, 24000], [15000, 30000], [20000, 40000],
  [25000, 50000], [30000, 60000], [40000, 80000], [50000, 100000],
];

// 現在のブラインド(playHand開始時にstate.handNoから設定される)
let LIVE = { sb: 2000, bb: 4000, ante: 4000, level: 0 };
function setLevel(level) {
  const li = Math.min(level, BLIND_LEVELS.length - 1);
  LIVE = { sb: BLIND_LEVELS[li][0], bb: BLIND_LEVELS[li][1], ante: BLIND_LEVELS[li][1], level: li };
}
function levelForHand(handNo) {
  return Math.min(Math.floor((handNo - 1) / CFG.HANDS_PER_LEVEL), BLIND_LEVELS.length - 1);
}

const BOT_NAMES = ["鷹", "龍", "桜", "雪", "嵐", "鋼", "影", "月", "燕", "雷", "霧", "蓮", "隼", "楓", "弦"];
let botNameCounter = 0;

function toBB(chips) { return chips / LIVE.bb; }
function fmtBB(chips) { return (chips / LIVE.bb).toFixed(1); }
function fmtChips(n) { return n.toLocaleString("ja-JP"); }

function randomStack() {
  const bb = CFG.MIN_BB + Math.random() * (CFG.MAX_BB - CFG.MIN_BB);
  return Math.round(bb * LIVE.bb / 1000) * 1000; // 1,000チップ単位
}

function makeBot(seat) {
  const name = BOT_NAMES[botNameCounter % BOT_NAMES.length] + (botNameCounter >= BOT_NAMES.length ? "②" : "");
  botNameCounter++;
  return makePlayer(seat, name, false, randomStack());
}

function makePlayer(seat, name, isHero, chips) {
  return {
    seat, name, isHero, chips,
    cards: [], folded: true, allIn: false, out: false,
    streetBet: 0, committed: 0, hasActed: false, hadAggression: false,
    assumedRange: null, rangeNote: "",
    showCards: false, lastAction: null,
  };
}

function newTournament(heroName, fieldSize, heroBB) {
  botNameCounter = 0;
  setLevel(0);
  const players = [];
  const heroChips = heroBB ? Math.round(heroBB * LIVE.bb / 1000) * 1000 : randomStack();
  for (let s = 0; s < CFG.SEATS; s++) {
    if (s === 0) players.push(makePlayer(0, heroName || "あなた", true, heroChips));
    else players.push(makeBot(s));
  }
  const field = Math.max(CFG.SEATS, fieldSize || 27);
  return {
    players,
    fieldSize: field,   // トーナメント参加人数
    fieldLeft: field,   // 残り人数(自分+卓上ボット+他テーブルの仮想プレイヤー)
    finalTable: false,
    won: false,
    btn: (Math.random() * CFG.SEATS) | 0,
    handNo: 0,
    board: [],
    deadPot: 0,
    street: "idle",
    deck: [],
    log: [],
    handLog: [],
    preflopOpen: null,
    preflopJams: [],
    jamCallers: 0,
    heroDecisions: [],   // 全決断の記録(採点付き)
    handResults: [],     // ハンドごとの結果
    fastMode: false,
    over: false,
  };
}

/* ---------- 生存席ヘルパー(ショートハンド対応) ---------- */
function aliveSeats(state) {
  return state.players.filter(p => !p.out);
}
function nextAliveSeat(state, from) {
  for (let i = 1; i <= CFG.SEATS; i++) {
    const s = (from + i) % CFG.SEATS;
    if (!state.players[s].out) return s;
  }
  return from;
}
function aliveOrderFromBtn(state) {
  const order = [];
  for (let i = 0; i < CFG.SEATS; i++) {
    const seat = (state.btn + i) % CFG.SEATS;
    if (!state.players[seat].out) order.push(seat);
  }
  return order;
}

/* ---------- ポジション(人数に応じて動的に決定) ---------- */
function posIdxOf(state, seat) {
  if (state.players[seat] && state.players[seat].out) return -1;
  const order = aliveOrderFromBtn(state);
  const n = order.length;
  const k = order.indexOf(seat);
  if (k < 0) return -1;
  if (n === 2) return k === 0 ? POS_SB : POS_BB; // ヘッズアップ: BTN=SB
  if (k === 0) return POS_BTN;
  if (k === 1) return POS_SB;
  if (k === 2) return POS_BB;
  // 残りは後ろから CO, HJ, ... と詰める(9人ならk=3がUTG)
  return (9 - n) + (k - 3);
}
function posNameOf(state, seat) {
  const idx = posIdxOf(state, seat);
  return idx < 0 ? "" : POSITIONS[idx];
}

/* ---------- ハンド進行 ----------
 * io = {
 *   delay(ms), render(state), log(msg, cls),
 *   heroAct(ctx, legal) -> Promise<{id, chips}>,
 *   sound(name)?  ※省略可
 * }
 * ========================================================= */
async function playHand(state, io) {
  state.handNo++;
  // ブラインドレベル(2周=18ハンドごとにアップ)
  const lvl = levelForHand(state.handNo);
  const leveledUp = lvl !== LIVE.level;
  setLevel(lvl);
  if (leveledUp) {
    io.log(`📈 ブラインドアップ! Lv${lvl + 1}: ${fmtChips(LIVE.sb)} / ${fmtChips(LIVE.bb)} (アンティ ${fmtChips(LIVE.ante)})`, "levelup");
    if (io.sound) io.sound("levelup");
  }
  state.board = [];
  state.deadPot = 0;
  state.street = "preflop";
  state.preflopOpen = null;
  state.preflopJams = [];
  state.jamCallers = 0;
  state.handLog = [];

  // デッキ
  const deck = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  state.deck = deck;

  // プレイヤー初期化(アウト席はスキップ)
  for (const p of state.players) {
    if (p.out) {
      p.folded = true; p.cards = []; p.showCards = false;
      p.streetBet = 0; p.committed = 0; p.allIn = false; p.lastAction = null;
      continue;
    }
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false; p.allIn = false;
    p.streetBet = 0; p.committed = 0; p.hasActed = false; p.hadAggression = false;
    p.assumedRange = null; p.rangeNote = ""; p.showCards = false; p.lastAction = null;
    p.startChips = p.chips;
  }

  // ブラインド席(ヘッズアップはBTN=SB)
  const hu = aliveSeats(state).length === 2;
  const sbSeat = hu ? state.btn : nextAliveSeat(state, state.btn);
  const bbSeat = nextAliveSeat(state, sbSeat);
  state.sbSeat = sbSeat; state.bbSeat = bbSeat;
  const sbP = state.players[sbSeat], bbP = state.players[bbSeat];

  // BBアンティ(デッドマネー)
  const ante = Math.min(bbP.chips, LIVE.ante);
  bbP.chips -= ante; state.deadPot += ante;
  // ブラインド
  postBet(sbP, Math.min(sbP.chips, LIVE.sb));
  postBet(bbP, Math.min(bbP.chips, LIVE.bb));
  if (bbP.chips === 0) bbP.allIn = true;
  if (sbP.chips === 0) sbP.allIn = true;

  io.log(`─── ハンド #${state.handNo} ─── BTN: ${state.players[state.btn].name}`, "hand-sep");
  if (io.sound) io.sound("deal");
  io.render(state);
  await io.delay(300);

  // プリフロップ
  await bettingRound(state, "preflop", LIVE.bb, io);

  // プリフロップのアグレッサーを記録(チェック・トゥ・ザ・レイザー判定用)
  state.prevAggressorSeat = state.preflopOpen ? state.preflopOpen.seat
    : (state.preflopJams.length > 0 ? state.preflopJams[state.preflopJams.length - 1].seat : null);

  const streets = [["flop", 3], ["turn", 1], ["river", 1]];
  for (const [street, n] of streets) {
    if (activeCount(state) <= 1) break;
    state.street = street;
    state.curStreetAggressor = null;
    for (let i = 0; i < n; i++) state.board.push(state.deck.pop());
    for (const p of state.players) { p.streetBet = 0; p.hasActed = false; p.hadAggression = false; if (!p.folded) p.lastAction = null; }
    io.log(`【${streetJP(street)}】 ${state.board.map(cardText).join(" ")}`, "street");
    if (io.sound) io.sound("deal");
    io.render(state);
    await io.delay(450);
    if (canAct(state).length >= 2) {
      await bettingRound(state, street, 0, io);
    } else {
      // オールイン済み: カードを公開してランアウトを見せる
      for (const p of state.players) if (!p.folded) p.showCards = true;
      io.render(state);
      await io.delay(700);
    }
    // このストリートのアグレッサーを次ストリートの判定用に引き継ぐ
    state.prevAggressorSeat = state.curStreetAggressor; // 誰もベットしなければnull(=スタブOK)
  }

  // ショーダウン / ポット分配
  await resolveHand(state, io);

  // バスト処理: 補欠(他テーブルの選手)がいる間は席が埋まり、いなければ席が消える
  // ※FT以降は絶対に補充しない(ダブルKO時の幽霊着席→誤優勝判定バグの防止)
  for (const p of state.players) {
    if (!p.isHero && !p.out && p.chips <= 0) {
      state.fieldLeft--;
      const tableAlive = state.players.filter(q => !q.out && q.chips > 0).length;
      if (!state.finalTable && state.fieldLeft > tableAlive) {
        const fresh = makeBot(p.seat);
        io.log(`${p.name} がバスト(残り${state.fieldLeft}人)。${fresh.name} が移動してきた (${fmtBB(fresh.chips)}BB)`, "info");
        state.players[p.seat] = fresh;
      } else {
        p.out = true;
        io.log(`${p.name} がバスト! 残り${state.fieldLeft}人`, "info");
      }
    }
  }

  // 他テーブルでも脱落が進行する
  const tableAliveNow = state.players.filter(q => !q.out && q.chips > 0).length;
  if (state.fieldLeft > tableAliveNow && Math.random() < 0.4) {
    state.fieldLeft--;
    io.log(`他のテーブルで1人バスト(残り${state.fieldLeft}人)`, "info");
  }

  // バブル宣言(あと1人でイン・ザ・マネー=FT)
  if (!state.bubbleAnnounced && !state.finalTable && state.fieldLeft === CFG.SEATS + 1) {
    state.bubbleAnnounced = true;
    io.log(`💥 バブル! 残り${state.fieldLeft}人 — あと1人飛べばファイナルテーブル=全員入賞!`, "levelup");
    if (io.sound) io.sound("final");
  }
  // ファイナルテーブル宣言(=イン・ザ・マネー)
  if (!state.finalTable && state.fieldLeft <= CFG.SEATS) {
    state.finalTable = true;
    io.log(`🔥 ファイナルテーブル! 残り${state.fieldLeft}人 — 🎉全員イン・ザ・マネー(入賞確定)! ここからは席の補充なし`, "levelup");
    if (io.sound) io.sound("final");
  }

  const hero = state.players.find(p => p.isHero);
  if (hero.chips <= 0) {
    state.over = true; // バスト(順位 = state.fieldLeft)
  } else if (state.fieldLeft <= 1) {
    state.won = true;  // 優勝!!
    state.over = true;
    io.log(`🏆 優勝!!! ${state.fieldSize}人のトーナメントを制覇!`, "win");
  }

  state.btn = nextAliveSeat(state, state.btn);
  state.street = "idle";
  io.render(state);
}

function streetJP(s) {
  return { preflop: "プリフロップ", flop: "フロップ", turn: "ターン", river: "リバー" }[s] || s;
}

function postBet(p, amount) {
  p.chips -= amount;
  p.streetBet += amount;
  p.committed += amount;
}

function potTotal(state) {
  return state.deadPot + state.players.reduce((s, p) => s + p.committed, 0);
}

function activeCount(state) {
  return state.players.filter(p => !p.folded).length;
}
function canAct(state) {
  return state.players.filter(p => !p.folded && !p.allIn);
}

/* ---------- ベッティングラウンド ---------- */
async function bettingRound(state, street, initialBet, io) {
  const ps = state.players;
  let currentBet = initialBet;
  let firstSeat;
  // プリフロップ: BBの次(HUではBTN=SBが先)、ポストフロップ: BTNの次
  if (street === "preflop") firstSeat = nextAliveSeat(state, state.bbSeat);
  else firstSeat = nextAliveSeat(state, state.btn);

  let guard = 0;
  let cursor = firstSeat;
  // ミニマムレイズ追跡(プリフロップはBB、ポストフロップは最低ベット=BB)
  let lastRaise = street === "preflop" ? LIVE.bb : LIVE.bb;
  while (guard++ < 200) {
    if (activeCount(state) <= 1) return;
    // 次にアクションが必要なプレイヤーを探す
    let actor = null;
    for (let i = 0; i < CFG.SEATS; i++) {
      const p = ps[(cursor + i) % CFG.SEATS];
      if (p.folded || p.allIn) continue;
      if (!p.hasActed || p.streetBet < currentBet) { actor = p; break; }
    }
    if (!actor) { state.actorSeat = null; return; }
    cursor = (actor.seat + 1) % CFG.SEATS;
    state.actorSeat = actor.seat;
    state.minRaiseTarget = currentBet + lastRaise;
    io.render(state);

    const legal = legalActions(state, actor, currentBet, street);
    const ctx = buildCtx(state, actor, currentBet, street);

    let action;
    if (actor.isHero) {
      action = await io.heroAct(ctx, legal);
    } else {
      await io.delay(380);
      action = await botAct(state, actor, ctx, legal, io);
    }
    state.actorSeat = null;
    applyAction(state, actor, action, currentBet, street, io);
    if (["bet33", "bet66", "raise", "jam", "raiseTo"].includes(action.id)) {
      const newBet = actor.streetBet;
      if (newBet - currentBet > 0) lastRaise = Math.max(lastRaise, newBet - currentBet);
      currentBet = newBet;
      state.curStreetAggressor = actor.seat;
      for (const q of ps) if (q !== actor && !q.folded && !q.allIn) q.hasActed = false;
    }
    actor.hasActed = true;
    io.render(state);
  }
}

/* ---------- 合法アクション ----------
 * 各要素: {id, label, target(このストリートの合計ベット目標)}
 */
function legalActions(state, p, currentBet, street) {
  const toCall = currentBet - p.streetBet;
  const pot = potTotal(state);
  const out = [];
  const maxTarget = p.streetBet + p.chips;
  const r1k = v => Math.round(v / 1000) * 1000;

  // プリフロップ未オープン(ブラインドのみ): リンプ無し → フォールド/レイズ/オールイン
  if (street === "preflop" && toCall > 0 && !state.preflopOpen && state.preflopJams.length === 0) {
    out.push({ id: "fold", label: "フォールド" });
    const target = r1k(CFG.OPEN_SIZE * LIVE.bb);
    if (maxTarget > target) {
      out.push({ id: "raise", label: `レイズ ${fmtChips(target)}`, target });
    }
    // レイズ額指定(ミニレイズ=2BB 〜 オールイン未満)
    const minOpen = 2 * LIVE.bb;
    if (maxTarget > minOpen) {
      out.push({ id: "raiseTo", label: "レイズ額指定", minTarget: minOpen, maxTarget });
    }
    out.push({ id: "jam", label: `オールイン ${fmtChips(maxTarget)}`, target: maxTarget });
    return out;
  }
  if (toCall > 0) {
    out.push({ id: "fold", label: "フォールド" });
    const callAmt = Math.min(toCall, p.chips);
    out.push({ id: "call", label: `コール ${fmtChips(callAmt)}`, pay: callAmt });
    const opp = state.players.filter(q => !q.folded && !q.allIn && q !== p);
    if (p.chips > toCall && opp.length > 0) {
      // レイズ額指定(ミニマムレイズ 〜 オールイン未満)
      const minR = Math.min(state.minRaiseTarget || (currentBet + LIVE.bb), maxTarget);
      if (maxTarget > minR) {
        out.push({ id: "raiseTo", label: "レイズ額指定", minTarget: minR, maxTarget });
      }
      out.push({ id: "jam", label: `オールイン ${fmtChips(maxTarget)}`, target: maxTarget, isRaise: true });
    }
  } else {
    out.push({ id: "check", label: "チェック" });
    if (street === "preflop") {
      const target = r1k(CFG.OPEN_SIZE * LIVE.bb);
      if (maxTarget > target) {
        out.push({ id: "raise", label: `レイズ ${fmtChips(target)}`, target });
      }
      if (maxTarget > 2 * LIVE.bb) {
        out.push({ id: "raiseTo", label: "レイズ額指定", minTarget: 2 * LIVE.bb, maxTarget });
      }
      out.push({ id: "jam", label: `オールイン ${fmtChips(maxTarget)}`, target: maxTarget });
    } else {
      const b33 = Math.max(LIVE.bb, r1k(pot * 0.33));
      const b66 = Math.max(LIVE.bb, r1k(pot * 0.66));
      if (p.chips > b33) out.push({ id: "bet33", label: `ベット33% (${fmtChips(b33)})`, target: b33 });
      if (p.chips > b66 && b66 > b33) out.push({ id: "bet66", label: `ベット66% (${fmtChips(b66)})`, target: b66 });
      if (maxTarget > LIVE.bb) {
        out.push({ id: "raiseTo", label: "ベット額指定", minTarget: LIVE.bb, maxTarget });
      }
      out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips)}`, target: maxTarget });
    }
  }
  return out;
}

/* ---------- アクション適用 ---------- */
function applyAction(state, p, action, currentBet, street, io) {
  const pos = posNameOf(state, p.seat);
  const tag = `${p.name}(${pos})`;
  if (action.id === "fold") {
    p.folded = true;
    p.lastAction = "FOLD";
    io.log(`${tag}: フォールド`, "fold");
    if (io.sound) io.sound("fold");
    return;
  }
  if (action.id === "check") {
    p.lastAction = "CHECK";
    io.log(`${tag}: チェック`, "check");
    if (io.sound) io.sound("check");
    return;
  }
  if (action.id === "call") {
    const toCall = Math.min(currentBet - p.streetBet, p.chips);
    postBet(p, toCall);
    if (p.chips === 0) p.allIn = true;
    if (street === "preflop" && state.preflopJams.length > 0) state.jamCallers++;
    p.lastAction = p.allIn ? "ALL IN" : "CALL";
    io.log(`${tag}: コール ${fmtChips(toCall)}${p.allIn ? " (オールイン)" : ""}`, "call");
    if (io.sound) io.sound("chip");
    return;
  }
  // ベット/レイズ/ジャム
  const target = Math.min(action.target, p.streetBet + p.chips);
  const pay = target - p.streetBet;
  postBet(p, pay);
  p.hadAggression = true;
  if (p.chips === 0) p.allIn = true;
  p.lastAction = (action.id === "jam" || p.allIn) ? "ALL IN"
    : (street === "preflop" ? "RAISE" : (currentBet > 0 ? "RAISE" : "BET"));

  if (street === "preflop") {
    const posIdx = posIdxOf(state, p.seat);
    const stackBB = toBB(p.startChips);
    if (action.id === "jam") {
      let range;
      if (state.preflopOpen && state.preflopOpen.seat !== p.seat) {
        range = Ranges.rejam(state.preflopOpen.cls, Math.min(stackBB, state.preflopOpen.stackBB));
        p.rangeNote = "リジャム";
      } else {
        range = Ranges.push(posIdx, stackBB);
        p.rangeNote = "オープンジャム";
      }
      p.assumedRange = range;
      state.preflopJams.push({ seat: p.seat, range, posIdx });
      io.log(`${tag}: オールイン ${fmtChips(target)} (${fmtBB(target)}BB)`, "jam");
      if (io.sound) io.sound("jam");
    } else if (state.preflopOpen && state.preflopOpen.seat !== p.seat) {
      // 非オールインの3ベット: リジャムレンジ相当とみなす
      p.assumedRange = Ranges.rejam(state.preflopOpen.cls, Math.min(stackBB, state.preflopOpen.stackBB));
      p.rangeNote = "3ベット";
      state.preflopOpen = { seat: p.seat, posIdx, cls: openerClass(posIdx), sizeBB: toBB(target), stackBB };
      io.log(`${tag}: レイズ ${fmtChips(target)}`, "raise");
      if (io.sound) io.sound("chip");
    } else {
      p.assumedRange = Ranges.open(posIdx, stackBB);
      p.rangeNote = "オープンレイズ";
      state.preflopOpen = { seat: p.seat, posIdx, cls: openerClass(posIdx), sizeBB: toBB(target), stackBB };
      io.log(`${tag}: レイズ ${fmtChips(target)}`, "raise");
      if (io.sound) io.sound("chip");
    }
  } else {
    const lbl = action.id === "jam" ? `オールイン ${fmtChips(target)}` :
      `ベット ${fmtChips(pay)}`;
    io.log(`${tag}: ${lbl}`, action.id === "jam" ? "jam" : "raise");
    if (io.sound) io.sound(action.id === "jam" ? "jam" : "chip");
  }
}

/* ---------- コンテキスト構築(戦略エンジンへの入力) ---------- */
function buildCtx(state, p, currentBet, street) {
  const pot = potTotal(state);
  const toCall = Math.min(currentBet - p.streetBet, p.chips);
  const posIdx = posIdxOf(state, p.seat);

  if (street === "preflop") {
    let facing = "none";
    let jamRange = null, jamCount = 0, openerClassV = null, effBB = toBB(p.startChips);
    if (state.preflopJams.length > 0) {
      facing = (state.preflopOpen && state.preflopOpen.seat === p.seat) ? "rejamOverMyOpen" : "jam";
      // 最初のジャマー(最もタイトと想定)のレンジを使用
      jamRange = state.preflopJams[0].range;
      jamCount = state.preflopJams.length + state.jamCallers;
    } else if (state.preflopOpen && state.preflopOpen.seat !== p.seat) {
      facing = "open";
      openerClassV = state.preflopOpen.cls;
      effBB = Math.min(toBB(p.startChips), state.preflopOpen.stackBB);
    }
    // FTでジャムに直面 → ICM補正用コンテキスト
    let icm = null;
    if ((facing === "jam" || facing === "rejamOverMyOpen") && state.preflopJams.length > 0) {
      icm = icmCtxFor(state, p, state.preflopJams[0].seat);
      if (icm) icm.toCallChips = toCall;
    }
    // FTでジャムする側 → ICM評価用コンテキスト(相手=最も脅威な後続スタック)
    let icmJam = null;
    if (state.finalTable && (facing === "none" || facing === "open") && typeof Icm !== "undefined") {
      let villSeat = -1, villChips = -1;
      if (facing === "open" && state.preflopOpen) {
        villSeat = state.preflopOpen.seat;
      } else {
        for (const q of state.players) {
          if (q.out || q.folded || q === p) continue;
          if (q.chips > villChips) { villChips = q.chips; villSeat = q.seat; }
        }
      }
      if (villSeat >= 0) {
        icmJam = icmCtxFor(state, p, villSeat);
        if (icmJam) {
          icmJam.bbChips = LIVE.bb;
          icmJam.heroPostedChips = p.committed;
        }
      }
    }
    // 残っているディフェンダー数(ショートハンド・前のフォールドを正確に反映)
    const defendersN = state.players.filter(q => !q.out && !q.folded && q !== p).length;
    return {
      phase: "preflop",
      heroCards: p.cards, heroLabel: handLabelOf(p.cards[0], p.cards[1]),
      posIdx, stackBB: toBB(p.startChips), effBB,
      tableN: aliveSeats(state).length,
      icm, icmJam, defendersN,
      facing, openerClass: openerClassV,
      openerPosIdx: state.preflopOpen ? state.preflopOpen.posIdx : null,
      openSizeBB: state.preflopOpen ? state.preflopOpen.sizeBB : 0,
      jamRange, jamCount,
      playersBehind: facing === "jam" ? countBehindForJam(state, p) : 0,
      potBB: toBB(pot), toCallBB: toBB(toCall),
      fast: state.fastMode,
      seatName: posNameOf(state, p.seat),
    };
  }

  // ポストフロップ
  const pfrSeat = state.preflopOpen ? state.preflopOpen.seat : -1;
  const role = p.seat === pfrSeat ? "pfr" : "caller";
  const opps = state.players.filter(q => !q.folded && q !== p);
  // 主たる相手: アグレッサー優先、いなければ最初のアクティブ
  let mainOpp = opps.find(q => q.hadAggression) || opps.find(q => q.seat === pfrSeat) || opps[0];
  let oppRange = mainOpp && mainOpp.assumedRange;
  if (!oppRange) {
    // レンジ情報なし(BBチェックなど) → BBディフェンスレンジで代用
    oppRange = state.preflopOpen ? Ranges.bbCall(state.preflopOpen.cls, 20) : parseRange("22+,A2s+,A2o+,K2s+,K2o+,Q2s+,Q5o+,J4s+,J8o+,T6s+,T8o+,96s+,98o,85s+,87o,75s+,64s+,54s");
  }
  let facing = "none";
  if (toCall > 0) {
    facing = (p.hadAggression && mainOpp && mainOpp.allIn) ? "raiseAllin" : "bet";
  }
  const effBehind = Math.min(p.chips, mainOpp ? mainOpp.chips + mainOpp.streetBet : p.chips);
  const oppCanRespond = opps.some(q => !q.allIn);
  // FTで相手のオールインに直面 → ICM補正
  let icm = null;
  if (facing !== "none" && mainOpp && mainOpp.allIn) {
    icm = icmCtxFor(state, p, mainOpp.seat);
    if (icm) icm.toCallChips = toCall;
  }
  // 前ストリート(プリフロップ含む)のアグレッサー情報(チェック・トゥ・ザ・レイザー)
  const prevAgg = state.prevAggressorSeat;
  const prevAggP = prevAgg != null ? state.players[prevAgg] : null;
  return {
    phase: "postflop",
    icm,
    prevAggressorSeat: prevAgg,
    iWasPrevAggressor: prevAgg === p.seat,
    aggressorActive: !!(prevAggP && !prevAggP.folded && !prevAggP.out),
    heroCards: p.cards, heroLabel: handLabelOf(p.cards[0], p.cards[1]),
    board: state.board.slice(), street,
    potBB: toBB(pot), toCallBB: toBB(toCall),
    heroBehindBB: toBB(p.chips), effBehindBB: toBB(effBehind),
    role, oppRange, facing,
    playersIn: activeCount(state),
    canRaise: toCall > 0 && p.chips > toCall && oppCanRespond,
    fast: state.fastMode,
    posIdx, seatName: posNameOf(state, p.seat),
  };
}

/* FTでのICMコンテキスト(全員のスタック既知の時のみ) */
function icmCtxFor(state, p, villainSeat) {
  if (!state.finalTable || typeof Icm === "undefined") return null;
  const alive = state.players.filter(q => !q.out);
  if (alive.length < 2) return null;
  const heroI = alive.indexOf(p);
  const villI = alive.findIndex(q => q.seat === villainSeat);
  if (heroI < 0 || villI < 0 || heroI === villI) return null;
  return {
    stacks: alive.map(q => q.chips),
    heroI, villI,
    potChips: potTotal(state),
    toCallChips: 0, // 呼び出し側で設定
    payouts: Icm.payoutsFor(state.fieldSize, alive.length),
  };
}

function countBehindForJam(state, p) {
  // ジャムに対するコール判断時、まだ手番が残っているプレイヤー数
  let n = 0;
  for (const q of state.players) {
    if (q.folded || q.allIn || q === p || q.out) continue;
    if (!q.hasActed) n++;
  }
  return Math.max(0, n);
}

/* ---------- ボットのアクション ---------- */
async function botAct(state, p, ctx, legal, io) {
  const advice = ctx.phase === "preflop" ? await preflopAdvice(ctx) : await postflopAdvice(ctx);
  let id = sampleAction(advice.freqs);
  // 戦略のアクションを合法アクションへマッピング
  const ids = legal.map(a => a.id);
  if (id === "raise" && !ids.includes("raise")) id = ids.includes("jam") ? "jam" : "call";
  if (id === "bet33" && !ids.includes("bet33")) id = ids.includes("jam") ? "jam" : "check";
  if (id === "bet66" && !ids.includes("bet66")) id = ids.includes("bet33") ? "bet33" : (ids.includes("jam") ? "jam" : "check");
  if (id === "jam" && !ids.includes("jam")) id = ids.includes("call") ? "call" : "check";
  if (id === "call" && !ids.includes("call")) id = "check";
  if (id === "check" && !ids.includes("check")) id = "fold";
  if (!ids.includes(id)) id = ids[0].id ? ids[0].id : "fold";
  const act = legal.find(a => a.id === id) || legal[0];
  // BBがオープンにコールしたらレンジを記録
  if (ctx.phase === "preflop" && id === "call" && ctx.facing === "open" && ctx.posIdx === POS_BB) {
    p.assumedRange = Ranges.bbCall(ctx.openerClass, ctx.effBB);
    p.rangeNote = "BBディフェンス";
  }
  return act;
}

/* ---------- ハンド解決(ショーダウン・サイドポット) ---------- */
async function resolveHand(state, io) {
  const contenders = state.players.filter(p => !p.folded);
  const pot = potTotal(state);

  if (contenders.length === 1) {
    const w = contenders[0];
    w.chips += pot;
    resetCommit(state);
    io.log(`${w.name} がポット ${fmtChips(pot)} を獲得`, "win");
    if (io.sound) io.sound(w.isHero ? "win" : "collect");
    io.render(state);
    await io.delay(500);
    recordHandResult(state, [{ name: w.name, isHero: w.isHero, amount: pot }], false);
    return;
  }

  // ボードを5枚まで(全員オールインで途中だった場合は playHand 側で配り済み)
  while (state.board.length < 5) state.board.push(state.deck.pop());
  state.street = "showdown";
  for (const p of contenders) p.showCards = true;
  io.render(state);

  // 払い過ぎ返金: 最大コミットが他の最大より大きい場合
  const sorted = [...contenders].sort((a, b) => b.committed - a.committed);
  const others = state.players.filter(p => p !== sorted[0]);
  const maxOther = Math.max(...others.map(p => p.committed));
  if (sorted[0].committed > maxOther) {
    const refund = sorted[0].committed - maxOther;
    sorted[0].chips += refund;
    sorted[0].committed -= refund;
  }

  // サイドポット構築
  const levels = [...new Set(contenders.map(p => p.committed))].sort((a, b) => a - b);
  let prev = 0;
  const pots = [];
  for (const lv of levels) {
    let amt = 0;
    for (const p of state.players) amt += Math.max(0, Math.min(p.committed, lv) - Math.min(p.committed, prev));
    const eligible = contenders.filter(p => p.committed >= lv);
    if (amt > 0) pots.push({ amt, eligible });
    prev = lv;
  }
  if (pots.length > 0) pots[0].amt += state.deadPot;

  // 各ポットの勝者決定
  const scores = new Map();
  for (const p of contenders) scores.set(p, evaluate7(p.cards.concat(state.board)));
  const winners = [];
  for (const pt of pots) {
    let best = -1;
    for (const p of pt.eligible) if (scores.get(p) > best) best = scores.get(p);
    const ws = pt.eligible.filter(p => scores.get(p) === best);
    const share = Math.floor(pt.amt / ws.length / 1000) * 1000;
    let dealt = 0;
    for (let i = 0; i < ws.length; i++) {
      const give = i === ws.length - 1 ? pt.amt - dealt : share;
      ws[i].chips += give; dealt += give;
      winners.push({ name: ws[i].name, isHero: ws[i].isHero, amount: give, hand: handRankJP(scores.get(ws[i])) });
    }
  }
  resetCommit(state);

  // ログ
  for (const p of contenders) {
    io.log(`${p.name}: ${p.cards.map(cardText).join(" ")} → ${handRankJP(scores.get(p))}`, "show");
  }
  for (const w of winners) {
    io.log(`${w.name} が ${fmtChips(w.amount)} を獲得 (${w.hand})`, "win");
  }
  if (io.sound) io.sound(winners.some(w => w.isHero) ? "win" : "collect");
  io.render(state);
  await io.delay(900);
  recordHandResult(state, winners, true);
}

function resetCommit(state) {
  state.deadPot = 0;
  for (const p of state.players) { p.committed = 0; p.streetBet = 0; }
}

function recordHandResult(state, winners, showdown) {
  const hero = state.players.find(p => p.isHero);
  state.handResults.push({
    handNo: state.handNo,
    heroChips: hero.chips,
    heroWon: winners.some(w => w.isHero),
    showdown,
  });
}

function handRankJP(score) {
  const cat = score >> 20;
  return ["ハイカード", "ワンペア", "ツーペア", "トリップス", "ストレート", "フラッシュ", "フルハウス", "クアッズ", "ストレートフラッシュ"][cat];
}
