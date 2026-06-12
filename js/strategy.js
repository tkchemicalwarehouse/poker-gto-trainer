/* =========================================================
 * strategy.js — 戦略エンジン(ボットの脳 & コーチの採点基準)
 *
 * プリフロップ: ナッシュ均衡チャート(ranges.js) + エクイティ計算
 * ポストフロップ: ソルバー傾向ヒューリスティック + リアルタイムエクイティ
 *
 * すべてBB単位で計算する。
 * ========================================================= */
"use strict";

/* ---------- ハンド分類(ポストフロップ) ----------
 * tier: 5=モンスター 4=強い役 3=中強 2=ミドル/ドロー 1=弱い見込み 0=エア
 */
function classifyHand(heroCards, board) {
  const all = heroCards.concat(board);
  const score = evaluate7(all);
  const cat = score >> 20;
  const boardScore = board.length >= 5 ? evaluate7(board) : (board.length >= 3 ? evaluateBoardOnly(board) : 0);
  const boardCat = board.length >= 3 ? (boardScore >> 20) : 0;

  const hr1 = cardRank(heroCards[0]), hr2 = cardRank(heroCards[1]);
  const boardRanks = board.map(cardRank).sort((a, b) => b - a);
  const topBoard = boardRanks[0];
  const isPocketPair = hr1 === hr2;

  const draws = detectDraws(heroCards, board);
  let tier = 0, label = "エア(ノーメイド)";

  if (cat >= 4) { // ストレート以上
    tier = 5;
    label = ["", "", "", "", "ストレート", "フラッシュ", "フルハウス", "クアッズ", "ストレートフラッシュ"][cat];
    if (boardCat >= cat) { tier = 3; label += "(ボードと共有)"; } // プレイボード気味
  } else if (cat === 3) { // トリップス/セット
    tier = 5;
    label = isPocketPair ? "セット" : "トリップス";
  } else if (cat === 2) { // ツーペア
    const usesBoth = usesBothCards(heroCards, board, score);
    tier = usesBoth ? 5 : 4;
    label = "ツーペア";
    if (boardCat >= 2) { tier = 2; label = "ボードペア+自分ペア"; }
  } else if (cat === 1) { // ワンペア
    const pairRank = (score >> 16) & 0xF;
    if (isPocketPair && hr1 > topBoard) { tier = 4; label = "オーバーペア"; }
    else if (pairRank === topBoard && (hr1 === topBoard || hr2 === topBoard)) {
      const kicker = hr1 === topBoard ? hr2 : hr1;
      if (kicker >= 9) { tier = 4; label = "トップペア(良キッカー)"; } // J以上
      else { tier = 3; label = "トップペア(弱キッカー)"; }
    } else if (isPocketPair && boardRanks.length >= 2 && hr1 > boardRanks[1]) {
      tier = 3; label = "セカンドポケットペア";
    } else if (boardRanks.length >= 2 && pairRank === boardRanks[1] && !isPocketPair && boardCat === 0) {
      tier = 2; label = "ミドルペア";
    } else if (boardCat >= 1 && !heroMakesPair(heroCards, board)) {
      tier = 1; label = "ボードペアのみ";
    } else {
      tier = 1; label = "弱いペア";
    }
  } else {
    // ノーメイド
    if (hr1 > topBoard && hr2 > topBoard) { tier = 1; label = "オーバーカード2枚"; }
  }

  // ドローによる引き上げ
  if (tier <= 3) {
    const comboDraw = (draws.flushDraw && (draws.oesd || tier >= 2)) || (draws.flushDraw && draws.gutshot);
    if (comboDraw && tier < 3) { tier = 3; label += " + 強力コンボドロー"; }
    else if ((draws.flushDraw || draws.oesd) && tier < 2) { tier = 2; label += draws.flushDraw ? " + フラッシュドロー" : " + ストレートドロー"; }
    else if (draws.flushDraw || draws.oesd) { label += draws.flushDraw ? " + フラッシュドロー" : " + ストレートドロー"; }
    else if (draws.gutshot && tier < 1) { tier = 1; label += " + ガットショット"; }
    else if (draws.gutshot) { label += " + ガットショット"; }
  }
  return { tier, label, cat, draws };
}

function evaluateBoardOnly(board) {
  // 3-5枚でも evaluate7 は動く(枚数分だけ走査)
  return evaluate7(board);
}

function heroMakesPair(heroCards, board) {
  const br = board.map(cardRank);
  return br.includes(cardRank(heroCards[0])) || br.includes(cardRank(heroCards[1])) ||
    cardRank(heroCards[0]) === cardRank(heroCards[1]);
}

function usesBothCards(heroCards, board, score) {
  // ツーペアが両ホールカード使用か(=強いツーペア)の簡易判定
  const br = board.map(cardRank);
  const r1 = cardRank(heroCards[0]), r2 = cardRank(heroCards[1]);
  return br.includes(r1) && br.includes(r2) && r1 !== r2;
}

function detectDraws(heroCards, board) {
  if (board.length >= 5) return { flushDraw: false, oesd: false, gutshot: false };
  const all = heroCards.concat(board);
  // フラッシュドロー: 同スートちょうど4枚(ヒーローのカードを1枚以上使用)
  const suitCount = [0, 0, 0, 0], heroSuit = [0, 0, 0, 0];
  for (const c of all) suitCount[cardSuit(c)]++;
  for (const c of heroCards) heroSuit[cardSuit(c)]++;
  let flushDraw = false;
  for (let s = 0; s < 4; s++) if (suitCount[s] === 4 && heroSuit[s] >= 1) flushDraw = true;

  // ストレートドロー: 完成させるランクの数を数える
  let mask = 0;
  for (const c of all) mask |= (1 << cardRank(c));
  let outs = 0;
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    if (bestStraightHigh(mask | (1 << r)) >= 0 && bestStraightHigh(mask) < 0) outs++;
  }
  const heroRanks = [cardRank(heroCards[0]), cardRank(heroCards[1])];
  const boardMask = board.reduce((m, c) => m | (1 << cardRank(c)), 0);
  // ボードだけで既にストレートが見えている場合はドローとしない
  const boardOnly = bestStraightHigh(boardMask) >= 0;
  return {
    flushDraw,
    oesd: !boardOnly && outs >= 2,
    gutshot: !boardOnly && outs === 1,
  };
}

/* ---------- レンジのボードフィルタ ----------
 * mode: 'bet'      = 相手がベットしてくる想定レンジ(バリュー+ドロー)
 *       'continue' = 相手がベットに対しコールする想定レンジ
 *       'raise'    = 相手がレイズオールインしてくる想定レンジ(モンスター+コンボドロー)
 */
function filterRangeOnBoard(range, board, mode, dead) {
  const combos = rangeToCombos(range, (dead || []).concat(board));
  const out = [];
  for (const cb of combos) {
    const cls = classifyHand([cb.c1, cb.c2], board);
    let keep = false;
    if (mode === "bet") keep = cls.tier >= 3 || cls.draws.flushDraw || cls.draws.oesd;
    else if (mode === "continue") keep = cls.tier >= 2 || cls.draws.flushDraw || cls.draws.oesd;
    else if (mode === "raise") keep = cls.tier >= 4 || (cls.tier >= 3 && (cls.draws.flushDraw || cls.draws.oesd));
    if (keep) out.push(cb);
  }
  return out;
}

// プリビルドしたコンボ配列に対するエクイティ(MC)
function equityVsCombos(heroCards, combos, board, iters) {
  board = board || [];
  iters = iters || 1500;
  const dead = heroCards.concat(board);
  const deadSet = new Set(dead);
  const usable = combos.filter(cb => !deadSet.has(cb.c1) && !deadSet.has(cb.c2));
  if (!usable.length) return { equity: 0.75, samples: 0 }; // 相手レンジが空=こちら有利とみなす
  const sampler = buildSampler(usable);
  const deckBase = freshDeckExcluding(dead);
  const need = 5 - board.length;
  let win = 0, total = 0;
  const hf = new Array(7), vf = new Array(7);
  hf[0] = heroCards[0]; hf[1] = heroCards[1];
  for (let b = 0; b < board.length; b++) { hf[2 + b] = board[b]; vf[2 + b] = board[b]; }
  for (let it = 0; it < iters; it++) {
    const vc = sampleCombo(sampler);
    vf[0] = vc.c1; vf[1] = vc.c2;
    let filled = board.length;
    if (need > 0) {
      const taken = new Set([vc.c1, vc.c2]);
      while (filled < 5) {
        const c = deckBase[(Math.random() * deckBase.length) | 0];
        if (taken.has(c)) continue;
        taken.add(c);
        hf[2 + filled] = c; vf[2 + filled] = c;
        filled++;
      }
    }
    const hs = evaluate7(hf), vs = evaluate7(vf);
    if (hs > vs) win += 1; else if (hs === vs) win += 0.5;
    total++;
  }
  return { equity: win / total, samples: total };
}

/* =========================================================
 * プリフロップ・アドバイス
 * ctx: {
 *   heroCards, heroLabel, posIdx, stackBB(ハンド開始時), effBB,
 *   facing: 'none'|'open'|'jam'|'rejamOverMyOpen',
 *   openerPosIdx, openerClass, openSizeBB,
 *   jamRange(Map), jamCount, playersBehind,
 *   potBB, toCallBB, fast(bool)
 * }
 * 戻り値: { freqs: {fold,call,raise,jam}, primary, data }
 * ========================================================= */
async function preflopAdvice(ctx) {
  const label = ctx.heroLabel;
  const freqs = { fold: 0, call: 0, raise: 0, jam: 0 };
  const data = { kind: null };

  if (ctx.facing === "none") {
    if (ctx.posIdx === POS_BB) { // 全員フォールドでBBに回ることはない(ウォーク)
      freqs.check = 1;
      return { freqs, primary: "check", data };
    }
    if (ctx.stackBB <= 13.5) {
      const push = Ranges.push(ctx.posIdx, ctx.stackBB);
      data.kind = "openJam";
      data.range = push;
      data.bucket = pushBucketFor(ctx.stackBB);
      data.rangePct = rangePercent(push);
      if (rangeHas(push, label)) freqs.jam = 1; else freqs.fold = 1;
    } else {
      const open = Ranges.open(ctx.posIdx, ctx.stackBB);
      data.kind = "openRaise";
      data.range = open;
      data.bucket = openBucketFor(ctx.stackBB);
      data.rangePct = rangePercent(open);
      if (rangeHas(open, label)) freqs.raise = 1; else freqs.fold = 1;
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "open") {
    const opClass = ctx.openerClass;
    const rejam = Ranges.rejam(opClass, ctx.effBB);
    data.kind = "facingOpen";
    data.rejamRange = rejam;
    data.rejamPct = rangePercent(rejam);
    data.openerClass = opClass;
    if (ctx.posIdx === POS_BB) {
      const callR = Ranges.bbCall(opClass, ctx.effBB);
      data.callRange = callR;
      data.callPct = rangePercent(callR);
      if (rangeHas(rejam, label)) freqs.jam = 1;
      else if (rangeHas(callR, label)) freqs.call = 1;
      else freqs.fold = 1;
    } else {
      // BB以外はリジャム or フォールド(浅スタックの標準戦略)
      if (rangeHas(rejam, label)) freqs.jam = 1; else freqs.fold = 1;
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "jam" || ctx.facing === "rejamOverMyOpen") {
    // エクイティ vs 必要勝率
    const iters = ctx.fast ? 400 : 3000;
    const res = equityVsRange(ctx.heroCards, ctx.jamRange, [], iters);
    const be = ctx.toCallBB / (ctx.potBB + ctx.toCallBB);
    let margin = 0.005;
    margin += 0.03 * (ctx.playersBehind || 0);       // 後ろに残るプレイヤー
    margin += 0.06 * Math.max(0, (ctx.jamCount || 1) - 1); // 追加のオールイン
    const threshold = be + margin;
    data.kind = "facingJam";
    data.equity = res.equity;
    data.breakeven = be;
    data.margin = margin;
    data.threshold = threshold;
    data.jamRangePct = rangePercent(ctx.jamRange);
    data.evCallBB = res.equity * (ctx.potBB + ctx.toCallBB) - ctx.toCallBB;
    const diff = res.equity - threshold;
    if (diff > 0.015) freqs.call = 1;
    else if (diff > -0.015) { freqs.call = 0.5; freqs.fold = 0.5; }
    else freqs.fold = 1;
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  freqs.fold = 1;
  return { freqs, primary: "fold", data };
}

/* =========================================================
 * ポストフロップ・アドバイス
 * ctx: {
 *   heroCards, board, street('flop'|'turn'|'river'),
 *   potBB, toCallBB, heroBehindBB, effBehindBB,
 *   role: 'pfr'|'caller', oppRange(Map),
 *   facing: 'none'|'bet'|'raiseAllin',
 *   playersIn, canRaise, fast
 * }
 * アクション: check, bet33, bet66, jam, call, fold, raise(=オールイン)
 * ========================================================= */
async function postflopAdvice(ctx) {
  const cls = classifyHand(ctx.heroCards, ctx.board);
  const freqs = {};
  const data = { kind: "postflop", cls, street: ctx.street };
  const iters = ctx.fast ? 250 : 1600;
  const spr = ctx.potBB > 0 ? ctx.effBehindBB / ctx.potBB : 99;
  data.spr = spr;
  const multiway = (ctx.playersIn || 2) > 2;

  if (ctx.facing === "none") {
    // ベットするか、チェックするか
    const conts = filterRangeOnBoard(ctx.oppRange, ctx.board, "continue", ctx.heroCards);
    const eqRes = equityVsCombos(ctx.heroCards, conts, ctx.board, iters);
    data.equity = eqRes.equity;
    data.vsLabel = "相手の継続レンジ";

    const dry = isDryBoard(ctx.board);
    data.dryBoard = dry;
    const t = cls.tier;
    const strongDraw = cls.draws.flushDraw || cls.draws.oesd;

    if (ctx.street === "flop") {
      if (t >= 5) { setF(freqs, dry || spr > 4 ? { bet33: 0.8, bet66: 0.2 } : { bet66: 0.7, bet33: 0.3 }); }
      else if (t === 4) { setF(freqs, dry ? { bet33: 0.85, check: 0.15 } : { bet66: 0.55, bet33: 0.35, check: 0.1 }); }
      else if (t === 3) { setF(freqs, { bet33: 0.55, check: 0.45 }); }
      else if (strongDraw) { setF(freqs, { bet33: 0.45, bet66: 0.2, check: 0.35 }); }
      else if (t === 2) { setF(freqs, { check: 0.75, bet33: 0.25 }); }
      else if (t === 1 && cls.draws.gutshot) { setF(freqs, { bet33: 0.4, check: 0.6 }); }
      else if (ctx.role === "pfr" && dry && t <= 1) { setF(freqs, { bet33: 0.55, check: 0.45 }); } // レンジベット
      else { setF(freqs, { check: 0.8, bet33: 0.2 }); }
      if (multiway) shiftToward(freqs, "check", t >= 4 ? 0 : 0.3); // マルチウェイはブラフ減
    } else if (ctx.street === "turn") {
      if (t >= 5) { setF(freqs, spr <= 1.6 ? { jam: 0.5, bet66: 0.5 } : { bet66: 0.8, bet33: 0.2 }); }
      else if (t === 4) { setF(freqs, spr <= 1.2 ? { jam: 0.4, bet66: 0.4, check: 0.2 } : { bet66: 0.6, check: 0.4 }); }
      else if (strongDraw) { setF(freqs, spr <= 1.6 ? { jam: 0.35, bet66: 0.25, check: 0.4 } : { bet66: 0.4, check: 0.6 }); }
      else if (t === 3) { setF(freqs, { check: 0.6, bet33: 0.4 }); }
      else { setF(freqs, { check: 0.85, bet33: 0.15 }); }
    } else { // river
      const bluffCandidate = wasDrawHand(ctx.heroCards, ctx.board) && t <= 1;
      if (t >= 5) { setF(freqs, spr <= 1.8 ? { jam: 0.6, bet66: 0.4 } : { bet66: 0.85, bet33: 0.15 }); }
      else if (t === 4) { setF(freqs, { bet66: 0.55, bet33: 0.25, check: 0.2 }); }
      else if (t === 3) { setF(freqs, { check: 0.65, bet33: 0.35 }); }
      else if (bluffCandidate) { setF(freqs, { bet66: 0.35, check: 0.65 }); }
      else { setF(freqs, { check: 0.95, bet33: 0.05 }); }
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "bet") {
    const betR = filterRangeOnBoard(ctx.oppRange, ctx.board, "bet", ctx.heroCards);
    const eqRes = equityVsCombos(ctx.heroCards, betR, ctx.board, iters);
    const be = ctx.toCallBB / (ctx.potBB + ctx.toCallBB);
    data.equity = eqRes.equity;
    data.breakeven = be;
    data.vsLabel = "相手のベットレンジ";
    const t = cls.tier;
    const comboDraw = cls.draws.flushDraw && (cls.draws.oesd || cls.draws.gutshot || t >= 2);
    const margin = multiway ? 0.05 : 0.02;
    data.threshold = be + margin;

    if (t >= 5) {
      if (ctx.canRaise && spr <= 3) setF(freqs, { raise: 0.7, call: 0.3 });
      else setF(freqs, { call: 1 });
    } else if (t === 4) {
      if (ctx.canRaise && spr <= 1.5) setF(freqs, { raise: 0.5, call: 0.5 });
      else setF(freqs, { call: 1 });
    } else if (comboDraw && ctx.street !== "river" && ctx.canRaise && spr <= 2.5) {
      setF(freqs, { raise: 0.45, call: 0.45, fold: 0.1 });
    } else {
      const diff = eqRes.equity - (be + margin);
      if (diff > 0.03) setF(freqs, { call: 1 });
      else if (diff > -0.02) setF(freqs, { call: 0.5, fold: 0.5 });
      else setF(freqs, { fold: 1 });
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "raiseAllin") {
    const raiseR = filterRangeOnBoard(ctx.oppRange, ctx.board, "raise", ctx.heroCards);
    const eqRes = equityVsCombos(ctx.heroCards, raiseR, ctx.board, iters);
    const be = ctx.toCallBB / (ctx.potBB + ctx.toCallBB);
    data.equity = eqRes.equity;
    data.breakeven = be;
    data.threshold = be + 0.01;
    data.vsLabel = "相手のオールインレンジ";
    const diff = eqRes.equity - data.threshold;
    if (diff > 0.02) setF(freqs, { call: 1 });
    else if (diff > -0.02) setF(freqs, { call: 0.5, fold: 0.5 });
    else setF(freqs, { fold: 1 });
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  setF(freqs, { fold: 1 });
  return { freqs, primary: "fold", data };
}

/* ---------- 小道具 ---------- */
function setF(freqs, obj) { for (const k in obj) freqs[k] = obj[k]; }

function shiftToward(freqs, target, amount) {
  // 他のアクションから target に確率を移す
  let moved = 0;
  for (const k in freqs) {
    if (k === target) continue;
    const take = freqs[k] * amount;
    freqs[k] -= take; moved += take;
  }
  freqs[target] = (freqs[target] || 0) + moved;
}

function maxFreqAction(freqs) {
  let best = null, bf = -1;
  for (const k in freqs) if (freqs[k] > bf) { bf = freqs[k]; best = k; }
  return best;
}

function isDryBoard(board) {
  // ドライ: ペアなし・フラッシュドロー無し・コネクト弱い・ハイカードQ以上
  const ranks = board.map(cardRank).sort((a, b) => b - a);
  const suits = board.map(cardSuit);
  const suitCount = [0, 0, 0, 0];
  for (const s of suits) suitCount[s]++;
  const twoTone = Math.max(...suitCount) >= 2 && board.length === 3 && Math.max(...suitCount) >= 2;
  const mono = Math.max(...suitCount) >= 3;
  const paired = new Set(ranks).size < ranks.length;
  const connected = ranks.length >= 2 && (ranks[0] - ranks[ranks.length - 1]) <= 4 && ranks[0] <= 10;
  return ranks[0] >= 10 && !mono && !paired && !connected;
}

function wasDrawHand(heroCards, board) {
  // リバー時点: フロップ/ターンでドローだったか(=ブラフ候補)の簡易判定
  if (board.length < 5) return false;
  const flopDraws = detectDraws(heroCards, board.slice(0, 4));
  return flopDraws.flushDraw || flopDraws.oesd;
}

/* ---------- ボット用: 混合戦略からサンプリング ---------- */
function sampleAction(freqs) {
  let total = 0;
  for (const k in freqs) total += freqs[k];
  let x = Math.random() * total;
  for (const k in freqs) {
    x -= freqs[k];
    if (x <= 0) return k;
  }
  return maxFreqAction(freqs);
}
