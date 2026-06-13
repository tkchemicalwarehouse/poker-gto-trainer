/* オープンレイズ & BBディフェンスのレンジを計算で求める(B: プリフロップ範囲の本物化)
 * モデル(チップEV + エクイティ実現率。完全なポストフロップ解ではない近似):
 *  - オープンEV = P(全員降りる)×デッドマネー
 *               + P(誰か3ベットジャム)×(コール/フォールドの最適EV)
 *               + P(BBコール)×(実現エクイティ×想定ポット − 投資)
 *  - 3ベット(リジャム)頻度は data-rejam.js を使用、BBコール頻度は本スクリプトで自己無撞着に求解
 *  - 実現率R: スーテッド/ペア/コネクト性で補正(ポストフロップ操作性を粗く反映)
 * 出力: js/data-openraise.js (OPEN_NASH[bucket][posIdx], BBDEFEND_NASH[class])
 * 実行: node tools/gen-openraise.cjs (gen-equity.cjs / gen-rejam.cjs 実行済み前提)
 */
const fs = require("fs");
const path = require("path");
const loadJs = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const sb = {};
new Function("exports", [loadJs("engine.js"), loadJs("ranges.js")].join("\n") +
  ";exports.ALL_HANDS=ALL_HANDS;exports.combosOfLabel=combosOfLabel;exports.combosCountOfLabel=combosCountOfLabel;" +
  ";exports.RANK_CHARS=RANK_CHARS;exports.parseRange=parseRange;exports.rejamThreshold=typeof rejamThreshold!=='undefined'?rejamThreshold:null;")(sb);
const { ALL_HANDS, combosOfLabel, combosCountOfLabel, RANK_CHARS } = sb;
const EQ = JSON.parse(fs.readFileSync(path.join(__dirname, "equity.json"), "utf8"));
const REJAM = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "js", "data-rejam.js"), "utf8").replace(/^[\s\S]*?REJAM_THRESH\s*=\s*/, "").replace(/;\s*const REJAM_MAX_BB[\s\S]*$/, ""));
const N = 169;
const idx = {}; ALL_HANDS.forEach((h, i) => idx[h] = i);

// コンボ重複表(平均残存数)
const combosBy = ALL_HANDS.map(l => combosOfLabel(l));
const AVAIL = [];
for (let i = 0; i < N; i++) {
  AVAIL.push(new Float64Array(N));
  for (let j = 0; j < N; j++) {
    let pairs = 0;
    for (const a of combosBy[i]) for (const b of combosBy[j])
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) pairs++;
    AVAIL[i][j] = pairs / combosBy[i].length;
  }
}
function eqVsVec(h, vec) {
  let num = 0, den = 0; const av = AVAIL[h];
  for (let j = 0; j < N; j++) { const w = vec[j] * av[j]; if (w <= 0) continue; num += w * EQ[h][j]; den += w; }
  return den > 0 ? num / den / 1000 : 0.5;
}
function probVec(h, vec) { let s = 0, t = 0; const av = AVAIL[h]; for (let j = 0; j < N; j++) { s += vec[j] * av[j]; t += av[j]; } return t > 0 ? s / t : 0; }

// ハンドタイプ別の実現率(ポストフロップ操作性の粗い反映)
function realization(label, ip) {
  const suited = label.length === 3 && label[2] === "s";
  const pair = label.length === 2;
  const r1 = RANK_CHARS.indexOf(label[0]), r2 = RANK_CHARS.indexOf(label[1]);
  const gap = pair ? 0 : (r1 - r2);
  let R;
  if (pair) R = 0.96;
  else if (suited) R = gap <= 3 ? 0.98 : 0.90;     // スーテッドコネクター高実現
  else R = gap <= 2 ? 0.90 : (gap <= 4 ? 0.84 : 0.78); // オフスートギャップ低実現
  return R + (ip ? 0.06 : -0.06);
}

const POSTED = [0, 0, 0, 0, 0, 0, 0, 0.5, 1];
const DEAD = 2.5, OPEN = 2.2;
const CLASS_OF = ["EP", "EP", "EP", "MP", "MP", "LP", "LP", "SB"]; // posIdx→opener class(近似)

function rejamVec(cls, heroType, S) {
  const v = new Float64Array(N);
  if (!REJAM[cls]) return v;
  const tbl = (REJAM[cls][heroType] || REJAM[cls]["BB"]); if (!tbl) return v;
  const s2 = Math.min(S, 25) * 2;
  for (let h = 0; h < N; h++) if (tbl[h] >= s2) v[h] = 1;
  return v;
}

// BBコールレンジの best response(オープナーのレンジに対し、実現エクイティ≥ポットオッズ)
function bbCallBR(openVec, S) {
  const callRisk = OPEN - 1;                 // BBは既に1bb投資、追加 1.2bb(2.2-1)
  const pot = DEAD + OPEN + (OPEN - 1);       // 概算ポット(SB0.5+BB1+ante1 +open2.2 +BBの追加1.2)
  const v = new Float64Array(N);
  for (let h = 0; h < N; h++) {
    const R = realization(ALL_HANDS[h], false); // BBはOOP
    const eq = eqVsVec(h, openVec);
    // 実現後の勝率がポットオッズを上回ればコール
    const need = (OPEN - 1) / (pot);
    if (eq * R >= need) v[h] = 1;
  }
  return v;
}

// オープンEV(チップ単位)
function openEV(h, S, posIdx, behindRejam, bbCall) {
  const openRisk = OPEN;
  // 全員フォールド確率
  let pAllFold = 1;
  const behind = [];
  for (let d = posIdx + 1; d <= 8; d++) {
    if (d === 8) { // BB: コール or リジャム or フォールド
      const pCall = probVec(h, bbCall);
      const pJam = probVec(h, behindRejam[d] || new Float64Array(N));
      behind.push({ d, pCall, pJam });
      pAllFold *= (1 - pCall - pJam);
    } else {
      const pJam = probVec(h, behindRejam[d] || new Float64Array(N));
      behind.push({ d, pCall: 0, pJam });
      pAllFold *= (1 - pJam);
    }
  }
  let ev = pAllFold * DEAD;     // 全員降りればデッドマネー獲得
  let pReach = 1;
  for (const b of behind) {
    // リレイズジャムされた場合
    if (b.pJam > 0) {
      const rv = b.d === 8 ? (bbCall ? null : null) : null;
      const jamRange = behindRejam[b.d];
      const eqVsJam = eqVsVec(h, jamRange);
      const callRisk = S - OPEN, finalPot = DEAD + 2 * S - 0; // 概算
      const evCall = eqVsJam * (DEAD + 2 * (S - OPEN) + OPEN) - (S - OPEN);
      const evJamBranch = Math.max(-OPEN, evCall); // 降りれば-open、コールが良ければそちら
      ev += pReach * b.pJam * evJamBranch;
    }
    // BBコールされた場合(ポストフロップを実現率で近似)
    if (b.pCall > 0) {
      const R = realization(ALL_HANDS[h], true); // オープナーはIP
      const eq = eqVsVec(h, bbCall);
      const potCalled = DEAD + OPEN + (OPEN - 1); // ≈5.9
      const evCalled = R * eq * potCalled - OPEN;
      ev += pReach * b.pCall * evCalled;
    }
    pReach *= (1 - b.pCall - b.pJam);
  }
  return ev;
}

// ===== 求解 =====
const buckets = [15, 25];
const OPEN_NASH = {};
const BBDEFEND_NASH = {};

for (const S of buckets) {
  OPEN_NASH[S] = [];
  // 各ポジションの behind rejam ベクトル
  const behindRejam = {};
  for (let d = 1; d <= 8; d++) {
    const cls = CLASS_OF[Math.min(d, 7)];
    behindRejam[d] = rejamVec(cls, d === 8 ? "BB" : "IP", S);
  }
  // BBコールは暫定オープン(やや広め)から数回反復
  let bbCall = new Float64Array(N).fill(0);
  for (let h = 0; h < N; h++) bbCall[h] = 1; // 初期は全部
  for (let iter = 0; iter < 4; iter++) {
    // 各ポジションのオープンレンジ
    const opens = [];
    for (let pos = 0; pos < 8; pos++) {
      const v = new Float64Array(N);
      for (let h = 0; h < N; h++) if (openEV(h, S, pos, behindRejam, bbCall) > 0) v[h] = 1;
      opens.push(v);
    }
    // BBの相手は主にLP/BTNのオープン(代表してBTN=pos6のレンジ)に best response
    bbCall = bbCallBR(opens[6], S);
    if (iter === 3) {
      for (let pos = 0; pos < 8; pos++) OPEN_NASH[S][pos] = Array.from(opens[pos]);
    }
  }
  // BBディフェンス(クラス別): 各オープナークラスの代表オープンレンジに対するコール
  BBDEFEND_NASH[S] = {};
  const repPos = { EP: 1, MP: 4, LP: 6, SB: 7 };
  for (const cls of ["EP", "MP", "LP", "SB"]) {
    const openVec = new Float64Array(OPEN_NASH[S][repPos[cls]]);
    BBDEFEND_NASH[S][cls] = Array.from(bbCallBR(openVec, S));
  }
}

// 検証出力: ポジション別オープン%
function pctOf(vec) { let w = 0, t = 0; for (let h = 0; h < N; h++) { const c = combosCountOfLabel(ALL_HANDS[h]); t += c; if (vec[h]) w += c; } return (w / t * 100).toFixed(1); }
const POS = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB"];
console.log("--- 計算オープンレンジ% ---");
for (const S of buckets) console.log(`${S}BB: ` + POS.map((p, k) => `${p} ${pctOf(OPEN_NASH[S][k])}%`).join(" / "));
console.log("--- BBディフェンス(コール)% ---");
for (const S of buckets) console.log(`${S}BB: ` + ["EP", "MP", "LP", "SB"].map(c => `${c} ${pctOf(BBDEFEND_NASH[S][c])}%`).join(" / "));

const js = `/* 自動生成: オープンレイズ/BBディフェンスの計算レンジ(モデルベース近似)。tools/gen-openraise.cjs */
"use strict";
const OPEN_NASH = ${JSON.stringify(OPEN_NASH)};
const BBDEFEND_NASH = ${JSON.stringify(BBDEFEND_NASH)};
`;
fs.writeFileSync(path.join(__dirname, "..", "js", "data-openraise.js"), js);
console.log("\n→ js/data-openraise.js を出力");
