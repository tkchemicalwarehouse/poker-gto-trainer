/* 敵対的プレイ・テスター(20例バッテリー)
 * 「私(Claude)」が多数のスポットでわざと変則的なプレイをし、コーチの採点反応を検証する。
 * 各ケースに expect(本来あるべき判定の範囲)を付け、ズレを ★MISMATCH として報告。
 * 実行: node tools/adversarial-play.cjs
 */
const fs = require("fs");
const path = require("path");
const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
let src = ["engine.js","data-equity.js","data-nash.js","data-rejam.js","icm.js","ranges.js","strategy.js","poker.js","coach.js"].map(load).join("\n;\n");
src += `\n;global.__T={preflopAdvice,postflopAdvice,gradeDecision,combosOfLabel,parseRange,POSITIONS,nashRangeAt,makeCard,cardText,Icm};`;
const c = path.join(__dirname,"_adv_combined.cjs"); fs.writeFileSync(c, src); require(c);
const T = global.__T;
const mk = l => T.combosOfLabel(l)[0];
const C = (r,s)=>T.makeCard(r,s); // r:0-12(2..A) s:0-3(s,h,d,c)
const strip = h => (h||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const BB = 4000;

// ---- ctxビルダー ----
function fi(label, posIdx, stackBB, opts) {
  return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx, stackBB, effBB: stackBB,
    effJamBB: stackBB, defendersN: 8 - posIdx, tableN: 9, facing:"none", potBB:2.5, toCallBB:1, fast:true,
    seatName: T.POSITIONS[posIdx], phase:"preflop" }, opts||{});
}
function fo(label, openerClass, effBB, posIdx, opts) {
  return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx, stackBB: effBB, effBB, tableN: 9,
    facing:"open", openerClass, openSizeBB:2.2, potBB:4.7, toCallBB: posIdx===8?1.2:2.2, fast:true,
    seatName: T.POSITIONS[posIdx], phase:"preflop" }, opts||{});
}
function fj(label, jammerPos, jamBB, opts) {
  return Object.assign({ heroCards: mk(label), heroLabel: label, posIdx:8, stackBB:25, effBB: jamBB, tableN:9,
    facing:"jam", jamRange: T.nashRangeAt(jammerPos, jamBB), jamCount:1, playersBehind:0,
    potBB: jamBB+2.5, toCallBB: jamBB-1, fast:true, seatName:"BB", phase:"preflop" }, opts||{});
}
function pf(cards, board, opts) { // postflop
  return Object.assign({ heroCards: cards, heroLabel: T.cardText(cards[0])+T.cardText(cards[1]),
    board, street: opts && opts.street || "flop", potBB:6, toCallBB:0, heroBehindBB:18, effBehindBB:18,
    role:"pfr", oppRange: T.parseRange("22+,A2s+,ATo+,KTs+,KQo,QTs+"), facing:"none", playersIn:2,
    canRaise:true, fast:true, posIdx:5, seatName:"CO", phase:"postflop",
    prevAggressorSeat:0, iWasPrevAggressor:true, aggressorActive:true }, opts||{});
}

// 各テスト: {n, desc, ctx, act:{id,target}, expect:fn(verdict,g)->bool, why}
const TESTS = [
  // ── プリフロップ: サイズ ──
  { n:1, desc:"AA UTG25BB を最小2BBオープン(2x)", ctx:fi("AA",0,25), act:{id:"raise",target:8000},
    expect:v=>v==="best", why:"2x開きはMTT標準=OK" },
  { n:2, desc:"AKo HJ25BB を6BBオープン(過大)", ctx:fi("AKo",4,25), act:{id:"raiseTo",target:24000},
    expect:(v,g)=>v==="minor"&&g.sizing, why:"過大サイズ指摘されるべき" },
  // ── プリフロップ: アクション選択 ──
  { n:3, desc:"AKs CO12BB をフォールド(プレミアム放棄)", ctx:fi("AKs",5,12), act:{id:"fold"},
    expect:v=>v==="blunder", why:"12BB AKsフォールドは大ミス" },
  { n:4, desc:"K2o UTG10BB をオールイン(ジャンク)", ctx:fi("K2o",0,10), act:{id:"jam",target:100000},
    expect:v=>v==="blunder"||v==="minor", why:"UTG10BB K2oジャムは範囲外寄り" },
  { n:5, desc:"77 BB vs BTN12BBジャム をコール", ctx:fj("77",6,12), act:{id:"call"},
    expect:v=>v==="best"||v==="mixed", why:"77はBTN12BBジャムにコール圏内" },
  { n:6, desc:"K8o BB vs UTG10BBジャム をコール(緩い)", ctx:fj("K8o",0,10), act:{id:"call"},
    expect:v=>v==="blunder"||v==="minor", why:"UTGタイトジャムにK8oコールは緩すぎ" },
  { n:7, desc:"QJs BTN20BB vs COオープン をコールドコール", ctx:fo("QJs","LP",20,6), act:{id:"call"},
    expect:(v)=>true, why:"コール選択肢の扱い(参考)" },
  { n:8, desc:"AA BB vs LP20BBオープン をフォールド", ctx:fo("AA","LP",20,8), act:{id:"fold"},
    expect:v=>v==="blunder", why:"AAをフォールドは最悪" },
  { n:9, desc:"32o SB25BB vs BB残り1BB をフォールド", ctx:fi("32o",7,25,{effJamBB:1,defendersN:1}), act:{id:"fold"},
    expect:v=>v==="blunder"||v==="minor", why:"実効1BBは全ハンドジャム、フォールドはミス" },
  { n:10, desc:"AA UTG6BB をフォールド(超ショート)", ctx:fi("AA",0,6), act:{id:"fold"},
    expect:v=>v==="blunder", why:"6BB AAフォールドは論外" },

  // ── ポストフロップ ──
  // 11. コーラーがドンクベット(チェック・トゥ・ザ・レイザー違反)
  { n:11, desc:"コーラーがフロップでドンクベット(A94r、KQ)",
    ctx:pf([C(11,1),C(10,2)], [C(12,1),C(7,2),C(2,3)], {role:"caller", iWasPrevAggressor:false, prevAggressorSeat:3, posIdx:8, seatName:"BB", facing:"none"}),
    act:{id:"bet66",target:4000}, expect:v=>v==="minor"||v==="blunder"||v==="mixed", why:"ドンクは原則非推奨" },
  // 12. PFRがドライボードでトップセットをスロープレイ(チェック)
  { n:12, desc:"PFRがA94rでトップセットをチェック(スロープレイ)",
    ctx:pf([C(12,0),C(12,3)], [C(12,1),C(7,2),C(2,3)], {role:"pfr"}),
    act:{id:"check"}, expect:(v)=>true, why:"高EVハンドのチェック頻度(参考)" },
  // 13. リバーでエアをオールイン(オーバーベットブラフ)
  { n:13, desc:"リバーでエア(72o)をポット越えオールイン",
    ctx:pf([C(5,0),C(0,1)], [C(12,1),C(9,2),C(4,3),C(6,0),C(11,2)], {street:"river", role:"pfr", potBB:8, effBehindBB:20}),
    act:{id:"jam",target:80000}, expect:(v)=>true, why:"純ブラフ頻度(参考)" },
  // 14. トップセットをフロップのベットにフォールド(大ミス)
  { n:14, desc:"99(セット)をA94rのベットにフォールド",
    ctx:pf([C(7,0),C(7,1)], [C(12,1),C(7,2),C(2,3)], {role:"caller", iWasPrevAggressor:false, prevAggressorSeat:3, posIdx:8, seatName:"BB", facing:"bet", toCallBB:4, potBB:8, canRaise:true}),
    act:{id:"fold"}, expect:v=>v==="blunder", why:"セットフォールドは大ミス" },
  // 15. ナッツフラッシュドローを好オッズのベットにフォールド
  { n:15, desc:"ナッツFD(A♠K♠)をフロップ小ベットにフォールド",
    ctx:pf([C(12,0),C(11,0)], [C(7,0),C(4,0),C(2,3)], {role:"caller", iWasPrevAggressor:false, prevAggressorSeat:3, posIdx:8, seatName:"BB", facing:"bet", toCallBB:2, potBB:8, canRaise:true}),
    act:{id:"fold"}, expect:v=>v==="minor"||v==="blunder", why:"オーバーカード+ナッツFDで好オッズ、フォールドは損" },
  // 16. ボードペアのみのエアでリバー大ベットにコール(ヒーローコール失敗)
  { n:16, desc:"ボードペアのみ(QJ)でリバーのオールインにコール",
    ctx:pf([C(10,0),C(9,1)], [C(12,1),C(7,2),C(2,3),C(5,0),C(12,2)], {street:"river", role:"caller", iWasPrevAggressor:false, prevAggressorSeat:3, posIdx:8, seatName:"BB", facing:"raiseAllin", toCallBB:12, potBB:14, oppRange:T.parseRange("AA,KK,AQs,AQo,AKs,AKo,A2s")}),
    act:{id:"call"}, expect:v=>v==="blunder"||v==="minor", why:"勝てないコールは損" },
  // 17. トップセットをチェック(ターン、SPR低)
  { n:17, desc:"セットをターンでチェック(SPR低・バリュー逃し)",
    ctx:pf([C(7,0),C(7,1)], [C(12,1),C(7,2),C(2,3),C(9,0)], {street:"turn", role:"pfr", potBB:12, effBehindBB:14}),
    act:{id:"check"}, expect:(v)=>true, why:"バリュー逃しの扱い(参考)" },
  // 18. ドライボードでC100%ベット(オーバーサイズ)
  { n:18, desc:"A94rでポット100%C-bet(過大サイズ)",
    ctx:pf([C(12,0),C(11,2)], [C(12,1),C(9,2),C(4,3)], {role:"pfr", potBB:6}),
    act:{id:"bet66",target:24000}, expect:(v,g)=>true, why:"オーバーベット検出(参考)" },
  // 19. モンスター(フルハウス)をリバーでチェック
  { n:19, desc:"フルハウスをリバーでチェック(バリュー逃し)",
    ctx:pf([C(12,0),C(12,3)], [C(12,1),C(7,2),C(7,3),C(2,0),C(5,1)], {street:"river", role:"pfr", potBB:10, effBehindBB:15}),
    act:{id:"check"}, expect:(v)=>true, why:"バリュー逃し(参考)" },
  // 20. エアでフロップのベットにレイズ(ブラフレイズ)
  { n:20, desc:"エア(72o)でフロップのベットにオールイン(ブラフレイズ)",
    ctx:pf([C(5,0),C(0,1)], [C(12,1),C(9,2),C(4,3)], {role:"caller", iWasPrevAggressor:false, prevAggressorSeat:3, posIdx:8, seatName:"BB", facing:"bet", toCallBB:3, potBB:8, canRaise:true}),
    act:{id:"jam",target:80000}, expect:(v)=>true, why:"ブラフレイズ頻度(参考)" },

  // ── 攻めた追加(マルチウェイ/特殊ボード/3ベットポット/バレル) ──
  // 21. マルチウェイでエアをC-bet(3人ポット)
  { n:21, desc:"3人ポットでエア(QJ)をフロップC-bet",
    ctx:pf([C(10,0),C(9,1)], [C(12,1),C(7,2),C(2,3)], {role:"pfr", playersIn:3, potBB:9}),
    act:{id:"bet66",target:6000}, expect:(v)=>v!=="best", why:"マルチウェイのエアCBはブラフ頻度低" },
  // 22. モノトーンボードでトップペア(フラッシュなし)をオールイン
  { n:22, desc:"モノトーン♠ボードでトップペア(A♥K♦)をオーバーベット",
    ctx:pf([C(12,1),C(11,2)], [C(12,0),C(7,0),C(2,0)], {role:"pfr", potBB:6, effBehindBB:18}),
    act:{id:"jam",target:80000}, expect:(v)=>true, why:"モノトーンでのコミット(参考)" },
  // 23. ペアボードでエアをブラフ(セットの可能性)
  { n:23, desc:"ペアボード(K K 4)でエア(76o)をC-bet",
    ctx:pf([C(5,0),C(4,1)], [C(11,0),C(11,1),C(2,2)], {role:"pfr", potBB:6}),
    act:{id:"bet33",target:2000}, expect:(v)=>true, why:"ペアボードのレンジベット(参考)" },
  // 24. オーバーペアをウェットボードのレイズにフォールド(過弱)
  { n:24, desc:"オーバーペア(QQ)をJT9のレイズにフォールド",
    ctx:pf([C(10,0),C(10,3)], [C(9,1),C(8,2),C(7,0)], {role:"pfr", facing:"raiseAllin", toCallBB:10, potBB:12, effBehindBB:10, oppRange:T.parseRange("JT,T9,98,QQ,99,88,77,J9s,KQs")}),
    act:{id:"fold"}, expect:(v)=>true, why:"ウェットボードのオーバーペア対オールイン(参考)" },
  // 25. ナッツ(ストレート)をスロープレイ(チェック)
  { n:25, desc:"ナッツストレート(QT)をJ98ボードでチェック",
    ctx:pf([C(10,0),C(8,1)], [C(9,1),C(7,2),C(6,0)], {role:"pfr", potBB:8, effBehindBB:16}),
    act:{id:"check"}, expect:(v)=>v!=="blunder", why:"ナッツのスロープレイは致命傷でない" },
  // 26. BvB: SB完全フォールド網からのBBチェック(option)
  { n:26, desc:"BBでウォーク(全員フォールド)時のチェック",
    ctx:fi("72o",8,20,{facing:"none"}), act:{id:"check"}, expect:(v)=>v==="best", why:"ウォークのチェックは当然" },
  // 27. ターンバレル: フロップC-bet後ターンもエアでバレル
  { n:27, desc:"ターンでエア(76o)を2バレル(リバー一歩手前)",
    ctx:pf([C(5,0),C(4,1)], [C(12,1),C(9,2),C(2,3),C(5,2)], {street:"turn", role:"pfr", potBB:12, effBehindBB:20}),
    act:{id:"bet66",target:8000}, expect:(v)=>true, why:"ターンバレル頻度(参考)" },
  // 28. リバーで完成しなかったドローをブラフ(本来のセミブラフの続き)
  { n:28, desc:"フラッシュ逃し(9♠8♠)をリバーでブラフオールイン",
    ctx:pf([C(7,0),C(6,0)], [C(12,1),C(11,0),C(2,0),C(4,2),C(3,3)], {street:"river", role:"pfr", potBB:14, effBehindBB:18}),
    act:{id:"jam",target:72000}, expect:(v)=>true, why:"ブラフ完遂頻度(参考)" },
  // 29. セットをモノトーンボードで遅延(危険)
  { n:29, desc:"セット(99)をモノトーン♦ボードでチェック",
    ctx:pf([C(7,0),C(7,1)], [C(12,2),C(7,2),C(2,2)], {role:"pfr", potBB:6, effBehindBB:18}),
    act:{id:"check"}, expect:(v)=>v!=="best", why:"危険ボードでのセット遅延は推奨されにくい" },
  // 30. 深い30BBでのリンプ的ミニ3ベット
  { n:30, desc:"AKs BB vs LP25BBオープンを最小3ベット(raiseTo小)",
    ctx:fo("AKs","LP",25,8), act:{id:"raiseTo",target:24000}, expect:(v)=>true, why:"25BB 3ベットサイズ(参考)" },
];

function gradeId(ctx, act) {
  if (act.id==="raiseTo") return (act.target >= ctx.stackBB*BB - BB) ? "jam" : (ctx.phase==="preflop"?"raise":"bet66");
  return act.id;
}

(async () => {
  console.log("=== 敵対的プレイ 20例テスト ===\n");
  let mismatch = 0;
  for (const t of TESTS) {
    const a = ctx_phase(t.ctx) ? await T.preflopAdvice(t.ctx) : await T.postflopAdvice(t.ctx);
    const g = T.gradeDecision(t.ctx, a, gradeId(t.ctx, t.act), t.act);
    const ok = t.expect(g.verdict, g);
    const flag = ok ? "  " : "★MISMATCH";
    console.log(`${flag} #${t.n} ${t.desc}`);
    console.log(`      GTO primary=${a.primary} | あなた=${t.act.id} → 判定:${g.verdict}${g.sizing?"(サイズ指摘)":""} EV損${g.evLoss}`);
    if (!ok) { mismatch++; console.log(`      期待: ${t.why}`); }
    // 参考ケースは解説の主要文を1行表示
    const snip = strip(g.explanation).replace(/.*あなた: [^ ]+/,"").slice(0,110);
    console.log(`      解説: ${snip}…`);
    console.log("");
  }
  console.log(`=== 完了: ${TESTS.length}例中 ★MISMATCH ${mismatch}件 ===`);
})().catch(e=>{console.error(e);process.exitCode=1;});

function ctx_phase(ctx){ return ctx.phase === "preflop"; }
