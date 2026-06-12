/* =========================================================
 * poker.js — トーナメントエンジン
 * 固定ブラインド 2000/4000・BBアンティ4000。全員5〜30BBで開始。
 * バストしたボットは新しい5〜30BBのボットと入れ替わり(常に9人)。
 * ========================================================= */
"use strict";

const CFG = {
  SB: 2000,
  BB: 4000,
  ANTE: 4000,
  MIN_BB: 5,
  MAX_BB: 30,
  SEATS: 9,
  OPEN_SIZE: 2.2, // オープンレイズはBBの2.2倍
};

const BOT_NAMES = ["鷹", "龍", "桜", "雪", "嵐", "鋼", "影", "月", "燕", "雷", "霧", "蓮", "隼", "楓", "弦"];
let botNameCounter = 0;

function toBB(chips) { return chips / CFG.BB; }
function fmtBB(chips) { return (chips / CFG.BB).toFixed(1); }
function fmtChips(n) { return n.toLocaleString("ja-JP"); }

function randomStack() {
  const bb = CFG.MIN_BB + Math.random() * (CFG.MAX_BB - CFG.MIN_BB);
  return Math.round(bb * CFG.BB / 100) * 100; // 100点単位
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
    showCards: false,
  };
}

function newTournament(heroName) {
  botNameCounter = 0;
  const players = [];
  for (let s = 0; s < CFG.SEATS; s++) {
    if (s === 0) players.push(makePlayer(0, heroName || "あなた", true, randomStack()));
    else players.push(makeBot(s));
  }
  return {
    players,
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

/* ---------- ポジション ---------- */
const OFFSET_TO_POS = [6, 7, 8, 0, 1, 2, 3, 4, 5]; // btnからのオフセット → POSITIONSインデックス
function posIdxOf(state, seat) {
  const off = (seat - state.btn + CFG.SEATS) % CFG.SEATS;
  return OFFSET_TO_POS[off];
}
function seatAtPos(state, posIdx) {
  const off = OFFSET_TO_POS.indexOf(posIdx);
  return (state.btn + off) % CFG.SEATS;
}
function posNameOf(state, seat) { return POSITIONS[posIdxOf(state, seat)]; }

/* ---------- ハンド進行 ----------
 * io = {
 *   delay(ms), render(state), log(msg, cls),
 *   heroAct(ctx, legal) -> Promise<{id, chips}>,
 *   onShowdown(state, results), fast
 * }
 * ========================================================= */
async function playHand(state, io) {
  state.handNo++;
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

  // プレイヤー初期化
  for (const p of state.players) {
    p.cards = [deck.pop(), deck.pop()];
    p.folded = false; p.allIn = false;
    p.streetBet = 0; p.committed = 0; p.hasActed = false; p.hadAggression = false;
    p.assumedRange = null; p.rangeNote = ""; p.showCards = false;
    p.startChips = p.chips;
  }

  const sbSeat = (state.btn + 1) % CFG.SEATS;
  const bbSeat = (state.btn + 2) % CFG.SEATS;
  const sbP = state.players[sbSeat], bbP = state.players[bbSeat];

  // BBアンティ(デッドマネー)
  const ante = Math.min(bbP.chips, CFG.ANTE);
  bbP.chips -= ante; state.deadPot += ante;
  // ブラインド
  postBet(sbP, Math.min(sbP.chips, CFG.SB));
  postBet(bbP, Math.min(bbP.chips, CFG.BB));
  if (bbP.chips === 0) bbP.allIn = true;
  if (sbP.chips === 0) sbP.allIn = true;

  io.log(`─── ハンド #${state.handNo} ─── BTN: ${state.players[state.btn].name}`, "hand-sep");
  io.render(state);
  await io.delay(300);

  // プリフロップ
  await bettingRound(state, "preflop", CFG.BB, io);

  const streets = [["flop", 3], ["turn", 1], ["river", 1]];
  for (const [street, n] of streets) {
    if (activeCount(state) <= 1) break;
    state.street = street;
    for (let i = 0; i < n; i++) state.board.push(state.deck.pop());
    for (const p of state.players) { p.streetBet = 0; p.hasActed = false; p.hadAggression = false; }
    io.log(`【${streetJP(street)}】 ${state.board.map(cardText).join(" ")}`, "street");
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
  }

  // ショーダウン / ポット分配
  await resolveHand(state, io);

  // バストしたボットを入れ替え
  for (const p of state.players) {
    if (!p.isHero && p.chips <= 0) {
      const fresh = makeBot(p.seat);
      io.log(`${p.name} がバスト。新たに ${fresh.name} が着席 (${fmtBB(fresh.chips)}BB)`, "info");
      state.players[p.seat] = fresh;
    }
  }
  const hero = state.players.find(p => p.isHero);
  if (hero.chips <= 0) state.over = true;

  state.btn = (state.btn + 1) % CFG.SEATS;
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
  if (street === "preflop") firstSeat = (state.btn + 3) % CFG.SEATS;
  else firstSeat = (state.btn + 1) % CFG.SEATS;

  let guard = 0;
  let cursor = firstSeat;
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
    if (action.id === "bet33" || action.id === "bet66" || action.id === "raise" || action.id === "jam") {
      currentBet = actor.streetBet;
      for (const q of ps) if (q !== actor && !q.folded && !q.allIn) q.hasActed = false;
    }
    actor.hasActed = true;
    io.render(state);
  }
}

/* ---------- 合法アクション ----------
 * 各要素: {id, label, chips(支払額ではなくこのストリートの合計ベット目標)}
 */
function legalActions(state, p, currentBet, street) {
  const toCall = currentBet - p.streetBet;
  const pot = potTotal(state);
  const out = [];
  // プリフロップ未オープン(ブラインドのみ): リンプ無し → フォールド/レイズ2.2BB/オールイン
  if (street === "preflop" && toCall > 0 && !state.preflopOpen && state.preflopJams.length === 0) {
    out.push({ id: "fold", label: "フォールド" });
    const target = Math.round(CFG.OPEN_SIZE * CFG.BB);
    if (p.chips + p.streetBet > target && toBB(p.startChips) > 13.5) {
      out.push({ id: "raise", label: `レイズ ${fmtChips(target)}`, target });
    }
    out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips + p.streetBet)}`, target: p.streetBet + p.chips });
    return out;
  }
  if (toCall > 0) {
    out.push({ id: "fold", label: "フォールド" });
    const callAmt = Math.min(toCall, p.chips);
    out.push({ id: "call", label: `コール ${fmtChips(callAmt)}`, pay: callAmt });
    // レイズはオールインのみ(ショートスタック抽象化)
    const opp = state.players.filter(q => !q.folded && !q.allIn && q !== p);
    if (p.chips > toCall && opp.length > 0) {
      out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips + p.streetBet)}`, target: p.streetBet + p.chips, isRaise: true });
    }
  } else {
    out.push({ id: "check", label: "チェック" });
    if (street === "preflop") {
      // オープンレイズ(2.2BB)
      const target = Math.round(CFG.OPEN_SIZE * CFG.BB);
      if (p.chips + p.streetBet > target) {
        out.push({ id: "raise", label: `レイズ ${fmtChips(target)}`, target });
      }
      out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips + p.streetBet)}`, target: p.streetBet + p.chips });
    } else {
      const b33 = Math.max(CFG.BB, Math.round(pot * 0.33 / 100) * 100);
      const b66 = Math.max(CFG.BB, Math.round(pot * 0.66 / 100) * 100);
      if (p.chips > b33) out.push({ id: "bet33", label: `ベット33% (${fmtChips(b33)})`, target: b33 });
      if (p.chips > b66 && b66 > b33) out.push({ id: "bet66", label: `ベット66% (${fmtChips(b66)})`, target: b66 });
      out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips)}`, target: p.streetBet + p.chips });
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
    io.log(`${tag}: フォールド`, "fold");
    return;
  }
  if (action.id === "check") {
    io.log(`${tag}: チェック`, "check");
    return;
  }
  if (action.id === "call") {
    const toCall = Math.min(currentBet - p.streetBet, p.chips);
    postBet(p, toCall);
    if (p.chips === 0) p.allIn = true;
    if (street === "preflop" && state.preflopJams.length > 0) state.jamCallers++;
    io.log(`${tag}: コール ${fmtChips(toCall)}${p.allIn ? " (オールイン)" : ""}`, "call");
    return;
  }
  // ベット/レイズ/ジャム
  const target = Math.min(action.target, p.streetBet + p.chips);
  const pay = target - p.streetBet;
  postBet(p, pay);
  p.hadAggression = true;
  if (p.chips === 0) p.allIn = true;

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
    } else {
      p.assumedRange = Ranges.open(posIdx, stackBB);
      p.rangeNote = "オープンレイズ";
      state.preflopOpen = { seat: p.seat, posIdx, cls: openerClass(posIdx), sizeBB: toBB(target), stackBB };
      io.log(`${tag}: レイズ ${fmtChips(target)}`, "raise");
    }
  } else {
    const lbl = action.id === "jam" ? `オールイン ${fmtChips(target)}` :
      `ベット ${fmtChips(pay)}`;
    io.log(`${tag}: ${lbl}`, action.id === "jam" ? "jam" : "raise");
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
    // 自分の後ろのまだアクションしていないプレイヤー数(ブラインド除く考慮なしの簡易版)
    let behind = 0;
    for (const q of state.players) {
      if (q.folded || q.allIn || q === p || q.out) continue;
      if (!q.hasActed && q.streetBet < currentBet || !q.hasActed) behind++;
    }
    behind = Math.max(0, behind - (facing === "none" ? 0 : 0));
    return {
      phase: "preflop",
      heroCards: p.cards, heroLabel: handLabelOf(p.cards[0], p.cards[1]),
      posIdx, stackBB: toBB(p.startChips), effBB,
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
  return {
    phase: "postflop",
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
    const share = Math.floor(pt.amt / ws.length / 100) * 100;
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
