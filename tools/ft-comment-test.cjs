/* ファイナルテーブル(ICM)コメント矛盾チェック
 * FTのジャム/コール局面で、解説文と数字・結論の矛盾を機械検出する。
 * 実行: node tools/ft-comment-test.cjs
 */
const fs = require("fs");
const path = require("path");
const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
let src = ["engine.js","data-equity.js","data-nash.js","data-rejam.js","icm.js","ranges.js","strategy.js","poker.js","coach.js"].map(load).join("\n;\n");
src += `\n;global.__T={preflopAdvice,gradeDecision,combosOfLabel,nashRangeAt,Icm,POSITIONS,parseRange};`;
const c = path.join(__dirname,"_ft_combined.cjs"); fs.writeFileSync(c, src); require(c);
const T = global.__T;
const mk = l => T.combosOfLabel(l)[0];
const strip = h => (h||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const BB = 4000;

// FTのfacingJam ctx(ICM付き)
function ftJam(label, jammerPos, jamBB, stacks, heroI, villI) {
  const potChips = (jamBB + 2.5) * BB;
  return { heroCards: mk(label), heroLabel: label, posIdx:8, stackBB: stacks[heroI]/BB, effBB: jamBB, tableN: stacks.length,
    facing:"jam", jamRange: T.nashRangeAt(jammerPos, jamBB), jamCount:1, playersBehind:0,
    potBB: jamBB+2.5, toCallBB: jamBB-1, fast:false, seatName:"BB", phase:"preflop",
    icm: { stacks, heroI, villI, potChips, toCallChips:(jamBB-1)*BB, payouts: T.Icm.payoutsFor(18, stacks.length) } };
}
// FTのファーストインジャム(icmJam付き)
function ftFirstIn(label, posIdx, stackBB, stacks, heroI, villI) {
  return { heroCards: mk(label), heroLabel: label, posIdx, stackBB, effBB: stackBB, effJamBB: stackBB,
    defendersN: stacks.length-1, tableN: stacks.length, facing:"none", potBB:2.5, toCallBB:1, fast:false,
    seatName: T.POSITIONS[posIdx], phase:"preflop",
    icmJam: { stacks, heroI, villI, potChips: 2.5*BB, toCallChips:0, payouts: T.Icm.payoutsFor(18, stacks.length), bbChips: BB } };
}

// 矛盾検出: 解説テキストと結論の食い違い
function findContradictions(text, verdict, primary, act) {
  const issues = [];
  const saysCall = /スナップ|即コール|おいしすぎる|文句なしの\+EV|手が出ていい|受けて問題ない/.test(text);
  const saysFoldGood = /降りるが正解|フォールドが勝る|手を出さないのが上手い|長期で確実に削られる|資金を溶かす|禁物/.test(text);
  const userCalled = act.id === "call";
  // 1) コールを強く勧める文言なのに、推奨/判定がフォールド寄り
  if (saysCall && (primary === "fold")) issues.push("見出しはコール推奨だが primary=fold");
  if (saysCall && saysFoldGood) issues.push("『コールしろ』と『降りろ』が同一解説に同居");
  // 2) 「足りている」と「足りない」が同居
  const enough = /上回る|上回って|届いて(い|る)|足りて(い|る)|十分/.test(text);
  const notEnough = /足りない|届かない|届いていません|不足/.test(text);
  if (enough && notEnough) issues.push("『足りている』と『足りない』が同居");
  // 3) ユーザーのコールがbest/該当なのに本文は-EVと言う
  return issues;
}

const SCN = [];
// ヒーロー中スタック、ジャマー(BTN相当)が同程度、他に短いプレイヤー(バブル的圧力)
// AJoのような「チップEVでは+だがICMでフォールド」が出やすい状況を狙う
SCN.push(["FT9人 中スタック BB AJo vs BTN12BBジャム(下に短い人)",
  ftJam("AJo", 6, 12, [60000,60000,16000,90000,50000,70000,55000,30000,48000], 0, 1), {id:"call"}]);
SCN.push(["FT5人 BB KQo vs CO15BBジャム",
  ftJam("KQo", 5, 15, [120000,140000,60000,90000,40000], 0, 1), {id:"call"}]);
SCN.push(["FT4人 BB 99 vs BTN20BBジャム(ビッグ vs ビッグ)",
  ftJam("99", 6, 20, [240000,240000,80000,60000], 0, 1), {id:"call"}]);
SCN.push(["FT3人 BB ATs vs SB18BBジャム",
  ftJam("ATs", 7, 18, [300000,250000,150000], 0, 1), {id:"call"}]);
SCN.push(["FT9人 BB A5s vs UTG10BBジャム",
  ftJam("A5s", 0, 10, [50000,80000,16000,90000,50000,70000,55000,30000,48000], 0, 1), {id:"call"}]);
SCN.push(["FT ファーストイン CO 12BB A9o(下に超短)",
  ftFirstIn("A9o", 5, 12, [48000,80000,8000,90000,50000,70000,55000,33000,45000], 0, 2), {id:"jam",target:48000}]);
SCN.push(["FT ファーストイン BTN 8BB KTo",
  ftFirstIn("KTo", 6, 8, [32000,80000,12000,90000,50000,70000,55000,33000,45000], 0, 2), {id:"jam",target:32000}]);
SCN.push(["FT4人 BB AKo vs BTN25BBジャム(深い)",
  ftJam("AKo", 6, 25, [300000,260000,120000,90000], 0, 1), {id:"call"}]);

(async () => {
  console.log("=== FTコメント矛盾チェック ===\n");
  let total = 0;
  for (const [desc, ctx, act] of SCN) {
    const a = await T.preflopAdvice(ctx);
    const gid = act.id === "jam" ? "jam" : act.id;
    const g = T.gradeDecision(ctx, a, gid, act);
    const text = strip(g.explanation);
    const issues = findContradictions(text, g.verdict, a.primary, act);
    total += issues.length;
    console.log(`▸ ${desc}`);
    console.log(`   primary=${a.primary} judge=${g.verdict} | icmReq=${a.data.icmReq?(a.data.icmReq*100).toFixed(0)+'%':'-'} eqCallBB=${a.data.evCallBB?.toFixed(2)} icmJamEval=${a.data.icmJamEval?('jam'+(a.data.icmJamEval.evJam*100).toFixed(1)+'/fold'+(a.data.icmJamEval.evFold*100).toFixed(1)):'-'}`);
    if (issues.length) issues.forEach(i=>console.log(`   ★矛盾: ${i}`));
    console.log(`   解説: ${text.slice(0, 260)}…`);
    console.log("");
  }
  console.log(`=== ★矛盾 合計 ${total} 件 ===`);
})().catch(e=>{console.error(e);process.exitCode=1;});
