/* 報告(GTO判定報告フォーム)の grading 再検証
 * 報告に含まれる advice データをそのまま gradeDecision に通し、
 * 「現行コードでの判定」を出して、当時の verdict と矛盾(推奨どおり→ブランダー等)を検出する。
 * 実行: node tools/verify-comments.cjs tools/reports-0613.json
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
const src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
const combined = path.join(__dirname, "_vc_combined.cjs");
fs.writeFileSync(combined, src + `\n;global.__VC={gradeDecision,POSITIONS,rangeHas,parseRange};`);
require(combined);
const { gradeDecision, POSITIONS } = global.__VC;

const arg = process.argv[2] || path.join(__dirname, "reports-0613.json");
let raw = fs.readFileSync(arg, "utf8");
let reps = JSON.parse(raw);
if (!Array.isArray(reps)) reps = [reps];

// ウォーターマーク: 処理済み基準時刻より新しい報告だけに絞る(--all で全件)
const wmPath = path.join(__dirname, "reports-watermark.json");
let wm = null;
if (!process.argv.includes("--all") && fs.existsSync(wmPath)) {
  wm = JSON.parse(fs.readFileSync(wmPath, "utf8"));
  const before = reps.length;
  reps = reps.filter(r => r && r.time && r.time > wm.lastProcessed);
  console.log(`ウォーターマーク ${wm.lastProcessed} より新しい報告: ${reps.length}/${before} 件(--allで全件)`);
}
let newestTime = wm ? wm.lastProcessed : null;
for (const r of reps) if (r && r.time && (!newestTime || r.time > newestTime)) newestTime = r.time;

let flagged = 0;
for (let i = 0; i < reps.length; i++) {
  const rep = reps[i];
  if (rep.test || !rep.advice || !rep.hero || !rep.hero.hand) { continue; }
  const a = rep.advice;
  // 報告ではadvice.data相当のフィールドがadvice直下にフラットに入っている → dataに復元
  const advice = { primary: a.primary, freqs: a.freqs, data: a };
  const ctx = {
    heroLabel: rep.hero.hand,
    posIdx: POSITIONS.indexOf(rep.hero.pos),
    effBB: rep.hero.effBB != null ? rep.hero.effBB : rep.hero.stackBB,
    phase: rep.street === "preflop" ? "preflop" : "postflop",
    street: rep.street,
  };
  let chosen = rep.userAction.id;
  if (chosen === "raiseTo") chosen = ctx.phase === "preflop" ? "raise" : "bet66";
  let g;
  try { g = gradeDecision(ctx, advice, chosen, rep.userAction, { noExplain: true }); }
  catch (e) { console.log(`#${i + 1} 採点エラー: ${e.message}`); continue; }

  const followedPrimary =
    (chosen === advice.primary) ||
    (a.kind === "facingJam" && advice.primary === "call" && (chosen === "call" || chosen === "jam")) ||
    (a.kind === "facingJam" && advice.primary === "fold" && chosen === "fold");
  const contradiction = followedPrimary && (g.verdict === "blunder" || g.verdict === "minor");

  console.log(`#${i + 1} ${rep.street} ${rep.hero.pos} ${rep.hero.hand} ${(rep.hero.effBB||rep.hero.stackBB)}bb / ${a.kind} facing=${rep.facing}`);
  console.log(`   推奨=${advice.primary}  あなた=${chosen}  | 当時:${rep.verdict}  → 現行:${g.verdict}(EV損${g.evLoss})` +
    (rep.verdict !== g.verdict ? "  ★判定変化" : ""));
  if (contradiction) { console.log(`   ⚠⚠ 矛盾: 推奨どおりに打ったのに ${g.verdict}`); flagged++; }
  if (rep.comment) console.log(`   💬 ${rep.comment}`);
}
console.log(`\n=== 矛盾(推奨追従なのにミス判定)の残存: ${flagged} 件 ===`);
if (newestTime) console.log(`→ 全件対応し終えたら reports-watermark.json の lastProcessed を "${newestTime}" に更新`);
