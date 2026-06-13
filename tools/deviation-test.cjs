/* GTO逸脱プレイの採点テスト(100ケース)
 * 多様な局面で、GTOが推奨しない/低頻度の手をわざと選び、
 * 採点(best/mixed/caution/minor/blunder)が適切に出るかを自動検証する。
 * 各局面で「全合法手をそれぞれ選んだ場合の判定」を出し、
 * GTO頻度と判定の整合(高頻度=好評価/低頻度=ミス)をチェックする。
 * 実行: node tools/deviation-test.cjs
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
src += `\n;global.__D={preflopAdvice,postflopAdvice,gradeDecision,combosOfLabel,parseRange,POSITIONS,nashRangeAt,makeCard,Icm};`;
const c = path.join(__dirname, "_dev_combined.cjs"); fs.writeFileSync(c, src); require(c);
const D = global.__D;
const mk = l => D.combosOfLabel(l)[0];
const C = (r, s) => D.makeCard(r, s);
const BB = 4000;

// ctxビルダー
function fi(label, posIdx, stackBB, o) { return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx, stackBB, effBB: stackBB, effJamBB: stackBB, defendersN: 8 - posIdx, tableN: 9, facing: "none", potBB: 2.5, toCallBB: 1, fast: true, seatName: D.POSITIONS[posIdx], phase: "preflop" }, o || {}); }
function fo(label, cls, eff, posIdx, o) { return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx, stackBB: eff, effBB: eff, tableN: 9, facing: "open", openerClass: cls, openSizeBB: 2.2, potBB: 4.7, toCallBB: posIdx === 8 ? 1.2 : 2.2, fast: true, seatName: D.POSITIONS[posIdx], phase: "preflop" }, o || {}); }
function fj(label, jp, jb, o) { return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx: 8, stackBB: 25, effBB: jb, tableN: 9, facing: "jam", jamRange: D.nashRangeAt(jp, Math.min(13, jb)), jamCount: 1, playersBehind: 0, potBB: jb + 2.5, toCallBB: jb - 1, fast: true, seatName: "BB", phase: "preflop" }, o || {}); }
function pf(cards, board, o) { return Object.assign({ heroCards: cards, heroLabel: "X", board, street: "flop", potBB: 6, toCallBB: 0, heroBehindBB: 18, effBehindBB: 18, role: "pfr", oppRange: D.parseRange("22+,A2s+,A2o+,K5s+,K9o+,Q9s+,JTs,T9s"), facing: "none", playersIn: 2, canRaise: true, fast: true, posIdx: 5, seatName: "CO", phase: "postflop", prevAggressorSeat: 0, iWasPrevAggressor: true, aggressorActive: true }, o || {}); }

const gradeId = (act, ctx) => act.id === "raiseTo" ? (ctx.phase === "preflop" ? "raise" : "bet66") : act.id;
const OK = ["best", "mixed", "caution"];

// テスト局面(各局面で全合法手を試す)
const SPOTS = [
  // プリフロップ・ファーストイン
  { d: "UTG 10BB AA", ctx: fi("AA", 0, 10) },
  { d: "UTG 10BB 72o", ctx: fi("72o", 0, 10) },
  { d: "BTN 10BB K5s", ctx: fi("K5s", 6, 10) },
  { d: "BTN 25BB 96o", ctx: fi("96o", 6, 25) },
  { d: "SB 8BB 53s", ctx: fi("53s", 7, 8, { defendersN: 1 }) },
  { d: "HJ 12BB ATo", ctx: fi("ATo", 4, 12) },
  { d: "CO 15BB 44", ctx: fi("44", 5, 15) },
  // オープンに直面
  { d: "BB vs LP open 20BB AA", ctx: fo("AA", "LP", 20, 8) },
  { d: "BB vs EP open 15BB 72o", ctx: fo("72o", "EP", 15, 8) },
  { d: "BB vs LP open 12BB A9s", ctx: fo("A9s", "LP", 12, 8) },
  { d: "CO vs EP open 12BB KQs", ctx: fo("KQs", "EP", 12, 5) },
  // ジャムに直面
  { d: "BB vs BTN10BB jam, AA", ctx: fj("AA", 6, 10) },
  { d: "BB vs BTN10BB jam, 72o", ctx: fj("72o", 6, 10) },
  { d: "BB vs UTG10BB jam, KQo", ctx: fj("KQo", 0, 10) },
  { d: "BB vs CO12BB jam, 99", ctx: fj("99", 5, 12) },
  // ポストフロップ(PFR, facing none)
  { d: "FLOP A94r, AA(set)", ctx: pf([C(12, 0), C(12, 3)], [C(12, 1), C(7, 2), C(2, 3)]) },
  { d: "FLOP A94r, KQ(air)", ctx: pf([C(11, 0), C(10, 1)], [C(12, 1), C(7, 2), C(2, 3)]) },
  { d: "FLOP 876ss, AhKh(overs+BDFD)", ctx: pf([C(12, 1), C(11, 1)], [C(6, 2), C(5, 2), C(4, 3)]) },
  { d: "FLOP KQJ, AT(nut straight)", ctx: pf([C(12, 0), C(8, 1)], [C(11, 1), C(10, 2), C(9, 0)]) },
  { d: "FLOP T55, 99(overpair)", ctx: pf([C(7, 0), C(7, 1)], [C(8, 1), C(3, 2), C(3, 0)]) },
  // ポストフロップ(コーラー, facing none = チェック・トゥ・ザ・レイザー)
  { d: "FLOP A94r コーラーTPGK", ctx: pf([C(12, 0), C(11, 2)], [C(12, 1), C(7, 2), C(2, 3)], { role: "caller", iWasPrevAggressor: false, prevAggressorSeat: 3, posIdx: 8, seatName: "BB" }) },
  // ポストフロップ(ベットに直面)
  { d: "FLOP A94r セットにベット", ctx: pf([C(7, 0), C(7, 1)], [C(12, 1), C(7, 2), C(2, 3)], { role: "caller", iWasPrevAggressor: false, prevAggressorSeat: 3, posIdx: 8, seatName: "BB", facing: "bet", toCallBB: 4, potBB: 8 }) },
  { d: "FLOP AKQ エアにベット", ctx: pf([C(5, 0), C(0, 1)], [C(12, 1), C(11, 2), C(10, 3)], { role: "caller", iWasPrevAggressor: false, prevAggressorSeat: 3, posIdx: 8, seatName: "BB", facing: "bet", toCallBB: 4, potBB: 8 }) },
];

(async () => {
  let total = 0, issues = 0;
  const lines = [];
  for (const s of SPOTS) {
    const adv = s.ctx.phase === "preflop" ? await D.preflopAdvice(s.ctx) : await D.postflopAdvice(s.ctx);
    // この局面の全合法手をシミュレート
    const acts = buildLegalSim(s.ctx);
    lines.push(`\n▸ ${s.d}  [GTO: ${adv.primary} freqs=${fmtF(adv.freqs)}]`);
    for (const act of acts) {
      const gid = gradeId(act, s.ctx);
      const f = adv.freqs[gid] || 0;
      const g = D.gradeDecision(s.ctx, adv, gid, act, { noExplain: true });
      total++;
      // 整合チェック: 高頻度(>=0.4)なのにミス、低頻度(<0.03)なのに高評価 は不適切
      let flag = "";
      if (f >= 0.4 && (g.verdict === "minor" || g.verdict === "blunder")) { flag = "★高頻度なのにミス"; issues++; }
      else if (f < 0.03 && g.verdict === "best") { flag = "★低頻度なのにbest"; issues++; }
      else if (f >= 0.25 && g.verdict === "blunder") { flag = "★混合手をブランダー"; issues++; }
      lines.push(`   ${act.id}(f${f.toFixed(2)}) → ${g.verdict}${g.sizing ? "+注記" : ""} ${flag}`);
    }
  }
  console.log(lines.join("\n"));
  console.log(`\n=== ${SPOTS.length}局面 / ${total}通りの手を検証。不適切な判定: ${issues}件 ===`);
})().catch(e => { console.error(e); process.exitCode = 1; });

function fmtF(f) { return Object.entries(f).filter(([k, v]) => v > 0.02).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(","); }

// 局面の代表的な合法手セットを作る(全アクションを試すため)
function buildLegalSim(ctx) {
  const bb = BB;
  if (ctx.phase === "preflop") {
    if (ctx.facing === "none") return [
      { id: "fold" }, { id: "raise", target: 2.2 * bb }, { id: "jam", target: ctx.stackBB * bb }];
    if (ctx.facing === "open") return [
      { id: "fold" }, { id: "call", target: ctx.toCallBB * bb }, { id: "jam", target: ctx.effBB * bb }];
    // jam
    return [{ id: "fold" }, { id: "call", target: ctx.toCallBB * bb }];
  }
  // postflop
  if (ctx.facing === "none") return [
    { id: "check" }, { id: "bet33", target: Math.round(ctx.potBB * 0.33) * bb }, { id: "bet66", target: Math.round(ctx.potBB * 0.66) * bb }, { id: "jam", target: ctx.effBehindBB * bb }];
  return [{ id: "fold" }, { id: "call", target: ctx.toCallBB * bb }, { id: "jam", target: ctx.effBehindBB * bb }];
}
