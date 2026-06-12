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
    if (d.kind === "openJam" && !d.nash && chosen === "fold" && rangeHas(d.range, ctx.heroLabel)) {
      const pct = handPercentile(ctx.heroLabel);
      if (Math.abs(pct - d.rangePct) < 5) verdict = "minor";
    }
  }
  // ナッシュ閾値からの距離でミスの重さを決める
  if (d.kind === "openJam" && d.nash && (verdict === "minor" || verdict === "blunder")) {
    const m = Math.abs(d.marginBB);
    verdict = m < 2.5 ? "minor" : "blunder";
  }
  // リジャム閾値も同様(ジャムの有無を間違えた場合のみ)
  if (d.kind === "facingOpen" && d.nashRejam && (verdict === "minor" || verdict === "blunder") &&
      ((chosen === "jam") !== (advice.primary === "jam"))) {
    const m = Math.abs(d.marginBB);
    verdict = m < 2.5 ? "minor" : "blunder";
  }

  // EV損失推定(BB)
  let evLoss = 0;
  if (verdict === "minor") evLoss = 0.4;
  if (verdict === "blunder") evLoss = 1.5;
  if (d.kind === "openJam" && d.nash && (verdict === "minor" || verdict === "blunder")) {
    evLoss = Math.round(Math.min(2.5, 0.15 * Math.abs(d.marginBB) + 0.1) * 100) / 100;
  }
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
    if (d.nash) {
      const th = d.threshold, m = d.marginBB;
      const thText = th <= 0 ? "どのスタックでもジャムしません"
        : th >= 16 ? "16BB以上でもジャムできます"
        : `<b>${th.toFixed(1)}BB以下ならジャム</b>です`;
      lines.push(`<p>ナッシュ均衡(計算済み)では、${ctx.seatName}の ${hand} は${thText}。` +
        `現在 <b>${ctx.stackBB.toFixed(1)}BB</b>。</p>`);
      if (Math.abs(m) <= 0.5) {
        lines.push(`<p>ちょうど境界線上の<b>混合域</b>です。ジャムもフォールドもEVはほぼ同じ — どちらを選んでもミスではありません。</p>`);
      } else if (m > 0) {
        const comfort = m >= 4 ? "余裕でジャム圏内。迷う必要のないオールインです" :
          m >= 1.5 ? `ジャム圏内(余裕${m.toFixed(1)}BB)` : `ぎりぎりジャム圏内(余裕${m.toFixed(1)}BB)`;
        lines.push(`<p>${comfort}。` +
          (chosen === "fold" ? `これを落とすとブラインド+アンティ<b>2.5BB</b>を奪うチャンスを毎周捨てることになります。` : "") + `</p>`);
      } else {
        const sever = -m >= 4 ? "明確に圏外。コールされた時に勝てないハンドです" :
          -m >= 1.5 ? `圏外(あと${(-m).toFixed(1)}BB浅ければジャムでした)` : `僅かに圏外(あと${(-m).toFixed(1)}BB浅ければジャム)`;
        lines.push(`<p>${sever}。` +
          (chosen === "jam" ? `フォールドエクイティを考慮してもEVが足りません。` : "") + `</p>`);
      }
      lines.push(`<p>この${ctx.stackBB.toFixed(1)}BBでの${ctx.seatName}のナッシュ・ジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>:</p>`);
    } else {
      const inR = rangeHas(d.range, hand);
      lines.push(`<p>${ctx.stackBB.toFixed(1)}BBの${ctx.seatName}のジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
        `${hand} は<b>${inR ? "含まれます" : "含まれません"}</b>。</p>`);
    }
    lines.push(rangeGridHTML(d.range, null, hand, "ジャム"));
  }
  else if (d.kind === "openRaise") {
    const inR = rangeHas(d.range, hand);
    const pctile = handPercentile(hand);
    if (d.hu) {
      lines.push(`<p><b>ヘッズアップ</b>のSBは約${d.rangePct.toFixed(0)}%という超ワイドなオープンが標準です。` +
        `${hand}(強度 上位${pctile.toFixed(0)}%)は<b>${inR ? "余裕でオープン" : "さすがにフォールド"}</b>。</p>`);
    } else {
      const dist = Math.abs(pctile - d.rangePct);
      const posNote = inR
        ? (dist > 20 ? "レンジのド真ん中。標準的なオープンです" : "オープンレンジの下限付近ですが、オープンが正解です")
        : (dist > 20 ? "オープンレンジから大きく外れています" : `惜しくもレンジ外(レンジ上位${d.rangePct.toFixed(0)}%に対し強度${pctile.toFixed(0)}%)`);
      lines.push(`<p>${ctx.seatName}(${ctx.stackBB.toFixed(0)}BB)のオープンレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。${hand} は${posNote}。</p>`);
    }
    if (chosen === "jam" && inR) lines.push(`<p>このスタック(${ctx.stackBB.toFixed(0)}BB)ではオールインより2.2BBレイズが標準。強いハンドの価値を最大化し、弱いハンドにフォールドの余地を残せます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "レイズ"));
  }
  else if (d.kind === "facingOpen") {
    const inJam = rangeHas(d.rejamRange, hand);
    const inCall = d.callRange ? rangeHas(d.callRange, hand) : false;
    const openerDesc = d.hu ? "<b>ヘッズアップ</b>のSBオープン(超ワイドレンジ)" : `${d.openerClass}ポジションからのオープン`;
    lines.push(`<p>${openerDesc}に対する有効${ctx.effBB.toFixed(0)}BBの戦略: リジャム上位 <b>${d.rejamPct.toFixed(1)}%</b>` +
      (d.callRange ? ` / コール <b>${d.callPct.toFixed(1)}%</b>` : " / コールなし(ジャムかフォールド)") + `。</p>`);
    if (d.nashRejam && d.threshold !== null) {
      const th = d.threshold, m = d.marginBB;
      const thText = th <= 0 ? `${hand} はどの有効スタックでもリジャムしません`
        : th >= 25 ? `${hand} は有効25BB以上でもリジャムできます`
        : `${hand} のリジャムは<b>有効${th.toFixed(1)}BB以下</b>(計算済み均衡)`;
      let nuance = "";
      if (Math.abs(m) <= 0.5) nuance = " — ちょうど境界の混合域です";
      else if (m > 0 && m < 2) nuance = ` — ぎりぎり圏内(余裕${m.toFixed(1)}BB)`;
      else if (m < 0 && m > -2) nuance = ` — 僅かに圏外(あと${(-m).toFixed(1)}BB浅ければジャム)`;
      lines.push(`<p>${thText}。現在 有効<b>${ctx.effBB.toFixed(1)}BB</b>${nuance}。</p>`);
    }
    if (d.eqVsOpen != null) {
      lines.push(`<p>相手のオープンレンジに対する ${hand} の生エクイティ: <b>${pct(d.eqVsOpen)}</b>(事前計算テーブルによる厳密値)</p>`);
    }
    // 選択と正解の組み合わせに応じた説明(定型文の連発はしない)
    const correct = advice.primary;
    if (correct === "jam" && chosen === "fold") {
      lines.push(`<p>${hand} はリジャムレンジ内です。${d.hu ? "HUの超ワイドオープンに対しては、ここで踏み込まないとブラインドを取られ続けます。" : "相手のオープンレンジの大部分はジャムにフォールドするため、フォールドエクイティ+コールされた時のエクイティの合計で+EVです。"}</p>`);
    } else if (correct === "jam" && chosen === "call") {
      lines.push(`<p>コールよりリジャム推奨です。有効${ctx.effBB.toFixed(0)}BBではポストフロップの技術介入余地が小さく、フォールドエクイティを取れるジャムの方がEVが高くなります。</p>`);
    } else if (correct === "call" && chosen === "fold") {
      lines.push(`<p>必要勝率は約<b>${pct(ctx.toCallBB / (ctx.potBB + ctx.toCallBB))}</b>と安く、${hand} はコールレンジ内。ここを全部降りるとブラインドの搾取に対して無防備になります。</p>`);
    } else if (correct === "call" && chosen === "jam") {
      lines.push(`<p>${hand} はジャムするには弱く、捨てるには強い「コール向き」のハンドです。ジャムだと相手の継続レンジ(上位${d.rejamPct.toFixed(0)}%級)に対して分が悪くなります。</p>`);
    } else if (correct === "fold" && (chosen === "call" || chosen === "jam")) {
      lines.push(`<p>${hand} はリジャムにもコールにも届きません。${ctx.posIdx === POS_BB ? "BBのポットオッズをもってしても継続は-EVです。" : "ポジション外から弱いハンドで参加すると、その後の全ストリートで損をし続けます。"}</p>`);
    }
    lines.push(rangeGridHTML(d.rejamRange, d.callRange, hand, "オールイン", "コール"));
  }
  else if (d.kind === "facingJam") {
    const ev = d.evCallBB;
    let headline;
    if (ev > 1.5) headline = `圧倒的に+EVのコール(<b class="pos">+${ev.toFixed(2)}BB</b>)。スナップコールです。`;
    else if (ev > 0.3) headline = `+EVのコール(<b class="pos">+${ev.toFixed(2)}BB</b>)。`;
    else if (ev > -0.3) headline = `境界線上(EV ${ev >= 0 ? "+" : ""}${ev.toFixed(2)}BB)。どちらを選んでも大差ありません。`;
    else if (ev > -1.5) headline = `-EVのコール(<b class="neg">${ev.toFixed(2)}BB</b>)。フォールドが正解。`;
    else headline = `明確に-EV(<b class="neg">${ev.toFixed(2)}BB</b>)。これをコールし続けると長期で大損します。`;
    lines.push(`<p>${headline}</p>`);
    lines.push(
      `<p>相手のジャムレンジ: 上位 <b>${d.jamRangePct.toFixed(1)}%</b><br>` +
      `${hand} のエクイティ: <b>${pct(d.equity)}</b>${d.eqExact ? `<span style="color:var(--dim)">(169×169厳密計算)</span>` : ""}<br>` +
      `必要勝率(ポットオッズ): <b>${pct(d.breakeven)}</b>` +
      (d.margin > 0.02 && !d.icmPremium ? ` + 後続/マルチ補正 ${pct(d.margin)}` : "") + `</p>`);
    if (d.icmPremium > 0.005) {
      lines.push(`<p>🏆 <b>ICM補正(ファイナルテーブル)</b>: 賞金圧力により必要勝率が ` +
        `${pct(d.breakeven)} → <b>${pct(d.icmReq)}</b>(+${pct(d.icmPremium)})に上昇。` +
        `チップで勝てる勝負でも、飛んだ時に失う「賞金の期待値」が大きいため、より強い手でしかコールできません。</p>`);
    }
    if (chosen === "call" && ev < -0.3) lines.push(`<p>「ここまで来たら…」の感情コールは分散ではなくミスです。数字はフォールドと言っています。</p>`);
    if (chosen === "fold" && ev > 0.3) lines.push(`<p>トーナメントの勝者は、この+EVコールを淡々と積み重ねた人です。</p>`);
  }
  else if (d.kind === "postflop") {
    const c = d.cls;
    lines.push(`<p>あなたのハンド: <b>${c.label}</b> (強度ティア ${c.tier}/5)<br>` +
      (d.equity !== undefined ? `${d.vsLabel}に対するエクイティ: <b>${pct(d.equity)}</b><br>` : "") +
      (d.breakeven !== undefined ? `必要勝率: <b>${pct(d.breakeven)}</b>` +
        (d.icmPremium > 0.005 ? ` → ICM補正後 <b>${pct(d.icmReq)}</b>(🏆FT賞金圧力)` : "") + `<br>` : "") +
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
