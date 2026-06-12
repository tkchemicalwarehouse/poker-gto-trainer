/* ---- ヘッドレステスト本体(run.jsがjs/*と連結して実行) ---- */
let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL: " + msg); failures++; }
  else console.log("ok: " + msg);
}
const c = (r, s) => makeCard(r, s);

/* 役判定 */
assert((evaluate7([c(12,0),c(11,0),c(10,0),c(9,0),c(8,0),c(0,1),c(1,2)]) >> 20) === 8, "ロイヤル=ストレートフラッシュ");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(5,3),c(8,0),c(0,1),c(1,2)]) >> 20) === 7, "クアッズ");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(8,3),c(8,0),c(0,1),c(1,2)]) >> 20) === 6, "フルハウス");
assert((evaluate7([c(2,0),c(4,0),c(6,0),c(8,0),c(10,0),c(0,1),c(1,2)]) >> 20) === 5, "フラッシュ");
assert((evaluate7([c(12,0),c(0,1),c(1,2),c(2,3),c(3,0)]) >> 20) === 4, "ホイール(A2345)");
assert((evaluate7([c(8,0),c(9,1),c(10,2),c(11,3),c(12,0),c(0,1),c(0,2)]) >> 20) === 4, "TJQKAストレート");
assert((evaluate7([c(5,0),c(5,1),c(5,2),c(8,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 3, "トリップス");
assert((evaluate7([c(5,0),c(5,1),c(8,2),c(8,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 2, "ツーペア");
assert((evaluate7([c(5,0),c(5,1),c(8,2),c(7,3),c(9,0),c(0,1),c(1,2)]) >> 20) === 1, "ワンペア");
assert((evaluate7([c(5,0),c(3,1),c(8,2),c(7,3),c(9,0),c(0,1),c(12,2)]) >> 20) === 0, "ハイカード");
// キッカー比較: AKvsAQ on A-high board
const b1 = [c(12,0), c(7,1), c(4,2), c(2,3), c(9,0)];
const ak = evaluate7([c(12,1), c(11,2)].concat(b1));
const aq = evaluate7([c(12,2), c(10,3)].concat(b1));
assert(ak > aq, "キッカー比較 AK>AQ");

/* レンジパーサー */
assert(parseRange("22+").size === 13, "22+ → 13ペア");
assert(parseRange("A2s+").size === 12, "A2s+ → 12種");
assert(parseRange("ATo+").size === 4, "ATo+ → 4種");
assert(parseRange("77-55").size === 3, "77-55 → 3種");
assert(parseRange("A5s-A3s").size === 3, "A5s-A3s → 3種");
assert(parseRange("A2+").size === 24, "A2+ → s/o両方24種");
assert(parseRange("KQo:0.5").get("KQo") === 0.5, "重み付き");
const pr = parseRange("22+,A2s+,A7o+,K9s+,KJo+,QTs+,JTs");
console.log("  UTG 5bbジャムレンジ:", rangePercent(pr).toFixed(1) + "%");
assert(rangePercent(pr) > 13 && rangePercent(pr) < 22, "UTG 5bbジャム ≈ 15-20%");

/* レンジデータの整合性(全バケット・全ポジションがパース可能か) */
for (const bucket of Object.keys(PUSH_RANGES)) {
  for (let pos = 0; pos < 8; pos++) {
    const r = parseRange(PUSH_RANGES[bucket][pos]);
    assert(r.size > 0, `PUSH[${bucket}][${POSITIONS[pos]}] パース可`);
  }
}
for (const bucket of Object.keys(OPEN_RANGES)) {
  for (let pos = 0; pos < 8; pos++) {
    const r = parseRange(OPEN_RANGES[bucket][pos]);
    assert(r.size > 0, `OPEN[${bucket}][${POSITIONS[pos]}] パース可`);
  }
}
// 単調性: ポジションが後ろほどジャムレンジは広い
for (const bucket of [5, 8, 10, 12]) {
  let prev = 0, mono = true;
  for (let pos = 0; pos < 8; pos++) {
    const pct = rangePercent(parseRange(PUSH_RANGES[bucket][pos]));
    if (pct < prev - 0.6) mono = false;
    prev = pct;
  }
  assert(mono, `PUSH[${bucket}bb] ポジション単調性`);
}

/* エクイティ精度 */
const AA = [c(12,0), c(12,1)];
const eKK = equityVsRange(AA, parseRange("KK"), [], 30000);
console.log("  AA vs KK:", (eKK.equity*100).toFixed(1) + "%");
assert(Math.abs(eKK.equity - 0.82) < 0.025, "AA vs KK ≈ 82%");
const rndRange = new Map(ALL_HANDS.map(h => [h, 1]));
const eRnd = equityVsRange(AA, rndRange, [], 30000);
console.log("  AA vs ランダム:", (eRnd.equity*100).toFixed(1) + "%");
assert(Math.abs(eRnd.equity - 0.852) < 0.02, "AA vs ランダム ≈ 85%");
const AKs = [c(12,0), c(11,0)];
const eQQ = equityVsRange(AKs, parseRange("QQ"), [], 30000);
console.log("  AKs vs QQ:", (eQQ.equity*100).toFixed(1) + "%");
assert(Math.abs(eQQ.equity - 0.46) < 0.025, "AKs vs QQ ≈ 46%");

/* ハンド分類 */
const flop1 = [c(12,0), c(7,1), c(2,2)]; // A 9 4 レインボー
const clsTP = classifyHand([c(12,1), c(11,2)], flop1); // AK
assert(clsTP.tier === 4, "AK on A94r = トップペア良キッカー (tier4) got " + clsTP.tier + " " + clsTP.label);
const clsSet = classifyHand([c(7,0), c(7,2)], flop1);
assert(clsSet.tier === 5, "99 on A94 = セット (tier5)");
const clsFD = classifyHand([c(10,0), c(9,0)], [c(5,0), c(3,0), c(12,1)]); // QJss on 75s As
assert(clsFD.draws.flushDraw, "フラッシュドロー検出");
const clsOESD = classifyHand([c(7,0), c(6,1)], [c(5,2), c(4,3), c(12,1)]); // 98 on 76A
assert(clsOESD.draws.oesd, "OESD検出");

/* 採点ロジック */
(async () => {
  // 5BB UTGのAKs → ジャムが正解
  const ctx1 = {
    heroCards: [c(12,0), c(11,0)], heroLabel: "AKs", posIdx: 0,
    stackBB: 5, effBB: 5, facing: "none", potBB: 2.5, toCallBB: 1, fast: true, seatName: "UTG",
  };
  const adv1 = await preflopAdvice(ctx1);
  assert(adv1.primary === "jam", "5BB UTG AKs → ジャム");
  const g1 = gradeDecision(ctx1, adv1, "fold");
  assert(g1.verdict === "blunder" || g1.verdict === "minor", "AKsフォールドは減点");
  const g2 = gradeDecision(ctx1, adv1, "jam");
  assert(g2.verdict === "best", "AKsジャムはGTO通り");

  // 72o → フォールドが正解
  const ctx2 = Object.assign({}, ctx1, { heroCards: [c(5,0), c(0,1)], heroLabel: "72o" });
  const adv2 = await preflopAdvice(ctx2);
  assert(adv2.primary === "fold", "5BB UTG 72o → フォールド");

  // ジャムに対するAAコール
  const ctx3 = {
    heroCards: [c(12,0), c(12,1)], heroLabel: "AA", posIdx: 8,
    stackBB: 20, effBB: 10, facing: "jam",
    jamRange: Ranges.push(POS_BTN, 10), jamCount: 1, playersBehind: 0,
    potBB: 12.5, toCallBB: 9, fast: true, seatName: "BB",
  };
  const adv3 = await preflopAdvice(ctx3);
  assert(adv3.primary === "call", "BB AA vs BTNジャム → コール");
  assert(adv3.data.evCallBB > 5, "AAコールEVは大きく+ got " + adv3.data.evCallBB.toFixed(2));

  // 72o はフォールド
  const ctx4 = Object.assign({}, ctx3, { heroCards: [c(5,0), c(0,1)], heroLabel: "72o" });
  const adv4 = await preflopAdvice(ctx4);
  assert(adv4.primary === "fold", "BB 72o vs BTNジャム → フォールド");

  /* ヘッドレストーナメント(ボット同士) */
  let totalHands = 0;
  for (let i = 0; i < 6; i++) {
    const st = newTournament("bot");
    st.fastMode = true;
    const io = {
      delay: () => Promise.resolve(),
      render: () => { },
      log: () => { },
      heroAct: (ctx, legal) => botAct(st, st.players[0], ctx, legal, io),
    };
    let guard = 0;
    while (!st.over && st.handNo < 150 && guard++ < 160) {
      await playHand(st, io);
      for (const p of st.players) {
        if (p.chips < 0) { assert(false, `チップがマイナス: ${p.name} ${p.chips}`); break; }
      }
    }
    console.log(`  トーナメント${i + 1}: ${st.handNo}ハンドで${st.over ? "バスト" : "生存(打ち切り)"}`);
    totalHands += st.handNo;
  }
  assert(totalHands > 0, "ヘッドレストーナメント完走");

  console.log(failures === 0 ? "\n=== 全テスト合格 ===" : `\n=== 失敗 ${failures}件 ===`);
  if (failures > 0) process.exitCode = 1;
})().catch(e => { console.error("クラッシュ:", e); process.exitCode = 1; });
