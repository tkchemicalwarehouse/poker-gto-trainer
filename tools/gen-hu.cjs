/* ヘッズアップ(SB=BTN vs BB)プリフロップ均衡ソルバー
 * HUは2人=ゲーム木が小さく、エクイティはEQ169で厳密に評価できる。
 * 両者のレンジをフィクティシャスプレイで「同時に」共解する(これがHUの本質。
 * gen-openraiseは相手レンジ固定だが、HUは相手も最適化しないと均衡にならない)。
 *
 * ゲーム木(ブラインド: SB0.5 / BB1 / BBアンティ1。SB=BTNがポストフロップIP):
 *   SB(先手): フォールド | オープン2.5 | ジャム(オールインS)
 *   BB vs オープン: フォールド | コール | 3ベット7.5
 *   SB vs 3ベット: フォールド | コール | 4ベットジャム(オールインS)
 *   BB vs 4ベットジャム: フォールド | コール(ショーダウン)
 *   BB vs SBジャム: フォールド | コール(ショーダウン)
 *
 * オールイン分岐(ジャム/4ベットジャム/対ジャムコール)はショーダウン=EQ169で厳密。
 * コール後のポストフロップ(SRP=5.0 / 3betポット=15.0)のみ実現率モデルで近似。
 *
 * 出力: js/data-hu.js — HU_SOLVE[stack] = {sbRaise,sbJam,bbCall,bb3bet,bbCallVsJam}(各169のfreq)
 * 実行: node tools/gen-hu.cjs (gen-equity.cjs 実行済み前提)
 */
const fs = require("fs");
const path = require("path");
const loadJs = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const sb = {};
new Function("exports", [loadJs("engine.js"), loadJs("ranges.js")].join("\n") +
  ";exports.ALL_HANDS=ALL_HANDS;exports.combosOfLabel=combosOfLabel;exports.combosCountOfLabel=combosCountOfLabel;" +
  "exports.RANK_CHARS=RANK_CHARS;")(sb);
const { ALL_HANDS, combosOfLabel, combosCountOfLabel, RANK_CHARS } = sb;
const EQ = JSON.parse(fs.readFileSync(path.join(__dirname, "equity.json"), "utf8"));
const N = 169;

// カード除去表: 手iを持つときの相手手jの平均残存率
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
const COMBOS = ALL_HANDS.map(l => combosCountOfLabel(l));

function eqVsVec(h, vec) {
  let num = 0, den = 0; const av = AVAIL[h];
  for (let j = 0; j < N; j++) { const w = vec[j] * av[j]; if (w <= 0) continue; num += w * EQ[h][j]; den += w; }
  return den > 0 ? num / den / 1000 : 0.5;
}
function probVec(h, vec) {
  let s = 0, t = 0; const av = AVAIL[h];
  for (let j = 0; j < N; j++) { s += vec[j] * av[j]; t += av[j]; }
  return t > 0 ? s / t : 0;
}
function pct(vec) { let w = 0, t = 0; for (let h = 0; h < N; h++) { t += COMBOS[h]; if (vec[h] > 0.5) w += COMBOS[h]; } return (w / t * 100); }

function realization(label, ip) {
  const suited = label.length === 3 && label[2] === "s";
  const pair = label.length === 2;
  const r1 = RANK_CHARS.indexOf(label[0]), r2 = RANK_CHARS.indexOf(label[1]);
  const gap = pair ? 0 : (r1 - r2);
  let R;
  if (pair) R = 0.96;
  else if (suited) R = gap <= 3 ? 0.98 : 0.90;
  else R = gap <= 2 ? 0.90 : (gap <= 4 ? 0.84 : 0.78);
  return R + (ip ? 0.06 : -0.06);
}
const RI = ALL_HANDS.map(l => realization(l, true));  // SB=BTN=IP
const RZ = ALL_HANDS.map(l => realization(l, false)); // BB=OOP

// ブラインド/サイズ定数(BB単位)
const SBP = 0.5, BBP = 2.0;       // 投稿額(SB=0.5 / BB=1+アンティ1)
const R1 = 2.5;                   // SBオープン総額
const T3 = 7.5;                   // BB 3ベット総額(3x)
const POT_RC = 2 * R1;            // オープン+コール後 = 5.0
const POT_3C = 2 * T3;            // 3ベット+コール後 = 15.0
const f = () => new Float64Array(N);
// イニシアチブ・プレミアム: 純エクイティ実現モデルはプリフロップ・アグレッサーが
// ポストフロップで持つフォールドエクイティ(cベット等)を捉えられない。これをポットの
// 一定割合として加える。既知のHU解(BBアンティ下でSBは深いほどほぼ全開帳)に較正。
const AGG = parseFloat(process.env.AGG || "0.085");

/* スタックSでHU均衡を共解 */
function solveHU(S, iters) {
  const allowRaise = S >= 4.5;          // これ未満はジャム/フォールドのみ
  const allow3bet = S >= T3 + 1.0;      // 3ベット7.5を打つ余地
  // 平均戦略(各意思決定は確率分布)
  const avg = {
    sbFold: f(), sbRaise: f(), sbJam: f(),         // SBオープン
    bbFold: f(), bbCall: f(), bb3bet: f(),         // BB vs オープン
    s3Fold: f(), s3Call: f(), s3Jam: f(),          // SB vs 3ベット
    bbCall4: f(),                                  // BB vs 4ベットジャム(コール頻度)
    bbCallJam: f(),                                // BB vs SBジャム(コール頻度)
  };
  for (let h = 0; h < N; h++) {
    if (allowRaise) avg.sbRaise[h] = 1; else avg.sbJam[h] = 1;
    avg.bbFold[h] = 0.34; avg.bbCall[h] = 0.5; avg.bb3bet[h] = 0.16;
    avg.s3Fold[h] = 0.34; avg.s3Call[h] = 0.5; avg.s3Jam[h] = 0.16;
    avg.bbCall4[h] = 0.4; avg.bbCallJam[h] = 0.5;
  }

  for (let t = 1; t <= iters; t++) {
    const br = {};
    for (const k of Object.keys(avg)) br[k] = f();

    // 派生レンジ(到達経路を掛けたもの)
    const sbRaiseR = avg.sbRaise;
    const bb3betR = avg.bb3bet;
    const sbJamR = avg.sbJam;
    const sb4jamOf3 = f();   // SBが「レイズ→3betされ→4betジャム」する到達freq
    for (let h = 0; h < N; h++) sb4jamOf3[h] = sbRaiseR[h] * avg.s3Jam[h];
    const sbCallOf3 = f();   // SBがレイズ→3betをコールする到達freq
    for (let h = 0; h < N; h++) sbCallOf3[h] = sbRaiseR[h] * avg.s3Call[h];
    const sbFoldOf3 = f();   // SBがレイズ→3betにフォールドする到達freq
    for (let h = 0; h < N; h++) sbFoldOf3[h] = sbRaiseR[h] * avg.s3Fold[h];
    const bbCallOf4 = f();   // BBが3bet→4betジャムをコールする到達freq
    for (let h = 0; h < N; h++) bbCallOf4[h] = bb3betR[h] * avg.bbCall4[h];

    // (A) BB vs SBジャム
    for (let h = 0; h < N; h++) {
      const eq = eqVsVec(h, sbJamR);
      br.bbCallJam[h] = (eq * 2 * S - S) > -BBP ? 1 : 0;
    }
    // (B) BB vs SB4ベットジャム(BBは3bet=7.5を投資済み)
    for (let h = 0; h < N; h++) {
      const eq = eqVsVec(h, sb4jamOf3);
      br.bbCall4[h] = (eq * 2 * S - S) > -T3 ? 1 : 0;
    }
    // (C) SB vs BB3ベット: fold/call/4betジャム
    for (let h = 0; h < N; h++) {
      const evFold = -R1;
      const eqVs3 = eqVsVec(h, bb3betR);
      const evCall = allow3bet ? (RI[h] * eqVs3 * POT_3C - T3) : -Infinity;
      // 4ベットジャム: BBがフォ/コールする割合(3betレンジ内)
      const pReach = probVec(h, bb3betR);
      let evJam;
      if (pReach <= 1e-9) evJam = evFold;
      else {
        const pCall = probVec(h, bbCallOf4);
        const fFold = Math.max(0, (pReach - pCall)) / pReach, fCall = Math.min(1, pCall / pReach);
        const eqVsCall = eqVsVec(h, bbCallOf4);
        evJam = fFold * T3 + fCall * (eqVsCall * 2 * S - S); // BBフォールドならBBの7.5獲得
      }
      const best = Math.max(evFold, evCall, evJam);
      if (best === evJam && evJam > evFold && evJam >= evCall) br.s3Jam[h] = 1;
      else if (best === evCall && evCall > evFold) br.s3Call[h] = 1;
      else br.s3Fold[h] = 1;
    }
    // (D) BB vs SBオープン: fold/call/3bet
    for (let h = 0; h < N; h++) {
      const evFold = -BBP;
      const eqVsRaise = eqVsVec(h, sbRaiseR);
      const evCall = RZ[h] * eqVsRaise * POT_RC - R1; // SRPでBBはOOP
      // 3ベット: SBがレイズレンジ内でfold/call/4betジャムする割合
      let ev3bet;
      if (!allow3bet) ev3bet = -Infinity;
      else {
        const pReach = probVec(h, sbRaiseR);
        if (pReach <= 1e-9) ev3bet = evFold;
        else {
          const pF = probVec(h, sbFoldOf3) / pReach;
          const pC = probVec(h, sbCallOf3) / pReach;
          const pJ = probVec(h, sb4jamOf3) / pReach;
          const eqVsSBcall = eqVsVec(h, sbCallOf3);          // SBがコール→3betポストフロップ(BB OOP)
          const eqVsSBjam = eqVsVec(h, sb4jamOf3);           // SBが4betジャム→ショーダウン
          // BBが4betジャムに直面したときのBB最適応答
          const evVsJam = Math.max(-T3, eqVsSBjam * 2 * S - S);
          ev3bet = pF * R1                                              // SBフォールド→SBの2.5獲得
                 + pC * (RZ[h] * eqVsSBcall * POT_3C + AGG * POT_3C - T3) // SBコール→BBがアグレッサー
                 + pJ * evVsJam;                                        // SB4betジャム
        }
      }
      const best = Math.max(evFold, evCall, ev3bet);
      if (best === ev3bet && ev3bet > evFold && ev3bet >= evCall) br.bb3bet[h] = 1;
      else if (best === evCall && evCall > evFold) br.bbCall[h] = 1;
      else br.bbFold[h] = 1;
    }
    // (E) SBオープン: fold/raise/jam
    for (let h = 0; h < N; h++) {
      const evFold = -SBP;
      // ジャム
      const pCallJam = probVec(h, avg.bbCallJam);
      const eqVsCallJam = eqVsVec(h, avg.bbCallJam);
      const evJam = (1 - pCallJam) * BBP + pCallJam * (eqVsCallJam * 2 * S - S);
      // レイズ
      let evRaise = -Infinity;
      if (allowRaise) {
        const pBBfold = probVec(h, avg.bbFold);
        const pBBcall = probVec(h, avg.bbCall);
        const pBB3 = probVec(h, avg.bb3bet);
        const eqVsBBcall = eqVsVec(h, avg.bbCall);
        const evCalled = RI[h] * eqVsBBcall * POT_RC + AGG * POT_RC - R1; // SRP: SBがアグレッサー(IP+イニシアチブ)
        // 3ベットされた時のSB最適応答(fold/call/4betジャム)
        let evVs3;
        {
          const evF = -R1;
          const eqVs3 = eqVsVec(h, avg.bb3bet);
          const evC = allow3bet ? (RI[h] * eqVs3 * POT_3C - T3) : -Infinity;
          const eqVsCall4 = eqVsVec(h, bbCallOf4);
          const pReach3 = probVec(h, bb3betR);
          let evJ = evF;
          if (pReach3 > 1e-9) {
            const pCall4 = probVec(h, bbCallOf4) / pReach3;
            const fFold4 = Math.max(0, 1 - pCall4);
            evJ = fFold4 * T3 + Math.min(1, pCall4) * (eqVsCall4 * 2 * S - S);
          }
          evVs3 = Math.max(evF, evC, evJ);
        }
        evRaise = pBBfold * BBP + pBBcall * evCalled + pBB3 * evVs3;
      }
      const best = Math.max(evFold, evRaise, evJam);
      if (best === evJam && evJam > evFold && (!allowRaise || evJam >= evRaise)) br.sbJam[h] = 1;
      else if (allowRaise && best === evRaise && evRaise > evFold) br.sbRaise[h] = 1;
      else br.sbFold[h] = 1;
    }

    // 平均更新(フィクティシャスプレイ)
    const a = 1 / (t + 1);
    for (const k of Object.keys(avg)) for (let h = 0; h < N; h++) avg[k][h] = avg[k][h] * (1 - a) + br[k][h] * a;
  }
  return avg;
}

// ===== 求解 =====
const STACKS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 25, 30];
const ITERS = 400;
const HU_SOLVE = {};
const cut = (v) => Array.from(v, x => Math.round(x * 1000) / 1000);

console.log("=== HU均衡 (SB=BTN vs BB) ===");
console.log("stack | SBレイズ SBジャム (合計) | BBフォ  BBコール  BB3bet | 対ジャムBBコール");
for (const S of STACKS) {
  const a = solveHU(S, ITERS);
  HU_SOLVE[S] = { sbRaise: cut(a.sbRaise), sbJam: cut(a.sbJam), bbCall: cut(a.bbCall), bb3bet: cut(a.bb3bet), bbCallVsJam: cut(a.bbCallJam) };
  const rP = pct(a.sbRaise), jP = pct(a.sbJam);
  console.log(
    `${String(S).padStart(2)}BB | ${rP.toFixed(0).padStart(4)}%  ${jP.toFixed(0).padStart(4)}%  (${(rP + jP).toFixed(0)}%)`.padEnd(33) +
    `| F${pct(a.bbFold).toFixed(0)}% C${pct(a.bbCall).toFixed(0)}% 3b${pct(a.bb3bet).toFixed(0)}%`.padEnd(26) +
    `| ${pct(a.bbCallJam).toFixed(0)}%`
  );
}

// 研究用アーティファクト(tools/配下)。※本番(js/)には配線しない。
// オールイン分岐(ジャム/4ベット/対ジャムコール)はEQ169厳密だが、レイズ→コール後の
// ポストフロップは実現率近似のため、深いスタックのオープン幅/3ベット幅はGTO級ではない
// (実現率モデルは各ノードでアグレッサーを系統的に過大評価する。検証済み)。
const out = { note: "research only; deep-stack open/3bet are approximate (no postflop CFR)", AGG, HU_STACKS: STACKS, HU_SOLVE };
fs.writeFileSync(path.join(__dirname, "hu-solve.json"), JSON.stringify(out));
console.log("\n→ tools/hu-solve.json を出力(研究用)");
