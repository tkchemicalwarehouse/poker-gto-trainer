/* ---- 黄金スポット本体(golden.cjsが連結して実行) ---- */
const mkc = l => combosOfLabel(l)[0];
function mkCard(r, s) { return makeCard(r, s); }

// プリフロップ・ファーストインのctx
function fi(label, posIdx, stackBB, opts) {
  return Object.assign({
    heroCards: mkc(label), heroLabel: label, posIdx, stackBB, effBB: stackBB,
    effJamBB: stackBB, defendersN: 8 - posIdx, tableN: 9,
    facing: "none", potBB: 2.5, toCallBB: 1, fast: true,
    seatName: POSITIONS[posIdx], phase: "preflop",
  }, opts || {});
}
// ジャムに直面するctx
function fj(label, jammerPos, jamBB, opts) {
  return Object.assign({
    heroCards: mkc(label), heroLabel: label, posIdx: 8, stackBB: 20, effBB: jamBB, tableN: 9,
    facing: "jam", jamRange: nashRangeAt(jammerPos, jamBB), jamCount: 1, playersBehind: 0,
    potBB: jamBB + 2.5, toCallBB: jamBB - 1, fast: true, seatName: "BB", phase: "preflop",
  }, opts || {});
}
// オープンに直面するctx
function fo(label, openerClass, effBB, posIdx, opts) {
  return Object.assign({
    heroCards: mkc(label), heroLabel: label, posIdx, stackBB: effBB, effBB, tableN: 9,
    facing: "open", openerClass, openSizeBB: 2.2,
    potBB: 4.7, toCallBB: posIdx === 8 ? 1.2 : 2.2, fast: true,
    seatName: POSITIONS[posIdx], phase: "preflop",
  }, opts || {});
}

const SPOTS = [
  /* ===== ファーストイン(ナッシュ・プッシュ/フォールド) ===== */
  { name: "UTG10BB AAはジャム", ctx: fi("AA", 0, 10), want: a => a.primary === "jam" },
  { name: "UTG10BB AQsはジャム", ctx: fi("AQs", 0, 10), want: a => a.primary === "jam" },
  { name: "UTG10BB TTはジャム", ctx: fi("TT", 0, 10), want: a => a.primary === "jam" },
  { name: "UTG10BB 72oはフォールド", ctx: fi("72o", 0, 10), want: a => a.primary === "fold" },
  { name: "UTG10BB J6oはフォールド", ctx: fi("J6o", 0, 10), want: a => a.primary === "fold" },
  { name: "UTG6BB A9oはジャム", ctx: fi("A9o", 0, 6), want: a => a.primary === "jam" },
  { name: "BTN10BB A7oはジャム", ctx: fi("A7o", 6, 10), want: a => a.primary === "jam" },
  { name: "BTN10BB K9sはジャム", ctx: fi("K9s", 6, 10), want: a => a.primary === "jam" },
  { name: "BTN10BB 66はジャム", ctx: fi("66", 6, 10), want: a => a.primary === "jam" },
  { name: "BTN10BB 72oはフォールド", ctx: fi("72o", 6, 10), want: a => a.primary === "fold" },
  { name: "SB8BB K2oはジャム", ctx: fi("K2o", 7, 8, { defendersN: 1 }), want: a => a.primary === "jam" },
  { name: "SB8BB A2oはジャム", ctx: fi("A2o", 7, 8, { defendersN: 1 }), want: a => a.primary === "jam" },
  { name: "SB8BB 32oはフォールド", ctx: fi("32o", 7, 8, { defendersN: 1 }), want: a => a.primary === "fold" },

  /* ===== 実効スタックルール(報告由来の回帰) ===== */
  { name: "SB25BB vs BB残り1BB: J5oは100%ジャム", ctx: fi("J5o", 7, 25, { effJamBB: 1, defendersN: 1 }),
    want: a => a.primary === "jam" && a.data.rangePct > 95 },
  { name: "SB25BB vs BB残り1BB: 72oもジャム", ctx: fi("72o", 7, 25, { effJamBB: 1, defendersN: 1 }),
    want: a => a.primary === "jam" },
  { name: "同じJ5oでもBBが20BBならフォールド系", ctx: fi("J5o", 7, 25, { effJamBB: 20, defendersN: 1 }),
    want: a => a.primary !== "jam" },

  /* ===== ヘッズアップ ===== */
  { name: "HU SB12BB A2oはジャム", ctx: fi("A2o", 7, 12, { tableN: 2, defendersN: 1 }), want: a => a.primary === "jam" },
  { name: "HU SB12BB 22はジャム", ctx: fi("22", 7, 12, { tableN: 2, defendersN: 1 }), want: a => a.primary === "jam" },
  { name: "HU SB12BB 32oはフォールド", ctx: fi("32o", 7, 12, { tableN: 2, defendersN: 1 }), want: a => a.primary === "fold" },
  { name: "HU BB K7o vs SBオープンはフォールドしない", ctx: fo("K7o", "SB", 20, 8, { tableN: 2 }),
    want: a => a.primary !== "fold" },

  /* ===== オールインへのコール(厳密エクイティ) ===== */
  { name: "BB AA vs BTN10BBジャム: コール", ctx: fj("AA", 6, 10), want: a => a.primary === "call" },
  { name: "BB 72o vs BTN10BBジャム: フォールド", ctx: fj("72o", 6, 10), want: a => a.primary === "fold" },
  { name: "BB A9s vs BTN8BBジャム: コール", ctx: fj("A9s", 6, 8), want: a => a.primary === "call" },
  { name: "BB K4o vs UTG10BBジャム: フォールド", ctx: fj("K4o", 0, 10), want: a => a.primary === "fold" },
  { name: "BB AKs vs UTG10BBジャム: コール", ctx: fj("AKs", 0, 10), want: a => a.primary === "call" },

  /* ===== リジャム(vs オープン) ===== */
  { name: "CO AKo vs EPオープン(有効10BB): ジャム", ctx: fo("AKo", "EP", 10, 5), want: a => a.primary === "jam" },
  { name: "BB AA vs LPオープン(有効20BB): ジャム", ctx: fo("AA", "LP", 20, 8), want: a => a.primary === "jam" },
  { name: "BB 72o vs LPオープン(有効15BB): フォールド", ctx: fo("72o", "LP", 15, 8), want: a => a.primary === "fold" },
  { name: "BTN 76s vs EPオープン(有効15BB): フォールド", ctx: fo("76s", "EP", 15, 6), want: a => a.primary === "fold" },

  /* ===== ICM(報告由来の回帰: FT全員入賞=バストでも最下位賞金) ===== */
  { name: "FT: AKo 10.5BB vs EPオープンはジャム(ICM後も)", ctx: (() => {
      const stacks = [42000, 80000, 60000, 90000, 50000, 70000, 55000, 65000, 45000];
      return fo("AKo", "EP", 10.5, 5, { stackBB: 10.5, defendersN: 4,
        icmJam: { stacks, heroI: 0, villI: 1, potChips: 18800, toCallChips: 0, payouts: Icm.payoutsFor(27, 9), bbChips: 4000 } });
    })(), want: a => a.primary === "jam" },
  // EVとICMが割れたら「注意」(ミスでない)。KQo 30BB vs CO15BBジャム@FT5人
  { name: "EVとICMが割れる場面はミスでなく注意", ctx: {
      heroCards: combosOfLabel("KQo")[0], heroLabel: "KQo", posIdx: 8, stackBB: 30, effBB: 15, tableN: 5,
      facing: "jam", jamRange: nashRangeAt(5, 15), jamCount: 1, playersBehind: 0,
      potBB: 17.5, toCallBB: 14, fast: true, seatName: "BB", phase: "preflop",
      icm: { stacks: [120000, 140000, 60000, 90000, 40000], heroI: 0, villI: 1, potChips: 70000, toCallChips: 56000, payouts: Icm.payoutsFor(18, 5) },
    }, gradeAct: ["call", { id: "call" }, g => g.verdict === "caution"] },
  { name: "割れる場面で推奨どおりフォールドは正解(叱らない)", ctx: {
      heroCards: combosOfLabel("KQo")[0], heroLabel: "KQo", posIdx: 8, stackBB: 30, effBB: 15, tableN: 5,
      facing: "jam", jamRange: nashRangeAt(5, 15), jamCount: 1, playersBehind: 0,
      potBB: 17.5, toCallBB: 14, fast: true, seatName: "BB", phase: "preflop",
      icm: { stacks: [120000, 140000, 60000, 90000, 40000], heroI: 0, villI: 1, potChips: 70000, toCallChips: 56000, payouts: Icm.payoutsFor(18, 5) },
    }, gradeAct: ["fold", { id: "fold" }, g => g.verdict === "best"] },
  { name: "ICM: バスト者は最下位賞金を保証", ctx: null, want: () => {
      const ev = Icm.icmEVs([0, 100000, 50000], [0.5, 0.3, 0.2]);
      return Math.abs(ev[0] - 0.2) < 0.001 && Math.abs(ev[0] + ev[1] + ev[2] - 1.0) < 0.001;
    } },

  /* ===== セルフプレイ監査由来の回帰(計算グリッド端の混合バグ) ===== */
  { name: "KK 24.8BB vs EPオープン(IP)は混合でなく100%ジャム", ctx: fo("KK", "EP", 24.8, 5),
    want: a => a.primary === "jam" && a.freqs.jam >= 0.99 },
  { name: "32o UTG 実効2.0BBは100%ジャム(グリッド下限)", ctx: fi("32o", 0, 25, { effJamBB: 2, defendersN: 8 }),
    want: a => a.primary === "jam" && a.freqs.jam >= 0.99 },
  { name: "62o SB 実効2.0BBはジャム(margin+0.5は混合でない)", ctx: fi("62o", 7, 25, { effJamBB: 2, defendersN: 1 }),
    want: a => a.primary === "jam" },
  { name: "FT 74o BTN 実効1.8BBはジャム(超浅はICM補正しない)", ctx: (() => {
      const stacks = [7000, 30000, 40000, 25000, 50000, 35000, 28000, 33000, 45000];
      return fi("74o", 6, 1.8, { effJamBB: 1.8, defendersN: 2,
        icmJam: { stacks, heroI: 0, villI: 4, potChips: 10000, toCallChips: 0, payouts: Icm.payoutsFor(18, 9), bbChips: 4000 } });
    })(), want: a => a.primary === "jam" },

  /* ===== 採点の特例 ===== */
  { name: "有効20BBでジャム推奨ハンドの3ベットは混合OK", ctx: fo("AQs", "LP", 20, 8), grade: ["raise", g => g.verdict === "mixed"] },
  // ベットサイズ採点(ユーザー指摘: 4BBオープンでもOKと出ていた)
  { name: "KQs UTG+2 を4BBオープンはサイズ指摘で格下げ", ctx: fi("KQs", 2, 25),
    gradeAct: ["raise", { id: "raiseTo", target: 16000 }, g => g.verdict === "minor" && g.sizing] },
  { name: "KQs UTG+2 を2.2BB標準オープンはbest", ctx: fi("KQs", 2, 25),
    gradeAct: ["raise", { id: "raise", target: 8800 }, g => g.verdict === "best" && !g.sizing] },
  { name: "AA BTN を10BB過大オープンはサイズ指摘", ctx: fi("AA", 6, 25),
    gradeAct: ["raise", { id: "raiseTo", target: 40000 }, g => g.verdict === "minor" && g.sizing] },
  { name: "SB vs BB1BBのJ5oジャムはGTO通り", ctx: fi("J5o", 7, 25, { effJamBB: 1, defendersN: 1 }), grade: ["jam", g => g.verdict === "best"] },
];

/* ポストフロップの黄金スポット */
const POST_SPOTS = [
  { name: "コーラーはフロップでTPGKでもチェックが正解(チェック・トゥ・ザ・レイザー)",
    ctx: {
      heroCards: [mkCard(12, 0), mkCard(11, 2)], heroLabel: "AKo",
      board: [mkCard(12, 1), mkCard(7, 2), mkCard(2, 3)], street: "flop",
      potBB: 5.7, toCallBB: 0, heroBehindBB: 18, effBehindBB: 18, role: "caller",
      oppRange: parseRange("22+,A2s+,ATo+,K9s+,KJo+"), facing: "none", playersIn: 2, canRaise: false, fast: true,
      posIdx: 8, seatName: "BB", phase: "postflop",
      prevAggressorSeat: 3, iWasPrevAggressor: false, aggressorActive: true,
    },
    grade: ["check", g => g.verdict === "best"] },
  { name: "PFRはドライボードのTPGKでベット",
    ctx: {
      heroCards: [mkCard(12, 0), mkCard(11, 2)], heroLabel: "AKo",
      board: [mkCard(12, 1), mkCard(7, 2), mkCard(2, 3)], street: "flop",
      potBB: 5.7, toCallBB: 0, heroBehindBB: 18, effBehindBB: 18, role: "pfr",
      oppRange: parseRange("22+,A2s+,ATo+,K9s+,QTs+"), facing: "none", playersIn: 2, canRaise: false, fast: true,
      posIdx: 5, seatName: "CO", phase: "postflop",
      prevAggressorSeat: 0, iWasPrevAggressor: true, aggressorActive: true,
    },
    want: a => a.primary === "bet33" || a.primary === "bet66" },
  { name: "エアで大きなベットに直面したらフォールド",
    ctx: {
      heroCards: [mkCard(5, 0), mkCard(0, 1)], heroLabel: "72o",
      board: [mkCard(12, 1), mkCard(11, 2), mkCard(7, 3)], street: "flop",
      potBB: 6, toCallBB: 4, heroBehindBB: 15, effBehindBB: 15, role: "caller",
      oppRange: parseRange("88+,AQs+,AQo+,KQs"), facing: "bet", playersIn: 2, canRaise: true, fast: true,
      posIdx: 8, seatName: "BB", phase: "postflop",
      prevAggressorSeat: 3, iWasPrevAggressor: false, aggressorActive: true,
    },
    want: a => a.primary === "fold" },
  { name: "TPGKで66%ベット(GTOは33%)はサイズ軽微ミス(ブランダーでない)",
    ctx: {
      heroCards: [mkCard(12, 0), mkCard(11, 2)], heroLabel: "AKo",
      board: [mkCard(12, 1), mkCard(9, 2), mkCard(4, 3)], street: "flop",
      potBB: 6, toCallBB: 0, heroBehindBB: 18, effBehindBB: 18, role: "pfr",
      oppRange: parseRange("22+,A2s+,ATo+,KTs+,KQo,QTs+"), facing: "none", playersIn: 2, canRaise: false, fast: true,
      posIdx: 5, seatName: "CO", phase: "postflop", prevAggressorSeat: 0, iWasPrevAggressor: true, aggressorActive: true,
    },
    gradeAct: ["bet66", { id: "bet66", target: 24000 }, g => g.verdict === "minor" || g.verdict === "mixed"] },
  { name: "トップセットのフロップチェック(スロープレイ)はブランダーでない",
    ctx: {
      heroCards: [mkCard(12, 0), mkCard(12, 3)], heroLabel: "AA",
      board: [mkCard(12, 1), mkCard(7, 2), mkCard(2, 3)], street: "flop",
      potBB: 6, toCallBB: 0, heroBehindBB: 18, effBehindBB: 18, role: "pfr",
      oppRange: parseRange("22+,A2s+,ATo+,KTs+,KQo,QTs+"), facing: "none", playersIn: 2, canRaise: false, fast: true,
      posIdx: 5, seatName: "CO", phase: "postflop", prevAggressorSeat: 0, iWasPrevAggressor: true, aggressorActive: true,
    },
    grade: ["check", g => g.verdict === "minor" || g.verdict === "mixed"] },
  { name: "フロップのセットはベットに対してフォールドしない",
    ctx: {
      heroCards: [mkCard(7, 0), mkCard(7, 1)], heroLabel: "99",
      board: [mkCard(12, 1), mkCard(7, 2), mkCard(2, 3)], street: "flop",
      potBB: 6, toCallBB: 3, heroBehindBB: 14, effBehindBB: 14, role: "caller",
      oppRange: parseRange("22+,A2s+,ATo+,KTs+,KQo,QTs+"), facing: "bet", playersIn: 2, canRaise: true, fast: true,
      posIdx: 8, seatName: "BB", phase: "postflop",
      prevAggressorSeat: 3, iWasPrevAggressor: false, aggressorActive: true,
    },
    want: a => (a.freqs.fold || 0) < 0.05 },
];

(async () => {
  let pass = 0, fail = 0;
  for (const s of SPOTS) {
    let ok = false, detail = "";
    try {
      if (!s.ctx) { ok = s.want(); }
      else {
        const a = await preflopAdvice(s.ctx);
        if (s.gradeAct) {
          const g = gradeDecision(s.ctx, a, s.gradeAct[0], s.gradeAct[1]);
          ok = s.gradeAct[2](g);
          detail = `verdict=${g.verdict} sizing=${!!g.sizing}`;
        } else if (s.grade) {
          const g = gradeDecision(s.ctx, a, s.grade[0]);
          ok = s.grade[1](g);
          detail = `verdict=${g.verdict} primary=${a.primary}`;
        } else {
          ok = s.want(a);
          detail = `primary=${a.primary} freqs=${JSON.stringify(a.freqs)}`;
        }
      }
    } catch (e) { detail = "例外: " + e.message; }
    if (ok) { pass++; console.log("ok: " + s.name); }
    else { fail++; console.error("★FAIL: " + s.name + " (" + detail + ")"); }
  }
  for (const s of POST_SPOTS) {
    let ok = false, detail = "";
    try {
      const a = await postflopAdvice(s.ctx);
      if (s.gradeAct) {
        const g = gradeDecision(s.ctx, a, s.gradeAct[0], s.gradeAct[1]);
        ok = s.gradeAct[2](g);
        detail = `verdict=${g.verdict} sizing=${!!g.sizing}`;
      } else if (s.grade) {
        const g = gradeDecision(s.ctx, a, s.grade[0]);
        ok = s.grade[1](g);
        detail = `verdict=${g.verdict} primary=${a.primary}`;
      } else {
        ok = s.want(a);
        detail = `primary=${a.primary} freqs=${JSON.stringify(a.freqs)}`;
      }
    } catch (e) { detail = "例外: " + e.message; }
    if (ok) { pass++; console.log("ok: " + s.name); }
    else { fail++; console.error("★FAIL: " + s.name + " (" + detail + ")"); }
  }
  console.log(`\n=== 黄金スポット: ${pass}合格 / ${fail}不合格 ===`);
  if (fail > 0) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
