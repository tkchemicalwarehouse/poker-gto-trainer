/* 敵対的プレイ・テスター
 * 「私(Claude)」が多数のスポットでわざと通常と違うプレイをし、コーチの採点反応を一覧化する。
 * 採点が甘すぎ/厳しすぎ/おかしい反応を発見する目的。
 * 実行: node tools/adversarial-play.cjs
 */
const fs = require("fs");
const path = require("path");
const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
let src = ["engine.js","data-equity.js","data-nash.js","data-rejam.js","icm.js","ranges.js","strategy.js","poker.js","coach.js"].map(load).join("\n;\n");
src += `\n;global.__T={preflopAdvice,postflopAdvice,gradeDecision,combosOfLabel,parseRange,POSITIONS,nashRangeAt,OPEN_RANGES,LIVE,cardText,makeCard};`;
const c = path.join(__dirname,"_adv_combined.cjs"); fs.writeFileSync(c, src); require(c);
const T = global.__T;
const mk = l => T.combosOfLabel(l)[0];
const strip = h => (h||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();

function fi(label, posIdx, stackBB, opts) {
  return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx, stackBB, effBB: stackBB,
    effJamBB: stackBB, defendersN: 8 - posIdx, tableN: 9, facing:"none", potBB:2.5, toCallBB:1, fast:true,
    seatName: T.POSITIONS[posIdx], phase:"preflop" }, opts||{});
}

// テスト: [説明, ctx, ユーザーのアクション(id,target), 期待(任意)]
const TESTS = [
  // ユーザー指摘: 過大オープン
  ["KQs UTG+2 を 4BBレイズ(標準2.2BB)", fi("KQs",2,25), {id:"raiseTo",target:16000}],
  ["KQs UTG+2 を 2.2BBレイズ(標準)", fi("KQs",2,25), {id:"raise",target:8800}],
  ["AA BTN を 10BBレイズ(過大)", fi("AA",6,25), {id:"raiseTo",target:40000}],
  ["72o UTG を 2.2BBオープン(ジャンク)", fi("72o",0,25), {id:"raise",target:8800}],
  ["A5s CO を 2.2BBオープン(標準内)", fi("A5s",5,25), {id:"raise",target:8800}],
  // ミニレイズ
  ["KK UTG を ミニレイズ2BB", fi("KK",0,25), {id:"raiseTo",target:8000}],
  // 浅いのに小さいレイズ(本来ジャム)
  ["A9o BTN 8BB をミニレイズ(本来ジャム)", fi("A9o",6,8), {id:"raiseTo",target:8800}],
  // 強い手をフォールド
  ["AA UTG 10BB をフォールド", fi("AA",0,10), {id:"fold"}],
  // ジャンクをジャム
  ["32o UTG 25BB をオールイン", fi("32o",0,25), {id:"jam",target:100000}],
];

(async () => {
  console.log("=== 敵対的プレイ採点チェック ===\n");
  for (const [desc, ctx, act] of TESTS) {
    const a = await T.preflopAdvice(ctx);
    const gradeId = act.id === "raiseTo"
      ? (act.target >= ctx.stackBB*4000 - 4000 ? "jam" : "raise")
      : act.id;
    const g = T.gradeDecision(ctx, a, gradeId, act);
    console.log(`▸ ${desc}`);
    console.log(`   GTO: ${a.primary} / freqs=${JSON.stringify(a.freqs)}`);
    console.log(`   あなた: ${act.id}${act.target?(" "+act.target):""} → 判定: ${g.verdict} (EV損失 ${g.evLoss})`);
    if (g.sizing) console.log(`   📏サイズ指摘: ${strip(g.sizing.note).slice(0,80)}…`);
    console.log("");
  }
})();
