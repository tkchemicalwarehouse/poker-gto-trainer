/* 大規模・逸脱プレイ監査: ヒーローが実戦中にわざとGTOから外れて打ち、
 * その採点(verdict / EV損失)が妥当かを大量サンプルで検証する。
 *
 * 検証する妥当性:
 *   ① 見逃し   : 明確な逸脱(GTO頻度<5%)なのに best/mixed と甘評価
 *   ② 誤判定   : GTO高頻度(≥25%)なのに minor/blunder と厳評価
 *   ③ 矛盾     : 推奨ライン(primary)どおりに打ったのに minor/blunder(=バグ)
 *   ④ 単調性   : 選択肢のGTO頻度が低いほど、平均EV損失が大きいか
 *
 * 実行: node tools/deviation-audit.cjs [hands=30000] [devRate=0.5]
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
const src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n") +
  `\n;global.__A={newTournament,playHand,preflopAdvice,postflopAdvice,gradeDecision,sampleAction,POSITIONS};`;
const c = path.join(__dirname, "_devaudit_combined.cjs");
fs.writeFileSync(c, src); require(c);
const A = global.__A;

const TARGET = parseInt(process.argv[2]) || 30000;
const DEV_RATE = process.argv[3] ? parseFloat(process.argv[3]) : 0.5;

const gradeId = (act, ctx) => act.id === "raiseTo" ? (ctx.phase === "preflop" ? "raise" : "bet66") : act.id;

// legalにマップ(autoplay-auditと同じ吸収)
function toLegal(id, legal) {
  const ids = legal.map(a => a.id);
  if (id === "raise" && !ids.includes("raise")) id = ids.includes("jam") ? "jam" : "call";
  if (id === "bet33" && !ids.includes("bet33")) id = ids.includes("jam") ? "jam" : "check";
  if (id === "bet66" && !ids.includes("bet66")) id = ids.includes("bet33") ? "bet33" : (ids.includes("jam") ? "jam" : "check");
  if (id === "jam" && !ids.includes("jam")) id = ids.includes("call") ? "call" : "check";
  if (id === "call" && !ids.includes("call")) id = "check";
  if (id === "check" && !ids.includes("check")) id = "fold";
  if (!ids.includes(id)) id = ids[0];
  return legal.find(a => a.id === id) || legal[0];
}

const S = {
  hands: 0, tourneys: 0, decisions: 0, deviations: 0, gtoPlays: 0,
  // 妥当性カウンタ
  clearDevSeen: 0, clearDevCaught: 0, missed: 0,          // ①見逃し
  highFreqSeen: 0, falsePos: 0,                            // ②誤判定
  primaryPlays: 0, contradictions: 0,                     // ③矛盾
  evByBand: {}, // freqバンド別 {n, evSum, mistakes}
  verdicts: {},
  suspects: [],
};
function band(f) { return f < 0.02 ? "0-2%" : f < 0.05 ? "2-5%" : f < 0.10 ? "5-10%" : f < 0.25 ? "10-25%" : f < 0.50 ? "25-50%" : "50%+"; }

let curHeroAct;
function makeHeroAct(st) {
  return async (ctx, legal) => {
    const advice = ctx.phase === "preflop" ? await A.preflopAdvice(ctx) : await A.postflopAdvice(ctx);
    // 行動選択: devRateで「最も低頻度の合法手」を選ぶ(明確な逸脱)、それ以外はGTOサンプル
    let deviate = Math.random() < DEV_RATE;
    let act;
    if (deviate) {
      let worst = null, wf = Infinity;
      for (const a of legal) { const f = advice.freqs[gradeId(a, ctx)] || 0; if (f < wf) { wf = f; worst = a; } }
      act = worst || legal[0];
    } else {
      act = toLegal(A.sampleAction(advice.freqs), legal);
    }
    const gid = gradeId(act, ctx);
    let chosen = gid;
    if (advice.data && advice.data.kind === "facingJam" && chosen === "jam") chosen = "call";
    const f = advice.freqs[chosen] || 0;
    const g = A.gradeDecision(ctx, advice, gid, act, { noExplain: true });
    const mistake = g.verdict === "minor" || g.verdict === "blunder";
    const ok = g.verdict === "best" || g.verdict === "mixed";

    S.decisions++; if (deviate) S.deviations++; else S.gtoPlays++;
    S.verdicts[g.verdict] = (S.verdicts[g.verdict] || 0) + 1;
    const b = band(f); const eb = S.evByBand[b] || (S.evByBand[b] = { n: 0, evSum: 0, mistakes: 0 });
    eb.n++; eb.evSum += g.evLoss || 0; if (mistake) eb.mistakes++;

    // ③矛盾: primaryどおりに打ったのにミス
    const followedPrimary = (chosen === advice.primary) ||
      (advice.data && advice.data.kind === "facingJam" && advice.primary === "call" && chosen === "call");
    if (followedPrimary) { S.primaryPlays++; if (mistake) { S.contradictions++; pushSuspect("矛盾", ctx, advice, chosen, f, g); } }
    // ①見逃し: 明確な逸脱(f<5%)なのに甘評価(best/mixed)。cautionは割れ局面なので除外
    if (f < 0.05 && !followedPrimary) {
      S.clearDevSeen++;
      if (mistake) S.clearDevCaught++;
      else if (ok) { S.missed++; pushSuspect("見逃し", ctx, advice, chosen, f, g); }
    }
    // ②誤判定: 高頻度(>=25%)なのにミス
    if (f >= 0.25) { S.highFreqSeen++; if (mistake) { S.falsePos++; pushSuspect("厳しすぎ", ctx, advice, chosen, f, g); } }

    return act;
  };
}
function pushSuspect(type, ctx, advice, chosen, f, g) {
  if (S.suspects.length > 4000) return;
  S.suspects.push({ type, kind: advice.data && advice.data.kind, street: ctx.street || "preflop",
    facing: ctx.facing, primary: advice.primary, chosen, f: +f.toFixed(2), verdict: g.verdict });
}

(async () => {
  const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {} };
  const t0 = Date.now();
  while (S.hands < TARGET) {
    const st = A.newTournament("自分", 9); st.fastMode = true;
    io.heroAct = makeHeroAct(st);
    let guard = 0;
    while (!st.over && st.handNo < 500 && guard++ < 520) await A.playHand(st, io);
    S.tourneys++; S.hands += st.handNo;
    if (S.tourneys % 100 === 0) process.stderr.write(`  ${S.hands}/${TARGET}ハンド (${((Date.now() - t0) / 1000).toFixed(0)}秒)\n`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + "%" : "-";

  console.log(`\n===== 逸脱プレイ監査 (${S.hands}ハンド / ${S.tourneys}トナメ / ${secs}秒) =====`);
  console.log(`ヒーロー決断: ${S.decisions}(うち わざと逸脱 ${S.deviations} / GTOサンプル ${S.gtoPlays})`);
  console.log(`判定分布: ${JSON.stringify(S.verdicts)}`);

  console.log(`\n--- ③矛盾(推奨どおりに打ったのにミス判定。0であるべき) ---`);
  console.log(`  primaryどおりの決断 ${S.primaryPlays} 件中、ミス判定 = ${S.contradictions} 件 (${pct(S.contradictions, S.primaryPlays)})`);

  console.log(`\n--- ①見逃し(明確な逸脱 f<5% を甘評価) ---`);
  console.log(`  明確な逸脱 ${S.clearDevSeen} 件 → ミスとして検出 ${S.clearDevCaught} (${pct(S.clearDevCaught, S.clearDevSeen)}) / 見逃し ${S.missed} (${pct(S.missed, S.clearDevSeen)})`);

  console.log(`\n--- ②誤判定/厳しすぎ(GTO高頻度 f>=25% をミス判定) ---`);
  console.log(`  高頻度の選択 ${S.highFreqSeen} 件中、ミス判定 = ${S.falsePos} 件 (${pct(S.falsePos, S.highFreqSeen)})`);

  console.log(`\n--- ④単調性: GTO頻度バンド別の平均EV損失とミス率 ---`);
  for (const b of ["0-2%", "2-5%", "5-10%", "10-25%", "25-50%", "50%+"]) {
    const e = S.evByBand[b]; if (!e) continue;
    console.log(`  freq ${b.padEnd(7)}: n=${String(e.n).padStart(6)} 平均EV損 ${(e.evSum / e.n).toFixed(2)}BB / ミス率 ${pct(e.mistakes, e.n)}`);
  }

  // 疑わしいケースの集計(タイプ×kind×facing×primary×chosen×verdict)
  const buck = {};
  for (const s of S.suspects) {
    const k = `${s.type}|${s.kind}|${s.street}|facing=${s.facing}|primary=${s.primary}→${s.chosen}(f${s.f})|${s.verdict}`;
    buck[k] = (buck[k] || 0) + 1;
  }
  console.log(`\n--- 要確認パターン(上位30) ---`);
  for (const [k, n] of Object.entries(buck).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${String(n).padStart(5)}件: ${k}`);

  fs.writeFileSync(path.join(__dirname, "deviation-audit-result.json"), JSON.stringify({
    summary: { hands: S.hands, decisions: S.decisions, deviations: S.deviations, verdicts: S.verdicts,
      contradictions: S.contradictions, primaryPlays: S.primaryPlays,
      clearDevSeen: S.clearDevSeen, clearDevCaught: S.clearDevCaught, missed: S.missed,
      highFreqSeen: S.highFreqSeen, falsePos: S.falsePos, evByBand: S.evByBand }, buckets: buck
  }, null, 1));
  console.log(`\n→ tools/deviation-audit-result.json に保存`);
})().catch(e => { console.error(e); process.exitCode = 1; });
