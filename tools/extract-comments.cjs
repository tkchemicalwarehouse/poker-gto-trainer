/* ミス局面の「解説コメント本文」を大量抽出して整合性を点検する。
 * 実戦で逸脱プレイをさせ、minor/blunder と判定された決断の buildExplanation を
 * 実際に生成 → プレーンテキスト化 → 重複排除して全パターンを出力。
 * さらに「チグハグ」自動検出(称賛語なのにミス判定 / 行動とコメントの食い違い 等)。
 * 実行: node tools/extract-comments.cjs [hands=1000]
 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
const load = f => fs.readFileSync(path.join(dir, f), "utf8");
const src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n") +
  `\n;global.__A={newTournament,playHand,preflopAdvice,postflopAdvice,gradeDecision,sampleAction,POSITIONS,actionJP};`;
const c = path.join(__dirname, "_extract_combined.cjs");
fs.writeFileSync(c, src); require(c);
const A = global.__A;

const TARGET = parseInt(process.argv[2]) || 1000;
const gradeId = (act, ctx) => act.id === "raiseTo" ? (ctx.phase === "preflop" ? "raise" : "bet66") : act.id;

function strip(html) {
  return String(html)
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/(p|div|li|h4)>/g, "\n")
    .replace(/<li>/g, "・")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
}
// レンジグリッド・計算ボックスを除去してから整形(チグハグは見出し+論述に出る)
function narrative(html) {
  let h = String(html);
  for (const marker of ['<div class="rg-wrap"', '<div class="calc-box"']) {
    const i = h.indexOf(marker); if (i >= 0) h = h.slice(0, i);
  }
  return strip(h);
}
// 全文(レンジグリッドだけ除去、計算ボックスは残す)= 1件ずつの精読用
function fullText(html) {
  let h = String(html);
  const i = h.indexOf('<div class="rg-wrap"'); if (i >= 0) h = h.slice(0, i);
  return strip(h);
}

const PRAISE = /(ナイス|その通り|よく受けた|よく降り|正しく(降り|守|た)|正解|ど真ん中|余裕で|問題ない|完璧|お見事)/;
const records = [];

function makeHeroAct() {
  return async (ctx, legal) => {
    const advice = ctx.phase === "preflop" ? await A.preflopAdvice(ctx) : await A.postflopAdvice(ctx);
    // 逸脱優先: 最も低頻度の合法手を選ぶ(ミスを多く発生させる)。たまにGTOも混ぜる
    let act;
    if (Math.random() < 0.7) {
      let worst = null, wf = Infinity;
      for (const a of legal) { const f = advice.freqs[gradeId(a, ctx)] || 0; if (f < wf) { wf = f; worst = a; } }
      act = worst || legal[0];
    } else act = legal.find(a => a.id === A.sampleAction(advice.freqs)) || legal[0];

    const gid = gradeId(act, ctx);
    let chosen = gid; if (advice.data && advice.data.kind === "facingJam" && chosen === "jam") chosen = "call";
    const g = A.gradeDecision(ctx, advice, gid, act, {}); // 解説あり
    if (g.verdict === "minor" || g.verdict === "blunder") {
      const narr = narrative(g.explanation);
      // チグハグ自動検出
      const flags = [];
      const praised = PRAISE.test(narr);
      if (praised) flags.push("称賛語×ミス判定");
      // 行動とコメントの食い違い: foldしたのに「コール」を褒める/前提にする等
      if (chosen === "fold" && /ナイスコール|よく受けた|受けて正解|コールが正解だった.*正解/.test(narr)) flags.push("fold×コール称賛");
      if ((chosen === "call" || chosen === "jam") && /ナイスフォールド|正しく降り|降りて正解/.test(narr)) flags.push("コール×フォールド称賛");
      // 見出しの結論語と判定の不一致
      records.push({
        sig: `${advice.data ? advice.data.kind : "?"}|${ctx.facing}|${ctx.street || "preflop"}|primary=${advice.primary}|chosen=${chosen}|${g.verdict}`,
        hand: ctx.heroLabel, pos: ctx.seatName, eff: Math.round((ctx.effBB || ctx.stackBB || 0) * 10) / 10,
        primary: advice.primary, chosen, verdict: g.verdict, freqs: advice.freqs,
        flags, narr, full: fullText(g.explanation),
      });
    }
    return act;
  };
}

(async () => {
  const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {}, heroAct: makeHeroAct() };
  let hands = 0, tn = 0;
  while (hands < TARGET) {
    const st = A.newTournament("自分", 9); st.fastMode = true;
    io.heroAct = makeHeroAct();
    let guard = 0;
    while (!st.over && st.handNo < 500 && guard++ < 520) await A.playHand(st, io);
    tn++; hands += st.handNo;
  }
  // 重複排除: signatureごとに代表1件 + 件数
  const groups = {};
  for (const r of records) {
    const grp = groups[r.sig] || (groups[r.sig] = { sig: r.sig, count: 0, flagged: 0, flags: new Set(), ex: r });
    grp.count++; if (r.flags.length) { grp.flagged++; r.flags.forEach(f => grp.flags.add(f)); }
  }
  const arr = Object.values(groups).sort((a, b) => b.count - a.count);
  const totalFlagged = records.filter(r => r.flags.length).length;

  const out = [];
  out.push(`===== ミス解説コメント抽出 (${hands}ハンド / ${tn}トナメ) =====`);
  out.push(`ミス判定の決断: ${records.length} 件 / 解説の型(distinct): ${arr.length} 種`);
  out.push(`自動検出「チグハグ」候補: ${totalFlagged} 件\n`);
  out.push(`========== 解説の全パターン(代表1件ずつ・件数順) ==========`);
  for (const g of arr) {
    out.push(`\n■[${g.count}件]${g.flags.size ? " ⚠" + [...g.flags].join(",") : ""}  ${g.sig}`);
    out.push(`  例: ${g.ex.pos} ${g.ex.hand} ${g.ex.eff}BB`);
    out.push(g.ex.narr.split("\n").map(l => "  | " + l).join("\n"));
  }
  if (totalFlagged) {
    out.push(`\n\n========== ⚠チグハグ候補(自動検出)全件 ==========`);
    for (const r of records.filter(x => x.flags.length)) {
      out.push(`\n⚠ ${r.flags.join(",")} | ${r.sig} | ${r.pos} ${r.hand} ${r.eff}BB`);
      out.push(r.narr.split("\n").map(l => "  | " + l).join("\n"));
    }
  }
  fs.writeFileSync(path.join(__dirname, "comments-report.txt"), out.join("\n"), "utf8");

  // 1件ずつ精読用: 全文(計算ボックス込み)を「全文テキスト」で重複排除し通し番号で出力
  const seen = new Map();
  for (const r of records) { const g = seen.get(r.full); if (g) g.count++; else seen.set(r.full, { count: 1, r }); }
  const uniq = [...seen.values()].sort((a, b) => b.count - a.count);
  const full = [];
  full.push(`ミス ${records.length}件 → 全文ユニーク ${uniq.length}件(1件ずつ精読用・件数順)`);
  uniq.forEach((u, i) => {
    full.push(`\n\n=========== #${i + 1}/${uniq.length}  [${u.count}件] ${u.r.sig} ===========`);
    full.push(`局面: ${u.r.pos} ${u.r.hand} ${u.r.eff}BB / 推奨=${u.r.primary} 選択=${u.r.chosen} 判定=${u.r.verdict}`);
    full.push(u.r.full);
  });
  fs.writeFileSync(path.join(__dirname, "comments-full.txt"), full.join("\n"), "utf8");
  fs.writeFileSync(path.join(__dirname, "extract-comments-result.json"), JSON.stringify({ count: records.length, distinct: arr.length, totalFlagged, records }, null, 1), "utf8");
  console.log(`ミス ${records.length}件 / 型 ${arr.length}種 / 全文ユニーク ${uniq.length}件 / チグハグ候補 ${totalFlagged}件\n→ comments-report.txt(型別) / comments-full.txt(1件ずつ全文)`);
  try { require("./record-verification.cjs").recordVerification({ tool: "extract-comments", checks: 0, hands, note: "コメント整合性抽出" }); } catch (e) {}
})().catch(e => { console.error(e); process.exitCode = 1; });
