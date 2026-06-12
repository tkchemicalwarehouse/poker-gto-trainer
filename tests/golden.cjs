/* 黄金スポット回帰テスト
 * 「ポーカー戦略として正解が確定している局面」を機械検証する。
 * コーチのロジックを変更するたびに実行し、戦略的な退行を防ぐ。
 * ユーザー報告で修正した局面も必ずここに追加する(同じバグの再発防止)。
 * 実行: node tests/golden.cjs
 */
const fs = require("fs");
const path = require("path");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8")).join("\n;\n");
src += "\n;\n" + fs.readFileSync(path.join(__dirname, "golden-body.js"), "utf8");
const out = path.join(__dirname, "_golden_combined.cjs");
fs.writeFileSync(out, src);
require(out);
