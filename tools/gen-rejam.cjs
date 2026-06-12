/* リジャム(オープンレイズへの3ベットオールイン)均衡ソルバー
 * モデル: オープナーは固定レンジでオープン(2.2BB)。ヒーローはジャム or フォールド。
 *         オープナーはジャムに対しベストレスポンスでコール。フィクティシャスプレイで均衡化。
 * 次元: オープナークラス(EP/MP/LP/SB/HU) × ヒーロー位置(BB/IP) × 有効スタック4〜25BB(0.5刻み)
 * 出力: js/data-rejam.js — REJAM_THRESH[クラス][ヒーロー位置][ハンド] = ジャムする最大有効スタック×2
 * 実行: node tools/gen-rejam.cjs (gen-equity.cjs 実行済みであること)
 */
const fs = require("fs");
const path = require("path");

const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const sb = {};
new Function("exports", load("engine.js") + "\n" + load("ranges.js") +
  "\n;exports.combosOfLabel=combosOfLabel;exports.ALL_HANDS=ALL_HANDS;exports.combosCountOfLabel=combosCountOfLabel;" +
  "exports.parseRange=parseRange;exports.OPEN_RANGES=OPEN_RANGES;exports.HU_SB_OPEN=HU_SB_OPEN;")(sb);
const { combosOfLabel, ALL_HANDS, combosCountOfLabel, parseRange, OPEN_RANGES, HU_SB_OPEN } = sb;

const EQ = JSON.parse(fs.readFileSync(path.join(__dirname, "equity.json"), "utf8"));
const N = 169;

// コンボ重複表
const combosBy = ALL_HANDS.map(l => combosOfLabel(l));
const AVAIL = [];
for (let i = 0; i < N; i++) {
  AVAIL.push(new Float64Array(N));
  for (let j = 0; j < N; j++) {
    let pairs = 0;
    for (const a of combosBy[i]) for (const b of combosBy[j]) {
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) pairs++;
    }
    AVAIL[i][j] = pairs / combosBy[i].length;
  }
}

function rangeToVec(map) {
  const v = new Float64Array(N);
  map.forEach((w, l) => { const i = ALL_HANDS.indexOf(l); if (i >= 0) v[i] = w; });
  return v;
}
function eqVsMix(h, mix) {
  let num = 0, den = 0;
  const av = AVAIL[h];
  for (let j = 0; j < N; j++) {
    const w = mix[j] * av[j];
    if (w <= 0) continue;
    num += w * EQ[h][j]; den += w;
  }
  return den > 0 ? num / den / 1000 : 0.5;
}

const OPEN = 2.2;
// オープナークラスの代表ポジション(オープンレンジ)
function openerVec(cls, eff) {
  if (cls === "HU") return rangeToVec(parseRange(HU_SB_OPEN));
  const bucket = eff <= 20 ? 15 : 25;
  const repPos = { EP: 1, MP: 4, LP: 6, SB: 7 }[cls];
  return rangeToVec(parseRange(OPEN_RANGES[bucket][repPos]));
}

/* ヒーロータイプ: posted(既に出した額), behindPenalty(後ろのプレイヤーが目を覚ますコスト) */
const HERO_TYPES = {
  BB: { posted: 1, penalty: 0 },
  IP: { posted: 0, penalty: 0.3 },  // ブラインド2人が後ろに残る
};

function solve(cls, heroType, S) {
  const O = openerVec(cls, S);
  const ht = HERO_TYPES[heroType];
  const potNow = 2.5 + OPEN;           // ブラインド+アンティ+オープン(ヒーローのポスト分含む)
  const heroRisk = S - ht.posted;
  const openerRisk = S - OPEN;
  const finalPot = 2.5 + 2 * S - ht.posted;

  let jam = new Float64Array(N).fill(0.2);
  let call = new Float64Array(N).fill(0);
  for (let r = 0; r < 50; r++) {
    const damp = r < 6 ? 0.6 : 0.35;
    // オープナーのコールBR(自分のレンジ内のハンドのみ意味を持つが全ハンド分計算)
    for (let h = 0; h < N; h++) {
      const eq = eqVsMix(h, jam);
      const br = (eq * finalPot - openerRisk > 0) ? 1 : 0;
      call[h] = call[h] * (1 - damp) + br * damp;
    }
    // ヒーローのジャムBR
    // オープナーのコール確率 = オープンレンジ内でコールに回る割合(ヒーローのハンドでカード除去)
    for (let h = 0; h < N; h++) {
      let pc = 0, tot = 0, eqNum = 0, eqDen = 0;
      const av = AVAIL[h];
      for (let j = 0; j < N; j++) {
        const wOpen = O[j] * av[j];
        if (wOpen <= 0) continue;
        tot += wOpen;
        const wCall = wOpen * call[j];
        pc += wCall;
        if (wCall > 0) { eqNum += wCall * EQ[h][j]; eqDen += wCall; }
      }
      const pCall = tot > 0 ? pc / tot : 0;
      const eqVsCall = eqDen > 0 ? eqNum / eqDen / 1000 : 0.5;
      const ev = (1 - pCall) * potNow + pCall * (eqVsCall * finalPot - heroRisk) - ht.penalty;
      const br = ev > 0 ? 1 : 0;
      jam[h] = jam[h] * (1 - damp) + br * damp;
    }
  }
  return jam;
}

console.log("リジャム均衡を計算中…");
const t0 = Date.now();
const CLASSES = ["EP", "MP", "LP", "SB", "HU"];
const RESULT = {};
const stacks = [];
for (let s = 4; s <= 25; s += 0.5) stacks.push(s);

for (const cls of CLASSES) {
  RESULT[cls] = {};
  const heroTypes = (cls === "SB" || cls === "HU") ? ["BB"] : ["BB", "IP"];
  for (const ht of heroTypes) {
    const jams = stacks.map(S => solve(cls, ht, S));
    // 閾値 = 浅いスタックから連続してジャムである最大S(ノイズの単発を除外)
    const th = new Array(N).fill(0);
    for (let h = 0; h < N; h++) {
      let t = 0;
      for (let si = 0; si < stacks.length; si++) {
        if (jams[si][h] >= 0.5) t = Math.round(stacks[si] * 2);
        else if (t > 0) break;
      }
      th[h] = t;
    }
    RESULT[cls][ht] = th;
    console.log(`  ${cls} vs ${ht}: 完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
  }
}

// 検証
function pctAt(cls, ht, S) {
  let w = 0, tot = 0;
  for (let h = 0; h < N; h++) {
    const c = combosCountOfLabel(ALL_HANDS[h]);
    tot += c;
    if (RESULT[cls][ht][h] >= S * 2) w += c;
  }
  return (w / tot * 100).toFixed(1);
}
console.log("\n--- リジャムレンジ%(BBから) ---");
for (const S of [8, 10, 15, 20, 25]) {
  console.log(`${S}BB: ` + CLASSES.map(c => `${c} ${pctAt(c, "BB", S)}%`).join(" / "));
}
for (const hand of ["99", "AJo", "A5s", "KQo", "76s", "A9o"]) {
  const h = ALL_HANDS.indexOf(hand);
  console.log(`${hand}: ` + CLASSES.map(c => `${c}=${RESULT[c]["BB"][h] / 2}BB`).join(" "));
}

const js = `/* 自動生成: リジャム(vs オープン2.2BB)のナッシュ閾値(ジャムする最大有効スタックBB×2)。
 * tools/gen-rejam.cjs で生成。クラス: EP/MP/LP/SB/HU、ヒーロー: BB(ブラインド)/IP(ポジション側) */
"use strict";
const REJAM_THRESH = ${JSON.stringify(RESULT)};
const REJAM_MAX_BB = 25;
`;
fs.writeFileSync(path.join(__dirname, "..", "js", "data-rejam.js"), js);
console.log(`\n完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)。js/data-rejam.js を出力しました。`);
