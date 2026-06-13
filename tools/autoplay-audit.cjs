/* 自走採点監査 + GTOプレイ統計
 * GTOボットで大量プレイ(ヘッズアップ/優勝まで)し、
 *  (A) 全プレイヤーのアクション統計 (VPIP/PFR/3bet/Cbet/バレル/オールイン率 等)
 *  (B) 全ヒーロー(seat0)決断を gradeDecision で採点し「厳しすぎる誤判定」を抽出
 * を同時収集。GTOプレイ自体の妥当性を最後に検証する。
 * 実行: node tools/autoplay-audit.cjs [targetHands=10000]
 * 結果は tools/autoplay-result.json にも保存。
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");
src += `
;const __origBotAct = botAct;
botAct = async function(state, p, ctx, legal, io) {
  const act = await __origBotAct(state, p, ctx, legal, io);
  if (global.__onBotAct) global.__onBotAct(ctx, act);
  return act;
};
global.__A = { newTournament, playHand, preflopAdvice, postflopAdvice, gradeDecision,
  sampleAction, handLabelOf, POSITIONS, Ranges, getLIVE: () => LIVE };
`;
const c = path.join(__dirname, "_apa_combined.cjs");
fs.writeFileSync(c, src);
require(c);
const A = global.__A;

const TARGET_HANDS = parseInt(process.argv[2]) || 10000;

const S = {
  // 統計カウンタ
  pfOpps: 0, vpip: 0, pfr: 0,        // プリフロップ参加機会/自発参加/レイズ
  open3betOpps: 0, threeBet: 0,      // オープンに直面した機会/3ベット(jam含む)
  open: 0, openFaced3bet: 0, openFold3bet: 0, // オープンした回数/3ベットされた/それに降りた
  cbetOpps: 0, cbet: 0,              // フロップPFRでC-bet機会/実行
  turnOpps: 0, turnBet: 0,           // ターンPFR継続機会/実行
  faceCbetOpps: 0, faceCbetFold: 0,  // C-betに直面/フォールド
  faceJamOpps: 0, faceJamCall: 0,    // プリフロップのジャムに直面/コール
  pfAllin: 0,                        // プリフロップでオールイン
  decisions: 0,
  byPosOpen: {},                     // ポジション別オープン率
  // 採点(ヒーローのみ)
  verdicts: {}, mistakes: [],
  // トーナメント
  tourneys: 0, hu: 0, hands: 0, wins: 0,
  finishes: {},                      // seat0の順位分布(1位=優勝〜9位)
  finishSum: 0, finishN: 0,          // 平均順位
};

function gradeId(act, ctx) {
  if (act.id === "raiseTo") return ctx.phase === "preflop" ? "raise" : "bet66";
  return act.id;
}

// 全席共通: 決断を選びつつ統計を記録(botActのマッピングを再現)
function decide(st, p, ctx, legal, advice) {
  let id = A.sampleAction(advice.freqs);
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

function recordStats(ctx, act) {
  S.decisions++;
  const agg = act.id === "raise" || act.id === "jam" || act.id === "raiseTo";
  const betAgg = agg || act.id === "bet33" || act.id === "bet66"; // ポストフロップのベットも攻撃
  if (ctx.phase === "preflop") {
    if (ctx.facing === "none") {           // オープン機会(誰も入ってない)
      S.pfOpps++;
      if (agg) { S.vpip++; S.pfr++; S.open++; }
      const b = (S.byPosOpen[ctx.seatName] = S.byPosOpen[ctx.seatName] || { o: 0, n: 0 });
      b.n++; if (agg) b.o++;
    } else if (ctx.facing === "open") {     // オープンに直面
      S.open3betOpps++; S.pfOpps++;
      if (agg) { S.threeBet++; S.vpip++; }
      else if (act.id === "call") S.vpip++;
    } else if (ctx.facing === "jam") {      // ジャム(3ベットジャム含む)に直面
      S.pfOpps++; S.faceJamOpps++;
      if (act.id === "call" || act.id === "jam") { S.vpip++; S.faceJamCall++; }
    } else if (ctx.facing === "rejamOverMyOpen") { // 自分のオープンに3ベット(リジャム)された
      S.pfOpps++; S.openFaced3bet++;
      if (act.id === "fold") S.openFold3bet++;
      if (act.id === "call" || act.id === "jam") S.vpip++;
    }
    if (act.id === "jam") S.pfAllin++;
  } else if (ctx.street === "flop") {
    // ベット可能(チップが残っている)PFRのみc-bet機会に算入
    if (ctx.facing === "none" && ctx.role === "pfr" && (ctx.effBehindBB || 0) > 0.5) {
      S.cbetOpps++; if (betAgg) S.cbet++;
    }
    if (ctx.facing === "bet") { S.faceCbetOpps++; if (act.id === "fold") S.faceCbetFold++; }
  } else if (ctx.street === "turn") {
    if (ctx.facing === "none" && ctx.role === "pfr" && (ctx.effBehindBB || 0) > 0.5) {
      S.turnOpps++; if (betAgg) S.turnBet++;
    }
  }
}

function makeHeroAct(st) {
  return async (ctx, legal) => {
    const advice = ctx.phase === "preflop" ? await A.preflopAdvice(ctx) : await A.postflopAdvice(ctx);
    const act = decide(st, st.players[0], ctx, legal, advice);
    recordStats(ctx, act);
    // ヒーローのみ採点(誤判定抽出)
    const g = A.gradeDecision(ctx, advice, gradeId(act, ctx), act, { noExplain: true });
    S.verdicts[g.verdict] = (S.verdicts[g.verdict] || 0) + 1;
    if (g.verdict === "minor" || g.verdict === "blunder") {
      const cf = advice.freqs[gradeId(act, ctx)] || 0;
      if (cf >= 0.12) S.mistakes.push({ verdict: g.verdict, chosen: act.id, cf: +cf.toFixed(2),
        primary: advice.primary, kind: advice.data && advice.data.kind, street: ctx.street || "preflop", facing: ctx.facing });
    }
    return act;
  };
}

// 全ボット(seat1〜8)の決断も統計に算入(ポストフロップのサンプルを十分に得る)
global.__onBotAct = (ctx, act) => recordStats(ctx, act);

(async () => {
  const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {} };
  const t0 = Date.now();
  while (S.hands < TARGET_HANDS) {
    const st = A.newTournament("自分", 9);
    st.fastMode = true;
    io.heroAct = makeHeroAct(st);
    let minAlive = 9, guard = 0, startHand = st.handNo;
    while (!st.over && st.handNo < 500 && guard++ < 520) {
      await A.playHand(st, io);
      const alive = st.players.filter(p => !p.out && p.chips > 0).length;
      if (alive < minAlive) minAlive = alive;
    }
    S.tourneys++; S.hands += st.handNo;
    if (minAlive <= 2) S.hu++;
    // seat0(自分)の最終順位を記録
    const place = st.won ? 1 : Math.min(9, (st.fieldLeft || 0) + 1);
    S.finishes[place] = (S.finishes[place] || 0) + 1;
    S.finishSum += place; S.finishN++;
    if (st.won) S.wins++;
    if (S.tourneys % 50 === 0) process.stderr.write(`  ${S.hands}/${TARGET_HANDS}ハンド (${((Date.now()-t0)/1000).toFixed(0)}秒)\n`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + "%" : "-";

  const stats = {
    総ハンド: S.hands, トーナメント: S.tourneys, 優勝: S.wins,
    優勝率: pct(S.wins, S.tourneys), ヘッズアップ到達率: pct(S.hu, S.tourneys),
    平均順位: S.finishN ? (S.finishSum / S.finishN).toFixed(2) + "位/9人" : "-",
    ヒーロー決断: S.decisions, 秒: +secs,
    VPIP: pct(S.vpip, S.pfOpps), PFR: pct(S.pfr, S.pfOpps),
    "3ベット率(対オープン)": pct(S.threeBet, S.open3betOpps),
    "自分のオープンが3ベットされた率": pct(S.openFaced3bet, S.open),
    "★相手の3ベット(リジャム)へのフォールド率": pct(S.openFold3bet, S.openFaced3bet),
    "プリフロップ・ジャムへのコール率": pct(S.faceJamCall, S.faceJamOpps),
    "Cベット率(フロップPFR)": pct(S.cbet, S.cbetOpps),
    "ターンバレル率": pct(S.turnBet, S.turnOpps),
    "Cベットへのフォールド率": pct(S.faceCbetFold, S.faceCbetOpps),
    "プリフロップ・オールイン率": pct(S.pfAllin, S.pfOpps),
    判定分布: S.verdicts,
  };
  console.log("\n=== GTOプレイ統計(seat0 ヒーロー視点) ===");
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v === "object") console.log(`  ${k}: ${JSON.stringify(v)}`);
    else console.log(`  ${k}: ${v}`);
  }
  console.log("\n--- seat0(自分)の順位分布 / 9人スタート ---");
  for (let p = 1; p <= 9; p++) {
    const n = S.finishes[p] || 0;
    console.log(`  ${p}位${p === 1 ? "(優勝)" : ""}: ${n}回 (${pct(n, S.finishN)})`);
  }
  console.log(`  期待値(完全五分なら): 優勝 ${pct(1, 9)} / 平均 5.00位`);

  console.log("\n--- 生カウント(サンプル確認) ---");
  console.log(`  フロップC-bet機会(role=pfr,facing=none): ${S.cbetOpps} / 実行 ${S.cbet}`);
  console.log(`  ターン継続機会: ${S.turnOpps} / 実行 ${S.turnBet}`);
  console.log(`  C-betに直面: ${S.faceCbetOpps} / フォールド ${S.faceCbetFold}`);
  console.log(`  ※postロール内訳:`, JSON.stringify(S.flopRoles || {}));
  console.log("\n--- ポジション別オープン率 ---");
  for (const pos of A.POSITIONS) {
    const b = S.byPosOpen[pos]; if (b && b.n > 20) console.log(`  ${pos}: ${pct(b.o, b.n)} (${b.n}回)`);
  }

  // 厳しすぎる疑い(GTO頻度12%以上をミス判定)の集計
  const buckets = {};
  for (const m of S.mistakes) {
    const key = `${m.kind}|${m.street}|${m.facing}|chosen=${m.chosen}(f${m.cf})|primary=${m.primary}|${m.verdict}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  console.log(`\n=== 採点の妥当性: GTO頻度12%以上を「ミス」とした疑わしい判定 ${S.mistakes.length}件 ===`);
  for (const [k, n] of Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}件: ${k}`);

  fs.writeFileSync(path.join(__dirname, "autoplay-result.json"), JSON.stringify({ stats, buckets }, null, 1));
  console.log("\n→ tools/autoplay-result.json に保存");
})().catch(e => { console.error(e); process.exitCode = 1; });
