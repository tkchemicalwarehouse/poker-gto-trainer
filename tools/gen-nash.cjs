/* プッシュ/フォールド・ナッシュ均衡ソルバー(フィクティシャスプレイ)
 * 構造: 9人テーブル、SB0.5 + BB1 + BBアンティ1(デッド2.5BB)、全員同スタックS
 * ファーストイン・ジャム or フォールド。ディフェンダーはコール or フォールド。
 * 近似: シングルコーラー(マルチコールは無視)、コーラー間のカードリムーバルは無視。
 * 出力: js/data-nash.js — NASH_PUSH_THRESH[pos][hand] = ジャムする最大スタック(0.5BB刻み×2の整数)
 * 実行: node tools/gen-nash.cjs   (先に gen-equity.cjs を実行しておくこと)
 */
const fs = require("fs");
const path = require("path");

const engineSrc = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
const sb = {};
new Function("exports", engineSrc +
  "\n;exports.combosOfLabel=combosOfLabel;exports.ALL_HANDS=ALL_HANDS;exports.combosCountOfLabel=combosCountOfLabel;")(sb);
const { combosOfLabel, ALL_HANDS, combosCountOfLabel } = sb;

const EQ = JSON.parse(fs.readFileSync(path.join(__dirname, "equity.json"), "utf8")); // 千分率
const N = 169;

// avail[i][j] = ハンドiの特定コンボが配られた時に残るjのコンボ数(平均)
console.log("コンボ重複表を計算中…");
const combosBy = ALL_HANDS.map(l => combosOfLabel(l));
const AVAIL = [];
for (let i = 0; i < N; i++) {
  AVAIL.push(new Float64Array(N));
  for (let j = 0; j < N; j++) {
    let pairs = 0;
    for (const a of combosBy[i]) {
      for (const b of combosBy[j]) {
        if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) pairs++;
      }
    }
    AVAIL[i][j] = pairs / combosBy[i].length;
  }
}
const TOTAL_AVAIL = 1225; // C(50,2)

const POSTED = [0, 0, 0, 0, 0, 0, 0, 0.5, 1]; // UTG..SB, BB
const DEAD = 2.5;

// レンジ(確率ベクトル)に対するハンドhのエクイティ(コンボ重み付き)
function eqVsMix(h, mix) {
  let num = 0, den = 0;
  const av = AVAIL[h];
  for (let j = 0; j < N; j++) {
    const w = mix[j] * av[j];
    if (w <= 0) continue;
    num += w * EQ[h][j];
    den += w;
  }
  return den > 0 ? num / den / 1000 : 0.5;
}
// ハンドhから見たmixの出現確率(全コンボ比)
function probOfMix(h, mix) {
  let s = 0;
  const av = AVAIL[h];
  for (let j = 0; j < N; j++) s += mix[j] * av[j];
  return s / TOTAL_AVAIL;
}

function solveStack(S, warmJam, warmCall) {
  // jam[k][h] (k=0..7), call[d][k][h] (d=k+1..8)
  const jam = warmJam || Array.from({ length: 8 }, () => new Float64Array(N).fill(0.3));
  const call = warmCall || Array.from({ length: 9 }, (_, d) =>
    Array.from({ length: 8 }, () => new Float64Array(N).fill(0)));

  const ROUNDS = warmJam ? 32 : 90;
  for (let r = 0; r < ROUNDS; r++) {
    const damp = r < 6 ? 0.55 : 0.35;
    // 1) コールのベストレスポンス
    for (let k = 0; k < 8; k++) {
      const jamRisk = S - POSTED[k];
      for (let d = k + 1; d <= 8; d++) {
        const callRisk = S - POSTED[d];
        const finalPot = DEAD + jamRisk + callRisk;
        const cv = call[d][k];
        for (let h = 0; h < N; h++) {
          const eq = eqVsMix(h, jam[k]);
          const ev = eq * finalPot - callRisk;
          const br = ev > 0 ? 1 : 0;
          cv[h] = cv[h] * (1 - damp) + br * damp;
        }
      }
    }
    // 2) ジャムのベストレスポンス
    // ファーストコーラーモデル: 最初にコールした人とHU、以降はフォールド扱い
    // (確率が保存されるため、マルチコール枝を0扱いするよりも正確)
    for (let k = 0; k < 8; k++) {
      const jamRisk = S - POSTED[k];
      for (let h = 0; h < N; h++) {
        let ev = 0;
        let pReach = 1; // ここまで誰もコールしていない確率
        for (let d = k + 1; d <= 8; d++) {
          const pc = probOfMix(h, call[d][k]);
          if (pc > 0) {
            const eq = eqVsMix(h, call[d][k]);
            const callRisk = S - POSTED[d];
            const finalPot = DEAD + jamRisk + callRisk;
            ev += pReach * pc * (eq * finalPot - jamRisk);
          }
          pReach *= (1 - pc);
        }
        ev += pReach * DEAD; // 全員フォールド
        const br = ev > 0 ? 1 : 0;
        jam[k][h] = jam[k][h] * (1 - damp) + br * damp;
      }
    }
  }
  return { jam, call };
}

console.log("スタック2〜16BB(0.5刻み)のナッシュ均衡を計算中…");
const stacks = [];
for (let s = 2; s <= 16; s += 0.5) stacks.push(s); // 昇順(浅→深)でウォームスタート

const jamBy = {}; // S*2 → jam確率
let warm = null;
const t0 = Date.now();
for (const S of stacks) {
  const sol = solveStack(S, warm && warm.jam, warm && warm.call);
  warm = sol;
  jamBy[Math.round(S * 2)] = sol.jam.map(a => Float64Array.from(a));
  console.log(`  S=${S}BB 完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
}
// 閾値 = 浅いスタックから連続してジャムである最大S(収束ノイズの単発ジャムを除外)
const THRESH = Array.from({ length: 8 }, () => new Array(N).fill(0));
for (let k = 0; k < 8; k++) {
  for (let h = 0; h < N; h++) {
    let th = 0;
    for (const S of stacks) {
      const s2 = Math.round(S * 2);
      if (jamBy[s2][k][h] >= 0.5) th = s2;
      else if (th > 0) break; // 連続ブロックの終わり
    }
    THRESH[k][h] = th;
  }
}

// 検証: 各ポジションのレンジ%(コンボ加重)
function pctAt(k, S) {
  let w = 0, tot = 0;
  for (let h = 0; h < N; h++) {
    const c = combosCountOfLabel(ALL_HANDS[h]);
    tot += c;
    if (THRESH[k][h] >= S * 2) w += c;
  }
  return (w / tot * 100).toFixed(1);
}
const POS = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB"];
console.log("\n--- ナッシュ・ジャムレンジ%(検証) ---");
for (const S of [5, 8, 10, 12, 15]) {
  console.log(`${S}BB: ` + POS.map((p, k) => `${p} ${pctAt(k, S)}%`).join(" / "));
}
// 代表ハンドの閾値
for (const hand of ["AA", "A9o", "KTs", "76s", "22", "Q5s"]) {
  const h = ALL_HANDS.indexOf(hand);
  console.log(`${hand}: ` + POS.map((p, k) => `${p}=${THRESH[k][h] / 2}BB`).join(" "));
}

const js = `/* 自動生成: プッシュ/フォールドのナッシュ均衡閾値(ジャムする最大スタックBB×2の整数)。
 * 構造: 9max・SB0.5/BB1/BBアンティ1・ファーストイン。tools/gen-nash.cjs で生成 */
"use strict";
const NASH_PUSH_THRESH = ${JSON.stringify(THRESH)};
const NASH_MAX_BB = 16;
`;
fs.writeFileSync(path.join(__dirname, "..", "js", "data-nash.js"), js);
console.log(`\n完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)。js/data-nash.js を出力しました。`);
