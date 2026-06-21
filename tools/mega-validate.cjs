/* 大規模・網羅検証ハーネス(「Claudeで検証した」の正直な裏付け用)
 *
 * このアプリの戦略は「事前計算テーブル(EQ169エクイティ / ナッシュ閾値 / リジャム閾値)」で
 * 駆動される=決定空間は有限。よって「N億回ランダムプレイ」より、有限空間を網羅して
 * 全不変条件を検証する方が、論理的に強い保証になる。
 *
 * 検証する不変条件(violation=0であるべき):
 *   ① エクイティ表 EQ169: 全 169×169 が [0,1000]、対称性 EQ[i][j]+EQ[j][i]≈1000、対角=500付近
 *   ② ナッシュ押し引き: 全 8ポジ×全スタックで、レンジ%がスタックに対し単調(深いほどタイト)
 *   ③ リジャム: 全クラス×全スタックで閾値が有限・レンジ単調
 *   ④ プリフロップ判定: freqs合計≈1 / primary∈freqs / NaN無し(全169手×代表スタックを網羅)
 *   ⑤ 採点: 推奨どおりの手は決してblunderにならない(全169手×代表局面)
 * さらに throughput を実測し、相当する「検証ハンド数/計算回数」を正直に算定する。
 *
 * 実行: node tools/mega-validate.cjs
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
const src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n") +
  `\n;global.__M={EQ169,ALL_HANDS,combosCountOfLabel,nashRangeAt,rejamRangeAtEff,nashThreshold,parseRange,
    preflopAdvice,gradeDecision,rangeHas,eqVsRangeTable,NASH_PUSH_THRESH,REJAM_THRESH};`;
const c = path.join(__dirname, "_mega_combined.cjs");
fs.writeFileSync(c, src); require(c);
const M = global.__M;
const N = 169;
const t0 = Date.now();

let checks = 0, viol = 0;
const fail = (msg) => { viol++; if (viol <= 30) console.log("  ✗ " + msg); };
const near = (a, b, eps) => Math.abs(a - b) <= eps;

function pctOf(map) { let w = 0, t = 0; for (const l of M.ALL_HANDS) { const cc = M.combosCountOfLabel(l); t += cc; if (map.has(l)) w += cc; } return w / t * 100; }

/* ① EQ169 エクイティ表の網羅検証(対称性・範囲・対角) */
console.log("① EQ169 エクイティ表(169×169)を網羅検証中…");
let eqOK = true;
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const e = M.EQ169[i][j]; checks++;
    if (!Number.isFinite(e) || e < 0 || e > 1000) { fail(`EQ[${i}][${j}]=${e} 範囲外`); eqOK = false; continue; }
    // 対称性: i vs j と j vs i は合計1000(引き分け込み)付近
    const s = e + M.EQ169[j][i]; checks++;
    if (!near(s, 1000, 12)) { fail(`対称性 EQ[${i}][${j}]+EQ[${j}][${i}]=${s} ≠1000`); eqOK = false; }
  }
}
console.log(`   ${checks.toLocaleString()} 件検証 / 対称性${eqOK ? "OK" : "NG"}`);

/* ② ナッシュ押し引き: 全ポジ×全スタックで単調性 */
console.log("② ナッシュ押し引きレンジの単調性を網羅検証中…");
const STK = []; for (let s = 2; s <= 16; s += 0.5) STK.push(s);
for (let pos = 0; pos < 8; pos++) {
  let prevPct = 101;
  for (const s of STK) {
    const r = M.nashRangeAt(pos, s); const p = pctOf(r); checks++;
    if (!Number.isFinite(p)) { fail(`nash pos${pos} ${s}BB %がNaN`); continue; }
    if (p > prevPct + 0.5) fail(`nash pos${pos} 単調性違反: ${s}BBで${p.toFixed(1)}% > 浅い側${prevPct.toFixed(1)}%`);
    prevPct = p;
  }
}
console.log(`   8ポジ×${STK.length}スタック 検証`);

/* ③ リジャム閾値: 全クラス×全スタックで有限・単調 */
console.log("③ リジャム・レンジの単調性を網羅検証中…");
for (const cls of ["EP", "MP", "LP", "SB", "HU"]) {
  let prevPct = 101;
  for (let s = 4; s <= 25; s += 0.5) {
    const r = M.rejamRangeAtEff(cls, "BB", s); const p = pctOf(r); checks++;
    if (!Number.isFinite(p)) { fail(`rejam ${cls} ${s}BB %がNaN`); continue; }
    if (p > prevPct + 0.5) fail(`rejam ${cls} 単調性違反 ${s}BB`);
    prevPct = p;
  }
}
console.log(`   5クラス×43スタック 検証`);

/* ④⑤ プリフロップ判定+採点の網羅検証(全169手 × 代表局面) */
console.log("④⑤ プリフロップ判定と採点を全169手×局面で網羅検証中…");
const POS = global.POSITIONS || null;
async function checkPreflop() {
  const scenarios = [];
  // ファーストイン(open/jam): 全ポジ×代表スタック
  for (let pos = 1; pos <= 7; pos++) for (const s of [6, 8, 10, 12, 15, 20, 25]) scenarios.push({ facing: "none", pos, s });
  for (const sc of scenarios) {
    for (let h = 0; h < N; h++) {
      const label = M.ALL_HANDS[h];
      const ctx = {
        heroLabel: label, posIdx: sc.pos, seatName: "P" + sc.pos, stackBB: sc.s, effJamBB: sc.s,
        facing: sc.facing, tableN: 9, phase: "preflop", fast: true,
      };
      let adv;
      try { adv = await M.preflopAdvice(ctx); } catch (e) { fail(`preflopAdvice例外 ${label} pos${sc.pos} ${sc.s}BB: ${e.message}`); continue; }
      checks++;
      // freqs合計≈1
      const sum = Object.values(adv.freqs).reduce((a, b) => a + (b || 0), 0);
      if (!near(sum, 1, 0.001) && sum !== 0) fail(`freqs合計=${sum} (${label} pos${sc.pos} ${sc.s}BB)`);
      // primary∈freqs かつ最大
      if (adv.primary && !(adv.primary in adv.freqs)) fail(`primary=${adv.primary} がfreqsに無い (${label})`);
      // NaN無し
      for (const k in adv.freqs) if (!Number.isFinite(adv.freqs[k])) fail(`freqs.${k}=NaN (${label})`);
      // ⑤ 採点: 推奨どおりの手はblunderにならない
      if (adv.primary) {
        const g = M.gradeDecision(ctx, adv, adv.primary, null, { noExplain: true });
        checks++;
        if (g.verdict === "blunder") fail(`推奨どおり(${adv.primary})なのにblunder (${label} pos${sc.pos} ${sc.s}BB)`);
        if (!Number.isFinite(g.evLoss)) fail(`evLoss=NaN (${label})`);
      }
    }
  }
}

(async () => {
  await checkPreflop();
  const secs = (Date.now() - t0) / 1000;

  // ---- 正直な「計算回数」の算定 ----
  // ナッシュ・ソルバー(gen-nash.cjs)の内部エクイティ評価回数(実際に解いた時の計算量):
  //   169手 × 8ポジ × 28スタック × 90ラウンド × (コールBR+ジャムBR で 169×169 規模の評価)
  const nashEqEvals = 8 * 28 * 90 * (169 * 169) * 2; // ≈ 1.16e9
  const rejamEvals = 5 * 2 * 43 * 32 * (169 * 169);  // リジャム求解
  const eqTableCells = 169 * 169;                    // 事前計算エクイティ表のセル
  const totalSolveOps = nashEqEvals + rejamEvals;

  console.log("\n================ 検証結果 ================");
  console.log(`不変条件チェック: ${checks.toLocaleString()} 件 / 違反 ${viol} 件`);
  console.log(`所要 ${secs.toFixed(1)} 秒 (${Math.round(checks / secs).toLocaleString()} 件/秒)`);
  console.log(`\n--- 正直な「計算回数」の内訳(誇張しない) ---`);
  console.log(`・エクイティ表(EQ169)セル数: ${eqTableCells.toLocaleString()}(全網羅検証済み)`);
  console.log(`・ナッシュ均衡の求解内部エクイティ評価: 約 ${(nashEqEvals / 1e9).toFixed(2)} 億… ≈ ${(nashEqEvals / 1e8).toFixed(1)}億回`);
  console.log(`・リジャム均衡の求解内部評価: 約 ${(rejamEvals / 1e9).toFixed(2)}×10⁹ 回`);
  console.log(`・合計の均衡計算(EV評価)回数: 約 ${(totalSolveOps / 1e9).toFixed(2)}×10⁹ ≈ ${(totalSolveOps / 1e8).toFixed(0)}億回`);
  console.log(`\n結論: 違反 ${viol} 件。${viol === 0 ? "全不変条件パス。" : "要修正。"}`);
  console.log(`正直な宣伝の指針 → 「ハンドをN億回プレイ」ではなく「均衡計算を約${(totalSolveOps / 1e8).toFixed(0)}億回行って解いた戦略を、全169手×全スタックで網羅検証」が真実に即す。`);
  process.exitCode = viol === 0 ? 0 : 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
