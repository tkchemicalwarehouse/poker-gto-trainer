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

/* ---------- 教材用: ジャムEVの分解計算(解説で式を見せるため) ----------
 * 同スタック仮定の近似。ナッシュ表が解いている計算を1ハンド分だけ再現する。
 */
function teachJamBreakdown(label, jamRange, S, defenders, posted) {
  if (typeof EQ169 === "undefined" || defenders <= 0) return null;
  const risk = S - posted;
  const finalPot = 2.5 + 2 * S - posted;
  // ディフェンダー(同スタック仮定)のコールレンジ: eq×最終ポット−リスク > 0
  const defRisk = S - 0.5;            // ブラインド分を平均的に割引
  const defBE = defRisk / (2.5 + risk + defRisk);
  const callRange = new Map();
  let callW = 0, totW = 0;
  for (const h of ALL_HANDS) {
    const w = combosCountOfLabel(h);
    totW += w;
    const eq = eqVsRangeTable(h, jamRange);
    if (eq !== null && eq >= defBE) { callRange.set(h, 1); callW += w; }
  }
  const perDef = callW / totW;
  const pNo = Math.pow(1 - perDef, defenders);
  const eqVsCall = eqVsRangeTable(label, callRange) || 0.5;
  const ev = pNo * 2.5 + (1 - pNo) * (eqVsCall * finalPot - risk);
  return { S, defenders, perDef, pNo, eqVsCall, finalPot, risk, defBE, ev };
}

/* 教材用: リジャムEVの分解(オープナーのコール/フォールドで分解) */
function teachRejamBreakdown(label, rejamRange, openRange, effBB, posted) {
  if (typeof EQ169 === "undefined" || !openRange) return null;
  const S = effBB;
  const risk = S - posted;
  const potNow = 2.5 + 2.2;
  const finalPot = 2.5 + 2 * S - posted;
  const openerRisk = S - 2.2;
  const openerBE = openerRisk / finalPot;
  // オープナーのコールレンジ = オープンレンジ内でジャムレンジに対しBE以上
  const callRange = new Map();
  let callW = 0, totW = 0;
  openRange.forEach((w, h) => {
    const c = w * combosCountOfLabel(h);
    totW += c;
    const eq = eqVsRangeTable(h, rejamRange);
    if (eq !== null && eq >= openerBE) { callRange.set(h, w); callW += c; }
  });
  if (totW <= 0) return null;
  const pCall = callW / totW;
  const eqVsCall = eqVsRangeTable(label, callRange) || 0.5;
  const ev = (1 - pCall) * potNow + pCall * (eqVsCall * finalPot - risk);
  return { S, pCall, potNow, eqVsCall, finalPot, risk, openerBE, ev };
}

/* FTでのジャムEVを賞金期待値(ICM)で評価
 * pFoldAll: 全員降りる確率, eqVsCall: コールされた時の勝率
 * 戻り: {evJam, evFold}(プライズプール比) | null
 */
function icmJamEval(icmCtx, pFoldAll, eqVsCall) {
  try {
    if (!icmCtx || typeof Icm === "undefined") return null;
    const { stacks, heroI, villI, potChips, payouts } = icmCtx;
    const heroBehind = stacks[heroI], villBehind = stacks[villI];
    const callAmt = Math.min(villBehind, heroBehind);
    const foldS = stacks.slice(); foldS[villI] += potChips;          // 降りる→相手がポット回収(近似)
    const stealS = stacks.slice(); stealS[heroI] += potChips;        // 全員フォールド
    const winS = stacks.slice(); winS[heroI] = heroBehind + potChips + callAmt; winS[villI] = villBehind - callAmt;
    const loseS = stacks.slice(); loseS[heroI] = heroBehind - callAmt; loseS[villI] = villBehind + potChips + callAmt;
    const e = s => Icm.icmEVs(s, payouts)[heroI];
    const evJam = pFoldAll * e(stealS) + (1 - pFoldAll) * (eqVsCall * e(winS) + (1 - eqVsCall) * e(loseS));
    const evFold = e(foldS);
    return { evJam, evFold };
  } catch (e) { return null; }
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
/* 深いスタックでの「小さい3ベット(刻む)」頻度配分(ヒューリスティック近似・本物のCFRではない)。
 * 戻り: 攻撃(ジャム)頻度のうち、オールインせず刻む小3ベットに回す割合(0..1)。
 * effBB<16 は刻む余地が乏しくジャム/フォールド主体=0。ナット/ポラー(AA/KK/AK/AQ系)は主にジャム、
 * それ以外の参加手(JJ以下・スーテッドブロードウェイ等)は深いほど主に刻む=フォールド余地を残す。 */
function smallThreeBetShare(label, effBB) {
  if (!(effBB >= 14)) return 0;
  const depth = Math.min(1, (effBB - 13) / 15);            // 14BB→0.07, 20→0.47, 30→1.0
  const nutPolar = (label === "AA" || label === "KK" || label === "AKs" || label === "AKo" || label === "AQs" || label === "AQo");
  if (nutPolar) return 0.20 + 0.15 * depth;                 // 主にジャム(AK/AAは入れ切り志向)
  return Math.min(0.88, 0.55 + 0.35 * depth);               // それ以外は主に小3ベット(フォールド余地)
}

async function preflopAdvice(ctx) {
  const label = ctx.heroLabel;
  const freqs = { fold: 0, call: 0, raise: 0, jam: 0 };
  const data = { kind: null, hu: ctx.tableN === 2 };

  if (ctx.facing === "none") {
    if (ctx.posIdx === POS_BB) { // 全員フォールドでBBに回ることはない(ウォーク)
      freqs.check = 1;
      return { freqs, primary: "check", data };
    }
    // ★実効スタック: 自分 vs 残存ディフェンダー最大スタックの小さい方で判定する★
    // 相手が1BBしか持っていなければ実効1BB → ほぼ全ハンドジャムが正解
    const effS = Math.min(ctx.stackBB, ctx.effJamBB != null ? ctx.effJamBB : ctx.stackBB);
    data.effS = effS;
    data.effLimited = effS < ctx.stackBB - 0.5; // 相手のスタックで実効が制限されている
    if (effS <= 13.5) {
      data.kind = "openJam";
      // ナッシュ均衡データがあれば閾値で厳密判定(なければ手書きチャートにフォールバック)
      const th = nashThreshold(ctx.posIdx, label);
      if (th !== null) {
        data.nash = true;
        data.threshold = th;            // このハンドはthBB以下ならジャム
        data.marginBB = th - effS;      // +なら範囲内(実効スタック基準)
        data.range = nashRangeAt(ctx.posIdx, Math.max(2, effS));
        data.rangePct = rangePercent(data.range);
        // 混合域は閾値が計算グリッドの内側にある時のみ(端=2BB/上限16BBは無差別点ではない)
        const nashCap = (typeof NASH_MAX_BB !== "undefined") ? NASH_MAX_BB : 16;
        const interior = th > 2.01 && th < nashCap - 0.01;
        // margin>=0(effS<=閾値)はジャム圏内。無差別の混合は閾値ちょうど付近(±0.25)のみ
        if (interior && Math.abs(data.marginBB) < 0.25) { freqs.jam = 0.5; freqs.fold = 0.5; }
        else if (data.marginBB >= 0) freqs.jam = 1;
        else freqs.fold = 1;
        // 教材用: ジャムEVの分解(UI時 or FTのICM評価に必要な時)
        if (!ctx.fast || ctx.icmJam) {
          const posted = ctx.posIdx === POS_SB ? 0.5 : 0;
          const defenders = ctx.defendersN != null ? ctx.defendersN : 8 - ctx.posIdx;
          data.calc = teachJamBreakdown(label, data.range, Math.max(2, effS), defenders, posted);
        }
        // FT: ジャム自体を賞金期待値で再評価(ICMはジャム側も締める)
        // ただし実効4BB以下は事実上コミット済み(ソルバーもほぼ100%ジャム)なのでICM補正しない
        if (ctx.icmJam && data.calc && freqs.jam > 0 && effS > 4) {
          const r = icmJamEval(ctx.icmJam, data.calc.pNo, data.calc.eqVsCall);
          if (r) {
            data.icmJamEval = r;
            const diff = r.evJam - r.evFold;
            if (Math.abs(diff) < 0.002) { freqs.jam = 0.5; freqs.fold = 0.5; data.icmMix = true; }
            else if (diff < 0) { freqs.jam = 0; freqs.fold = 1; data.icmVeto = true; }
            else data.icmConfirm = true;
          }
        }
      } else {
        const push = Ranges.push(ctx.posIdx, Math.max(2, effS));
        data.range = push;
        data.rangePct = rangePercent(push);
        if (rangeHas(push, label)) freqs.jam = 1; else freqs.fold = 1;
      }
    } else {
      const open = (data.hu && ctx.posIdx === POS_SB) ? Ranges.huOpen() : Ranges.open(ctx.posIdx, ctx.stackBB);
      data.kind = "openRaise";
      data.range = open;
      data.rangePct = rangePercent(open);
      if (rangeHas(open, label)) freqs.raise = 1; else freqs.fold = 1;
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "open") {
    const opClass = ctx.openerClass;
    const hu = data.hu && ctx.posIdx === POS_BB;
    const cls = hu ? "HU" : opClass;
    const heroType = ctx.posIdx === POS_BB ? "BB" : "IP";
    data.kind = "facingOpen";
    data.openerClass = opClass;

    // ジャム判定: 計算済み均衡の閾値(なければ手書きチャートにフォールバック)
    const th = rejamThreshold(cls, heroType, label);
    let jamDecided = null; // true/false/"mix"
    if (th !== null) {
      data.nashRejam = true;
      data.threshold = th;
      data.marginBB = th - ctx.effBB;
      data.rejamRange = rejamRangeAtEff(cls, heroType, ctx.effBB);
      if (th >= 25 && ctx.effBB > 25) data.marginBB = 1; // 上限到達ハンドは深くてもジャム可
      // 混合域は閾値が計算グリッドの内側にある時のみ(端=4BB/上限25BBは無差別点ではない)
      const rejamCap = (typeof REJAM_MAX_BB !== "undefined") ? REJAM_MAX_BB : 25;
      const interiorR = th > 4.01 && th < rejamCap - 0.01;
      if (interiorR && Math.abs(data.marginBB) < 0.25) jamDecided = "mix";
      else jamDecided = data.marginBB >= 0;
    } else {
      data.rejamRange = hu ? Ranges.huRejam(ctx.effBB) : Ranges.rejam(opClass, ctx.effBB);
      jamDecided = rangeHas(data.rejamRange, label);
    }
    data.rejamPct = rangePercent(data.rejamRange);
    // オープンレンジに対する実エクイティ(テーブルがあれば)
    const openRange = hu ? Ranges.huOpen() : (typeof OPEN_RANGES !== "undefined"
      ? parseRange(OPEN_RANGES[ctx.effBB <= 20 ? 15 : 25][{ EP: 1, MP: 4, LP: 6, SB: 7 }[opClass]]) : null);
    if (openRange) data.eqVsOpen = eqVsRangeTable(label, openRange);
    // 教材用: リジャムEVの分解(UI時 or FTのICM評価に必要な時)
    if ((!ctx.fast || ctx.icmJam) && openRange && data.rejamRange) {
      const posted = ctx.posIdx === POS_BB ? 1 : (ctx.posIdx === POS_SB ? 0.5 : 0);
      data.calc = teachRejamBreakdown(label, data.rejamRange, openRange, ctx.effBB, posted);
    }
    // FT: リジャム自体を賞金期待値で再評価(実効4BB以下はコミット済みのため補正しない)
    if (ctx.icmJam && data.calc && jamDecided !== false && ctx.effBB > 4) {
      const r = icmJamEval(ctx.icmJam, 1 - data.calc.pCall, data.calc.eqVsCall);
      if (r) {
        data.icmJamEval = r;
        const diff = r.evJam - r.evFold;
        if (Math.abs(diff) < 0.002) { jamDecided = "mix"; data.icmMix = true; }
        else if (diff < 0) { jamDecided = false; data.icmVeto = true; }
        else data.icmConfirm = true;
      }
    }

    if (ctx.posIdx === POS_BB) {
      const callR = hu ? Ranges.huCall(ctx.effBB) : Ranges.bbCall(opClass, ctx.effBB);
      data.callRange = callR;
      data.callPct = rangePercent(callR);
      const inCall = rangeHas(callR, label);
      if (jamDecided === "mix") {
        freqs.jam = 0.5;
        if (inCall) freqs.call = 0.5; else freqs.fold = 0.5;
      }
      else if (jamDecided) freqs.jam = 1;
      else if (inCall) freqs.call = 1;
      else freqs.fold = 1;
    } else {
      // BB以外はリジャム or フォールド(浅スタックの標準戦略)
      if (jamDecided === "mix") { freqs.jam = 0.5; freqs.fold = 0.5; }
      else if (jamDecided) freqs.jam = 1;
      else freqs.fold = 1;
    }
    // 深いスタックでは「小さい3ベット(刻む)」を頻度で混ぜる。ジャム一択をやめ、フォールド余地を残す線。
    // AA/KK/AK/AQはジャム寄り、JJ等のバリューは刻み寄り。※ツリー単純化下のヒューリスティック近似。
    if (freqs.jam > 0 && ctx.effBB >= 14) {
      const share = smallThreeBetShare(label, ctx.effBB);
      if (share > 0.02) {
        freqs.raise = (freqs.raise || 0) + freqs.jam * share;
        freqs.jam = freqs.jam * (1 - share);
        data.smallThreeBet = true;
      }
    }
    return { freqs, primary: maxFreqAction(freqs), data };
  }

  if (ctx.facing === "jam" || ctx.facing === "rejamOverMyOpen") {
    // エクイティ vs 必要勝率(事前計算テーブルがあれば厳密、なければMC)
    let eq = eqVsRangeTable(label, ctx.jamRange);
    data.eqExact = eq !== null;
    if (eq === null) {
      const res = equityVsRange(ctx.heroCards, ctx.jamRange, [], ctx.fast ? 400 : 3000);
      eq = res.equity;
    }
    const be = ctx.toCallBB / (ctx.potBB + ctx.toCallBB);
    // FTのICM補正があれば、それが必要勝率の精密な物差し。雑な後続補正は二重計上になるので足さない。
    let icmActive = false;
    if (ctx.icm && typeof Icm !== "undefined") {
      const r = Icm.requiredEq(ctx.icm);
      if (r && isFinite(r.req) && r.req > be) {
        data.icmReq = r.req;
        data.icmPremium = r.req - be;
        data.icmDetail = { evFold: r.evFold, evWin: r.evWin, evLose: r.evLose };
        icmActive = true;
      }
    }
    let margin;
    if (icmActive) {
      // ICMが必要勝率を精密に算出済み。後続/マルチの雑な上乗せはしない(微小マージンのみ)
      margin = (data.icmReq - be) + 0.01;
    } else {
      // ChipEV: ポットオッズ + 控えめな後続/マルチ補正(上限を抑え過剰フォールドを防ぐ)
      margin = 0.005 + Math.min(0.05, 0.02 * (ctx.playersBehind || 0))
        + 0.04 * Math.max(0, (ctx.jamCount || 1) - 1);
    }
    const threshold = be + margin;
    data.kind = "facingJam";
    data.equity = eq;
    data.breakeven = be;
    data.margin = margin;
    data.threshold = threshold;
    data.jamRangePct = rangePercent(ctx.jamRange);
    data.evCallBB = eq * (ctx.potBB + ctx.toCallBB) - ctx.toCallBB;
    const diff = eq - threshold;
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
// ドローのアウツ概算(2/4の法則の教材用)
function estimateOuts(cls) {
  let outs = 0;
  if (cls.draws.flushDraw && cls.draws.oesd) outs = 15;
  else if (cls.draws.flushDraw && cls.draws.gutshot) outs = 12;
  else if (cls.draws.flushDraw) outs = 9;
  else if (cls.draws.oesd) outs = 8;
  else if (cls.draws.gutshot) outs = 4;
  if (cls.tier <= 1 && cls.label.includes("オーバーカード")) outs += 6;
  return outs;
}

async function postflopAdvice(ctx) {
  const cls = classifyHand(ctx.heroCards, ctx.board);
  const freqs = {};
  const data = { kind: "postflop", cls, street: ctx.street, outs: estimateOuts(cls) };
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

    // ★チェック・トゥ・ザ・レイザー(GTOの大原則)★
    // 前のストリートのアグレッサーが自分以外でまだ残っている場合、
    // コーラー側はほぼレンジ全体でチェックして相手に打たせる(ドンクベットは限定的)
    const checkToRaiser = ctx.prevAggressorSeat != null && !ctx.iWasPrevAggressor && ctx.aggressorActive;
    if (checkToRaiser) {
      data.checkToRaiser = true;
      if (t >= 5) setF(freqs, { check: 0.7, bet33: 0.3 });           // モンスターは少しだけドンク混ぜ
      else if (strongDraw && !dry) setF(freqs, { check: 0.8, bet33: 0.2 });
      else setF(freqs, { check: 1 });
      return { freqs, primary: maxFreqAction(freqs), data };
    }

    // C-betできる側か(プリフロップアグレッサー、または先制権のある先手)
    const aggressor = ctx.role === "pfr" || ctx.prevAggressorSeat == null;
    const gutshot = cls.draws.gutshot;
    if (ctx.street === "flop") {
      // ソルバー傾向: ドライ=レンジの大半を小さくC-bet / ウェット=ポラライズ
      if (aggressor && dry) {
        // ドライ・静的ボード: 高頻度レンジベット(小サイズ)。全体で約70〜80%
        if (t >= 5) setF(freqs, { bet33: 0.7, bet66: 0.3 });
        else if (t === 4) setF(freqs, { bet33: 0.82, check: 0.18 });
        else if (t === 3) setF(freqs, { bet33: 0.72, check: 0.28 });
        else if (strongDraw) setF(freqs, { bet33: 0.55, bet66: 0.2, check: 0.25 });
        else if (t === 2) setF(freqs, { bet33: 0.5, check: 0.5 });
        else if (gutshot) setF(freqs, { bet33: 0.6, check: 0.4 });
        else setF(freqs, { bet33: 0.55, check: 0.45 }); // エアもレンジベットで混ぜる
      } else if (aggressor) {
        // ウェット・動的ボード: ポラライズ(強い手・強ドローは大きく、中間はチェック多め)。全体約50〜55%
        if (t >= 5) setF(freqs, { bet66: 0.75, bet33: 0.25 });
        else if (t === 4) setF(freqs, { bet66: 0.6, bet33: 0.2, check: 0.2 });
        else if (strongDraw) setF(freqs, { bet66: 0.5, bet33: 0.2, check: 0.3 });
        else if (t === 3) setF(freqs, { bet33: 0.45, check: 0.55 });
        else if (t === 2) setF(freqs, { bet33: 0.35, check: 0.65 });
        else if (gutshot) setF(freqs, { bet66: 0.35, check: 0.65 });
        else setF(freqs, { bet66: 0.22, bet33: 0.18, check: 0.6 }); // エアのセミブラフ/バランス ~40%
      } else {
        // 先制権のない側(リードベット=ドンクは限定的)
        if (t >= 5) setF(freqs, { bet33: 0.5, check: 0.5 });
        else if (strongDraw) setF(freqs, { bet33: 0.3, check: 0.7 });
        else setF(freqs, { check: 0.85, bet33: 0.15 });
      }
      if (multiway) shiftToward(freqs, "check", t >= 4 ? 0.1 : 0.3); // マルチウェイはブラフ減
    } else if (ctx.street === "turn") {
      // 2ndバレル: フロップでC-betした手が継続する。ソルバー傾向で約45〜55%継続
      if (t >= 5) { setF(freqs, spr <= 1.6 ? { jam: 0.5, bet66: 0.5 } : { bet66: 0.85, bet33: 0.15 }); }
      else if (t === 4) { setF(freqs, spr <= 1.2 ? { jam: 0.45, bet66: 0.4, check: 0.15 } : { bet66: 0.7, check: 0.3 }); }
      else if (strongDraw) { setF(freqs, spr <= 1.6 ? { jam: 0.4, bet66: 0.3, check: 0.3 } : { bet66: 0.55, check: 0.45 }); }
      else if (t === 3) { setF(freqs, { bet33: 0.45, check: 0.55 }); }
      else if (aggressor && gutshot) { setF(freqs, { bet66: 0.4, check: 0.6 }); } // ガットでバレル継続
      else if (aggressor) { setF(freqs, { bet66: 0.28, check: 0.72 }); } // エアの2ndバレル ~28%
      else { setF(freqs, { check: 0.85, bet33: 0.15 }); }
      if (multiway) shiftToward(freqs, "check", t >= 4 ? 0.1 : 0.35);
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
    // FTのICM補正
    if (ctx.icm && typeof Icm !== "undefined") {
      const r = Icm.requiredEq(ctx.icm);
      if (r && isFinite(r.req) && r.req > be) {
        data.icmReq = r.req;
        data.icmPremium = r.req - be;
        data.icmDetail = { evFold: r.evFold, evWin: r.evWin, evLose: r.evLose };
        data.threshold = r.req + 0.01;
      }
    }
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
