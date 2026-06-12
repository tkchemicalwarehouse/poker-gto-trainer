/* js/* (app.js除く) とテスト本体を連結してNodeで実行する */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const files = ["engine.js", "data-equity.js", "data-nash.js", "ranges.js", "strategy.js", "poker.js", "coach.js"];
let src = files.map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n;\n");
src += "\n;\n" + fs.readFileSync(path.join(__dirname, "tests-body.js"), "utf8");
const out = path.join(__dirname, "_combined.cjs");
fs.writeFileSync(out, src);
require(out);
