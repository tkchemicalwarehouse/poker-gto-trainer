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

/* ---------- 169×169事前計算テーブルによる正確なプリフロップ・エクイティ ----------
 * data-equity.js (EQ169: 千分率) が読み込まれている場合に使用。
 * カードリムーバルはラベルレベルのコンボ数で厳密に加重。
 */
let AVAIL169 = null;
function getAvail169() {
  if (AVAIL169) return AVAIL169;
  AVAIL169 = [];
  const combosBy = ALL_HANDS.map(l => combosOfLabel(l));
  for (let i = 0; i < 169; i++) {
    const row = new Float64Array(169);
    for (let j = 0; j < 169; j++) {
      let pairs = 0;
      for (const a of combosBy[i]) {
        for (const b of combosBy[j]) {
          if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) pairs++;
        }
      }
      row[j] = pairs / combosBy[i].length;
    }
    AVAIL169.push(row);
  }
  return AVAIL169;
}

// レンジに対するエクイティ(テーブル版・即時・高精度)。テーブル未読込ならnull。
function eqVsRangeTable(heroLabel, range) {
  if (typeof EQ169 === "undefined") return null;
  const h = ALL_HANDS.indexOf(heroLabel);
  if (h < 0) return null;
  const av = getAvail169()[h];
  let num = 0, den = 0;
  range.forEach((w, label) => {
    if (w <= 0) return;
    const j = ALL_HANDS.indexOf(label);
    if (j < 0) return;
    const x = w * av[j];
    num += x * EQ169[h][j];
    den += x;
  });
  return den > 0 ? num / den / 1000 : 0.5;
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
