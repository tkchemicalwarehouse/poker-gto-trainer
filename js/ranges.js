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
    /*BTN  */ "22+,A2s+,A5o+,K2s+,K9o+,Q5s+,Q9o+,J7s+,J9o+,T6s+,T9o,96s+,86s+,75s+,65s,54s,43s",
    /*SB   */ "22+,A2+,K2s+,K7o+,Q3s+,Q9o+,J5s+,J9o+,T6s+,T8o+,95s+,86s+,75s+,64s+,54s,43s",
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

/* =========================================================
 * 5. ヘッズアップ専用(残り2人: SB=BTN vs BB)
 *    HUはレンジが大幅に広がるため9maxチャートを流用しない
 * ========================================================= */
// SBのオープンレイズ(13.5BB超。それ以下はナッシュジャム表のSB列=対BBそのもの)
const HU_SB_OPEN = "22+,A2+,K2+,Q2+,J2s+,J5o+,T2s+,T6o+,92s+,96o+,84s+,86o+,73s+,75o+,63s+,64o+,52s+,54o,43s";
// BBのSBオープン(ミニレイズ)に対するリジャム
const HU_REJAM = {
  10: "22+,A2+,K2s+,K5o+,Q2s+,Q8o+,J5s+,J9o+,T7s+,T9o,97s+,87s,76s,65s",
  15: "22+,A2s+,A3o+,K5s+,K9o+,Q8s+,QJo,J8s+,T8s+,98s,87s,76s",
  20: "22+,A2s+,A8o+,A5o,K9s+,KJo+,QTs+,JTs,T9s",
  25: "33+,A7s+,A5s-A2s,ATo+,KTs+,KQo,QJs,JTs",
};
// BBのSBオープンに対するコール(HUはポットオッズ最良で非常に広い)
const HU_DEFEND_TOTAL = "22+,A2+,K2+,Q2+,J2s+,J6o+,T3s+,T7o+,93s+,96o+,84s+,86o+,74s+,75o+,63s+,64o+,53s+,43s,42s";

/* ---------- リジャム均衡データ(data-rejam.js)ヘルパー ---------- */
function rejamNashAvailable() {
  return typeof REJAM_THRESH !== "undefined";
}
// ジャムする最大有効スタック(BB)。cls: EP/MP/LP/SB/HU、heroType: BB/IP
function rejamThreshold(cls, heroType, label) {
  if (!rejamNashAvailable() || !REJAM_THRESH[cls]) return null;
  const tbl = REJAM_THRESH[cls][heroType] || REJAM_THRESH[cls]["BB"];
  if (!tbl) return null;
  const h = ALL_HANDS.indexOf(label);
  return h >= 0 ? tbl[h] / 2 : null;
}
function rejamRangeAtEff(cls, heroType, effBB) {
  const range = new Map();
  if (!rejamNashAvailable() || !REJAM_THRESH[cls]) return range;
  const tbl = REJAM_THRESH[cls][heroType] || REJAM_THRESH[cls]["BB"];
  if (!tbl) return range;
  const s2 = Math.min(effBB, 25) * 2;
  for (let h = 0; h < 169; h++) {
    if (tbl[h] >= s2) range.set(ALL_HANDS[h], 1);
  }
  return range;
}

/* ---------- ナッシュ均衡データ(data-nash.js)ヘルパー ---------- */
function nashAvailable() {
  return typeof NASH_PUSH_THRESH !== "undefined";
}
// ハンドの「ジャムする最大スタック(BB)」。posIdx 0..7
function nashThreshold(posIdx, label) {
  if (!nashAvailable() || posIdx > 7) return null;
  const h = ALL_HANDS.indexOf(label);
  return h >= 0 ? NASH_PUSH_THRESH[posIdx][h] / 2 : null;
}
// あるスタックでのナッシュ・ジャムレンジ(Map)
function nashRangeAt(posIdx, stackBB) {
  const range = new Map();
  if (!nashAvailable() || posIdx > 7) return range;
  const s2 = stackBB * 2;
  for (let h = 0; h < 169; h++) {
    if (NASH_PUSH_THRESH[posIdx][h] >= s2) range.set(ALL_HANDS[h], 1);
  }
  return range;
}

/* ---------- レンジ取得API(strategy.jsから使用) ---------- */
const Ranges = {
  huOpen() { return parseRange(HU_SB_OPEN); },
  huRejam(effStackBB) { return parseRange(HU_REJAM[rejamBucketFor(effStackBB)]); },
  huCall(effStackBB) {
    const total = parseRange(HU_DEFEND_TOTAL);
    const jam = parseRange(HU_REJAM[rejamBucketFor(effStackBB)]);
    return rangeSubtract(total, jam);
  },
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
