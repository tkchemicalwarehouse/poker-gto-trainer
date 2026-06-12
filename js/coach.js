/* =========================================================
 * coach.js — 採点とGTO解説の生成
 * ========================================================= */
"use strict";

const VERDICT_INFO = {
  best:    { label: "✓ GTO通り",      cls: "v-best",    score: 10 },
  mixed:   { label: "✓ OK(混合戦略)", cls: "v-mixed",   score: 10 },
  minor:   { label: "△ 僅かなミス",   cls: "v-minor",   score: 4 },
  blunder: { label: "✗ ブランダー",   cls: "v-blunder", score: 0 },
};

function gradeDecision(ctx, advice, chosenId) {
  // ベット系のIDゆらぎを吸収
  let chosen = chosenId;
  const freqs = advice.freqs;
  const f = freqs[chosen] || 0;

  let verdict;
  if (f >= 0.6) verdict = "best";
  else if (f >= 0.25) verdict = "mixed";
  else if (f >= 0.05) verdict = "minor";
  else verdict = "blunder";

  // 特例処理
  const d = advice.data;
  if (verdict === "blunder") {
    if (d.kind === "openRaise" && chosen === "jam" && rangeHas(d.range, ctx.heroLabel)) {
      verdict = "minor"; // レンジ内ハンドのオーバージャム
    }
    if (d.kind === "facingOpen" && chosen === "call" && d.rejamRange && rangeHas(d.rejamRange, ctx.heroLabel) && ctx.posIdx !== POS_BB) {
      verdict = "minor"; // リジャム推奨ハンドでのコール
    }
    if (d.kind === "openJam" && chosen === "raise" && rangeHas(d.range, ctx.heroLabel)) {
      verdict = "minor"; // ジャム推奨スタックでの通常レイズ
    }
    if ((d.kind === "openJam") && chosen === "fold" && rangeHas(d.range, ctx.heroLabel)) {
      // レンジ最底辺のハンドのフォールドは僅差
      const pct = handPercentile(ctx.heroLabel);
      if (Math.abs(pct - d.rangePct) < 5) verdict = "minor";
    }
  }

  // EV損失推定(BB)
  let evLoss = 0;
  if (verdict === "minor") evLoss = 0.4;
  if (verdict === "blunder") evLoss = 1.5;
  if (d.kind === "facingJam" && d.evCallBB !== undefined) {
    const ev = d.evCallBB;
    if (chosen === "call" && ev < -0.05) evLoss = -ev;
    else if (chosen === "fold" && ev > 0.05) evLoss = ev;
    else evLoss = 0;
    if (evLoss > 0 && evLoss < 0.3) verdict = (verdict === "blunder") ? "minor" : verdict;
    if (evLoss === 0 && (verdict === "minor" || verdict === "blunder")) verdict = "mixed";
  }
  if (verdict === "best" || verdict === "mixed") evLoss = 0;

  return { verdict, evLoss, explanation: buildExplanation(ctx, advice, chosen, verdict) };
}

/* ---------- 解説文の生成 ---------- */
function actionJP(id) {
  return {
    fold: "フォールド", call: "コール", check: "チェック",
    raise: "レイズ", jam: "オールイン", bet33: "33%ベット", bet66: "66%ベット",
  }[id] || id;
}

function freqsText(freqs) {
  const parts = [];
  const keys = Object.keys(freqs).sort((a, b) => freqs[b] - freqs[a]);
  for (const k of keys) {
    if (freqs[k] >= 0.03) parts.push(`${actionJP(k)} ${(freqs[k] * 100).toFixed(0)}%`);
  }
  return parts.join(" / ");
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }

function buildExplanation(ctx, advice, chosen, verdict) {
  const d = advice.data;
  const lines = [];
  const hand = ctx.heroLabel;
  lines.push(`<div class="ex-head"><b>${hand}</b> @ ${ctx.seatName} ` +
    (ctx.phase === "preflop" ? `(${ctx.stackBB.toFixed(1)}BB)` : `【${streetJP(ctx.street)}】`) + `</div>`);
  lines.push(`<div class="ex-gto">GTO戦略: <b>${freqsText(advice.freqs)}</b> — あなた: <b>${actionJP(chosen)}</b></div>`);

  if (d.kind === "openJam") {
    const inR = rangeHas(d.range, hand);
    lines.push(`<p>${ctx.stackBB.toFixed(1)}BBの${ctx.seatName}からのナッシュ・オープンジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
      `${hand} はこのレンジに<b>${inR ? "含まれます" : "含まれません"}</b>(ハンド強度 上位${handPercentile(hand).toFixed(0)}%)。</p>`);
    if (!inR && chosen === "jam") lines.push(`<p>ショートでも全ハンドをジャムして良いわけではありません。コールされた時の勝率が低すぎ、フォールドエクイティを差し引いてもマイナスです。</p>`);
    if (inR && chosen === "fold") lines.push(`<p>ブラインド+アンティ(2.5BB)を奪う価値はスタックが浅いほど大きく、このハンドはジャムで+EVです。タイトすぎるとブラインドで削られていきます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "ジャム"));
  }
  else if (d.kind === "openRaise") {
    const inR = rangeHas(d.range, hand);
    lines.push(`<p>${ctx.seatName}(${ctx.stackBB.toFixed(0)}BB)のオープンレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
      `${hand} は<b>${inR ? "オープンします" : "フォールドです"}</b>。</p>`);
    if (chosen === "jam" && inR) lines.push(`<p>このスタックではオールインよりも2.2BBレイズが標準です。強いハンドの価値を最大化し、弱いハンドにフォールドの余地を残せます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "レイズ"));
  }
  else if (d.kind === "facingOpen") {
    lines.push(`<p>${d.openerClass}ポジションからのオープンに対する有効${ctx.effBB.toFixed(0)}BBのリジャムレンジは上位 <b>${d.rejamPct.toFixed(1)}%</b>` +
      (d.callRange ? `、コールレンジは <b>${d.callPct.toFixed(1)}%</b>` : "") + `。</p>`);
    if (ctx.posIdx === POS_BB) lines.push(`<p>BBは既に1BB+アンティを投資しているためポットオッズが良く、広めにディフェンスできます。ただし浅いスタックではコールよりリジャムでフォールドエクイティを取る方が優位です。</p>`);
    else lines.push(`<p>ポジション外・浅スタックではコール(フラット)はほぼ使わず、<b>リジャムかフォールド</b>の二択がGTOです。</p>`);
    lines.push(rangeGridHTML(d.rejamRange, d.callRange, hand, "オールイン", "コール"));
  }
  else if (d.kind === "facingJam") {
    lines.push(
      `<p>相手のジャムレンジ: 上位 <b>${d.jamRangePct.toFixed(1)}%</b><br>` +
      `${hand} のエクイティ: <b>${pct(d.equity)}</b><br>` +
      `必要勝率(ポットオッズ): <b>${pct(d.breakeven)}</b>` +
      (d.margin > 0.01 ? ` + 後続プレイヤー補正 ${pct(d.margin)}` : "") + `<br>` +
      `コールのEV: <b class="${d.evCallBB >= 0 ? "pos" : "neg"}">${d.evCallBB >= 0 ? "+" : ""}${d.evCallBB.toFixed(2)} BB</b></p>`);
    if (chosen === "call" && d.evCallBB < -0.05) lines.push(`<p>エクイティが必要勝率に届いていません。「もう投げ捨てるには惜しい」と感じても、長期では確実に損をするコールです。</p>`);
    if (chosen === "fold" && d.evCallBB > 0.05) lines.push(`<p>必要勝率を上回っているのでコールが+EVでした。トーナメントで勝つには、この僅かに+EVのコールを積み重ねる必要があります。</p>`);
  }
  else if (d.kind === "postflop") {
    const c = d.cls;
    lines.push(`<p>あなたのハンド: <b>${c.label}</b> (強度ティア ${c.tier}/5)<br>` +
      (d.equity !== undefined ? `${d.vsLabel}に対するエクイティ: <b>${pct(d.equity)}</b><br>` : "") +
      (d.breakeven !== undefined ? `必要勝率: <b>${pct(d.breakeven)}</b><br>` : "") +
      `SPR(スタック/ポット比): <b>${d.spr.toFixed(1)}</b></p>`);
    lines.push(`<p>${postflopReason(ctx, advice, chosen)}</p>`);
  }
  return lines.join("\n");
}

function postflopReason(ctx, advice, chosen) {
  const d = advice.data, c = d.cls, primary = advice.primary;
  const t = c.tier;
  if (ctx.facing === "none") {
    if (t >= 4) return "強い役はベットでバリューを取ります。浅いSPRではポットを膨らませてスタックを入れ切る設計が重要です。";
    if (t === 3) return "中程度の強さは「小さくベット」と「チェック」の混合です。ベットしすぎると強いハンドにしか出てこられず、チェックしすぎるとフリーカードを与えます。";
    if (c.draws.flushDraw || c.draws.oesd) return "強いドローはセミブラフの好機です。降ろせれば即利益、コールされても完成すれば大きく勝てる二重の勝ち筋があります。";
    if (d.dryBoard && ctx.role === "pfr") return "ドライなボードはプリフロップレイザーのレンジが有利なので、小さいベットを高頻度で打てます(レンジベット)。";
    return "弱いハンド・濡れたボードではチェックが基本です。エクイティのないブラフは浅いスタックでは特に割に合いません。";
  }
  if (ctx.facing === "bet") {
    if (t >= 5) return "モンスターは浅いSPRならレイズ(オールイン)でバリュー最大化。深ければコールで相手のブラフを泳がせる選択もあります。";
    if (d.equity !== undefined && d.breakeven !== undefined) {
      return d.equity >= d.threshold
        ? "エクイティが必要勝率を上回るため継続が正解です。"
        : "エクイティが必要勝率に足りません。ここで支払い続けるとスタックが溶けます。";
    }
  }
  if (ctx.facing === "raiseAllin") {
    return "オールインを受けた時は感情を排して「相手のレンジに対する勝率 vs 必要勝率」だけで決めます。";
  }
  return "";
}

/* ---------- 13x13 レンジグリッド ---------- */
const GRID_RANKS = "AKQJT98765432";

function rangeGridHTML(primaryRange, secondaryRange, heroLabel, primaryName, secondaryName) {
  let html = `<div class="rg-wrap"><div class="rg-legend">` +
    `<span class="rg-key rg-p"></span>${primaryName || "レイズ"}` +
    (secondaryRange ? ` <span class="rg-key rg-s"></span>${secondaryName || "コール"}` : "") +
    ` <span class="rg-key rg-f"></span>フォールド</div><div class="rg-grid">`;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      let label;
      if (r === c) label = GRID_RANKS[r] + GRID_RANKS[c];
      else if (r < c) label = GRID_RANKS[r] + GRID_RANKS[c] + "s";
      else label = GRID_RANKS[c] + GRID_RANKS[r] + "o";
      let cls = "rg-f";
      const pw = primaryRange ? (primaryRange.get(label) || 0) : 0;
      const sw = secondaryRange ? (secondaryRange.get(label) || 0) : 0;
      if (pw >= 0.5) cls = "rg-p";
      else if (sw >= 0.5) cls = "rg-s";
      else if (pw > 0 || sw > 0) cls = "rg-m";
      const hero = label === heroLabel ? " rg-hero" : "";
      html += `<div class="rg-cell ${cls}${hero}">${label}</div>`;
    }
  }
  html += `</div></div>`;
  return html;
}
