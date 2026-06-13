/* =========================================================
 * coach.js — 採点とGTO解説の生成
 * ========================================================= */
"use strict";

const VERDICT_INFO = {
  best:    { label: "✓ GTO通り",          cls: "v-best",    score: 10 },
  mixed:   { label: "✓ OK(混合戦略)",     cls: "v-mixed",   score: 10 },
  caution: { label: "⚠ 注意(EVとICMで割れる)", cls: "v-caution", score: 8 },
  minor:   { label: "△ 僅かなミス",       cls: "v-minor",   score: 4 },
  blunder: { label: "✗ ブランダー",       cls: "v-blunder", score: 0 },
};

/* ---------- 語彙の多様化(同じ表現を連続で出さない) ---------- */
const _pickMemo = {};
function pickVar(key, arr) {
  if (!arr || arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  let i = (Math.random() * arr.length) | 0;
  if (_pickMemo[key] === i) i = (i + 1) % arr.length; // 直前と同じを回避
  _pickMemo[key] = i;
  return arr[i];
}

// 判定ごとのメンター風一言(冒頭に出す。毎回違う表情を出して飽きさせない)
const COACH_VOICE = {
  best: [
    "ナイス。これが基準だ。",
    "完璧。何も足すことはない。",
    "教科書通り。この感覚を体に染み込ませよう。",
    "迷いなく取れたなら本物だ。",
    "そう、それでいい。淡々と続けよう。",
    "正解。強い選択は地味なことが多い。",
  ],
  mixed: [
    "アリだ。ここはGTOも答えを混ぜる場面。",
    "OK。どちらを選んでも責められない。",
    "問題なし。これは「揺らぎ」が正しいスポット。",
    "良い。相手に読まれないために、こういう手も混ぜる。",
  ],
  caution: [
    "ここは「正解」が一つに決まらない。EVとICMで答えが割れる。",
    "難所だ。チップの理屈と賞金の理屈が逆を向いている。",
    "ミスではない。ただし、なぜ割れるかを理解しておく価値がある。",
    "上級者でも意見が分かれるスポット。両方の視点を持っておこう。",
  ],
  minor: [
    "惜しい。方向は合っているが、詰めが甘い。",
    "悪くないが、ベストではない。理由を見ておこう。",
    "小さな漏れだ。塵も積もれば、になる前に直そう。",
    "大事故ではない。だが上手い人はここを取りこぼさない。",
    "方針は正解。あと一歩の精度だ。",
  ],
  blunder: [
    "ここは見過ごせない。なぜダメか、しっかり残そう。",
    "止まれ。これは長期で確実に削られる選択だ。",
    "痛い一手。でも、ここで気づけば財産になる。",
    "明確なミス。感情ではなく数字で決めよう。",
    "これは高くつく。理由を理解すれば二度と踏まない。",
  ],
};

function gradeDecision(ctx, advice, chosenId, act) {
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
  // 有効18BB以上でのノンオールイン3ベットは正解の一つとして許容
  // (本アプリのゲーム木はジャムに単純化しているが、実GTOは小さい3ベットも混ぜる)
  if (d.kind === "facingOpen" && advice.primary === "jam" && chosen === "raise" && ctx.effBB >= 18 &&
      (verdict === "minor" || verdict === "blunder")) {
    verdict = "mixed";
  }
  // ===== EVとICMが割れたら「ミス」でなく「注意」。両方が違うと言った時だけ「ミス」 =====
  // (ユーザー方針: チップEVの理屈とICMの理屈を統合して1つの正解にしない)
  let ftSplit = null;
  if (d.kind === "facingJam" && d.icmPremium > 0.005 && d.icmReq != null && d.equity != null) {
    ftSplit = {
      chipDo: d.evCallBB > 0.03,          // チップEVはコールしたいか
      icmDo: d.equity >= d.icmReq,        // ICMはコールしたいか
      userDid: chosen === "call",
      agg: "コール", pass: "フォールド",
    };
  } else if ((d.kind === "openJam" || d.kind === "facingOpen") && d.icmJamEval) {
    ftSplit = {
      chipDo: (d.marginBB != null ? d.marginBB >= 0 : true),  // チップEV(ナッシュ)はジャムしたいか
      icmDo: d.icmJamEval.evJam >= d.icmJamEval.evFold,       // ICMはジャムしたいか
      userDid: chosen === "jam",
      agg: "ジャム", pass: "フォールド",
    };
  }
  if (ftSplit) {
    // 採点は必ず「表示された推奨ライン(advice.primary)」を基準にする。
    // (戦略freqsと採点が食い違って『推奨どおり打ったのに叱られる』のを防ぐ)
    const aggId = (d.kind === "facingJam") ? "call" : "jam";
    const recommendAgg = (advice.primary === aggId);
    const userTookRecommended = (ftSplit.userDid === recommendAgg);
    if (userTookRecommended) {
      // 推奨どおり → 決して「ミス」にしない。割れる場面なら二視点を前向きに補足
      if (verdict === "minor" || verdict === "blunder") verdict = "best";
      if (ftSplit.chipDo !== ftSplit.icmDo) d._ftFollowed = true;
    } else {
      // 推奨と逆に打った
      if (ftSplit.chipDo !== ftSplit.icmDo) verdict = "caution"; // もう一方の枠組みが支持 → 注意
      else verdict = "blunder";                                  // EVもICMも推奨を支持 → ミス
    }
    d._ftSplit = ftSplit;
  }

  // EV損失推定(BB)
  let evLoss = 0;
  if (verdict === "minor") evLoss = 0.4;
  if (verdict === "blunder") evLoss = 1.5;
  if (verdict === "caution") evLoss = 0;   // 注意はミスではないのでEV損失計上しない
  if (d.kind === "openJam" && d.nash && (verdict === "minor" || verdict === "blunder")) {
    evLoss = Math.round(Math.min(2.5, 0.15 * Math.abs(d.marginBB) + 0.1) * 100) / 100;
  }
  if (d.kind === "facingJam" && d.evCallBB !== undefined && !ftSplit) {
    const ev = d.evCallBB;
    if (chosen === "call" && ev < -0.05) evLoss = -ev;
    else if (chosen === "fold" && ev > 0.05) evLoss = ev;
    else evLoss = 0;
    if (evLoss > 0 && evLoss < 0.3) verdict = (verdict === "blunder") ? "minor" : verdict;
    if (evLoss === 0 && (verdict === "minor" || verdict === "blunder")) verdict = "mixed";
  }
  // ---- ポストフロップ: ベットサイズ違いやスロープレイを「致命的」扱いしない ----
  let postNote = null;
  if (ctx.phase === "postflop") {
    const betFreq = (freqs.bet33 || 0) + (freqs.bet66 || 0) + (freqs.jam || 0);
    // (1) ベットを選びGTOも主にベット → サイズ違いは最悪でも軽微(致命的でない)
    if ((chosen === "bet33" || chosen === "bet66") && betFreq >= 0.5 &&
        (verdict === "blunder" || verdict === "minor")) {
      verdict = (freqs[chosen] || 0) >= 0.35 ? "mixed" : "minor";
      if (verdict === "minor") {
        const want = (freqs.bet66 || 0) > (freqs.bet33 || 0) ? "大きめ(66%)" : "小さめ(33%)";
        postNote = `ベットする判断は正解。ただしサイズはGTO的には${want}が主体です。中盤戦の小さいスタックでは、強い役は早くスタックを入れ切り、弱い手は安く諦める設計が効きます。`;
      }
    }
    // (2) 強い役(ティア4+)のチェック=スロープレイ。バリュー逃しだが致命傷ではない
    if (chosen === "check" && verdict === "blunder" && d.cls && d.cls.tier >= 4) {
      verdict = "minor";
      postNote = `強い役のチェック(スロープレイ)自体は時に有効ですが、中盤戦の浅いスタックでは<b>ベットでバリューを取り、早めにスタックを入れ切る</b>方が基本的に得です。チェックは相手に無料でカードを与え、本来取れたチップを逃します。`;
    }
  }

  // ポストフロップのサイズ違い/スロープレイは控えめなEV損失に
  if (postNote) evLoss = 0.35;
  if (verdict === "best" || verdict === "mixed") evLoss = 0;

  // ---- ベットサイズの採点(アクションが正しくてもサイズがGTO標準から外れたら指摘) ----
  let sizing = null;
  if (act && act.target && (verdict === "best" || verdict === "mixed")) {
    sizing = evalSizing(ctx, advice, chosen, act);
    if (sizing && sizing.severity) {
      verdict = sizing.severity; // minor 等に格下げ
      evLoss = sizing.evLoss;
    }
  }
  // ポストフロップの注記をサイズ注記枠で表示(未設定時のみ)
  if (postNote && !sizing) sizing = { note: postNote };

  return { verdict, evLoss, sizing, explanation: buildExplanation(ctx, advice, chosen, verdict, sizing) };
}

/* ベットサイズの妥当性を評価。戻り: {severity, evLoss, note} | null */
function evalSizing(ctx, advice, chosen, act) {
  const bb = (typeof LIVE !== "undefined") ? LIVE.bb : 4000;
  const sizeBB = act.target / bb;
  const d = advice.data;

  // プリフロップ・オープンレイズ(ファーストイン、非オールイン)
  if (ctx.phase === "preflop" && (d.kind === "openRaise") && chosen === "raise") {
    const std = (typeof CFG !== "undefined" ? CFG.OPEN_SIZE : 2.2);
    if (sizeBB >= 2.0 && sizeBB <= 2.7) return null;           // 標準帯
    if (sizeBB < 2.0) {
      return { severity: "minor", evLoss: 0.3,
        note: `オープンが<b>${sizeBB.toFixed(1)}BB</b>と小さすぎます(ミニレイズ)。標準は約<b>2.2BB</b>。` +
          `小さく開くと後ろの全員に良いオッズを与え、特にBBがほぼ何でもコールしてくるため、ポジション不利のポストフロップを多く戦わされ損をします。` };
    }
    // 過大
    const sev = sizeBB >= 4 ? "minor" : "minor";
    const evl = Math.min(1.2, (sizeBB - 2.7) * 0.25);
    return { severity: sev, evLoss: Math.round(evl * 100) / 100,
      note: `オープンが<b>${sizeBB.toFixed(1)}BB</b>と大きすぎます。標準は約<b>2.2BB</b>。` +
        `開きが大きいほど、降りた時の損が増え、強いハンドの時だけ大きく賭ける形になって相手に読まれます。` +
        `また自分のスタックを不必要に薄くし、4ベットオールインに対して脆くなります。同じ「オープンする」でもサイズで期待値は変わります。` };
  }
  // ポストフロップのベット/レイズが極端(ポット比)
  if (ctx.phase === "postflop" && (chosen === "bet33" || chosen === "bet66")) {
    const potBB = ctx.potBB || 0;
    if (potBB > 0) {
      const ratio = sizeBB / potBB;
      if (ratio > 1.5) return { severity: "minor", evLoss: 0.3,
        note: `ベットが<b>ポットの${Math.round(ratio*100)}%</b>と大きすぎます。中盤戦の標準は33〜75%程度。オーバーベットは特定の場面以外ではバランスを崩します。` };
    }
  }
  return null;
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
function pct0(x) { return (x * 100).toFixed(0) + "%"; }

// 計算方法の解説ボックス
function calcBox(title, html) {
  return `<div class="calc-box"><h4>${title}</h4>${html}</div>`;
}

// EVとICMが割れた「注意」局面の二視点解説(矛盾を避け、両方の考え方を分けて示す)
function splitBox(ft, d, ctx) {
  const evSide = ft.chipDo ? ft.agg : ft.pass;
  const icmSide = ft.icmDo ? ft.agg : ft.pass;
  let evDetail = "", icmDetail = "";
  if (d.kind === "facingJam") {
    evDetail = `チップだけで見ると、${hl(d.equity)}のエクイティに対しコールのEVは` +
      `<b class="${d.evCallBB>=0?"pos":"neg"}">${d.evCallBB>=0?"+":""}${d.evCallBB.toFixed(2)}BB</b>。` +
      `チップを最大化するなら<b>${evSide}</b>。`;
    icmDetail = `賞金で見ると、必要勝率がICM補正で<b>${pct(d.breakeven)}→${pct(d.icmReq)}</b>に上がる。` +
      `あなたのエクイティ${pct(d.equity)}は${d.equity>=d.icmReq?"これを上回る":"これに届かない"}ので、賞金重視なら<b>${icmSide}</b>。`;
  } else {
    const i = d.icmJamEval;
    evDetail = `チップだけで見れば、ナッシュ均衡上このハンドは<b>${ft.chipDo?"ジャム圏内":"圏外"}</b>。チップ最大化なら<b>${evSide}</b>。`;
    icmDetail = `賞金で見ると、ジャムの賞金期待値<b>${(i.evJam*100).toFixed(2)}%</b> vs フォールド<b>${(i.evFold*100).toFixed(2)}%</b>。` +
      `飛んだ時の順位下落の代償を含めると、賞金重視なら<b>${icmSide}</b>。`;
  }
  const followed = d._ftFollowed;
  const intro = followed
    ? `<b>このスポットはEVとICMで答えが割れます。あなたは推奨ライン(賞金を守る側)に沿った正しい選択をしました。</b>もう一方の見方も知っておきましょう。`
    : `<b>このスポットはEVとICMで答えが割れます。だから「ミス」ではなく「注意」です。</b>`;
  const concl = followed
    ? `③ <b>結論: 正解</b> — あなたの<b>${ft.userDid?ft.agg:ft.pass}</b>は推奨どおり。チップだけ見ると別の選択も+ですが、後半戦で順位(賞金)を守るこの判断が基本的に勝ります。`
    : `③ <b>結論: 注意</b> — あなたの<b>${ft.userDid?ft.agg:ft.pass}</b>は${ft.userDid===ft.chipDo?"チップEV":"ICM"}側に沿った判断で、一理あります。` +
      `どちらを採るかは「次のペイジャンプの近さ」「自分のスキル優位」「相手の傾向」で決めます。一般に、入賞直後やビッグスタック相手はICM寄り(慎重)、賞金がフラットな局面や格下相手はチップEV寄り(積極)が目安です。`;
  return `<div class="split-box">` +
    `<p>${intro}</p>` +
    `<p>① <b class="sb-ev">チップEVの考え方</b><br>${evDetail}</p>` +
    `<p>② <b class="sb-icm">ICM(賞金)の考え方</b><br>${icmDetail}</p>` +
    `<p>${concl}</p>` +
    `</div>`;
}
function hl(x){ return `<b>${pct(x)}</b>`; }

// ポットオッズの暗算早見(教材)
const POT_ODDS_CHEAT = `<span class="dim">【暗算の近道】相手のベットがポットの 1/3 → 必要20% / 半分 → 25% / 2/3 → 28.5% / ポット → 33% / 2倍 → 40%。オールインの場合は「コール額 ÷ (合計ポット+コール額)」を直接計算。</span>`;

// エクイティの実戦見積もり表(教材)
const EQUITY_CHEAT =
  `<b>手札の対決の目安(暗記推奨):</b><br>` +
  `・ペア vs 2オーバーカード(コインフリップ) ≈ <b>55:45</b>(例: 77 vs AK)<br>` +
  `・オーバーペア vs 下のペア ≈ <b>80:20</b>(例: QQ vs 88)<br>` +
  `・ドミネイト(同ハイカード) ≈ <b>73:27</b>(例: AK vs AQ)<br>` +
  `・2オーバー vs 2アンダー ≈ <b>67:33</b>(例: AQ vs 87)<br>` +
  `・「レンジ」に対しては中間を取る: 例えばAToはタイトな10%レンジ(99+,AJ+級)に対して約38%、ワイドな40%レンジに対して約57%`;

function buildExplanation(ctx, advice, chosen, verdict, sizing) {
  const d = advice.data;
  const lines = [];
  const hand = ctx.heroLabel;
  if (verdict && COACH_VOICE[verdict]) {
    lines.push(`<div class="ex-voice">${pickVar("voice", COACH_VOICE[verdict])}</div>`);
  }
  lines.push(`<div class="ex-head"><b>${hand}</b> @ ${ctx.seatName} ` +
    (ctx.phase === "preflop" ? `(${ctx.stackBB.toFixed(1)}BB)` : `【${streetJP(ctx.street)}】`) + `</div>`);
  lines.push(`<div class="ex-gto">GTO戦略: <b>${freqsText(advice.freqs)}</b> — あなた: <b>${actionJP(chosen)}</b></div>`);

  // サイズ/方針の指摘(アクション選択は妥当だが改善点がある場合)
  if (sizing && sizing.note) {
    const head = (chosen === "check") ? "💡 改善点:" : `📏 <b>ハンドの選択(${actionJP(chosen)})は妥当</b>。改善点:`;
    lines.push(`<p>${head}</p>`);
    lines.push(`<p>${sizing.note}</p>`);
  }

  if (d.kind === "openJam") {
    if (d.nash) {
      const th = d.threshold, m = d.marginBB;
      const effS = d.effS != null ? d.effS : ctx.stackBB;
      const thText = th <= 0 ? "どのスタックでもジャムしません"
        : th >= 16 ? "16BB以上でもジャムできます"
        : `<b>${th.toFixed(1)}BB以下ならジャム</b>です`;
      const stackText = d.effLimited
        ? `現在 実効<b>${effS.toFixed(1)}BB</b>(あなたは${ctx.stackBB.toFixed(1)}BB持ちですが、後ろの最大スタックがそれだけなので、リスクに晒されるのはこの分だけ)`
        : `現在 <b>${effS.toFixed(1)}BB</b>`;
      lines.push(`<p>ナッシュ均衡(計算済み)では、${ctx.seatName}の ${hand} は${thText}。${stackText}。</p>`);
      if (d.effLimited && effS <= 3) {
        lines.push(`<p>💡 <b>相手のスタックが極端に短い時の鉄則</b>: 実効${effS.toFixed(1)}BBに対してリスクはごく僅か、しかもポットには既に2.5BBのデッドマネー。この状況では<b>ほぼ全ハンドがジャムで+EV</b>です。相手の残りチップを常に確認しましょう。</p>`);
      }
      if (Math.abs(m) <= 0.5) {
        lines.push(`<p>ちょうど境界線上の<b>混合域</b>です。ジャムもフォールドもEVはほぼ同じ — どちらを選んでもミスではありません。</p>`);
      } else if (m > 0) {
        const comfort = m >= 4 ? pickVar("jamComfort", [
            "余裕でジャム圏内。迷う必要のないオールインだ",
            "どっしりジャム圏内。考え込む場面じゃない",
            "ジャムの中心ど真ん中。自動的に押していい",
          ]) :
          m >= 1.5 ? `ジャム圏内(余裕${m.toFixed(1)}BB)` : `ぎりぎりジャム圏内(余裕${m.toFixed(1)}BB)`;
        lines.push(`<p>${comfort}。` +
          (chosen === "fold" ? pickVar("foldMiss", [
            "ここで降りると、ブラインド+アンティの<b>2.5BB</b>を毎周みすみす献上することになる。",
            "降りるたびに<b>2.5BB</b>の置きチップを相手にプレゼントしている計算だ。",
            "フォールドは「確実に取れる2.5BB」を捨てる行為。浅い卓では命取りになる。",
          ]) : "") + `</p>`);
      } else {
        const sever = -m >= 4 ? pickVar("jamOut", [
            "明確に圏外。コールされたら勝ち目の薄いハンドだ",
            "これはレンジの外。受けられた瞬間に後手に回る",
            "押すには力不足。コールされると分が悪い",
          ]) :
          -m >= 1.5 ? `圏外(あと${(-m).toFixed(1)}BB浅ければジャムでした)` : `僅かに圏外(あと${(-m).toFixed(1)}BB浅ければジャム)`;
        lines.push(`<p>${sever}。` +
          (chosen === "jam" ? pickVar("jamOverEV", [
            "フォールドエクイティを足してもEVが届かない。",
            "降ろせる見込みを計算に入れても、まだ赤字だ。",
            "「相手が降りるかも」を勘定しても収支はマイナス。",
          ]) : "") + `</p>`);
      }
      // FTのICM判定
      if (d._ftSplit && (verdict === "caution" || d._ftFollowed)) {
        lines.push(splitBox(d._ftSplit, d, ctx));   // EVとICMで割れる → 二視点で説明
      } else if (d.icmJamEval) {
        const i = d.icmJamEval;
        const line = `ジャムの賞金期待値 <b>${(i.evJam * 100).toFixed(2)}%</b> vs フォールド <b>${(i.evFold * 100).toFixed(2)}%</b>`;
        lines.push(`<p>🏆 <b>ICM検証(FT)</b>: ${line} — チップEVと賞金EVが同じ方向(${i.evJam >= i.evFold ? "ジャム" : "フォールド"})を指しています。</p>`);
      }
      lines.push(`<p>この${ctx.stackBB.toFixed(1)}BBでの${ctx.seatName}のナッシュ・ジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>:</p>`);
      // 📐 計算方法
      if (d.calc) {
        const c = d.calc;
        lines.push(calcBox("📐 ジャムEVの計算方法(ナッシュ表の中身)",
          `<b>基本式:</b><br>` +
          `EV(ジャム) = P(全員フォールド) × 2.5BB + P(コール) × (勝率 × 最終ポット − リスク)<br>` +
          `<span class="dim">※2.5BB = SB0.5 + BB1 + BBアンティ1(これを取りに行くのがジャムの動機)</span><br><br>` +
          `<b>今回の数字を代入(後ろ${c.defenders}人、全員${c.S.toFixed(0)}BB持ちの近似):</b><br>` +
          `① 相手1人がコールするには勝率${pct0(c.defBE)}が必要 → コールできるのは全ハンドの約<b>${pct0(c.perDef)}</b><br>` +
          `② P(全員フォールド) = (1−${pct0(c.perDef)})<sup>${c.defenders}</sup> ≈ <b>${pct0(c.pNo)}</b><br>` +
          `③ コールされた時の ${hand} の勝率 ≈ <b>${pct0(c.eqVsCall)}</b>(相手の強いコールレンジに対して)<br>` +
          `④ EV ≈ ${pct0(c.pNo)}×2.5 + ${pct0(1 - c.pNo)}×(${pct0(c.eqVsCall)}×${c.finalPot.toFixed(1)} − ${c.risk.toFixed(1)}) ` +
          `≈ <b class="${c.ev >= 0 ? "pos" : "neg"}">${c.ev >= 0 ? "+" : ""}${c.ev.toFixed(2)}BB</b><br><br>` +
          `<b>🧮 自分で概算するコツ:</b> ①スタックが浅いほど「2.5BBの奪取」の価値が相対的に大きい ` +
          `②後ろの人数が多いほどコールされやすい(UTGが一番タイトな理由) ` +
          `③コールされたら大抵40%前後しか勝てない — だからフォールド率が生命線。` +
          `ナッシュ表はこの式を全169ハンド×全スタックで解いた答えです。`));
      }
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
    // EVとICMが割れる場合は二視点解説に切り替え(注意でも、推奨に従った正解でも)
    if (d._ftSplit && (verdict === "caution" || d._ftFollowed)) {
      lines.push(splitBox(d._ftSplit, d, ctx));
      lines.push(rangeGridHTML(d.rejamRange, d.callRange, hand, "オールイン", "コール"));
      return lines.join("\n");
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
    if (correct === "jam" && chosen === "raise" && ctx.effBB >= 18) {
      lines.push(`<p>💡 <b>あなたのノンオールイン3ベットも正解の一つです。</b>本アプリのゲーム木は浅いスタックの標準に合わせて「ジャムかフォールド」に単純化していますが、有効18BB以上の実際のGTOは約3〜3.5倍の小さい3ベットも混ぜます(4ベットジャムされた時の対応計画はセットで)。</p>`);
    }
    // FTのICM判定(両者一致時のみ。割れる場合は上の splitBox で既に説明済み)
    if (d.icmJamEval && !(d._ftSplit && verdict === "caution")) {
      const i = d.icmJamEval;
      const line = `ジャムの賞金期待値 <b>${(i.evJam * 100).toFixed(2)}%</b> vs フォールド <b>${(i.evFold * 100).toFixed(2)}%</b>(プライズプール比)`;
      lines.push(`<p>🏆 <b>ICM検証(FT)</b>: ${line} — チップEVと賞金EVが同じ方向を指しています。</p>`);
    }
    // 📐 計算方法
    if (d.calc) {
      const c = d.calc;
      lines.push(calcBox("📐 リジャムEVの計算方法",
        `<b>基本式:</b><br>` +
        `EV(リジャム) = P(オープナーが降りる) × 今のポット + P(コール) × (勝率 × 最終ポット − リスク)<br><br>` +
        `<b>今回の数字を代入(有効${c.S.toFixed(0)}BB):</b><br>` +
        `① 今のポット = 2.5(ブラインド+アンティ) + 2.2(オープン) = <b>${c.potNow.toFixed(1)}BB</b><br>` +
        `② オープナーがコールするには勝率${pct0(c.openerBE)}が必要 → オープンレンジのうちコールできるのは約<b>${pct0(c.pCall)}</b>(残り${pct0(1 - c.pCall)}は降りる!)<br>` +
        `③ コールされた時の ${hand} の勝率 ≈ <b>${pct0(c.eqVsCall)}</b><br>` +
        `④ EV ≈ ${pct0(1 - c.pCall)}×${c.potNow.toFixed(1)} + ${pct0(c.pCall)}×(${pct0(c.eqVsCall)}×${c.finalPot.toFixed(1)} − ${c.risk.toFixed(1)}) ` +
        `≈ <b class="${c.ev >= 0 ? "pos" : "neg"}">${c.ev >= 0 ? "+" : ""}${c.ev.toFixed(2)}BB</b><br><br>` +
        `<b>🧮 自分で概算するコツ:</b> リジャムの利益の大半は「相手のオープンレンジの${pct0(1 - c.pCall)}が降りて${c.potNow.toFixed(1)}BBをタダ取りする」部分。` +
        `相手のオープンが広いほど(レイトポジションほど)降ろせる率が上がるので、リジャムレンジも広がります。`));
    }
    lines.push(rangeGridHTML(d.rejamRange, d.callRange, hand, "オールイン", "コール"));
  }
  else if (d.kind === "facingJam") {
    const ev = d.evCallBB;
    // EVとICMが割れる場合は二視点解説に切り替え(注意でも、推奨に従った正解でも)
    if (d._ftSplit && (verdict === "caution" || d._ftFollowed)) {
      lines.push(splitBox(d._ftSplit, d, ctx));
      lines.push(`<p><span class="dim">相手のジャムレンジ上位${d.jamRangePct.toFixed(0)}% / ${hand}のエクイティ${pct(d.equity)}(169×169厳密)</span></p>`);
      return lines.join("\n");
    }
    // 見出しは「エクイティ vs (ICM補正後の)必要勝率」で決める=結論と必ず一致させる
    const icmOn = d.icmPremium > 0.005 && d.icmReq != null;
    const thr = d.threshold != null ? d.threshold : d.breakeven;
    const eqMargin = d.equity - thr;            // +なら継続、−なら降り
    const callRight = eqMargin >= 0;             // コールが推奨か
    const userCalled = chosen === "call";
    const matched = userCalled === callRight;    // 自分の選択が推奨と一致したか
    const eqs = `勝率<b>${pct(d.equity)}</b> ${callRight ? "≥" : "<"} 必要<b>${pct(thr)}</b>`;
    let headline;
    if (callRight) {
      // コールが正解
      if (matched) headline = pickVar("callRightYes", [
          `ナイスコール。${eqs}で、受けて正解。`,
          `その通り、ここはコール。${eqs}。`,
          `よく受けた。エクイティが必要勝率を上回っている(${eqs})。`,
        ]);
      else headline = pickVar("callRightNo", [
          `もったいない。本当は<b>コール</b>が正解だった(${eqs})。降りると取れる利益を逃す。`,
          `ここはコールすべきだった。${eqs}で、フォールドは損。`,
        ]);
    } else {
      // フォールドが正解
      if (matched) headline = pickVar("foldRightYes", [
          `ナイスフォールド。${eqs}だから、降りて正解。`,
          `正しく降りた。${eqs}で、コールは損だった。`,
          `その判断でいい。エクイティが必要勝率に届かない(${eqs})。`,
        ]);
      else headline = pickVar("foldRightNo", [
          `ここは<b>フォールド</b>が正解。${eqs}で、コールは長期で損になる。`,
          `降りるべきだった。${eqs} — 受けるとEVを失う。`,
          `この手は捨て場。${eqs}でコールは割に合わない。`,
        ]);
    }
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
    // 📐 計算方法
    const potC = ctx.potBB, callC = ctx.toCallBB;
    lines.push(calcBox("📐 コール判断の計算方法(3ステップ)",
      `<b>手順1: 必要勝率(ポットオッズ)を出す</b><br>` +
      `必要勝率 = コール額 ÷ (ポット + コール額)<br>` +
      `= ${callC.toFixed(1)} ÷ (${potC.toFixed(1)} + ${callC.toFixed(1)}) = <b>${pct(d.breakeven)}</b><br>` +
      `${POT_ODDS_CHEAT}<br><br>` +
      `<b>手順2: 自分の勝率(エクイティ)を見積もる</b><br>` +
      EQUITY_CHEAT + `<br>` +
      `今回: 相手のジャムレンジ(上位${d.jamRangePct.toFixed(0)}%)に対する ${hand} の厳密値 = <b>${pct(d.equity)}</b><br><br>` +
      `<b>手順3: 比較して決める</b><br>` +
      `勝率${pct(d.equity)} ${d.equity >= d.threshold ? "≥" : "<"} 必要勝率${pct(d.threshold)} → <b>${d.equity >= d.threshold ? "コール" : "フォールド"}</b><br>` +
      `EVに直すと: EV = ${pct(d.equity)} × ${(potC + callC).toFixed(1)} − ${callC.toFixed(1)} = <b class="${d.evCallBB >= 0 ? "pos" : "neg"}">${d.evCallBB >= 0 ? "+" : ""}${d.evCallBB.toFixed(2)}BB</b>`));
    if (d.icmDetail) {
      const i = d.icmDetail;
      lines.push(calcBox("📐 ICM(賞金圧力)の計算方法",
        `ICMは「チップ→賞金期待値」の変換です。1位になる確率 = 自分のチップ ÷ 全体チップ。` +
        `2位以下は、その人を除いた残りで同じ計算を繰り返します(Malmuth-Harville法)。<br><br>` +
        `<b>今回のあなたの賞金期待値(賞金総額=100%として):</b><br>` +
        `・フォールドした場合: <b>${pct(i.evFold)}</b><br>` +
        `・コールして勝った場合: <b>${pct(i.evWin)}</b><br>` +
        `・コールして負けた場合: <b>${pct(i.evLose)}</b><br><br>` +
        `<b>ICM必要勝率</b> = (フォールド − 負け) ÷ (勝ち − 負け)<br>` +
        `= (${pct(i.evFold)} − ${pct(i.evLose)}) ÷ (${pct(i.evWin)} − ${pct(i.evLose)}) = <b>${pct(d.icmReq)}</b><br><br>` +
        `<b>🧮 直感的な理解:</b> チップを2倍にしても賞金期待値は2倍にならない(逓減する)。` +
        `だから「勝った時に得る賞金」<「負けた時に失う賞金」となり、チップ上の必要勝率${pct(d.breakeven)}より` +
        `<b>+${pct(d.icmPremium)}</b>厳しくなります。特にビッグスタック同士の衝突ほどこの差が大きくなります。`));
    }
  }
  else if (d.kind === "postflop") {
    const c = d.cls;
    lines.push(`<p>あなたのハンド: <b>${c.label}</b> (強度ティア ${c.tier}/5)<br>` +
      (d.equity !== undefined ? `${d.vsLabel}に対するエクイティ: <b>${pct(d.equity)}</b><br>` : "") +
      (d.breakeven !== undefined ? `必要勝率: <b>${pct(d.breakeven)}</b>` +
        (d.icmPremium > 0.005 ? ` → ICM補正後 <b>${pct(d.icmReq)}</b>(🏆FT賞金圧力)` : "") + `<br>` : "") +
      `SPR(スタック/ポット比): <b>${d.spr.toFixed(1)}</b></p>`);
    lines.push(`<p>${postflopReason(ctx, advice, chosen)}</p>`);
    // 📐 計算方法
    let calcParts = [];
    if (d.outs > 0 && ctx.street !== "river") {
      const mult = ctx.street === "flop" ? 4 : 2;
      calcParts.push(
        `<b>アウツと2/4の法則:</b><br>` +
        `自分の役を完成させるカード(アウツ)を数え、フロップなら×4、ターンなら×2で完成率(%)を概算。<br>` +
        `<span class="dim">フラッシュドロー9枚 / 両面ストレート8枚 / ガットショット4枚 / オーバーカード2枚≈6枚</span><br>` +
        `今回のアウツ ≈ <b>${d.outs}枚</b> → 完成率 ≈ ${d.outs}×${mult} = <b>約${Math.min(95, d.outs * mult)}%</b>`);
    }
    if (d.breakeven !== undefined) {
      calcParts.push(
        `<b>ポットオッズ:</b> 必要勝率 = コール額÷(ポット+コール額) = ` +
        `${ctx.toCallBB.toFixed(1)}÷(${ctx.potBB.toFixed(1)}+${ctx.toCallBB.toFixed(1)}) = <b>${pct(d.breakeven)}</b><br>${POT_ODDS_CHEAT}`);
    }
    calcParts.push(
      `<b>SPRの使い方:</b> SPR = 残りスタック ÷ ポット = <b>${d.spr.toFixed(1)}</b>。` +
      `目安: SPR3以下ならトップペア以上で全額コミットOK / SPR6以上はワンペアで大きなポットを作らない。` +
      `浅いトーナメントではSPRが小さいので「ワンペアで突っ込んで良い場面」が多くなります。`);
    lines.push(calcBox("📐 ポストフロップの基本計算", calcParts.join("<br><br>")));
  }
  return lines.join("\n");
}

function postflopReason(ctx, advice, chosen) {
  const d = advice.data, c = d.cls, primary = advice.primary;
  const t = c.tier;
  if (d.checkToRaiser) {
    return "<b>チェック・トゥ・ザ・レイザー(GTOの大原則)</b>: 前のストリートのアグレッサーはあなたではありません。" +
      "コーラー側はほぼレンジ全体でチェックして、レンジが有利なレイザー側に打たせるのがソルバーの標準です。" +
      "コーラーからのリード(ドンクベット)が正当化されるのは、モンスターや強ドローを少頻度で混ぜる時だけ。" +
      (t >= 5 ? "今回はモンスターなので少しだけドンクを混ぜても構いませんが、チェックが主体です。" :
        "チェックしてもポットは逃げません — 相手が打てばレイズ/コールの選択肢が生まれ、チェックバックされれば無料でカードが見られます。");
  }
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
