/* HRC等で自前ソルブしたHUプリフロップ・レンジを取り込み、本番データ js/data-hu.js を生成する。
 * 入力: tools/hu-source.json
 *   { "stacks": { "<BB>": { "sbOpen": "<range>", "bbCall": "<range>", "bb3bet": "<range>" }, ... } }
 *   range は標準表記("22+,A2s+,AQo+,..."。混合頻度は "AKo:0.5" のように後置可)。
 *   - sbOpen  : SB(ボタン)のオープンレイズ範囲
 *   - bbCall  : BB がオープンに対してフラットコールする範囲
 *   - bb3bet  : BB が3ベット(刻む/オールイン)する範囲
 * 出力: js/data-hu.js  → const HU_SOLVE = { "<BB>": { sbOpen:[169], bbCall:[169], bb3bet:[169] } } / HU_SOLVE_STACKS=[...]
 *   各配列は ALL_HANDS 順の頻度(0..1)。ranges.js が effBB に最も近いスタックを採用。
 * 実行: node tools/import-hu.cjs
 * ★誠実さの憲章★ ここに入れるのは「自分(あなた)がHRCで解いた実データ」のみ。出典をnoteに残す。
 */
const fs = require("fs");
const path = require("path");
const sb = {};
const rd = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
new Function("exports", rd("engine.js") + "\n" + rd("ranges.js") +
  ";exports.ALL_HANDS=ALL_HANDS;exports.parseRange=parseRange;exports.combosCountOfLabel=combosCountOfLabel;")(sb);
const { ALL_HANDS, parseRange, combosCountOfLabel } = sb;
const N = 169;

const SRC = path.join(__dirname, "hu-source.json");
const OUT = path.join(__dirname, "..", "js", "data-hu.js");
let src;
try { src = JSON.parse(fs.readFileSync(SRC, "utf8")); }
catch (e) { console.error("hu-source.json が読めません:", e.message); process.exit(1); }

// "AKo:0.5" 形式の頻度付きトークンに対応しつつ、range文字列を 169 の頻度配列へ
function rangeToVec(str) {
  const vec = new Float64Array(N);
  if (!str || !str.trim()) return vec;
  // 頻度付きトークンを抽出して別管理、残りは通常のparseRangeへ
  const freqMap = {};
  const plain = [];
  for (const tok of str.split(",").map(s => s.trim()).filter(Boolean)) {
    const m = tok.match(/^(.+):([0-9.]+)$/);
    if (m) freqMap[m[1].trim()] = Math.max(0, Math.min(1, parseFloat(m[2])));
    else plain.push(tok);
  }
  const r = parseRange(plain.join(","));
  for (let i = 0; i < N; i++) if (r.has(ALL_HANDS[i])) vec[i] = 1;
  for (const [lbl, f] of Object.entries(freqMap)) { const i = ALL_HANDS.indexOf(lbl); if (i >= 0) vec[i] = f; }
  return vec;
}
function pct(vec) { let w = 0, t = 0; for (let i = 0; i < N; i++) { const c = combosCountOfLabel(ALL_HANDS[i]); t += c; if (vec[i] >= 0.5) w += c; } return (w / t * 100); }

const stacks = Object.keys(src.stacks || {}).map(Number).filter(n => n > 0).sort((a, b) => a - b);
if (!stacks.length) { console.error("hu-source.json に stacks がありません。"); process.exit(1); }

const HU_SOLVE = {};
const SPOTS = ["sbOpen", "bbCall", "bb3bet"];
let warn = 0;
console.log("=== HUプリフロップ取り込み(stack別 %) ===");
console.log("stack | SBオープン | BBコール | BB3ベット");
for (const s of stacks) {
  const e = src.stacks[String(s)];
  const o = {};
  for (const spot of SPOTS) o[spot] = Array.from(rangeToVec(e[spot] || ""), x => Math.round(x * 1000) / 1000);
  HU_SOLVE[s] = o;
  const po = pct(o.sbOpen), pc = pct(o.bbCall), p3 = pct(o.bb3bet);
  console.log(`${String(s).padStart(2)}BB | ${po.toFixed(0).padStart(7)}% | ${pc.toFixed(0).padStart(6)}% | ${p3.toFixed(0).padStart(6)}%`);
  // 簡易検証
  if (po < 40 || po > 100) { console.log(`  ⚠ ${s}BB SBオープン ${po.toFixed(0)}% は想定外(HUボタンは通常~80-95%)`); warn++; }
  if (pc + p3 > 110) { console.log(`  ⚠ ${s}BB BB継続(コール+3ベット)${(pc + p3).toFixed(0)}% が100%超`); warn++; }
}

const js = `/* 自動生成: HUプリフロップの自前ソルブ・レンジ。tools/import-hu.cjs が hu-source.json から生成。手で編集しない。
 * 出典: ${(src.note || "(未記入)").replace(/\*\//g, "")} / 生成元: ${src.source || "HRC自前ソルブ"}
 * HU_SOLVE[stack] = { sbOpen, bbCall, bb3bet }(各169ハンドの頻度0..1, ALL_HANDS順) */
"use strict";
const HU_SOLVE = ${JSON.stringify(HU_SOLVE)};
const HU_SOLVE_STACKS = ${JSON.stringify(stacks)};
`;
fs.writeFileSync(OUT, js);
console.log(`\n→ js/data-hu.js を出力(${stacks.length}スタック, 警告${warn}件)。ranges.js が effBB 最近傍で採用します。`);
