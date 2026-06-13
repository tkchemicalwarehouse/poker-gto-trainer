/* セルフプレイ異常検知ハーネス
 * GTOボット同士に大量のトーナメントを打たせ、全プレイヤーの全判断を記録。
 * 「戦略的に矛盾するパターン」を自動検出して報告する。
 * 人間より先にバグ候補を見つけるのが目的(ユーザーが報告で見つけたような種類)。
 * 実行: node tools/selfplay-audit.cjs [tournaments=60]
 */
const fs = require("fs");
const path = require("path");

const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
let src = ["engine.js", "data-equity.js", "data-nash.js", "data-rejam.js", "icm.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(load).join("\n;\n");

// 全判断を記録するため preflop/postflopAdvice をラップ(関数宣言の束縛を再代入)
src += `
;
const __decisions = [];
const __origPre = preflopAdvice, __origPost = postflopAdvice;
preflopAdvice = async function(ctx){ const a = await __origPre(ctx); try{ __decisions.push({ phase:"preflop", ctx, advice:a }); }catch(e){} return a; };
postflopAdvice = async function(ctx){ const a = await __origPost(ctx); try{ __decisions.push({ phase:"postflop", ctx, advice:a }); }catch(e){} return a; };
global.__AUDIT = { decisions: __decisions, newTournament, playHand, botAct, handLabelOf, eqVsRangeTable, ALL_HANDS };
`;
const combined = path.join(__dirname, "_audit_combined.cjs");
fs.writeFileSync(combined, src);
require(combined);
const A = global.__AUDIT;

const N = parseInt(process.argv[2]) || 60;

/* ---- 異常検出ルール ---- */
// 各 decision = { phase, ctx, advice }。advice.primary が最頻アクション。
const RULES = [
  {
    id: "高エクイティでフォールド(閾値・ICM補正後も)",
    check: d => {
      const dd = d.advice.data; if (!dd) return false;
      const eq = dd.equity;
      const thr = dd.threshold != null ? dd.threshold : dd.breakeven;
      // ICM補正・後続/マルチ補正込みの閾値を上回ってなおフォールドなら真の異常
      return d.advice.primary === "fold" && eq != null && thr != null && eq > thr + 0.05;
    },
    note: d => `eq=${(d.advice.data.equity * 100).toFixed(0)}% > 閾値${((d.advice.data.threshold ?? d.advice.data.breakeven) * 100).toFixed(0)}%でフォールド (facing=${d.ctx.facing})`,
  },
  {
    id: "超浅実効スタックでフォールド推奨",
    check: d => {
      if (d.phase !== "preflop" || d.ctx.facing !== "none") return false;
      const eff = d.advice.data && d.advice.data.effS;
      // 混合(jam>=0.4)は「フォールド推奨」ではないので除外
      return d.advice.primary === "fold" && (d.advice.freqs.jam || 0) < 0.4 && eff != null && eff <= 2.0;
    },
    note: d => `実効${d.advice.data.effS.toFixed(1)}BBのファーストインでフォールド推奨 (${d.ctx.heroLabel} @${d.ctx.seatName})`,
  },
  {
    id: "AA/KKをフォールド推奨",
    // eff>0(実際に手番が来る=オールイン済みでない)に限定
    check: d => (d.ctx.heroLabel === "AA" || d.ctx.heroLabel === "KK") && d.advice.primary === "fold" &&
      d.ctx.facing !== "none" && (d.ctx.effBehindBB == null || d.ctx.effBehindBB > 0.5) && (d.ctx.effBB == null || d.ctx.effBB > 0.5),
    note: d => `${d.ctx.heroLabel} をフォールド推奨 (facing=${d.ctx.facing}, eff=${(d.ctx.effBB || d.ctx.effBehindBB || 0).toFixed(1)}BB)`,
  },
  {
    id: "ジャムに正しい閾値以上なのにフォールド",
    check: d => {
      const dd = d.advice.data;
      // data.threshold は必要勝率+後続/マルチ/ICM補正込みの正しい閾値
      return d.advice.primary === "fold" && dd && dd.kind === "facingJam" &&
        dd.equity != null && dd.threshold != null && dd.equity > dd.threshold + 0.04;
    },
    note: d => `eq ${(d.advice.data.equity * 100).toFixed(0)}% > 閾値 ${(d.advice.data.threshold * 100).toFixed(0)}%(補正込)+4%超なのにフォールド`,
  },
  {
    id: "freqs合計が0か異常",
    check: d => {
      const f = d.advice.freqs || {};
      const sum = Object.values(f).reduce((a, b) => a + b, 0);
      return sum < 0.99 || sum > 1.01;
    },
    note: d => `freqs合計=${Object.values(d.advice.freqs || {}).reduce((a, b) => a + b, 0).toFixed(2)} (${JSON.stringify(d.advice.freqs)})`,
  },
  {
    id: "primaryがfreqsに無い/未定義",
    check: d => {
      const f = d.advice.freqs || {};
      return !d.advice.primary || !(d.advice.primary in f) || f[d.advice.primary] <= 0;
    },
    note: d => `primary=${d.advice.primary} freqs=${JSON.stringify(d.advice.freqs)}`,
  },
  {
    id: "ポストフロップでエクイティ80%超なのにフォールド",
    check: d => d.phase === "postflop" && d.advice.primary === "fold" &&
      d.advice.data && d.advice.data.equity != null && d.advice.data.equity >= 0.80,
    note: d => `ボード${(d.ctx.board || []).map(cardText).join("")} eq=${(d.advice.data.equity * 100).toFixed(0)}%でフォールド`,
  },
];

(async () => {
  const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {},
    heroAct: null };
  let totalHands = 0, crashes = 0, busts = 0, wins = 0;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const st = A.newTournament("bot", 18);
    st.fastMode = true;
    io.heroAct = (ctx, legal) => A.botAct(st, st.players[0], ctx, legal, io);
    try {
      let guard = 0;
      while (!st.over && st.handNo < 300 && guard++ < 320) {
        await A.playHand(st, io);
        for (const p of st.players) if (p.chips < 0) throw new Error("負のチップ");
      }
      if (st.won) wins++; else busts++;
      totalHands += st.handNo;
    } catch (e) { crashes++; console.error(`CRASH t${i}: ${e.message}`); }
    if ((i + 1) % 20 === 0) console.error(`  ${i + 1}/${N} (${A.decisions.length}判断, ${((Date.now() - t0) / 1000).toFixed(0)}秒)`);
  }

  console.log(`\n=== セルフプレイ完了: ${N}トーナメント / ${totalHands}ハンド / ${A.decisions.length}判断 ===`);
  console.log(`優勝${wins} バスト${busts} クラッシュ${crashes}\n`);

  // 異常検出
  const findings = {};
  for (const d of A.decisions) {
    for (const r of RULES) {
      let hit = false;
      try { hit = r.check(d); } catch (e) {}
      if (hit) {
        if (!findings[r.id]) findings[r.id] = [];
        if (findings[r.id].length < 6) {
          try { findings[r.id].push(r.note(d)); } catch (e) { findings[r.id].push("(note生成エラー)"); }
        } else findings[r.id].push(null); // カウントのみ
      }
    }
  }

  // デバッグ: 超浅フォールドの完全ctxをダンプ
  for (const d of A.decisions) {
    if (d.phase === "preflop" && d.ctx.facing === "none" && d.advice.primary === "fold" &&
        d.advice.data && d.advice.data.effS != null && d.advice.data.effS <= 2.0) {
      const c = d.ctx;
      console.log("DUMP超浅fold:", JSON.stringify({
        label: c.heroLabel, pos: c.seatName, posIdx: c.posIdx, stackBB: c.stackBB,
        effBB: c.effBB, effJamBB: c.effJamBB, defendersN: c.defendersN, tableN: c.tableN,
        effS: d.advice.data.effS, th: d.advice.data.threshold, margin: d.advice.data.marginBB,
        freqs: d.advice.freqs, kind: d.advice.data.kind,
      }));
      break;
    }
  }

  let anomalies = 0;
  console.log("--- 異常検出 ---");
  for (const r of RULES) {
    const hits = findings[r.id] || [];
    if (hits.length === 0) { console.log(`✓ ${r.id}: 0件`); continue; }
    anomalies += hits.length;
    console.log(`★ ${r.id}: ${hits.length}件`);
    for (const ex of hits.filter(Boolean).slice(0, 6)) console.log(`    例: ${ex}`);
  }
  console.log(`\n合計 ${anomalies} 件の異常候補。0件が理想。★が出たら該当ルールを精査して修正。`);
})().catch(e => { console.error(e); process.exitCode = 1; });
