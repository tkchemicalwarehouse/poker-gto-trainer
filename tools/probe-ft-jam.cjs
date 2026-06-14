/* FT(残り少人数)のオールイン(openJam)推奨レンジの広さを測る。
 * 自走中、ICMが効くFTの openJam 助言をすべて記録し、卓人数×スタック帯ごとに
 * 「ジャム推奨率」「ICMでvetoされた率」「ジャム推奨された手の一覧」を集計する。
 * 実行: node tools/probe-ft-jam.cjs [hands=3000]
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
// preflopAdvice をラップして FT openJam を記録
src += `
;const __origPF = preflopAdvice;
preflopAdvice = async function(ctx){
  const a = await __origPF(ctx);
  if (a && a.data && a.data.kind === "openJam" && a.data.icmJamEval && global.__REC) global.__REC(ctx, a);
  return a;
};
global.__A = { newTournament, playHand };`;
const c = path.join(__dirname, "_ftjam_combined.cjs");
fs.writeFileSync(c, src); require(c);
const A = global.__A;

const TARGET = parseInt(process.argv[2]) || 3000;
const recs = [];
global.__REC = (ctx, a) => {
  recs.push({
    n: ctx.tableN || 0, eff: a.data.effS != null ? a.data.effS : ctx.stackBB,
    hand: ctx.heroLabel, pos: ctx.seatName,
    jam: a.primary === "jam", veto: !!a.data.icmVeto, mix: !!a.data.icmMix,
    rangePct: a.data.rangePct, evJam: a.data.icmJamEval.evJam, evFold: a.data.icmJamEval.evFold,
  });
};

(async () => {
  const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {} };
  let hands = 0;
  while (hands < TARGET) {
    const st = A.newTournament("自分", 9); st.fastMode = true;
    io.heroAct = async (ctx, legal) => legal.find(x => x.id === "fold") || legal.find(x => x.id === "check") || legal[0];
    let guard = 0;
    while (!st.over && st.handNo < 500 && guard++ < 520) await A.playHand(st, io);
    hands += st.handNo;
  }
  const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(0) + "%" : "-";
  console.log(`=== FT openJam 推奨レンジ調査 (${hands}ハンド / 記録${recs.length}件) ===`);
  for (const n of [2, 3, 4, 5, 6]) {
    const g = recs.filter(r => r.n === n);
    if (!g.length) continue;
    const jam = g.filter(r => r.jam), veto = g.filter(r => r.veto);
    console.log(`\n--- 卓${n}人 (記録${g.length}件) ---`);
    console.log(`  ジャム推奨: ${pct(jam.length, g.length)} / ICM veto(降ろした): ${pct(veto.length, g.length)}`);
    // スタック帯別のジャム推奨率
    for (const [lo, hi] of [[4, 8], [8, 12], [12, 16]]) {
      const sg = g.filter(r => r.eff >= lo && r.eff < hi);
      if (sg.length < 5) continue;
      const sj = sg.filter(r => r.jam);
      console.log(`    ${lo}-${hi}BB: ジャム推奨 ${pct(sj.length, sg.length)} (${sg.length}件)`);
    }
    // 8-13BBでジャム推奨された手のユニーク一覧(広すぎないか目視用)
    const mid = jam.filter(r => r.eff >= 8 && r.eff < 13);
    const hands8 = [...new Set(mid.map(r => r.hand))].sort();
    if (hands8.length) console.log(`    8-13BBでジャム推奨の手(${hands8.length}種): ${hands8.join(" ")}`);
  }
  fs.writeFileSync(path.join(__dirname, "ftjam-result.json"), JSON.stringify(recs.slice(0, 3000), null, 0), "utf8");
})().catch(e => { console.error(e); process.exitCode = 1; });
