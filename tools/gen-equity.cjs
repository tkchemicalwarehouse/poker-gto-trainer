/* 169×169 プリフロップ・エクイティ表の生成(オフライン実行)
 * 出力: js/data-equity.js (EQ169: 千分率の整数), tools/equity.json
 * 実行: node tools/gen-equity.cjs [itersPerPair=10000]
 */
const fs = require("fs");
const path = require("path");

// engine.js を読み込んで評価関数を得る
const engineSrc = fs.readFileSync(path.join(__dirname, "..", "js", "engine.js"), "utf8");
const sandbox = {};
new Function("exports", engineSrc +
  "\n;exports.evaluate7=evaluate7;exports.combosOfLabel=combosOfLabel;exports.ALL_HANDS=ALL_HANDS;")(sandbox);
const { evaluate7, combosOfLabel, ALL_HANDS } = sandbox;

const ITERS = parseInt(process.argv[2]) || 10000;
const N = 169;
console.log(`169x169エクイティ表を生成 (ペアあたり${ITERS}回MC)…`);

// 各ラベルのコンボを前計算
const combosByLabel = ALL_HANDS.map(l => combosOfLabel(l));

// ペアごとの有効コンボペア(カード重複なし)を列挙
function validComboPairs(i, j) {
  const out = [];
  for (const a of combosByLabel[i]) {
    for (const b of combosByLabel[j]) {
      if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) out.push([a, b]);
    }
  }
  return out;
}

const EQ = [];
for (let i = 0; i < N; i++) EQ.push(new Array(N).fill(500));

const heroFull = new Array(7), villFull = new Array(7);
const t0 = Date.now();
let done = 0;
const totalPairs = (N * (N - 1)) / 2;

for (let i = 0; i < N; i++) {
  for (let j = i + 1; j < N; j++) {
    const pairs = validComboPairs(i, j);
    if (pairs.length === 0) { EQ[i][j] = 500; EQ[j][i] = 500; continue; }
    let win = 0;
    for (let it = 0; it < ITERS; it++) {
      const [a, b] = pairs[(Math.random() * pairs.length) | 0];
      heroFull[0] = a[0]; heroFull[1] = a[1];
      villFull[0] = b[0]; villFull[1] = b[1];
      // ボード5枚サンプル
      const used = new Set([a[0], a[1], b[0], b[1]]);
      let filled = 0;
      while (filled < 5) {
        const c = (Math.random() * 52) | 0;
        if (used.has(c)) continue;
        used.add(c);
        heroFull[2 + filled] = c; villFull[2 + filled] = c;
        filled++;
      }
      const hs = evaluate7(heroFull), vs = evaluate7(villFull);
      if (hs > vs) win += 2; else if (hs === vs) win += 1;
    }
    const perMille = Math.round(win / (2 * ITERS) * 1000);
    EQ[i][j] = perMille;
    EQ[j][i] = 1000 - perMille;
    done++;
    if (done % 1000 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  ${done}/${totalPairs} ペア (${el.toFixed(0)}秒, 残り約${(el / done * (totalPairs - done)).toFixed(0)}秒)`);
    }
  }
}

// 妥当性チェック
const idx = l => ALL_HANDS.indexOf(l);
const checks = [
  ["AA", "KK", 815], ["AKs", "QQ", 460], ["AKo", "22", 470], ["72o", "AA", 115],
];
for (const [a, b, expect] of checks) {
  const got = EQ[idx(a)][idx(b)];
  console.log(`  検証 ${a} vs ${b}: ${(got / 10).toFixed(1)}% (期待 約${expect / 10}%) ${Math.abs(got - expect) < 25 ? "OK" : "★要確認"}`);
}

fs.writeFileSync(path.join(__dirname, "equity.json"), JSON.stringify(EQ));
const js = `/* 自動生成: 169x169プリフロップエクイティ(千分率)。tools/gen-equity.cjs */\n"use strict";\nconst EQ169 = ${JSON.stringify(EQ)};\n`;
fs.writeFileSync(path.join(__dirname, "..", "js", "data-equity.js"), js);
console.log(`完了 (${((Date.now() - t0) / 1000).toFixed(0)}秒)。js/data-equity.js を出力しました。`);
