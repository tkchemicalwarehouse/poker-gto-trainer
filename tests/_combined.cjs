/* =========================================================
 * engine.js — カード・役判定・エクイティ計算エンジン
 * カード表現: 0..51 の整数。 rank = c >> 2 (0=2 .. 12=A), suit = c & 3
 * ========================================================= */
"use strict";

const RANK_CHARS = "23456789TJQKA";
const SUIT_CHARS = ["s", "h", "d", "c"];
const SUIT_SYMBOLS = ["♠", "♥", "♦", "♣"];
const SUIT_COLORS = ["#222", "#d33", "#2277dd", "#2a8f2a"]; // 4色デッキ

function makeCard(rank, suit) { return (rank << 2) | suit; }
function cardRank(c) { return c >> 2; }
function cardSuit(c) { return c & 3; }
function cardText(c) { return RANK_CHARS[cardRank(c)] + SUIT_SYMBOLS[cardSuit(c)]; }

/* ---------- 169ハンドラベル ---------- */
// 例: "AKs", "AKo", "TT"
function handLabelOf(c1, c2) {
  let r1 = cardRank(c1), r2 = cardRank(c2);
  if (r1 < r2) { const t = r1; r1 = r2; r2 = t; }
  if (r1 === r2) return RANK_CHARS[r1] + RANK_CHARS[r2];
  const suited = cardSuit(c1) === cardSuit(c2);
  return RANK_CHARS[r1] + RANK_CHARS[r2] + (suited ? "s" : "o");
}

const ALL_HANDS = (() => {
  const out = [];
  for (let hi = 12; hi >= 0; hi--) {
    for (let lo = hi; lo >= 0; lo--) {
      if (hi === lo) out.push(RANK_CHARS[hi] + RANK_CHARS[lo]);
      else {
        out.push(RANK_CHARS[hi] + RANK_CHARS[lo] + "s");
        out.push(RANK_CHARS[hi] + RANK_CHARS[lo] + "o");
      }
    }
  }
  return out;
})();

// ラベル → 全コンボ([c1,c2]の配列)
function combosOfLabel(label) {
  const r1 = RANK_CHARS.indexOf(label[0]);
  const r2 = RANK_CHARS.indexOf(label[1]);
  const out = [];
  if (label.length === 2) { // ペア
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = s1 + 1; s2 < 4; s2++)
        out.push([makeCard(r1, s1), makeCard(r2, s2)]);
  } else if (label[2] === "s") {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++)
      for (let s2 = 0; s2 < 4; s2++)
        if (s1 !== s2) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
  }
  return out;
}

function combosCountOfLabel(label) {
  return label.length === 2 ? 6 : (label[2] === "s" ? 4 : 12);
}

/* ---------- 7カード役判定 ----------
 * 戻り値: 数値スコア(大きいほど強い)
 * score = cat*2^20 + k1*2^16 + k2*2^12 + k3*2^8 + k4*2^4 + k5
 * cat: 8=ストレートフラッシュ 7=クアッズ 6=フルハウス 5=フラッシュ
 *      4=ストレート 3=トリップス 2=ツーペア 1=ワンペア 0=ハイカード
 */
function evaluate7(cards) {
  const rankCount = new Array(13).fill(0);
  const suitCount = new Array(4).fill(0);
  const suitRanksMask = new Array(4).fill(0);
  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i] >> 2, s = cards[i] & 3;
    rankCount[r]++; suitCount[s]++;
    suitRanksMask[s] |= (1 << r);
    rankMask |= (1 << r);
  }

  // フラッシュ / ストレートフラッシュ
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      const sf = bestStraightHigh(suitRanksMask[s]);
      if (sf >= 0) return (8 << 20) | (sf << 16);
      // フラッシュ: 上位5枚
      let score = (5 << 20), shift = 16, taken = 0;
      for (let r = 12; r >= 0 && taken < 5; r--) {
        if (suitRanksMask[s] & (1 << r)) { score |= (r << shift); shift -= 4; taken++; }
      }
      return score;
    }
  }

  // クアッズ / フルハウス / トリップス / ペア類の分析
  let quad = -1, trips = [], pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCount[r] === 4) quad = r;
    else if (rankCount[r] === 3) trips.push(r);
    else if (rankCount[r] === 2) pairs.push(r);
  }
  if (quad >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r--) if (r !== quad && rankCount[r] > 0) { kicker = r; break; }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }
  if (trips.length >= 2) return (6 << 20) | (trips[0] << 16) | (trips[1] << 12);
  if (trips.length === 1 && pairs.length >= 1) return (6 << 20) | (trips[0] << 16) | (pairs[0] << 12);

  const st = bestStraightHigh(rankMask);
  if (st >= 0) return (4 << 20) | (st << 16);

  if (trips.length === 1) {
    const ks = topRanksExcluding(rankCount, [trips[0]], 2);
    return (3 << 20) | (trips[0] << 16) | (ks[0] << 12) | (ks[1] << 8);
  }
  if (pairs.length >= 2) {
    const k = topRanksExcluding(rankCount, [pairs[0], pairs[1]], 1);
    return (2 << 20) | (pairs[0] << 16) | (pairs[1] << 12) | (k[0] << 8);
  }
  if (pairs.length === 1) {
    const ks = topRanksExcluding(rankCount, [pairs[0]], 3);
    return (1 << 20) | (pairs[0] << 16) | (ks[0] << 12) | (ks[1] << 8) | (ks[2] << 4);
  }
  const ks = topRanksExcluding(rankCount, [], 5);
  return (0 << 20) | (ks[0] << 16) | (ks[1] << 12) | (ks[2] << 8) | (ks[3] << 4) | ks[4];
}

// rankMask からストレートの最高位ランクを返す(なければ-1)。A-5ホイール対応。
function bestStraightHigh(mask) {
  // Aを下にも置く(bit -1 相当として処理)
  for (let high = 12; high >= 3; high--) {
    let ok = true;
    for (let i = 0; i < 5; i++) {
      const r = high - i;
      const bit = (r === -1) ? 12 : r; // 使われない(high>=3なのでr>= -1だがr=-1はhigh=3のとき)
      if (r >= 0) { if (!(mask & (1 << r))) { ok = false; break; } }
      else { if (!(mask & (1 << 12))) { ok = false; break; } }
    }
    if (ok) return high;
  }
  return -1;
}

function topRanksExcluding(rankCount, excluded, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) {
    if (excluded.indexOf(r) === -1 && rankCount[r] > 0) out.push(r);
  }
  while (out.length < n) out.push(0);
  return out;
}

/* ---------- デッキ・乱数ユーティリティ ---------- */
function freshDeckExcluding(used) {
  const usedSet = new Set(used);
  const deck = [];
  for (let c = 0; c < 52; c++) if (!usedSet.has(c)) deck.push(c);
  return deck;
}
function sampleFrom(deck, n, scratch) {
  // deckを破壊しない部分Fisher-Yates。scratchは再利用配列。
  const len = deck.length;
  const idx = scratch || [];
  idx.length = 0;
  const picked = [];
  const taken = new Set();
  while (picked.length < n) {
    const i = (Math.random() * len) | 0;
    if (!taken.has(i)) { taken.add(i); picked.push(deck[i]); }
  }
  return picked;
}

/* ---------- レンジ表現 ----------
 * range = Map(label -> weight 0..1)
 * 重み付きコンボ配列に展開してMCで使う
 */
function rangeToCombos(range, dead) {
  const deadSet = new Set(dead || []);
  const combos = []; // {c1,c2,w}
  range.forEach((w, label) => {
    if (w <= 0) return;
    const cs = combosOfLabel(label);
    for (const [c1, c2] of cs) {
      if (deadSet.has(c1) || deadSet.has(c2)) continue;
      combos.push({ c1, c2, w });
    }
  });
  return combos;
}

function totalComboWeight(range) {
  let sum = 0;
  range.forEach((w, label) => { sum += w * combosCountOfLabel(label); });
  return sum;
}

function rangePercent(range) {
  return totalComboWeight(range) / 1326 * 100;
}

// 累積重みテーブルを作る(高速サンプリング用)
function buildSampler(combos) {
  const cum = new Float64Array(combos.length);
  let acc = 0;
  for (let i = 0; i < combos.length; i++) { acc += combos[i].w; cum[i] = acc; }
  return { combos, cum, total: acc };
}
function sampleCombo(sampler) {
  const x = Math.random() * sampler.total;
  // 二分探索
  let lo = 0, hi = sampler.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sampler.cum[mid] < x) lo = mid + 1; else hi = mid;
  }
  return sampler.combos[lo];
}

/* ---------- エクイティ計算(モンテカルロ) ---------- */

// ヒーローハンド vs レンジ。boardは0〜5枚。
function equityVsRange(heroCards, range, board, iters) {
  board = board || [];
  iters = iters || 4000;
  const dead = heroCards.concat(board);
  const combos = rangeToCombos(range, dead);
  if (combos.length === 0) return { equity: 0.5, samples: 0 };
  const sampler = buildSampler(combos);
  const deckBase = freshDeckExcluding(dead);
  const need = 5 - board.length;
  let win = 0, total = 0;
  const heroFull = new Array(7), villFull = new Array(7);
  heroFull[0] = heroCards[0]; heroFull[1] = heroCards[1];
  for (let b = 0; b < board.length; b++) { heroFull[2 + b] = board[b]; villFull[2 + b] = board[b]; }

  for (let it = 0; it < iters; it++) {
    const vc = sampleCombo(sampler);
    villFull[0] = vc.c1; villFull[1] = vc.c2;
    // 残りボードをサンプル(villコンボと衝突回避)
    let filled = board.length;
    if (need > 0) {
      const taken = new Set([vc.c1, vc.c2]);
      while (filled < 5) {
        const c = deckBase[(Math.random() * deckBase.length) | 0];
        if (taken.has(c)) continue;
        taken.add(c);
        heroFull[2 + filled] = c; villFull[2 + filled] = c;
        filled++;
      }
    }
    const hs = evaluate7(heroFull);
    const vs = evaluate7(villFull);
    if (hs > vs) win += 1;
    else if (hs === vs) win += 0.5;
    total++;
  }
  return { equity: win / total, samples: total };
}

// レンジ vs レンジ(フロップのレンジアドバンテージ計算用)
function rangeVsRangeEquity(rangeA, rangeB, board, iters) {
  board = board || [];
  iters = iters || 3000;
  const combosA = rangeToCombos(rangeA, board);
  const combosB = rangeToCombos(rangeB, board);
  if (!combosA.length || !combosB.length) return 0.5;
  const samplerA = buildSampler(combosA);
  const samplerB = buildSampler(combosB);
  const deckBase = freshDeckExcluding(board);
  const need = 5 - board.length;
  let win = 0, total = 0;
  const aFull = new Array(7), bFull = new Array(7);
  for (let b = 0; b < board.length; b++) { aFull[2 + b] = board[b]; bFull[2 + b] = board[b]; }
  for (let it = 0; it < iters; it++) {
    const ca = sampleCombo(samplerA);
    const cb = sampleCombo(samplerB);
    if (ca.c1 === cb.c1 || ca.c1 === cb.c2 || ca.c2 === cb.c1 || ca.c2 === cb.c2) continue;
    aFull[0] = ca.c1; aFull[1] = ca.c2;
    bFull[0] = cb.c1; bFull[1] = cb.c2;
    let filled = board.length;
    if (need > 0) {
      const taken = new Set([ca.c1, ca.c2, cb.c1, cb.c2]);
      while (filled < 5) {
        const c = deckBase[(Math.random() * deckBase.length) | 0];
        if (taken.has(c)) continue;
        taken.add(c);
        aFull[2 + filled] = c; bFull[2 + filled] = c;
        filled++;
      }
    }
    const as = evaluate7(aFull);
    const bs = evaluate7(bFull);
    if (as > bs) win += 1; else if (as === bs) win += 0.5;
    total++;
  }
  return total ? win / total : 0.5;
}

/* ---------- ハンド強さ順位(説明・採点用) ----------
 * 各169ハンドのランダムハンドに対するエクイティ(おおよそ)。
 * 起動時に軽量MCで計算し localStorage にキャッシュ。
 */
let HAND_POWER = null; // Map(label -> equity vs random)

function computeHandPower(itersPerHand) {
  itersPerHand = itersPerHand || 1500;
  const randomRange = new Map();
  for (const h of ALL_HANDS) randomRange.set(h, 1);
  const power = new Map();
  for (const label of ALL_HANDS) {
    const combo = combosOfLabel(label)[0];
    const r = equityVsRange(combo, randomRange, [], itersPerHand);
    power.set(label, r.equity);
  }
  return power;
}

function getHandPower() {
  if (HAND_POWER) return HAND_POWER;
  try {
    const cached = (typeof localStorage !== "undefined") && localStorage.getItem("pgt_handpower_v1");
    if (cached) {
      const obj = JSON.parse(cached);
      HAND_POWER = new Map(Object.entries(obj));
      return HAND_POWER;
    }
  } catch (e) { /* file:// 等で失敗しても続行 */ }
  HAND_POWER = computeHandPower();
  try {
    if (typeof localStorage !== "undefined") {
      const obj = {};
      HAND_POWER.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem("pgt_handpower_v1", JSON.stringify(obj));
    }
  } catch (e) { }
  return HAND_POWER;
}

// ハンドのパーセンタイル(0=最強, 100=最弱に近い)
function handPercentile(label) {
  const power = getHandPower();
  const mine = power.get(label);
  let stronger = 0, totalW = 0;
  power.forEach((eq, l) => {
    const w = combosCountOfLabel(l);
    totalW += w;
    if (eq > mine) stronger += w;
  });
  return stronger / totalW * 100;
}

;
/* =========================================================
 * ranges.js — GTOレンジデータ + レンジ文字列パーサー
 *
 * レンジ文字列の文法:
 *   "22+"        … ペア22以上すべて
 *   "77-55"      … ペアの区間
 *   "A9s+"       … A9s,ATs,...,AKs(同一ハイカードでキッカーを上げる)
 *   "A5s-A3s"    … 区間
 *   "KQo"        … 単体
 *   "A2+"        … A2s+とA2o+の両方
 *   "ATo:0.5"    … 重み付き(混合戦略)
 * ========================================================= */
"use strict";

function parseRange(str) {
  const range = new Map();
  if (!str) return range;
  for (let token of str.split(",")) {
    token = token.trim();
    if (!token) continue;
    let weight = 1;
    const wIdx = token.indexOf(":");
    if (wIdx >= 0) {
      weight = parseFloat(token.slice(wIdx + 1));
      token = token.slice(0, wIdx);
    }
    for (const label of expandToken(token)) {
      range.set(label, Math.max(range.get(label) || 0, weight));
    }
  }
  return range;
}

function expandToken(token) {
  const out = [];
  const plus = token.endsWith("+");
  if (plus) token = token.slice(0, -1);

  // 区間 "77-55" / "A5s-A3s"
  const dash = token.indexOf("-");
  if (dash > 0) {
    const hi = token.slice(0, dash), lo = token.slice(dash + 1);
    return expandSpan(hi, lo);
  }

  const r1 = RANK_CHARS.indexOf(token[0]);
  const r2 = RANK_CHARS.indexOf(token[1]);
  const suff = token.length > 2 ? token[2] : null;

  if (r1 === r2) { // ペア
    if (plus) { for (let r = r1; r <= 12; r++) out.push(RANK_CHARS[r] + RANK_CHARS[r]); }
    else out.push(token);
    return out;
  }
  const suffixes = suff ? [suff] : ["s", "o"];
  for (const sx of suffixes) {
    if (plus) {
      // キッカーをr2からr1-1まで上げる
      for (let k = r2; k < r1; k++) out.push(RANK_CHARS[r1] + RANK_CHARS[k] + sx);
    } else {
      out.push(RANK_CHARS[r1] + RANK_CHARS[r2] + sx);
    }
  }
  return out;
}

function expandSpan(hi, lo) {
  const out = [];
  const h1 = RANK_CHARS.indexOf(hi[0]), h2 = RANK_CHARS.indexOf(hi[1]);
  const l2 = RANK_CHARS.indexOf(lo[1]);
  if (h1 === h2) { // ペア区間
    for (let r = l2; r <= h1; r++) out.push(RANK_CHARS[r] + RANK_CHARS[r]);
    return out;
  }
  const sx = hi[2];
  for (let k = l2; k <= h2; k++) out.push(RANK_CHARS[h1] + RANK_CHARS[k] + sx);
  return out;
}

/* =========================================================
 * ポジション定義(9人テーブル)
 * ========================================================= */
const POSITIONS = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
const POS_UTG = 0, POS_LJ = 3, POS_HJ = 4, POS_CO = 5, POS_BTN = 6, POS_SB = 7, POS_BB = 8;

function openerClass(posIdx) {
  if (posIdx <= 2) return "EP";
  if (posIdx <= 4) return "MP";
  if (posIdx <= 6) return "LP";
  return "SB";
}

/* =========================================================
 * 1. オープンジャム(ナッシュ均衡近似・BBアンティあり 9max)
 *    スタックバケット: 5(〜6.5bb), 8(〜9.5bb), 10(〜11.5bb), 12(〜13.5bb)
 *    出典系統: HoldemResources系ナッシュチャートの近似
 * ========================================================= */
const PUSH_RANGES = {
  5: [
    /*UTG  */ "22+,A2s+,A7o+,K9s+,KJo+,QTs+,JTs",
    /*UTG+1*/ "22+,A2s+,A7o+,K8s+,KJo+,QTs+,JTs",
    /*UTG+2*/ "22+,A2s+,A5o+,K7s+,KTo+,Q9s+,QJo,JTs,T9s",
    /*LJ   */ "22+,A2s+,A4o+,K5s+,KTo+,Q8s+,QJo,J8s+,T8s+,98s",
    /*HJ   */ "22+,A2+,K4s+,K9o+,Q6s+,QTo+,J7s+,JTo,T7s+,T9o,97s+,87s,76s",
    /*CO   */ "22+,A2+,K2s+,K8o+,Q4s+,Q9o+,J6s+,J9o+,T6s+,T9o,96s+,98o,86s+,76s,65s",
    /*BTN  */ "22+,A2+,K2s+,K5o+,Q2s+,Q8o+,J4s+,J8o+,T6s+,T8o+,95s+,98o,85s+,87o,75s+,64s+,54s",
    /*SB   */ "22+,A2+,K2+,Q2s+,Q5o+,J2s+,J7o+,T4s+,T7o+,94s+,97o+,84s+,86o+,74s+,76o,63s+,53s+,43s",
  ],
  8: [
    /*UTG  */ "33+,A7s+,A5s,A4s,ATo+,KTs+,KQo,QJs,JTs",
    /*UTG+1*/ "33+,A5s+,ATo+,KTs+,KQo,QJs,JTs",
    /*UTG+2*/ "22+,A4s+,A9o+,K9s+,KJo+,QTs+,JTs",
    /*LJ   */ "22+,A2s+,A8o+,K8s+,KTo+,Q9s+,QJo,J9s+,T9s",
    /*HJ   */ "22+,A2s+,A7o+,K6s+,KTo+,Q8s+,QTo+,J8s+,JTo,T8s+,98s",
    /*CO   */ "22+,A2+,K4s+,K9o+,Q6s+,QTo+,J7s+,J9o+,T7s+,T9o,97s+,87s,76s",
    /*BTN  */ "22+,A2+,K2s+,K8o+,Q4s+,Q9o+,J6s+,J9o+,T6s+,T9o,96s+,86s+,76s,65s",
    /*SB   */ "22+,A2+,K2s+,K5o+,Q2s+,Q8o+,J4s+,J8o+,T5s+,T8o+,95s+,97o+,85s+,87o,74s+,64s+,54s",
  ],
  10: [
    /*UTG  */ "55+,A9s+,A5s,ATo+,KJs+",
    /*UTG+1*/ "44+,A8s+,A5s,ATo+,KJs+,KQo",
    /*UTG+2*/ "44+,A7s+,A5s,A4s,ATo+,KTs+,KQo,QJs",
    /*LJ   */ "33+,A4s+,ATo+,K9s+,KQo,QTs+,JTs",
    /*HJ   */ "22+,A2s+,A9o+,K8s+,KJo+,Q9s+,QJo,JTs,T9s",
    /*CO   */ "22+,A2s+,A7o+,K5s+,KTo+,Q8s+,QJo,J8s+,JTo,T8s+,98s,87s",
    /*BTN  */ "22+,A2+,K3s+,K9o+,Q6s+,QTo+,J7s+,JTo,T7s+,97s+,87s,76s,65s",
    /*SB   */ "22+,A2+,K2s+,K7o+,Q3s+,Q9o+,J5s+,J9o+,T6s+,T9o,96s+,98o,86s+,75s+,65s,54s",
  ],
  12: [
    /*UTG  */ "66+,ATs+,A5s,AJo+,KQs",
    /*UTG+1*/ "55+,A9s+,A5s,ATo+,KJs+",
    /*UTG+2*/ "55+,A8s+,A5s,ATo+,KJs+,KQo",
    /*LJ   */ "44+,A7s+,A5s,A4s,ATo+,KTs+,KQo",
    /*HJ   */ "33+,A4s+,A9o+,K9s+,KJo+,QTs+,JTs",
    /*CO   */ "22+,A2s+,A8o+,A5o,K7s+,KTo+,Q9s+,QJo,J9s+,T9s,98s",
    /*BTN  */ "22+,A2s+,A5o+,K5s+,KTo+,Q8s+,QTo+,J8s+,JTo,T8s+,97s+,87s,76s",
    /*SB   */ "22+,A2+,K2s+,K9o+,Q4s+,QTo+,J7s+,JTo,T7s+,T9o,97s+,86s+,76s,65s",
  ],
};

function pushBucketFor(stackBB) {
  if (stackBB <= 6.5) return 5;
  if (stackBB <= 9.5) return 8;
  if (stackBB <= 11.5) return 10;
  return 12;
}

/* =========================================================
 * 2. オープンレイズ(13.5bb超)
 *    バケット: 15(13.5〜20bb), 25(20〜30bb)
 *    GTO Wizard系 MTTチャートの近似(アンティあり)
 * ========================================================= */
const OPEN_RANGES = {
  15: [
    /*UTG  */ "66+,ATs+,A5s,AJo+,KTs+,KQo,QJs,JTs",
    /*UTG+1*/ "55+,A9s+,A5s,A4s,ATo+,KTs+,KQo,QTs+,JTs",
    /*UTG+2*/ "44+,A8s+,A5s,A4s,ATo+,KTs+,KQo,QTs+,JTs,T9s",
    /*LJ   */ "33+,A5s+,ATo+,K9s+,KJo+,QTs+,QJo,JTs,T9s,98s",
    /*HJ   */ "22+,A2s+,ATo+,K9s+,KJo+,Q9s+,QJo,J9s+,T9s,98s,87s",
    /*CO   */ "22+,A2s+,A9o+,K7s+,KTo+,Q9s+,QTo+,J9s+,JTo,T8s+,98s,87s,76s",
    /*BTN  */ "22+,A2s+,A7o+,A5o,K4s+,K9o+,Q6s+,QTo+,J7s+,J9o+,T7s+,T9o,97s+,86s+,76s,65s,54s",
    /*SB   */ "22+,A2+,K2s+,K9o+,Q4s+,QTo+,J6s+,JTo,T7s+,T9o,96s+,86s+,75s+,65s,54s",
  ],
  25: [
    /*UTG  */ "55+,A9s+,A5s,A4s,ATo+,KTs+,KQo,QTs+,JTs,T9s,98s",
    /*UTG+1*/ "44+,A8s+,A5s,A4s,ATo+,KTs+,KQo,QTs+,JTs,T9s,98s,87s",
    /*UTG+2*/ "33+,A7s+,A5s-A3s,ATo+,KTs+,KJo+,QTs+,QJo,JTs,T9s,98s,87s",
    /*LJ   */ "22+,A2s+,ATo+,K9s+,KJo+,Q9s+,QJo,J9s+,T9s,98s,87s,76s",
    /*HJ   */ "22+,A2s+,A9o+,K8s+,KTo+,Q9s+,QTo+,J9s+,JTo,T8s+,97s+,87s,76s,65s",
    /*CO   */ "22+,A2s+,A8o+,A5o,K5s+,KTo+,Q8s+,QTo+,J8s+,JTo,T7s+,97s+,86s+,76s,65s,54s",
    /*BTN  */ "22+,A2s+,A3o+,K2s+,K8o+,Q4s+,Q9o+,J6s+,J9o+,T6s+,T9o,96s+,98o,85s+,75s+,64s+,54s,53s",
    /*SB   */ "22+,A2+,K2s+,K7o+,Q2s+,Q9o+,J4s+,J9o+,T6s+,T8o+,96s+,98o,85s+,87o,74s+,64s+,54s,43s",
  ],
};

function openBucketFor(stackBB) {
  return stackBB <= 20 ? 15 : 25;
}

/* =========================================================
 * 3. リジャム(オープンに対する3ベットオールイン)
 *    キー: オープナークラス(EP/MP/LP/SB) × スタックバケット(10/15/20/25)
 * ========================================================= */
const REJAM_RANGES = {
  EP: {
    10: "77+,ATs+,A5s,AJo+,KQs",
    15: "88+,AJs+,AQo+",
    20: "99+,AQs+,AKo",
    25: "TT+,AQs+,AKo",
  },
  MP: {
    10: "55+,A7s+,A5s,A4s,ATo+,KJs+,KQo",
    15: "77+,ATs+,A5s,AJo+,KQs",
    20: "88+,AJs+,A5s,AQo+",
    25: "99+,AQs+,A5s,AKo",
  },
  LP: {
    10: "33+,A2s+,A8o+,A5o,K9s+,KJo+,QTs+,JTs",
    15: "55+,A7s+,A5s-A3s,ATo+,KTs+,KQo,QJs",
    20: "66+,A9s+,A5s,A4s,AJo+,KJs+",
    25: "77+,ATs+,A5s,AJo+,KQs",
  },
  SB: { // SBオープンに対するBBのリジャム
    10: "22+,A2s+,A4o+,K7s+,KTo+,Q9s+,QJo,J9s+,T9s",
    15: "44+,A2s+,A8o+,A5o,K9s+,KJo+,QTs+,JTs",
    20: "66+,A7s+,A5s-A3s,ATo+,KTs+,KQo,QJs",
    25: "77+,A9s+,A5s,AJo+,KTs+,KQo",
  },
};

function rejamBucketFor(stackBB) {
  if (stackBB <= 12) return 10;
  if (stackBB <= 17) return 15;
  if (stackBB <= 23) return 20;
  return 25;
}

/* =========================================================
 * 4. BBディフェンス(オープンに対する総ディフェンス範囲)
 *    コールレンジ = ディフェンス総範囲 − リジャムレンジ
 *    20bb以上で適用(浅いとジャム/フォールド主体)
 * ========================================================= */
const BB_DEFEND_TOTAL = {
  EP: "22+,A2s+,A9o+,K9s+,KJo+,Q9s+,QJo,J9s+,T8s+,97s+,87s,76s,65s,54s",
  MP: "22+,A2s+,A7o+,K7s+,KTo+,Q8s+,QJo,J8s+,JTo,T7s+,97s+,86s+,75s+,65s,54s",
  LP: "22+,A2+,K4s+,K9o+,Q5s+,QTo+,J7s+,J9o+,T6s+,T9o,96s+,98o,85s+,87o,75s+,64s+,54s,43s",
  SB: "22+,A2+,K2+,Q2s+,Q8o+,J3s+,J8o+,T5s+,T8o+,95s+,97o+,84s+,86o+,74s+,76o,63s+,65o,53s+,43s",
};

/* ---------- レンジ演算ユーティリティ ---------- */
function rangeSubtract(a, b) {
  const out = new Map();
  a.forEach((w, label) => {
    const bw = b.get(label) || 0;
    const nw = Math.max(0, w - bw);
    if (nw > 0) out.set(label, nw);
  });
  return out;
}

function rangeHas(range, label) {
  return (range.get(label) || 0) > 0;
}

function rangeWeight(range, label) {
  return range.get(label) || 0;
}

/* ---------- レンジ取得API(strategy.jsから使用) ---------- */
const Ranges = {
  push(posIdx, stackBB) {
    return parseRange(PUSH_RANGES[pushBucketFor(stackBB)][posIdx]);
  },
  open(posIdx, stackBB) {
    return parseRange(OPEN_RANGES[openBucketFor(stackBB)][posIdx]);
  },
  rejam(opClass, effStackBB) {
    return parseRange(REJAM_RANGES[opClass][rejamBucketFor(effStackBB)]);
  },
  bbDefendTotal(opClass) {
    return parseRange(BB_DEFEND_TOTAL[opClass]);
  },
  bbCall(opClass, effStackBB) {
    const total = parseRange(BB_DEFEND_TOTAL[opClass]);
    const jam = parseRange(REJAM_RANGES[opClass][rejamBucketFor(effStackBB)]);
    return rangeSubtract(total, jam);
  },
};

;
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

;
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

// ブラインド構成 [SB, BB] (BBアンティ = BB)
const BLIND_LEVELS = [
  [2000, 4000], [2500, 5000], [3000, 6000], [4000, 8000], [5000, 10000],
  [6000, 12000], [8000, 16000], [10000, 20000], [12500, 25000], [15000, 30000],
  [20000, 40000], [25000, 50000], [30000, 60000], [40000, 80000], [50000, 100000],
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
  return Math.round(bb * LIVE.bb / 100) * 100; // 100点単位
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
  setLevel(0);
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

  const streets = [["flop", 3], ["turn", 1], ["river", 1]];
  for (const [street, n] of streets) {
    if (activeCount(state) <= 1) break;
    state.street = street;
    for (let i = 0; i < n; i++) state.board.push(state.deck.pop());
    for (const p of state.players) { p.streetBet = 0; p.hasActed = false; p.hadAggression = false; }
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
 * 各要素: {id, label, target(このストリートの合計ベット目標)}
 */
function legalActions(state, p, currentBet, street) {
  const toCall = currentBet - p.streetBet;
  const pot = potTotal(state);
  const out = [];
  // プリフロップ未オープン(ブラインドのみ): リンプ無し → フォールド/レイズ2.2BB/オールイン
  if (street === "preflop" && toCall > 0 && !state.preflopOpen && state.preflopJams.length === 0) {
    out.push({ id: "fold", label: "フォールド" });
    const target = Math.round(CFG.OPEN_SIZE * LIVE.bb);
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
      const target = Math.round(CFG.OPEN_SIZE * LIVE.bb);
      if (p.chips + p.streetBet > target) {
        out.push({ id: "raise", label: `レイズ ${fmtChips(target)}`, target });
      }
      out.push({ id: "jam", label: `オールイン ${fmtChips(p.chips + p.streetBet)}`, target: p.streetBet + p.chips });
    } else {
      const b33 = Math.max(LIVE.bb, Math.round(pot * 0.33 / 100) * 100);
      const b66 = Math.max(LIVE.bb, Math.round(pot * 0.66 / 100) * 100);
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
    if (io.sound) io.sound("fold");
    return;
  }
  if (action.id === "check") {
    io.log(`${tag}: チェック`, "check");
    if (io.sound) io.sound("check");
    return;
  }
  if (action.id === "call") {
    const toCall = Math.min(currentBet - p.streetBet, p.chips);
    postBet(p, toCall);
    if (p.chips === 0) p.allIn = true;
    if (street === "preflop" && state.preflopJams.length > 0) state.jamCallers++;
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

;
/* =========================================================
 * coach.js — 採点とGTO解説の生成
 * ========================================================= */
"use strict";

const VERDICT_INFO = {
  best:    { label: "✓ GTO通り",      cls: "v-best",    score: 10 },
  mixed:   { label: "✓ OK(混合戦略)", cls: "v-mixed",   score: 10 },
  minor:   { label: "△ 僅かなミス",   cls: "v-minor",   score: 4 },
  blunder: { label: "✗ ブランダー",   cls: "v-blunder", score: 0 },
};

function gradeDecision(ctx, advice, chosenId) {
  // ベット系のIDゆらぎを吸収
  let chosen = chosenId;
  const freqs = advice.freqs;
  const f = freqs[chosen] || 0;

  let verdict;
  if (f >= 0.6) verdict = "best";
  else if (f >= 0.25) verdict = "mixed";
  else if (f >= 0.05) verdict = "minor";
  else verdict = "blunder";

  // 特例処理
  const d = advice.data;
  if (verdict === "blunder") {
    if (d.kind === "openRaise" && chosen === "jam" && rangeHas(d.range, ctx.heroLabel)) {
      verdict = "minor"; // レンジ内ハンドのオーバージャム
    }
    if (d.kind === "facingOpen" && chosen === "call" && d.rejamRange && rangeHas(d.rejamRange, ctx.heroLabel) && ctx.posIdx !== POS_BB) {
      verdict = "minor"; // リジャム推奨ハンドでのコール
    }
    if (d.kind === "openJam" && chosen === "raise" && rangeHas(d.range, ctx.heroLabel)) {
      verdict = "minor"; // ジャム推奨スタックでの通常レイズ
    }
    if ((d.kind === "openJam") && chosen === "fold" && rangeHas(d.range, ctx.heroLabel)) {
      // レンジ最底辺のハンドのフォールドは僅差
      const pct = handPercentile(ctx.heroLabel);
      if (Math.abs(pct - d.rangePct) < 5) verdict = "minor";
    }
  }

  // EV損失推定(BB)
  let evLoss = 0;
  if (verdict === "minor") evLoss = 0.4;
  if (verdict === "blunder") evLoss = 1.5;
  if (d.kind === "facingJam" && d.evCallBB !== undefined) {
    const ev = d.evCallBB;
    if (chosen === "call" && ev < -0.05) evLoss = -ev;
    else if (chosen === "fold" && ev > 0.05) evLoss = ev;
    else evLoss = 0;
    if (evLoss > 0 && evLoss < 0.3) verdict = (verdict === "blunder") ? "minor" : verdict;
    if (evLoss === 0 && (verdict === "minor" || verdict === "blunder")) verdict = "mixed";
  }
  if (verdict === "best" || verdict === "mixed") evLoss = 0;

  return { verdict, evLoss, explanation: buildExplanation(ctx, advice, chosen, verdict) };
}

/* ---------- 解説文の生成 ---------- */
function actionJP(id) {
  return {
    fold: "フォールド", call: "コール", check: "チェック",
    raise: "レイズ", jam: "オールイン", bet33: "33%ベット", bet66: "66%ベット",
  }[id] || id;
}

function freqsText(freqs) {
  const parts = [];
  const keys = Object.keys(freqs).sort((a, b) => freqs[b] - freqs[a]);
  for (const k of keys) {
    if (freqs[k] >= 0.03) parts.push(`${actionJP(k)} ${(freqs[k] * 100).toFixed(0)}%`);
  }
  return parts.join(" / ");
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

function buildExplanation(ctx, advice, chosen, verdict) {
  const d = advice.data;
  const lines = [];
  const hand = ctx.heroLabel;
  lines.push(`<div class="ex-head"><b>${hand}</b> @ ${ctx.seatName} ` +
    (ctx.phase === "preflop" ? `(${ctx.stackBB.toFixed(1)}BB)` : `【${streetJP(ctx.street)}】`) + `</div>`);
  lines.push(`<div class="ex-gto">GTO戦略: <b>${freqsText(advice.freqs)}</b> — あなた: <b>${actionJP(chosen)}</b></div>`);

  if (d.kind === "openJam") {
    const inR = rangeHas(d.range, hand);
    lines.push(`<p>${ctx.stackBB.toFixed(1)}BBの${ctx.seatName}からのナッシュ・オープンジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
      `${hand} はこのレンジに<b>${inR ? "含まれます" : "含まれません"}</b>(ハンド強度 上位${handPercentile(hand).toFixed(0)}%)。</p>`);
    if (!inR && chosen === "jam") lines.push(`<p>ショートでも全ハンドをジャムして良いわけではありません。コールされた時の勝率が低すぎ、フォールドエクイティを差し引いてもマイナスです。</p>`);
    if (inR && chosen === "fold") lines.push(`<p>ブラインド+アンティ(2.5BB)を奪う価値はスタックが浅いほど大きく、このハンドはジャムで+EVです。タイトすぎるとブラインドで削られていきます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "ジャム"));
  }
  else if (d.kind === "openRaise") {
    const inR = rangeHas(d.range, hand);
    lines.push(`<p>${ctx.seatName}(${ctx.stackBB.toFixed(0)}BB)のオープンレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
      `${hand} は<b>${inR ? "オープンします" : "フォールドです"}</b>。</p>`);
    if (chosen === "jam" && inR) lines.push(`<p>このスタックではオールインよりも2.2BBレイズが標準です。強いハンドの価値を最大化し、弱いハンドにフォールドの余地を残せます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "レイズ"));
  }
  else if (d.kind === "facingOpen") {
    lines.push(`<p>${d.openerClass}ポジションからのオープンに対する有効${ctx.effBB.toFixed(0)}BBのリジャムレンジは上位 <b>${d.rejamPct.toFixed(1)}%</b>` +
      (d.callRange ? `、コールレンジは <b>${d.callPct.toFixed(1)}%</b>` : "") + `。</p>`);
    if (ctx.posIdx === POS_BB) lines.push(`<p>BBは既に1BB+アンティを投資しているためポットオッズが良く、広めにディフェンスできます。ただし浅いスタックではコールよりリジャムでフォールドエクイティを取る方が優位です。</p>`);
    else lines.push(`<p>ポジション外・浅スタックではコール(フラット)はほぼ使わず、<b>リジャムかフォールド</b>の二択がGTOです。</p>`);
    lines.push(rangeGridHTML(d.rejamRange, d.callRange, hand, "オールイン", "コール"));
  }
  else if (d.kind === "facingJam") {
    lines.push(
      `<p>相手のジャムレンジ: 上位 <b>${d.jamRangePct.toFixed(1)}%</b><br>` +
      `${hand} のエクイティ: <b>${pct(d.equity)}</b><br>` +
      `必要勝率(ポットオッズ): <b>${pct(d.breakeven)}</b>` +
      (d.margin > 0.01 ? ` + 後続プレイヤー補正 ${pct(d.margin)}` : "") + `<br>` +
      `コールのEV: <b class="${d.evCallBB >= 0 ? "pos" : "neg"}">${d.evCallBB >= 0 ? "+" : ""}${d.evCallBB.toFixed(2)} BB</b></p>`);
    if (chosen === "call" && d.evCallBB < -0.05) lines.push(`<p>エクイティが必要勝率に届いていません。「もう投げ捨てるには惜しい」と感じても、長期では確実に損をするコールです。</p>`);
    if (chosen === "fold" && d.evCallBB > 0.05) lines.push(`<p>必要勝率を上回っているのでコールが+EVでした。トーナメントで勝つには、この僅かに+EVのコールを積み重ねる必要があります。</p>`);
  }
  else if (d.kind === "postflop") {
    const c = d.cls;
    lines.push(`<p>あなたのハンド: <b>${c.label}</b> (強度ティア ${c.tier}/5)<br>` +
      (d.equity !== undefined ? `${d.vsLabel}に対するエクイティ: <b>${pct(d.equity)}</b><br>` : "") +
      (d.breakeven !== undefined ? `必要勝率: <b>${pct(d.breakeven)}</b><br>` : "") +
      `SPR(スタック/ポット比): <b>${d.spr.toFixed(1)}</b></p>`);
    lines.push(`<p>${postflopReason(ctx, advice, chosen)}</p>`);
  }
  return lines.join("\n");
}

function postflopReason(ctx, advice, chosen) {
  const d = advice.data, c = d.cls, primary = advice.primary;
  const t = c.tier;
  if (ctx.facing === "none") {
    if (t >= 4) return "強い役はベットでバリューを取ります。浅いSPRではポットを膨らませてスタックを入れ切る設計が重要です。";
    if (t === 3) return "中程度の強さは「小さくベット」と「チェック」の混合です。ベットしすぎると強いハンドにしか出てこられず、チェックしすぎるとフリーカードを与えます。";
    if (c.draws.flushDraw || c.draws.oesd) return "強いドローはセミブラフの好機です。降ろせれば即利益、コールされても完成すれば大きく勝てる二重の勝ち筋があります。";
    if (d.dryBoard && ctx.role === "pfr") return "ドライなボードはプリフロップレイザーのレンジが有利なので、小さいベットを高頻度で打てます(レンジベット)。";
    return "弱いハンド・濡れたボードではチェックが基本です。エクイティのないブラフは浅いスタックでは特に割に合いません。";
  }
  if (ctx.facing === "bet") {
    if (t >= 5) return "モンスターは浅いSPRならレイズ(オールイン)でバリュー最大化。深ければコールで相手のブラフを泳がせる選択もあります。";
    if (d.equity !== undefined && d.breakeven !== undefined) {
      return d.equity >= d.threshold
        ? "エクイティが必要勝率を上回るため継続が正解です。"
        : "エクイティが必要勝率に足りません。ここで支払い続けるとスタックが溶けます。";
    }
  }
  if (ctx.facing === "raiseAllin") {
    return "オールインを受けた時は感情を排して「相手のレンジに対する勝率 vs 必要勝率」だけで決めます。";
  }
  return "";
}

/* ---------- 13x13 レンジグリッド ---------- */
const GRID_RANKS = "AKQJT98765432";

function rangeGridHTML(primaryRange, secondaryRange, heroLabel, primaryName, secondaryName) {
  let html = `<div class="rg-wrap"><div class="rg-legend">` +
    `<span class="rg-key rg-p"></span>${primaryName || "レイズ"}` +
    (secondaryRange ? ` <span class="rg-key rg-s"></span>${secondaryName || "コール"}` : "") +
    ` <span class="rg-key rg-f"></span>フォールド</div><div class="rg-grid">`;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      let label;
      if (r === c) label = GRID_RANKS[r] + GRID_RANKS[c];
      else if (r < c) label = GRID_RANKS[r] + GRID_RANKS[c] + "s";
      else label = GRID_RANKS[c] + GRID_RANKS[r] + "o";
      let cls = "rg-f";
      const pw = primaryRange ? (primaryRange.get(label) || 0) : 0;
      const sw = secondaryRange ? (secondaryRange.get(label) || 0) : 0;
      if (pw >= 0.5) cls = "rg-p";
      else if (sw >= 0.5) cls = "rg-s";
      else if (pw > 0 || sw > 0) cls = "rg-m";
      const hero = label === heroLabel ? " rg-hero" : "";
      html += `<div class="rg-cell ${cls}${hero}">${label}</div>`;
    }
  }
  html += `</div></div>`;
  return html;
}

;
/* ---- ヘッドレステスト本体(run.jsがjs/*と連結して実行) ---- */
let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); failures++; }
  else console.log("ok: " + msg);
}
const c = (r, s) => makeCard(r, s);

/* 役判定 */
assert((evaluate7([c(12,0),c(11,0),c(10,0),c(9,0),c(8,0),c(0,1),c(1,2)]) >> 20) === 8, "ロイヤル=ストレートフラッシュ");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(5,3),c(8,0),c(0,1),c(1,2)]) >> 20) === 7, "クアッズ");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(8,3),c(8,0),c(0,1),c(1,2)]) >> 20) === 6, "フルハウス");
assert((evaluate7([c(2,0),c(4,0),c(6,0),c(8,0),c(10,0),c(0,1),c(1,2)]) >> 20) === 5, "フラッシュ");
assert((evaluate7([c(12,0),c(0,1),c(1,2),c(2,3),c(3,0)]) >> 20) === 4, "ホイール(A2345)");
assert((evaluate7([c(8,0),c(9,1),c(10,2),c(11,3),c(12,0),c(0,1),c(0,2)]) >> 20) === 4, "TJQKAストレート");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(8,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 3, "トリップス");
assert((evaluate7([c(5,0),c(5,1),c(8,2),c(8,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 2, "ツーペア");
assert((evaluate7([c(5,0),c(5,1),c(8,2),c(7,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 1, "ワンペア");
assert((evaluate7([c(5,0),c(3,1),c(8,2),c(7,3),c(9,0),c(0,1),c(12,2)]) >> 20) === 0, "ハイカード");
// キッカー比較: AKvsAQ on A-high board
const b1 = [c(12,0), c(7,1), c(4,2), c(2,3), c(9,0)];
const ak = evaluate7([c(12,1), c(11,2)].concat(b1));
const aq = evaluate7([c(12,2), c(10,3)].concat(b1));
assert(ak > aq, "キッカー比較 AK>AQ");

/* レンジパーサー */
assert(parseRange("22+").size === 13, "22+ → 13ペア");
assert(parseRange("A2s+").size === 12, "A2s+ → 12種");
assert(parseRange("ATo+").size === 4, "ATo+ → 4種");
assert(parseRange("77-55").size === 3, "77-55 → 3種");
assert(parseRange("A5s-A3s").size === 3, "A5s-A3s → 3種");
assert(parseRange("A2+").size === 24, "A2+ → s/o両方24種");
assert(parseRange("KQo:0.5").get("KQo") === 0.5, "重み付き");
const pr = parseRange("22+,A2s+,A7o+,K9s+,KJo+,QTs+,JTs");
console.log("  UTG 5bbジャムレンジ:", rangePercent(pr).toFixed(1) + "%");
assert(rangePercent(pr) > 13 && rangePercent(pr) < 22, "UTG 5bbジャム ≈ 15-20%");

/* レンジデータの整合性(全バケット・全ポジションがパース可能か) */
for (const bucket of Object.keys(PUSH_RANGES)) {
  for (let pos = 0; pos < 8; pos++) {
    const r = parseRange(PUSH_RANGES[bucket][pos]);
    assert(r.size > 0, `PUSH[${bucket}][${POSITIONS[pos]}] パース可`);
  }
}
for (const bucket of Object.keys(OPEN_RANGES)) {
  for (let pos = 0; pos < 8; pos++) {
    const r = parseRange(OPEN_RANGES[bucket][pos]);
    assert(r.size > 0, `OPEN[${bucket}][${POSITIONS[pos]}] パース可`);
  }
}
// 単調性: ポジションが後ろほどジャムレンジは広い
for (const bucket of [5, 8, 10, 12]) {
  let prev = 0, mono = true;
  for (let pos = 0; pos < 8; pos++) {
    const pct = rangePercent(parseRange(PUSH_RANGES[bucket][pos]));
    if (pct < prev - 0.6) mono = false;
    prev = pct;
  }
  assert(mono, `PUSH[${bucket}bb] ポジション単調性`);
}

/* エクイティ精度 */
const AA = [c(12,0), c(12,1)];
const eKK = equityVsRange(AA, parseRange("KK"), [], 30000);
console.log("  AA vs KK:", (eKK.equity*100).toFixed(1) + "%");
assert(Math.abs(eKK.equity - 0.82) < 0.025, "AA vs KK ≈ 82%");
const rndRange = new Map(ALL_HANDS.map(h => [h, 1]));
const eRnd = equityVsRange(AA, rndRange, [], 30000);
console.log("  AA vs ランダム:", (eRnd.equity*100).toFixed(1) + "%");
assert(Math.abs(eRnd.equity - 0.852) < 0.02, "AA vs ランダム ≈ 85%");
const AKs = [c(12,0), c(11,0)];
const eQQ = equityVsRange(AKs, parseRange("QQ"), [], 30000);
console.log("  AKs vs QQ:", (eQQ.equity*100).toFixed(1) + "%");
assert(Math.abs(eQQ.equity - 0.46) < 0.025, "AKs vs QQ ≈ 46%");

/* ハンド分類 */
const flop1 = [c(12,0), c(7,1), c(2,2)]; // A 9 4 レインボー
const clsTP = classifyHand([c(12,1), c(11,2)], flop1); // AK
assert(clsTP.tier === 4, "AK on A94r = トップペア良キッカー (tier4) got " + clsTP.tier + " " + clsTP.label);
const clsSet = classifyHand([c(7,0), c(7,2)], flop1);
assert(clsSet.tier === 5, "99 on A94 = セット (tier5)");
const clsFD = classifyHand([c(10,0), c(9,0)], [c(5,0), c(3,0), c(12,1)]); // QJss on 75s As
assert(clsFD.draws.flushDraw, "フラッシュドロー検出");
const clsOESD = classifyHand([c(7,0), c(6,1)], [c(5,2), c(4,3), c(12,1)]); // 98 on 76A
assert(clsOESD.draws.oesd, "OESD検出");

/* 採点ロジック */
(async () => {
  // 5BB UTGのAKs → ジャムが正解
  const ctx1 = {
    heroCards: [c(12,0), c(11,0)], heroLabel: "AKs", posIdx: 0,
    stackBB: 5, effBB: 5, facing: "none", potBB: 2.5, toCallBB: 1, fast: true, seatName: "UTG",
  };
  const adv1 = await preflopAdvice(ctx1);
  assert(adv1.primary === "jam", "5BB UTG AKs → ジャム");
  const g1 = gradeDecision(ctx1, adv1, "fold");
  assert(g1.verdict === "blunder" || g1.verdict === "minor", "AKsフォールドは減点");
  const g2 = gradeDecision(ctx1, adv1, "jam");
  assert(g2.verdict === "best", "AKsジャムはGTO通り");

  // 72o → フォールドが正解
  const ctx2 = Object.assign({}, ctx1, { heroCards: [c(5,0), c(0,1)], heroLabel: "72o" });
  const adv2 = await preflopAdvice(ctx2);
  assert(adv2.primary === "fold", "5BB UTG 72o → フォールド");

  // ジャムに対するAAコール
  const ctx3 = {
    heroCards: [c(12,0), c(12,1)], heroLabel: "AA", posIdx: 8,
    stackBB: 20, effBB: 10, facing: "jam",
    jamRange: Ranges.push(POS_BTN, 10), jamCount: 1, playersBehind: 0,
    potBB: 12.5, toCallBB: 9, fast: true, seatName: "BB",
  };
  const adv3 = await preflopAdvice(ctx3);
  assert(adv3.primary === "call", "BB AA vs BTNジャム → コール");
  assert(adv3.data.evCallBB > 5, "AAコールEVは大きく+ got " + adv3.data.evCallBB.toFixed(2));

  // 72o はフォールド
  const ctx4 = Object.assign({}, ctx3, { heroCards: [c(5,0), c(0,1)], heroLabel: "72o" });
  const adv4 = await preflopAdvice(ctx4);
  assert(adv4.primary === "fold", "BB 72o vs BTNジャム → フォールド");

  /* ヘッドレストーナメント(ボット同士) */
  let totalHands = 0;
  for (let i = 0; i < 6; i++) {
    const st = newTournament("bot");
    st.fastMode = true;
    const io = {
      delay: () => Promise.resolve(),
      render: () => { },
      log: () => { },
      heroAct: (ctx, legal) => botAct(st, st.players[0], ctx, legal, io),
    };
    let guard = 0;
    while (!st.over && st.handNo < 150 && guard++ < 160) {
      await playHand(st, io);
      for (const p of st.players) {
        if (p.chips < 0) { assert(false, `チップがマイナス: ${p.name} ${p.chips}`); break; }
      }
    }
    console.log(`  トーナメント${i + 1}: ${st.handNo}ハンドで${st.over ? "バスト" : "生存(打ち切り)"}`);
    totalHands += st.handNo;
  }
  assert(totalHands > 0, "ヘッドレストーナメント完走");

  console.log(failures === 0 ? "\n=== 全テスト合格 ===" : `\n=== 失敗 ${failures}件 ===`);
  if (failures > 0) process.exitCode = 1;
})().catch(e => { console.error("クラッシュ:", e); process.exitCode = 1; });
