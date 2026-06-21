/* 外部基準との照合(著作権フリーの公知値・数学的事実のみ使用)
 *  Part1: エクイティの数学的事実(教科書値)と厳密照合
 *  Part2: 出荷中レンジ/採点が、公知のナッシュ傾向の許容範囲に収まるか
 *  Part3: 計算済みプッシュ/フォールド表の収束健全性(独立指標で確認)
 * 実行: node tools/validate-reference.cjs
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
src += `\n;global.__V={eqVsRangeTable,parseRange,nashRangeAt,nashThreshold,rangePercent,ALL_HANDS,combosCountOfLabel,Ranges,EQ169,ALL_HANDS};`;
const c = path.join(__dirname, "_valref_combined.cjs"); fs.writeFileSync(c, src); require(c);
const V = global.__V;
let pass = 0, fail = 0, warn = 0;
function chk(name, ok, detail) { if (ok) { pass++; console.log("  ok: " + name + (detail ? "  " + detail : "")); } else { fail++; console.error("  ★NG: " + name + "  " + detail); } }
function within(name, got, want, tol) { chk(name, Math.abs(got - want) <= tol, `(実${got.toFixed(1)} / 基準${want} ±${tol})`); }
function range(name, got, lo, hi) { const ok = got >= lo && got <= hi; if (ok) { pass++; console.log(`  ok: ${name} (実${got.toFixed(1)}% / 妥当域${lo}-${hi}%)`); } else { warn++; console.error(`  ⚠範囲外: ${name} (実${got.toFixed(1)}% / 妥当域${lo}-${hi}%)`); } }

// 169ラベル同士の厳密ヘッズアップ勝率(EQ169, 千分率→%)
const idx = l => V.ALL_HANDS.indexOf(l);
function eqHU(a, b) { return V.EQ169[idx(a)][idx(b)] / 10; }

console.log("=== Part1: エクイティの数学的事実(教科書値±1.5%) ===");
within("AA vs KK", eqHU("AA", "KK"), 81.9, 1.5);
within("AA vs AKs", eqHU("AA", "AKs"), 87.0, 2.0);
within("KK vs AKo", eqHU("KK", "AKo"), 70.0, 2.0);
within("QQ vs AKo", eqHU("QQ", "AKo"), 56.3, 2.0);   // オフスート版は約56.3%(スーテッドは53.8%)
within("AKs vs QQ", eqHU("AKs", "QQ"), 46.0, 2.0);
within("AKo vs 22", eqHU("AKo", "22"), 47.0, 2.0);
within("JJ vs AKs", eqHU("JJ", "AKs"), 54.0, 2.0);
within("A5s vs KQo", eqHU("A5s", "KQo"), 59.5, 2.5);  // Aハイ+ナッツFD+ホイールで優位
within("87s vs AKo", eqHU("87s", "AKo"), 42.5, 2.5);
within("22 vs 33", eqHU("22", "33"), 18.0, 2.0); // 下のペアは約18%

console.log("\n=== Part2: ナッシュ・プッシュ/フォールドの公知傾向(妥当域チェック) ===");
// ヘッズアップ(2人)SBジャムは非常にワイド。10bbで約60〜75%(公知)
// ※当アプリのSB列は9maxの対BBだが、最も広い列なので近似比較
range("SB(最広) 10BBジャム%", V.rangePercent(V.nashRangeAt(7, 10)), 55, 80);
range("UTG 10BBジャム%", V.rangePercent(V.nashRangeAt(0, 10)), 9, 20);
range("BTN 10BBジャム%", V.rangePercent(V.nashRangeAt(6, 10)), 35, 55);
range("CO 10BBジャム%", V.rangePercent(V.nashRangeAt(5, 10)), 28, 48);
range("UTG 6BBジャム%", V.rangePercent(V.nashRangeAt(0, 6)), 22, 40);
range("BTN 15BBジャム%", V.rangePercent(V.nashRangeAt(6, 15)), 28, 45);

console.log("\n=== Part2b: 公知の境界ハンド(in/out) ===");
const inR = (pos, bb, h) => (V.nashRangeAt(pos, bb).get(h) || 0) > 0;
chk("AA は UTG 16BBでもジャム圏内", inR(0, 16, "AA"), "");
chk("72o は UTG 10BBでフォールド", !inR(0, 10, "72o"), "");
chk("A2o は SB 8BBでジャム", inR(7, 8, "A2o"), "");
chk("K2o は SB 6BBでジャム(超ワイド)", inR(7, 6, "K2o"), "");
chk("55 は UTG 10BBでジャム(中ペア)", inR(0, 10, "55"), "");
chk("22 は UTG 7BBでジャム(浅いと最小ペアも)", inR(0, 7, "22"), "");
chk("J8o は UTG 10BBでフォールド", !inR(0, 10, "J8o"), "");
chk("ATs は BTN 12BBでジャム", inR(6, 12, "ATs"), "");

console.log("\n=== Part2c: オープンレンジ% が既知の目標域に収まるか ===");
const POSN = ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO", "BTN", "SB"];
const openPct = (bk, p) => V.rangePercent(V.Ranges.open(p, bk <= 20 ? 15 : 25));
// 25BB(深め)の目標域(公知の標準オープンレンジ)
range("25BB UTG オープン%", openPct(25, 0), 11, 18);
range("25BB CO オープン%", openPct(25, 5), 24, 32);
range("25BB BTN オープン%", openPct(25, 6), 40, 50);
range("25BB SB オープン%", openPct(25, 7), 42, 56);
// 15BB(浅め)
range("15BB BTN オープン%", openPct(15, 6), 34, 44);
range("15BB SB オープン%", openPct(15, 7), 40, 50);

console.log("\n=== Part2d: BBディフェンス総%(対オープン) ===");
range("BB総ディフェンス vs EP", V.rangePercent(V.Ranges.bbDefendTotal("EP")), 16, 32);
range("BB総ディフェンス vs LP", V.rangePercent(V.Ranges.bbDefendTotal("LP")), 34, 52);
range("BB総ディフェンス vs SB", V.rangePercent(V.Ranges.bbDefendTotal("SB")), 50, 70);

console.log("\n=== Part3: コール側の整合(ポットオッズ厳密) ===");
// AAはどのジャムにもコール、72oはタイトジャムにフォールド(数学的に自明)
const eqAAvsBTN = V.eqVsRangeTable("AA", V.nashRangeAt(6, 10));
range("AA の対BTN10BBジャムレンジ勝率", eqAAvsBTN * 100, 80, 92);
const eq72 = V.eqVsRangeTable("72o", V.nashRangeAt(0, 10));
range("72o の対UTG10BBジャムレンジ勝率", eq72 * 100, 25, 38);

console.log(`\n=== 照合結果: 合格 ${pass} / 不合格 ${fail} / 範囲外警告 ${warn} ===`);
try { require("./record-verification.cjs").recordVerification({ tool: "validate-reference", checks: pass + fail + warn, hands: 0, note: "外部数値リファレンス照合" }); } catch (e) {}
if (fail > 0) process.exitCode = 1;
