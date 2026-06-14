/* HU(ヘッズアップ)レンジの精度検証。
 * アプリが実際に使う関数(nash SB列=HUプッシュ/フォールド, 解済みrejam, 手書きopen/call)から
 * スタック別のレンジ%と代表ハンドを取り出し、既知のHU Nashベンチマークと突き合わせる。
 * 実行: node tools/validate-hu.cjs
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
const sb = {};
new Function("exports", [load("engine.js"), load("data-equity.js"), load("data-nash.js"),
  load("data-rejam.js"), load("ranges.js")].join("\n;\n") +
  ";exports.ALL_HANDS=ALL_HANDS;exports.combosCountOfLabel=combosCountOfLabel;exports.Ranges=Ranges;" +
  "exports.nashRangeAt=nashRangeAt;exports.rejamRangeAtEff=rejamRangeAtEff;exports.parseRange=parseRange;" +
  "exports.eqVsRangeTable=typeof eqVsRangeTable!=='undefined'?eqVsRangeTable:null;")(sb);
const { ALL_HANDS, combosCountOfLabel, Ranges, nashRangeAt, rejamRangeAtEff } = sb;

function pctOfRange(map) {
  let w = 0, t = 0;
  for (const l of ALL_HANDS) { const c = combosCountOfLabel(l); t += c; if (map.has(l)) w += c; }
  return w / t * 100;
}
const POS_SB = 7;

console.log("=================================================================");
console.log(" HU レンジ精度検証 (SB=BTN vs BB / SB0.5・BB1・BBアンティ1)");
console.log("=================================================================\n");

console.log("【1】SB オープンジャム(プッシュ/フォールド) = nash SB列(EQ169厳密)");
console.log("  既知Nash(BBアンティ込みで広め)目安: 8BB~65-75% / 10BB~55-65% / 12BB~48-58% / 15BB~40-50%");
console.log("  stack |  アプリ% | 代表(最弱クラスのジャム手の一例)");
for (const S of [6, 8, 10, 12, 13, 15]) {
  const r = nashRangeAt(POS_SB, S);
  const p = pctOfRange(r);
  // 含まれる手のうち弱めの代表
  const weak = ["K2o", "Q5o", "J7o", "T7o", "96o", "85o", "74o", "53o", "Q2s", "J4s", "T5s", "85s"].filter(h => r.has(h));
  console.log(`  ${String(S).padStart(2)}BB |  ${p.toFixed(0).padStart(4)}%  | ${weak.slice(0, 8).join(" ") || "(狭い)"}`);
}

console.log("\n【2】BB 3ベットオールイン(rejam)over SB min-open = 解済みREJAM_THRESH[HU](all-in厳密)");
console.log("  既知目安: 15BB~18-26% / 20BB~14-20% / 25BB~10-16%");
console.log("  stack |  アプリ% | 代表rejam手の一例");
for (const S of [12, 15, 18, 20, 22, 25]) {
  const r = rejamRangeAtEff("HU", "BB", S);
  const p = pctOfRange(r);
  const samp = ["AA", "KK", "QQ", "AKs", "AQs", "ATs", "A5s", "KQs", "99", "77", "55", "T9s", "76s"].filter(h => r.has(h));
  console.log(`  ${String(S).padStart(2)}BB |  ${p.toFixed(0).padStart(4)}%  | ${samp.slice(0, 8).join(" ")}`);
}

console.log("\n【3】SB オープンレイズ幅(>13.5BB)= 手書きHU_SB_OPEN(スタック非依存・近似)");
const open = Ranges.huOpen();
console.log(`  幅: ${pctOfRange(open).toFixed(0)}%  (既知のHUボタンRFI目安 ~80-90%。やや狭め・全スタック同一が弱点)`);

console.log("\n【4】BB フラットコール vs SB open = 手書き(HU_DEFEND - rejam)");
for (const S of [15, 20, 25]) {
  const c = Ranges.huCall(S);
  console.log(`  ${S}BB コール幅: ${pctOfRange(c).toFixed(0)}%`);
}

console.log("\n----------------------------------------------------------------");
console.log("結論の指針: 【1】【2】が既知Nashレンジに整合していれば、HUで最頻出かつ");
console.log("最重要な短スタックのオールイン局面は既にGTO級。【3】【4】(深いopen幅と");
console.log("フラットコール)はポストフロップ依存で、真のGTOには本物のCFRが必要。");
