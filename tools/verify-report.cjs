/* 判定報告の検証ハーネス
 * 報告JSON(アプリの報告ボタンが生成する形式)から局面を再現し、
 * 現在のエンジンの判定と数値根拠を出力する。
 * 使い方:
 *   node tools/verify-report.cjs report.json     … ファイルから
 *   node tools/verify-report.cjs '{"hero":...}'  … JSON直接
 * 複数件: JSONの配列にも対応。
 */
const fs = require("fs");
const path = require("path");

const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
const combined = path.join(__dirname, "_verify_combined.cjs");
fs.writeFileSync(combined, src + `
;
global.__V = { preflopAdvice, postflopAdvice, gradeDecision, combosOfLabel, parseRange,
  nashRangeAt, ALL_HANDS, POSITIONS, Icm, RANK_CHARS, makeCard };
`);
require(combined);
const V = global.__V;

const arg = process.argv[2];
if (!arg) { console.error("使い方: node tools/verify-report.cjs <report.json | JSON文字列>"); process.exit(1); }
let raw = arg;
if (fs.existsSync(arg)) raw = fs.readFileSync(arg, "utf8");
// ```json フェンスや前置きテキストを除去
const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
if (m) raw = m[0];
let reports = JSON.parse(raw);
if (!Array.isArray(reports)) reports = [reports];

function cardFromText(t) {
  // 例: "A♠" "10♦" → makeCard
  const suitIdx = { "♠": 0, "♥": 1, "♦": 2, "♣": 3 }[t.slice(-1)];
  let r = t.slice(0, -1);
  if (r === "10") r = "T";
  return V.makeCard(V.RANK_CHARS.indexOf(r), suitIdx);
}

function rebuildCtx(rep) {
  const posIdx = V.POSITIONS.indexOf(rep.hero.pos);
  const heroCards = (rep.hero.cards && rep.hero.cards.length === 2)
    ? rep.hero.cards.map(cardFromText)
    : V.combosOfLabel(rep.hero.hand)[0];
  const base = {
    heroCards, heroLabel: rep.hero.hand,
    posIdx, stackBB: rep.hero.stackBB, effBB: rep.hero.effBB,
    effJamBB: rep.hero.effJamBB, defendersN: rep.defendersN, tableN: rep.tableN,
    facing: rep.facing, openerClass: rep.openerClass || undefined,
    potBB: rep.potBB, toCallBB: rep.toCallBB,
    fast: false, seatName: rep.hero.pos, phase: rep.street === "preflop" ? "preflop" : "postflop",
  };
  if (rep.street !== "preflop") {
    base.board = (rep.board || []).map(cardFromText);
    base.street = rep.street;
    base.role = "caller"; // 報告にロールが無い場合の近似
    base.oppRange = V.parseRange("22+,A2s+,A2o+,K2s+,K5o+,Q4s+,Q9o+,J6s+,J9o+,T6s+,96s+,85s+,75s+,64s+,54s");
    base.heroBehindBB = rep.hero.stackBB;
    base.effBehindBB = rep.hero.effBB;
    base.playersIn = 2;
    base.canRaise = true;
  }
  if (rep.facing === "jam") {
    // ジャマーのレンジは報告のjamRangePct相当を再現できないため、典型値(BTN相当)で近似
    base.jamRange = V.nashRangeAt(6, Math.min(13, rep.hero.effBB || 10));
    base.jamCount = 1; base.playersBehind = 0;
  }
  return base;
}

(async () => {
  for (let i = 0; i < reports.length; i++) {
    const rep = reports[i];
    console.log(`\n===== 報告 ${i + 1}/${reports.length} =====`);
    console.log(`局面: ${rep.street} / ${rep.hero.pos} ${rep.hero.hand} ${rep.hero.stackBB}BB / facing=${rep.facing}` +
      (rep.openerClass ? `(${rep.openerClass})` : "") +
      ` / 残り${rep.fieldLeft}人${rep.finalTable ? "(FT)" : ""}`);
    console.log(`ユーザー: ${rep.userAction.id}${rep.userAction.target ? " " + rep.userAction.target : ""} → 当時の判定: ${rep.verdict}`);
    if (rep.comment) console.log(`💬 報告者コメント: ${rep.comment}`);
    console.log(`当時のアドバイス: ${JSON.stringify(rep.advice)}`);
    try {
      const ctx = rebuildCtx(rep);
      const a = ctx.phase === "preflop" ? await V.preflopAdvice(ctx) : await V.postflopAdvice(ctx);
      const g = V.gradeDecision(ctx, a, rep.userAction.id === "raiseTo" ? "raise" : rep.userAction.id);
      console.log(`現在のエンジン: primary=${a.primary} freqs=${JSON.stringify(a.freqs)}`);
      console.log(`現在の採点: ${g.verdict} (EV損失 ${g.evLoss})`);
      const d = a.data;
      const nums = {};
      for (const k of ["threshold", "marginBB", "effS", "rangePct", "rejamPct", "equity", "breakeven", "icmReq", "evCallBB"]) {
        if (d[k] !== undefined && d[k] !== null) nums[k] = typeof d[k] === "number" ? Math.round(d[k] * 1000) / 1000 : d[k];
      }
      if (d.icmJamEval) nums.icmJamEval = { evJam: +(d.icmJamEval.evJam * 100).toFixed(2), evFold: +(d.icmJamEval.evFold * 100).toFixed(2) };
      console.log(`数値根拠: ${JSON.stringify(nums)}`);
      const changed = rep.verdict !== g.verdict || (rep.advice && rep.advice.primary !== a.primary);
      console.log(changed ? "⚠ 当時と判定が変化(修正済みか、要調査)" : "判定は当時と同じ(妥当性を上の数値で検討)");
    } catch (e) {
      console.error("再現エラー: " + e.message);
    }
  }
})();
