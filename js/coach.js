/* =========================================================
 * coach.js — 採点とGTO解説の生成
 * ========================================================= */
"use strict";

const VERDICT_INFO = {
  best:    { label: "✓ GTO通り",          cls: "v-best",    score: 10 },
  mixed:   { label: "✓ OK(混合戦略)",     cls: "v-mixed",   score: 10 },
  caution: { label: "⚠ 注意(EVとICMで割れる)", cls: "v-caution", score: 8 },
  bluff:   { label: "🃏 ナイスブラフ",     cls: "v-bluff",   score: 8 },
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
  bluff: [
    "🃏 ナイスブラフ。攻めの姿勢は良い。",
    "良い度胸だ。狙ったブラフはポーカーの華。",
    "攻めたな。読みが当たれば、これが勝負を決める一手だ。",
    "悪くない仕掛けだ。あとは「相手が降りるか」の読み次第。",
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

function gradeDecision(ctx, advice, chosenId, act, opts) {
  // ベット系のIDゆらぎを吸収
  let chosen = chosenId;
  // 単独オールインに「オールイン」で被せた = 実質コール(同じチップを入れる)。
  // facingJamでは採点・推奨比較・説明をすべて「コール」に統一する(「オールイン押したのにコールと書かれる/叱られる」防止)
  if (advice.data && advice.data.kind === "facingJam" && chosen === "jam") chosen = "call";
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
        // ★サイズの理由は推奨サイズに合わせる(33%推奨なのに『大きく打って入れ切れ』は矛盾)
        const wantBig = (freqs.bet66 || 0) > (freqs.bet33 || 0);
        postNote = wantBig
          ? `ベットする判断自体は妥当。ただしGTO的には<b>大きめ(66%)</b>が主体です。強い役やドローの多い(濡れた)ボードでは、大きく打って<b>価値を最大化</b>しつつ相手のエクイティ実現を拒否します。`
          : `ベットする判断自体は妥当。ただしGTO的には<b>小さめ(33%)</b>が主体です。小さく打つと相手の弱い手からも<b>コールを貰えて薄く価値</b>を取れ、自分のチェックレンジも守れます。大きく打つと相手は強い手しか続けず、降ろしたくない弱い手まで降ろして取り損ねます。`;
      }
    }
    // (1b) GTOは少頻度ながらベットも取る局面(主体はチェック) → ベットは少数派ラインで「ミス」ではない
    else if ((chosen === "bet33" || chosen === "bet66") && betFreq >= 0.15 && betFreq < 0.5 &&
        verdict === "blunder") {
      verdict = "minor";
      const want = (freqs.bet66 || 0) > (freqs.bet33 || 0) ? "大きめ(66%)" : "小さめ(33%)";
      postNote = `この局面のGTOは主に<b>チェック(${Math.round((freqs.check || 0) * 100)}%)</b>で、ベットは少数派(${Math.round(betFreq * 100)}%)の選択です。ベット自体は間違いではありませんが頻度は低め — 中途半端な強さの手はチェックで様子を見るのが基本。打つならサイズは${want}が主体です。`;
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

  // ★頻度クランプ★ GTO自身が一定頻度で取る手は決して「ブランダー」にしない。
  // (頻度こそGTOの正解度の証拠。混合戦略の片方を大失敗と呼ぶ矛盾を防ぐ)
  // ただしサイズ指摘によるminor(アクションは正解・サイズが悪い)は意図的なので対象外。
  const sizingPenalty = sizing && sizing.severity;
  if (!sizingPenalty) {
    if (verdict === "blunder" && f >= 0.25) { verdict = "mixed"; evLoss = 0; }
    else if (verdict === "blunder" && f >= 0.10) { verdict = "minor"; evLoss = Math.min(evLoss, 0.4); }
    else if (verdict === "minor" && f >= 0.30) { verdict = "mixed"; evLoss = 0; }
    // ★ポストフロップの混合戦略補正★ GTOが15%以上の頻度で取る手は均衡上ほぼ同EV=「ミス」ではない。
    // minorではなくmixed(EV損0)とし、過剰減点を避ける(プロが嫌う「正当な混合を叱る」を防止)。
    else if (ctx.phase === "postflop" && verdict === "minor" && f >= 0.15) { verdict = "mixed"; evLoss = 0; }
  }

  // 🃏 狙ったブラフを尊重する。弱い手でのオーバーベット/リレイズ・オールイン(=フォールドを取りに行く意図)を
  // 「明確なミス」と断じない。ナイスブラフ + 正直なEV/ICM注意に。ただし嘘はつかない(+EVとは言わない=下の解説で正直に示す)。
  // 条件: ポストフロップで自分がアグレッサー(相手オールインへのコールではない)/弱い手/推奨外の攻撃/現状ミス判定。
  if (ctx.phase === "postflop" && (chosen === "jam" || chosen === "raise") &&
      ctx.facing !== "raiseAllin" && d.cls && d.cls.tier <= 2 &&
      (verdict === "minor" || verdict === "blunder") && advice.primary !== chosen) {
    verdict = "bluff";
    evLoss = 0;          // 読み依存の戦略的選択。caution同様セッション点には響かせない(解説で正直にEV/ICM注意)
    d.bluff = true;
  }

  return { verdict, evLoss, sizing, explanation: (opts && opts.noExplain) ? "" : buildExplanation(ctx, advice, chosen, verdict, sizing) };
}

/* ミスを「漏れ(リーク)カテゴリ」に分類する。学習者個人の弱点傾向を集計するため。
 * chosen は gradeDecision に渡すのと同じ正規化済みID。戻り: {key,label} | null(ミスでなければnull) */
function classifyLeak(ctx, advice, chosen, verdict) {
  if (verdict !== "blunder" && verdict !== "minor") return null;
  const d = advice.data || {};
  const k = d.kind;
  const prim = advice.primary;
  const aggr = chosen === "jam" || chosen === "raise" || chosen === "raiseTo" || chosen === "bet33" || chosen === "bet66" || chosen === "bet";
  if (ctx.phase === "preflop") {
    if (k === "facingJam") {
      if (chosen === "fold" && prim === "call") return { key: "pf_jam_tight", label: "オールインに対し、コールできる手を降りすぎ(タイト)" };
      if ((chosen === "call" || chosen === "jam") && prim === "fold") return { key: "pf_jam_loose", label: "降りるべきオールインにコールしすぎ(ルース)" };
    }
    if (k === "facingOpen") {
      if (chosen === "fold" && prim === "jam") return { key: "pf_open_missjam", label: "リジャム(3ベットオールイン)すべき手を降りている" };
      if (chosen === "call" && prim === "jam") return { key: "pf_open_flat", label: "ジャム推奨の手を、コールで受けてしまう" };
      if (aggr && prim === "fold") return { key: "pf_open_overplay", label: "降りるべき手で3ベット/参加しすぎ" };
    }
    if (k === "openJam" || k === "openRaise") {
      if (chosen === "fold" && (prim === "jam" || prim === "raise")) return { key: "pf_open_tight", label: "オープン(参加)すべき手を降りすぎ(タイト)" };
      if (chosen === "jam" && prim === "raise") return { key: "pf_overjam", label: "レイズで十分な手をオールイン(オーバージャム)" };
      if (chosen === "raise" && prim === "jam") return { key: "pf_underjam", label: "ジャムすべき浅さでミニレイズしている" };
    }
  } else {
    const fr = advice.freqs || {};
    const betFreq = (fr.bet33 || 0) + (fr.bet66 || 0) + (fr.jam || 0);
    if (aggr && (fr.check || 0) > betFreq) return { key: "post_overbet", label: "ポストフロップ: チェック主体の局面で打ちすぎ" };
    if (chosen === "check" && betFreq > (fr.check || 0)) return { key: "post_missvalue", label: "ポストフロップ: ベット主体の局面でチェック(バリュー逃し)" };
    if (chosen === "fold") return { key: "post_overfold", label: "ポストフロップ: 降りすぎ" };
    return { key: "post_other", label: "ポストフロップの判断ミス" };
  }
  return { key: k ? "other_" + k : "other", label: "その他の判断ミス" };
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
  const keys = Object.keys(freqs).filter(k => freqs[k] >= 0.03).sort((a, b) => freqs[b] - freqs[a]);
  if (!keys.length) return "—";
  // ★ポーカーに「100%の正解」は無い★ 単一アクションがほぼ純粋でも、絶対的な「100%」表記は避け「推奨」と書く。
  // (「フォールド100%」と「コール27%(レンジ全体)」が並んで矛盾に見える問題の解消も兼ねる)
  if (keys.length === 1 || freqs[keys[0]] >= 0.97) return `${actionJP(keys[0])}が推奨`;
  return keys.map(k => `${actionJP(k)} ${(freqs[k] * 100).toFixed(0)}%`).join(" / ");
}
// 助言が混合(2択以上が一定頻度)かどうか
function isMixedAdvice(freqs) {
  const vals = Object.values(freqs).filter(v => v >= 0.03);
  return vals.length >= 2 && Math.max.apply(null, Object.values(freqs)) < 0.97;
}

function pct(x) { return (x * 100).toFixed(1) + "%"; }
function pct0(x) { return (x * 100).toFixed(0) + "%"; }
// スタック表示の安全化(0チップ/未設定の劣化ctxで NaN を出さない)
function bb1(x) { return Number.isFinite(+x) ? (+x).toFixed(1) : "—"; }
function bb0(x) { return Number.isFinite(+x) ? (+x).toFixed(0) : "—"; }
// EV計算ボックスを表示してよいか(超浅スタックや非有限値では破綻するので出さない)
function calcSane(c) { return c && Number.isFinite(c.ev) && Number.isFinite(c.S) && c.S >= 2.5; }

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
    evDetail = `まず<b class="sb-ev">チップ(スタック)の観点</b>から見ると、${hl(d.equity)}のエクイティに対しコールのEVは` +
      `<b class="${d.evCallBB>=0?"pos":"neg"}">${d.evCallBB>=0?"+":""}${d.evCallBB.toFixed(2)}BB</b>。チップの最大化だけを考えるなら<b>${evSide}</b>が得です。`;
    icmDetail = `<b class="sb-icm">一方、ICM(賞金)の観点からすると</b>、必要勝率が賞金圧力で<b>${pct(d.breakeven)}→${pct(d.icmReq)}</b>に上がります。` +
      `あなたのエクイティ${pct(d.equity)}は${d.equity>=d.icmReq?"これを上回る":"これに届かない"}ため、賞金(順位)を守る観点では<b>${icmSide}</b>が正解になります。`;
  } else {
    const i = d.icmJamEval;
    evDetail = `まず<b class="sb-ev">チップ(スタック)の観点</b>から見ると、ナッシュ均衡上このハンドは<b>${ft.chipDo?"ジャム圏内":"圏外"}</b>。チップの最大化だけなら<b>${evSide}</b>です。`;
    icmDetail = `<b class="sb-icm">一方、ICM(賞金)の観点からすると</b>、ジャムの賞金期待値<b>${(i.evJam*100).toFixed(2)}%</b> vs フォールド<b>${(i.evFold*100).toFixed(2)}%</b>。` +
      `飛んだ時の順位下落の代償まで含めると、賞金重視なら<b>${icmSide}</b>になります。`;
  }
  const followed = d._ftFollowed;
  const intro = followed
    ? `<b>この局面は「チップの得」と「賞金(ICM)の得」で答えが割れます。</b>あなたは賞金を守る推奨ラインに沿った正しい選択をしました — もう一方の見方も知っておきましょう。`
    : `<b>この局面は「チップの得」と「賞金(ICM)の得」で答えが割れます。</b>だからこれは「ミス」ではなく「注意」です。`;
  const concl = followed
    ? `<b>結論: 正解</b>。あなたの<b>${ft.userDid?ft.agg:ft.pass}</b>は推奨どおりです。チップだけ見れば別の選択も+EVですが、後半戦で順位(賞金)を守るこの判断が基本的に勝ります。`
    : `<b>結論: 注意</b>。あなたの<b>${ft.userDid?ft.agg:ft.pass}</b>は${ft.userDid===ft.chipDo?"チップEV":"ICM"}側に沿った判断で、一理あります。` +
      `どちらを採るかは「次のペイジャンプの近さ」「自分のスキル優位」「相手の傾向」で決めます。一般に、入賞直後やビッグスタック相手はICM寄り(慎重)、賞金がフラットな局面や格下相手はチップEV寄り(積極)が目安です。`;
  return `<div class="split-box">` +
    `<p>${intro}</p>` +
    `<p>${evDetail}</p>` +
    `<p>${icmDetail}</p>` +
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

/* 「ワンペア」のとき、どのホールカードが場の何とペアかを明示する補足だけを返す。
 * (ユーザーが『弱いペアと出るがペアが無い』と混乱したのを解消する目的)
 * ポケットペア/ツーペア/トリップス/ノーペア/ストレート等は cls.label に任せ null を返す
 * — そうしないと「ツーペア — トップペア」「ストレート — ノーペア」のような矛盾表記になるため。 */
function madeHandDesc(ctx) {
  if (!ctx || !ctx.board || ctx.board.length < 3 || !ctx.heroCards || ctx.heroCards.length < 2) return null;
  if (typeof cardText !== "function") return null;
  const R = RANK_CHARS;
  const h = ctx.heroCards.map(c => c >> 2);
  const b = ctx.board.map(c => c >> 2);
  if (h[0] === h[1]) return null;                          // ポケットペアは cls に任せる
  const made = [...new Set(h.filter(hr => b.includes(hr)))];
  if (made.length !== 1) return null;                      // ノーペア/ツーペアは cls に任せる
  const pr = made[0];
  if (b.filter(x => x === pr).length >= 2) return null;     // トリップス(場に2枚)は cls に任せる
  const kicker = h.find(x => x !== pr);
  const pairCard = ctx.heroCards.find(c => (c >> 2) === pr);
  // cls.label が強さ(弱いペア/トップペア等)を既に示すので、ここは「どのカードでペアか」だけ補足
  return `あなたの${cardText(pairCard)}が場の${R[pr]}とペア${kicker != null ? `・${R[kicker]}キッカー` : ""}`;
}

/* ===== 厳密ポーカー理論スニペット(誠実さの憲章: すべて数学的に正しい概念のみ) ===== */

/* ブロッカー/カード除去。AまたはKを持つと相手の最強コンボが減る(向きは厳密)。
 * magnitudeは語らず、エクイティ計算に織り込み済みであることを明記(二重計上の誤解を防ぐ)。 */
function blockerNote(label) {
  if (!label) return "";
  const a = label[0], b = label[1];
  const has = r => a === r || b === r;
  if (has("A")) return "🔑 <b>ブロッカー</b>: あなたが <b>A</b> を持つので、相手の <b>AA・AK</b> のコンボ数が物理的に減ります。相手の最強の継続レンジが薄くなるぶん、押す/受ける判断が有利に働きます。<span class=\"dim\">※この効果は上のエクイティ計算に既に織り込まれています。</span>";
  if (has("K") && !has("A")) return "🔑 <b>ブロッカー</b>: あなたの <b>K</b> が相手の <b>KK・AK</b> の一部を消します。相手の最強コンボが減るぶん、ジャムのフォールドエクイティが上がります。<span class=\"dim\">※エクイティ計算に織り込み済み。</span>";
  return "";
}

/* MDF(最低防御頻度)とα。ベットp(これにbをコール)に対し MDF=p/(p+b)=1−b/(現ポット), α=b/(現ポット)。
 * potBB は相手のベットを含む現在のポット。レンジ全体の指標であり、個別ハンドの可否(エクイティvsオッズ)とは別物。 */
function mdfLine(potBB, toCallBB) {
  if (!(potBB > 0) || !(toCallBB > 0) || toCallBB >= potBB) return "";
  const mdf = 1 - toCallBB / potBB;   // レンジ全体の最低継続頻度
  const alpha = toCallBB / potBB;     // ブラフの必要成功率
  return `<b>MDF(最低防御頻度)— レンジ全体の話:</b> このベットに対し、あなたのレンジ全体で約 <b>${pct0(mdf)}</b> 以上を続けないと、相手は「どんな2枚でも打つ」だけで自動的に得をします(降りすぎ＝搾取)。逆に相手のブラフは <b>${pct0(alpha)}</b> 成功すれば+EV。<span class="dim">※これはレンジ全体の目安。この1手の可否は上の『エクイティ vs ポットオッズ』で決めます(両者は別の話)。</span>`;
}

/* フォールドエクイティ(実数): このベット/レイズで相手のレンジの何%が降りるか。
 * 相手の持ちうるレンジをボード上でコンボ展開し、ベットサイズ別の継続基準でフォールド率を出す。
 * モデル推定(相手は強い手・強ドローで継続、サイズが大きいほど降りる)。厳密GTOではないので「約」表記。 */
function foldEquityPct(ctx, chosen) {
  if (!ctx || !ctx.board || ctx.board.length < 3 || !ctx.oppRange) return null;
  if (typeof rangeToCombos !== "function" || typeof classifyHand !== "function") return null;
  const facingBet = ctx.facing === "bet";
  let combos;
  if (facingBet && typeof filterRangeOnBoard === "function") {
    combos = filterRangeOnBoard(ctx.oppRange, ctx.board, "bet", ctx.heroCards); // 相手のベットレンジ(これにレイズで挑む)
  } else {
    combos = rangeToCombos(ctx.oppRange, (ctx.heroCards || []).concat(ctx.board));
  }
  if (!combos || !combos.length) return null;
  const huge = chosen === "jam" || chosen === "raise";     // オールイン/オーバーベット級
  const big = huge || chosen === "bet66";                  // 2/3ポット級
  let foldW = 0, totW = 0;
  for (const cb of combos) {
    const w = cb.w || 1; totW += w;
    const cls = classifyHand([cb.c1, cb.c2], ctx.board);
    const strongDraw = cls.draws.flushDraw || cls.draws.oesd;
    const anyDraw = strongDraw || cls.draws.gutshot;
    let cont; // 継続(降りない)か
    if (facingBet) cont = cls.tier >= 4 || (cls.tier >= 3 && strongDraw); // レイズには強い手のみ継続
    else if (huge) cont = cls.tier >= 3 || strongDraw;                    // オールイン: 強made/強ドローのみ
    else if (big) cont = cls.tier >= 2 || strongDraw;                     // 2/3ポット
    else cont = cls.tier >= 2 || anyDraw;                                 // 小ベット: 何かあれば継続
    if (!cont) foldW += w;
  }
  return totW > 0 ? foldW / totW : null;
}

/* AA/KKは別格のプレミアム。「○BBでジャム」のような限界ハンド的な書き方をしない。 */
function isPremium(label) { return label === "AA" || label === "KK"; }
const PREMIUM_NOTE = `<span class="dim">この手は<b>AA/KK級のプレミアム</b>=別格。レイズ・3ベット・オールインのどれも正解で、ミニレイズで誘ってからスタックを入れ切るのも有効です。下のレンジ%表記は便宜上のもので、この手は常に積極的に戦います。</span>`;

/* 混合戦略がなぜ存在するか(無差別点)。憲章②の理論的裏付け。 */
const MIX_WHY = `<span class="dim">なぜ混ぜる? — いつも同じ行動だと相手に読まれて搾取されます。EVが互角の無差別点では、あえて両方を一定頻度で選ぶ(サイコロを振る)のが、つけ込ませない打ち方。迷わないのもポーカーです。</span>`;

/* FTの鉄則: バブルファクター(押し引き両面の理論)。 */
const BUBBLE_WHY = `<span class="dim">FTの鉄則: 賞金は逓減するので「失うチップ」＞「得るチップ」の価値(=バブルファクター)。だからコールもジャムも、チップEVだけの時より健全な手に絞るのが基本です。</span>`;

/* 信頼度バッジ(誠実さの憲章の可視化)。
 * 🟢 厳密GTO: オールインの損益が数学的に解けている局面(EQ169ナッシュ/厳密エクイティ)。
 * 🟡 目安   : 相手オープン幅の推定・手書きチャート・ポストフロップ等の近似。状況次第。
 * ⚪ どちらでもよい: 無差別点(EVほぼ互角の混合域)。
 * 嘘をつかない=近似を厳密のように見せない。判定根拠は data.kind と厳密フラグ。 */
function confidenceBadge(d, freqs, verdict, hint) {
  if (!d || !d.kind) return null; // 強制チェック等の非・意思決定はバッジ無し
  const fv = freqs ? Object.values(freqs).filter(v => v > 0) : [];
  const isMix = (fv.length >= 2 && Math.max.apply(null, fv) <= 0.6) || d.icmMix || (!hint && verdict === "mixed");
  if (isMix) return { lv: "either", icon: "⚪", label: "どちらでもよい",
    tip: "ここは無差別点。EVはほぼ互角なので、好みで選んでOK — 迷わないのもポーカーです。" };
  // 厳密に解けているのは「ナッシュのプッシュ/フォールド」と「オールインへの厳密エクイティのコール判断」のみ
  const exact = (d.kind === "openJam" && d.nash) || (d.kind === "facingJam" && d.eqExact);
  if (exact) return { lv: "exact", icon: "🟢", label: "厳密GTO",
    tip: "この局面はオールインの損益が数学的に解けています(ナッシュ均衡/厳密エクイティ)。安心して従ってOK。" };
  // それ以外(オープン幅・3ベット幅・フラットコール・ポストフロップ)はモデル近似
  return { lv: "approx", icon: "🟡", label: "目安",
    tip: "これは近似です(相手の幅推定やポストフロップは厳密には解いていません)。最善手は状況次第 — 根拠を見て判断材料に。" };
}

function buildExplanation(ctx, advice, chosen, verdict, sizing, hint) {
  const d = advice.data;
  const lines = [];
  const hand = ctx.heroLabel;
  const badge = confidenceBadge(d, advice.freqs, verdict, hint);
  if (badge) lines.push(`<div class="conf-badge conf-${badge.lv}"><span class="conf-row"><span class="conf-ico">${badge.icon}</span><b>${badge.label}</b></span><span class="conf-tip">${badge.tip}</span></div>`);
  // hint=決定前の「先生に聞く」モード: 採点的な声かけは出さず、推奨を中立に提示する
  if (!hint && verdict && COACH_VOICE[verdict]) {
    lines.push(`<div class="ex-voice">${pickVar("voice", COACH_VOICE[verdict])}</div>`);
  }
  lines.push(`<div class="ex-head"><b>${hand}</b> @ ${ctx.seatName} ` +
    (ctx.phase === "preflop" ? `(${bb1(ctx.stackBB)}BB)` : `【${streetJP(ctx.street)}】`) + `</div>`);
  // 純粋アクションは freqsText が「○○が推奨」と返すので、hint時の「先生の推奨」は混合時のみ付ける(推奨の二重表記を避ける)
  lines.push(`<div class="ex-gto">GTO戦略: <b>${freqsText(advice.freqs)}</b>` +
    (hint
      ? (isMixedAdvice(advice.freqs) ? ` ／ 主な推奨: <b>${actionJP(advice.primary)}</b>` : ``)
      : ` — あなた: <b>${actionJP(chosen)}</b>`) + `</div>`);

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
        ? `現在 実効<b>${bb1(effS)}BB</b>(あなたは${bb1(ctx.stackBB)}BB持ちですが、後ろの最大スタックがそれだけなので、リスクに晒されるのはこの分だけ)`
        : `現在 <b>${bb1(effS)}BB</b>`;
      lines.push(`<p>ナッシュ均衡(計算済み)では、${ctx.seatName}の ${hand} は${thText}。${stackText}。</p>`);
      if (Number.isFinite(effS) && effS < 2.5 && effS > 0) {
        lines.push(`<p>💡 実効<b>${bb1(effS)}BB</b>は実質オールイン級の浅さ。この深さでは細かいEV計算より「降りずに押す/受ける」が基本です。</p>`);
      }
      if (d.effLimited && effS <= 3) {
        lines.push(`<p>💡 <b>相手のスタックが極端に短い時の鉄則</b>: 実効${bb1(effS)}BBに対してリスクはごく僅か、しかもポットには既に2.5BBのデッドマネー。この状況では<b>ほぼ全ハンドがジャムで+EV</b>です。相手の残りチップを常に確認しましょう。</p>`);
      }
      if (Math.abs(m) <= 0.5) {
        lines.push(`<p>ちょうど境界線上の<b>混合域</b>です。ジャムもフォールドもEVはほぼ同じ — どちらを選んでもミスではありません。${MIX_WHY}</p>`);
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
      // ブロッカー(ジャム圏内のみ。Aを持つと相手の最強コンボが減る)
      if (m > 0) { const bn = blockerNote(hand); if (bn) lines.push(`<p>${bn}</p>`); }
      // FTのICM判定
      if (d._ftSplit && (verdict === "caution" || d._ftFollowed)) {
        lines.push(splitBox(d._ftSplit, d, ctx));   // EVとICMで割れる → 二視点で説明
      } else if (d.icmJamEval) {
        const i = d.icmJamEval;
        const line = `ジャムの賞金期待値 <b>${(i.evJam * 100).toFixed(2)}%</b> vs フォールド <b>${(i.evFold * 100).toFixed(2)}%</b>`;
        lines.push(`<p>🏆 <b>ICM検証(FT)</b>: ${line} — チップEVと賞金EVが同じ方向(${i.evJam >= i.evFold ? "ジャム" : "フォールド"})を指しています。${BUBBLE_WHY}</p>`);
      }
      lines.push(`<p>この${bb1(ctx.stackBB)}BBでの${ctx.seatName}のナッシュ・ジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>:</p>`);
      // 📐 計算方法(超浅・非有限では破綻するので出さない)
      if (calcSane(d.calc)) {
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
      lines.push(`<p>${bb1(ctx.stackBB)}BBの${ctx.seatName}のジャムレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。` +
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
      lines.push(`<p>${ctx.seatName}(${bb0(ctx.stackBB)}BB)のオープンレンジは上位 <b>${d.rangePct.toFixed(1)}%</b>。${hand} は${posNote}。</p>`);
    }
    if (chosen === "jam" && inR) lines.push(`<p>このスタック(${bb0(ctx.stackBB)}BB)ではオールインより2.2BBレイズが標準。強いハンドの価値を最大化し、弱いハンドにフォールドの余地を残せます。</p>`);
    lines.push(rangeGridHTML(d.range, null, hand, "レイズ"));
  }
  else if (d.kind === "facingOpen") {
    const inJam = rangeHas(d.rejamRange, hand);
    const inCall = d.callRange ? rangeHas(d.callRange, hand) : false;
    const openerDesc = d.hu ? "<b>ヘッズアップ</b>のSBオープン(超ワイドレンジ)" : `${d.openerClass}ポジションからのオープン`;
    lines.push(`<p>${openerDesc}に対する有効${bb0(ctx.effBB)}BBの戦略: リジャム上位 <b>${d.rejamPct.toFixed(1)}%</b>` +
      (d.callRange ? ` / コール <b>${d.callPct.toFixed(1)}%</b>` : " / コールなし(ジャムかフォールド)") + `。</p>`);
    if (isPremium(hand)) {
      // AA/KKは「○BBでジャム」「ぎりぎり圏内」のような限界ハンド扱いをしない
      lines.push(`<p>${PREMIUM_NOTE}</p>`);
    } else if (d.nashRejam && d.threshold !== null) {
      const th = d.threshold, m = d.marginBB;
      const thText = th <= 0 ? `${hand} はどの有効スタックでもリジャムしません`
        : th >= 25 ? `${hand} は有効25BB以上でもリジャムできます`
        : `${hand} のリジャムは<b>有効${th.toFixed(1)}BB以下</b>(計算済み均衡)`;
      let nuance = "";
      if (Math.abs(m) <= 0.5) nuance = " — ちょうど境界の混合域です";
      else if (m > 0 && m < 2) nuance = ` — ぎりぎり圏内(余裕${m.toFixed(1)}BB)`;
      else if (m < 0 && m > -2) nuance = ` — 僅かに圏外(あと${(-m).toFixed(1)}BB浅ければジャム)`;
      lines.push(`<p>${thText}。現在 有効<b>${bb1(ctx.effBB)}BB</b>${nuance}。${Math.abs(m) <= 0.5 ? MIX_WHY : ""}</p>`);
      if (Number.isFinite(ctx.effBB) && ctx.effBB < 2.5 && ctx.effBB > 0) {
        lines.push(`<p>💡 実効<b>${bb1(ctx.effBB)}BB</b>は実質オールイン級の浅さ。この深さでは細かいEV計算より「ジャムで受ける/降りる」の二択が基本です。</p>`);
      }
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
      // 相手が降りる割合(フォールドエクイティ)が高いか低いかで説明を変える(committedな短オープナーで矛盾しないように)
      const pCall = d.calc && Number.isFinite(d.calc.pCall) ? d.calc.pCall : null;
      const why = d.hu ? "HUの超ワイドオープンに対しては、ここで踏み込まないとブラインドを取られ続けます。"
        : (pCall != null && pCall > 0.65)
          ? `この深さでは相手は概ねコールしてきますが、${hand}はコールされても十分なエクイティがあり、フォールドする分も合わせて+EVになります。`
          : `相手のオープンレンジの多くはジャムにフォールドするため、フォールドエクイティ(相手が降りる分)＋コールされた時のエクイティの合計で+EVです。`;
      lines.push(`<p>${hand} はリジャムレンジ内です。${why}</p>`);
    } else if (correct === "jam" && chosen === "call") {
      lines.push(`<p>コールよりリジャム推奨です。有効${bb0(ctx.effBB)}BBではポストフロップの技術介入余地が小さく、フォールドエクイティを取れるジャムの方がEVが高くなります。</p>`);
    } else if (correct === "call" && chosen === "fold") {
      lines.push(`<p>必要勝率は約<b>${pct(ctx.toCallBB / (ctx.potBB + ctx.toCallBB))}</b>と安く、${hand} はコールレンジ内。ここを全部降りるとブラインドの搾取に対して無防備になります。</p>`);
    } else if (correct === "call" && chosen === "jam") {
      lines.push(`<p>${hand} はジャムするには弱く、捨てるには強い「コール向き」のハンドです。ジャムだと相手の継続レンジ(上位${d.rejamPct.toFixed(0)}%級)に対して分が悪くなります。</p>`);
    } else if (correct === "fold" && (chosen === "call" || chosen === "jam")) {
      lines.push(`<p>${hand} はリジャムにもコールにも届きません。${ctx.posIdx === POS_BB ? "BBのポットオッズをもってしても継続は-EVです。" : "ポジション外から弱いハンドで参加すると、その後の全ストリートで損をし続けます。"}</p>`);
    }
    if (correct === "jam") { const bn = blockerNote(hand); if (bn) lines.push(`<p>${bn}</p>`); }
    if (correct === "jam" && chosen === "raise" && ctx.effBB >= 18) {
      lines.push(`<p>💡 <b>あなたのノンオールイン3ベットも正解の一つです。</b>本アプリのゲーム木は浅いスタックの標準に合わせて「ジャムかフォールド」に単純化していますが、有効18BB以上の実際のGTOは約3〜3.5倍の小さい3ベットも混ぜます(4ベットジャムされた時の対応計画はセットで)。</p>`);
    }
    // FTのICM判定(両者一致時のみ。割れる場合は上の splitBox で既に説明済み)
    if (d.icmJamEval && !(d._ftSplit && verdict === "caution")) {
      const i = d.icmJamEval;
      const line = `ジャムの賞金期待値 <b>${(i.evJam * 100).toFixed(2)}%</b> vs フォールド <b>${(i.evFold * 100).toFixed(2)}%</b>(プライズプール比)`;
      lines.push(`<p>🏆 <b>ICM検証(FT)</b>: ${line} — チップEVと賞金EVが同じ方向を指しています。${BUBBLE_WHY}</p>`);
    }
    // 📐 計算方法(超浅・非有限では破綻するので出さない)
    if (calcSane(d.calc)) {
      const c = d.calc;
      lines.push(calcBox("📐 リジャムEVの計算方法",
        `<b>基本式:</b><br>` +
        `EV(リジャム) = P(オープナーが降りる) × 今のポット + P(コール) × (勝率 × 最終ポット − リスク)<br><br>` +
        `<b>今回の数字を代入(有効${c.S.toFixed(0)}BB):</b><br>` +
        `① 今のポット = 2.5(ブラインド+アンティ) + 2.2(オープン) = <b>${c.potNow.toFixed(1)}BB</b><br>` +
        `② オープナーがコールするには勝率${pct0(c.openerBE)}が必要 → オープンレンジのうちコールに回るのは約<b>${pct0(c.pCall)}</b>(降りるのは残り${pct0(1 - c.pCall)})<br>` +
        `③ コールされた時の ${hand} の勝率 ≈ <b>${pct0(c.eqVsCall)}</b><br>` +
        `④ EV ≈ ${pct0(1 - c.pCall)}×${c.potNow.toFixed(1)} + ${pct0(c.pCall)}×(${pct0(c.eqVsCall)}×${c.finalPot.toFixed(1)} − ${c.risk.toFixed(1)}) ` +
        `≈ <b class="${c.ev >= 0 ? "pos" : "neg"}">${c.ev >= 0 ? "+" : ""}${c.ev.toFixed(2)}BB</b><br><br>` +
        `<b>🧮 自分で概算するコツ:</b> ` +
        ((1 - c.pCall) >= 0.35
          ? `リジャムの利益の大半は「相手のオープンレンジの${pct0(1 - c.pCall)}が降りて${c.potNow.toFixed(1)}BBをタダ取りする」部分。相手のオープンが広いほど(レイトポジションほど)降ろせる率が上がるので、リジャムレンジも広がります。`
          : `この深さでは相手はほぼ降りません(降りるのは約${pct0(1 - c.pCall)})。利益はフォールドさせて稼ぐのではなく、コールされた時のエクイティ<b>${pct0(c.eqVsCall)}</b>から生まれます。だから浅くて降ろせない時ほど、リジャムには勝率のある手を選ぶのが鍵です。`)));
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
    // 表示する必要勝率は「下の計算で説明される値」に揃える(内部閾値の安全マージン分のズレを見せない):
    //   ICM時=ICM必要勝率 / 多人数で後続補正が出る時=閾値 / それ以外=ポットオッズ(breakeven)
    const thr = icmOn ? d.icmReq : (d.margin > 0.02 ? d.threshold : d.breakeven);
    const eqMargin = d.equity - thr;            // +なら継続、−なら降り
    const callRight = eqMargin >= 0;             // コールが推奨か
    const userCalled = chosen === "call";
    const matched = userCalled === callRight;    // 自分の選択が推奨と一致したか
    const eqs = `勝率<b>${pct(d.equity)}</b> ${callRight ? "≥" : "＜"} 必要<b>${pct(thr)}</b>`;
    let headline;
    if (hint) {
      // 決定前ヒント: 採点ではなく中立に推奨を提示
      headline = callRight
        ? `推奨は<b>コール</b>。${eqs} なので受けるのが+EVです。`
        : `推奨は<b>フォールド</b>。${eqs} なので降りるのが正解です。`;
    } else if (callRight) {
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
      // ★結論連動★ コールが正解の局面で「フォールドせよ」と読める強い文を出さない(逆も同様)
      const icmText = callRight
        ? `賞金圧力(ICM)で必要勝率は <b>${pct(d.breakeven)} → ${pct(d.icmReq)}</b> に上がりますが、この手のエクイティ <b>${pct(d.equity)}</b> はそれを上回ります。だから賞金の観点を踏まえても<b>コールで問題ありません</b>。`
        : `賞金期待値(ICM)から計算すると、必要勝率が <b>${pct(d.breakeven)} → ${pct(d.icmReq)}</b>(+${pct(d.icmPremium)})に上がります。この手のエクイティ <b>${pct(d.equity)}</b> では届かないため、チップ単体なら受けられても、<b>フォールドの選択肢も検討すべき</b>です(飛んだ時に失う賞金が大きいため)。`;
      lines.push(`<p>🏆 <b>ICM補正(ファイナルテーブル)</b>: ${icmText}` +
        `<br><span class="dim">一般則: <b>相手にカバーされている(負ければ飛ぶ)</b>時ほど必要勝率は上がり、<b>自分が相手をカバーしている</b>時は比較的緩く受けられます — FTで最も差がつく感覚です。</span></p>`);
    }
    if (Math.abs(eqMargin) < 0.015) lines.push(`<p>勝率と必要勝率がほぼ同じ<b>無差別点</b>です。${MIX_WHY}</p>`);
    if (callRight) { const bn = blockerNote(hand); if (bn) lines.push(`<p>${bn}</p>`); }
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
      `勝率${pct(d.equity)} ${d.equity >= thr ? "≥" : "＜"} 必要勝率${pct(thr)} → <b>${d.equity >= thr ? "コール" : "フォールド"}</b>${icmOn ? "(ICM補正後)" : ""}<br>` +
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
    const isAggro = chosen === "bet33" || chosen === "bet66" || chosen === "jam" || chosen === "raise";
    const fe = isAggro ? foldEquityPct(ctx, chosen) : null; // このベットで相手の何%が降りるか
    const made = madeHandDesc(ctx);
    // 単一ペア系のラベルのときだけ補足(ツーペア等に付けると矛盾表記になるので除外)
    const showMade = made && /ペア/.test(c.label) && !/ツーペア/.test(c.label);
    lines.push(`<p>あなたのハンド: <b>${c.label}</b>${showMade ? `(${made})` : ""} (強度ティア ${c.tier}/5)<br>` +
      (d.equity !== undefined ? `${d.vsLabel}に対するエクイティ: <b>${pct(d.equity)}</b><br>` : "") +
      (d.breakeven !== undefined ? `必要勝率: <b>${pct(d.breakeven)}</b>` +
        (d.icmPremium > 0.005 ? ` → ICM補正後 <b>${pct(d.icmReq)}</b>(🏆FT賞金圧力)` : "") + `<br>` : "") +
      `SPR(スタック/ポット比): <b>${d.spr.toFixed(1)}</b></p>`);
    if (d.bluff) {
      lines.push(`<div class="bluff-box">` +
        `<p>🃏 <b>これは「狙ったブラフ」</b>。弱い手でのオールイン/オーバーベットで相手を降ろしに行く — 攻めの姿勢はポーカーの正しい武器です。</p>` +
        `<p>正直に言うと、相手の<b>レンジ全体</b>に対してはモデル上このプレイは<b>-EV</b>(GTOはここでチェック/フォールド寄り)。` +
        `ただし<b>「相手は降りる/ナッツは無い」という根拠ある読み</b>があるなら、これは立派な<b>エクスプロイト(搾取)</b> — ポーカーの正解の一つです。</p>` +
        `<p>鍵は<b>フォールドエクイティ</b>: ` +
        (fe != null
          ? `相手の持ちうるレンジに対し、このプレイで<b>約${pct0(fe)}が降りる</b>と推定されます(モデル推定)。${fe >= 0.5 ? "半分以上を降ろせるなら、ブラフは十分に機能します。" : fe >= 0.3 ? "そこそこ降ろせます。あとはコールされた時の負けと天秤にかけて。" : "降ろせる率は低め — この相手/ボードではブラフは通りにくいかもしれません。"}`
          : `相手が降りうる場面でこそ機能します。`) +
        `降りない相手(コールステーション/コミット済み)には通りません。外れた時の代償(下のEV)も込みで選びましょう。</p>` +
        `</div>`);
    } else {
      lines.push(`<p>${postflopReason(ctx, advice, chosen)}</p>`);
    }
    // 📐 計算方法
    let calcParts = [];
    if (fe != null) {
      calcParts.push(
        `<b>🛡️ フォールドエクイティ(このベットで何%降ろせるか):</b><br>` +
        `相手の持ちうるレンジをこのボードで展開し、${chosen === "jam" || chosen === "raise" ? "オールイン/レイズ" : chosen === "bet66" ? "2/3ポット" : "小さめ"}に対して降りる割合を推定 ≈ <b>約${pct0(fe)}</b>。<br>` +
        `<span class="dim">ブラフの損益 ≒ (降ろせる率 × 今のポット) −(降ろせない率 × コールされて負ける額)。` +
        `<b>ベットが大きいほど降ろせる率は上がる</b>が、外れた時の代償も増える。だから「相手が降りやすいボード/相手」を選ぶのが肝心。</span>`);
    }
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
    if (ctx.facing === "bet") { const ml = mdfLine(ctx.potBB, ctx.toCallBB); if (ml) calcParts.push(ml); }
    if (d.outs > 0 && ctx.street !== "river" && d.breakeven !== undefined && d.equity !== undefined && d.equity < d.breakeven) {
      calcParts.push(`<b>💧 インプライド/リバースインプライドオッズ:</b> 生のポットオッズには僅かに届きませんが、完成した時に相手から<b>追加で取れる</b>チップ(インプライドオッズ)を見込めるなら、コールが正当化される場合があります。逆に、完成しても払ってもらえない・完成しても二番手で大きく負ける手は『リバースインプライド』として割り引いて考えます。`);
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
    // ★解説は必ず推奨(primary)と一致させる★ ベット推奨ならベットの理由、チェック推奨ならチェックの理由。
    const isBet = primary === "bet33" || primary === "bet66" || primary === "jam";
    const river = ctx.street === "river";
    // ボード性質の語を正確に(d.dryBoardは strategy と共有。非ドライ時はペア/モノトーンを区別)
    let boardWord = "ウェット(動的)な";
    if (ctx.board && ctx.board.length >= 3) {
      const branks = ctx.board.map(x => x >> 2), bsuits = ctx.board.map(x => x & 3);
      const sc = [0, 0, 0, 0]; bsuits.forEach(s => sc[s]++);
      const paired = new Set(branks).size < branks.length;
      const mono = Math.max(sc[0], sc[1], sc[2], sc[3]) >= 3;
      boardWord = d.dryBoard ? "ドライ(静的)な" : paired ? "ペア(静的)な" : mono ? "モノトーン(超ウェット)な" : "ウェット(動的)な";
    } else if (d.dryBoard) boardWord = "ドライ(静的)な";
    const liveDraw = (c.draws.flushDraw || c.draws.oesd) && !river; // リバーにドローは無い
    if (!isBet) {
      // 推奨=チェック
      if (t >= 5) return "モンスターですが、ここは<b>チェック</b>を選ぶ頻度です(相手のブラフを誘う/後のストリートで安全に価値を取る)。常に最大ベットが正解ではありません。";
      if (liveDraw) return "強いドローですが、ここは<b>チェック</b>に回す頻度。毎回打つと読まれるので、チェックして無料でカードを見たり、相手に打たせてレイズで戦う枝を混ぜます。";
      if (t === 3) return `中程度の強さ。${boardWord}ボードでは無理にポットを膨らませず、<b>チェック</b>で安いショーダウンを目指すのが基本です。`;
      return `エクイティの薄い手は、${boardWord}ボードでも<b>チェック</b>が基本。勝てない手で打ち続けるのは浅いスタックでは特に損(ブラフは相手が降りて初めて利益が出る)。`;
    }
    // 推奨=ベット
    if (t >= 4) return `強い役は${boardWord}ボードで<b>ベット</b>してバリューを取りつつ、相手にフリーカードを与えない(=相手の<b>エクイティ実現を拒否</b>する「プロテクション」)。浅いSPRではポットを膨らませ、スタックを入れ切る設計が重要です。`;
    if (liveDraw) return "強いドローの<b>セミブラフ</b>です。降ろせれば即利益、コールされても完成すれば大きく勝てる二重の勝ち筋があります。";
    if (t === 3) return "中程度の強さは小さめの<b>ベット</b>とチェックの混合。薄く価値を取りつつ、相手のフロートに大きなポットを与えません。";
    if (ctx.street === "flop" && d.dryBoard && ctx.role === "pfr") return "ドライなボードはプリフロップレイザーのレンジが有利。小さいサイズで高頻度に打つ<b>レンジベット</b>が機能します。";
    if (river) return "リバーの<b>ブラフ</b>は、相手の中途半端な手を降ろす目的。バランスのため一定頻度で打ちますが、降ろせる相手か見極めが必要です。";
    if (ctx.street === "turn") return "<b>2ndバレル(ターンの継続ベット)</b>です。フロップで主導権を取った側が、相手の弱いレンジにプレッシャーを掛け続けます。打ちすぎは禁物。";
    return "エア〜弱い手も、レンジのバランスのため一定頻度で<b>ブラフ</b>に回します(相手に降りてもらって利益を得る)。打ちすぎは禁物です。";
  }
  if (ctx.facing === "bet") {
    if (t >= 5) return "モンスターは浅いSPRなら<b>レイズ(オールイン)</b>でバリュー最大化。深ければコールで相手のブラフを泳がせる選択もあります。";
    if (d.equity !== undefined && d.breakeven !== undefined) {
      return d.equity >= d.threshold
        ? "エクイティが必要勝率を上回るため<b>継続</b>が得になります。"
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
