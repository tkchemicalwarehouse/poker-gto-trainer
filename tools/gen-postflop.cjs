/* ポストフロップ・ソルバー(C: バケット抽象化CFR)
 * ヘッズアップ・シングルレイズポット(オープン vs BBコール)のフロップ戦略を、
 * 役の強さバケットに抽象化したCFR(反実仮想後悔最小化)で求解する。
 * 終端のショーダウンは実7枚評価による厳密エクイティ(バケット間行列)。
 * まず1フロップで収束と妥当性を確認するための土台。
 * 実行: node tools/gen-postflop.cjs
 */
const fs = require("fs");
const path = require("path");
const loadJs = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const sb = {};
new Function("exports", [loadJs("engine.js"), loadJs("ranges.js"), loadJs("strategy.js")].join("\n") +
  ";exports.combosOfLabel=combosOfLabel;exports.parseRange=parseRange;exports.classifyHand=classifyHand;" +
  ";exports.evaluate7=evaluate7;exports.makeCard=makeCard;exports.cardText=cardText;exports.Ranges=Ranges;exports.rangeToCombos=rangeToCombos;")(sb);
const { combosOfLabel, parseRange, classifyHand, evaluate7, makeCard, cardText, Ranges } = sb;
const C = (r, s) => makeCard(r, s);

/* ---------- ハンド→バケット(0〜8、強い順は逆。フロップの強さ階層) ----------
 * classifyHandのtierとドローを使って戦略的に意味のある9バケットに圧縮
 */
function bucketOf(cards, board) {
  const cl = classifyHand(cards, board);
  const sd = cl.draws.flushDraw || cl.draws.oesd;
  if (cl.tier >= 5) return 8;                  // セット以上(モンスター)
  if (cl.tier === 4) return 7;                 // トップペア/オーバーペア
  if (cl.tier === 3 && sd) return 7;           // 中強+ドロー
  if (cl.tier === 3) return 6;                 // 中強
  if (sd && cl.tier >= 2) return 6;            // ペア+ドロー
  if (cl.draws.flushDraw && cl.draws.oesd) return 6; // コンボドロー
  if (cl.draws.flushDraw || cl.draws.oesd) return 5; // 強ドロー
  if (cl.tier === 2) return 4;                 // ミドルペア
  if (cl.draws.gutshot) return 3;              // ガットショット
  if (cl.tier === 1) return 2;                 // 弱ペア/ボードペア
  if (cl.label.includes("オーバーカード")) return 1; // 2オーバー
  return 0;                                    // 完全エア
}

/* ---------- レンジをバケット重みに集計 + バケット間エクイティ行列 ---------- */
function buildBuckets(range, board, dead) {
  const combos = sb.rangeToCombos(range, dead.concat(board));
  const byB = {}; // bucket -> [combos]
  for (const cb of combos) {
    const b = bucketOf([cb.c1, cb.c2], board);
    (byB[b] = byB[b] || []).push([cb.c1, cb.c2]);
  }
  return byB;
}

// バケットiとjの平均エクイティ(MCで残りボードを埋めてショーダウン)
function bucketEquity(combosA, combosB, board, iters) {
  const need = 5 - board.length;
  const hf = new Array(7), vf = new Array(7);
  for (let i = 0; i < board.length; i++) { hf[2 + i] = board[i]; vf[2 + i] = board[i]; }
  let win = 0, tot = 0;
  for (let it = 0; it < iters; it++) {
    const a = combosA[(Math.random() * combosA.length) | 0];
    const b = combosB[(Math.random() * combosB.length) | 0];
    if (a[0] === b[0] || a[0] === b[1] || a[1] === b[0] || a[1] === b[1]) continue;
    hf[0] = a[0]; hf[1] = a[1]; vf[0] = b[0]; vf[1] = b[1];
    const used = new Set([a[0], a[1], b[0], b[1], ...board]);
    let filled = board.length;
    while (filled < 5) { const c = (Math.random() * 52) | 0; if (used.has(c)) continue; used.add(c); hf[2 + filled] = c; vf[2 + filled] = c; filled++; }
    const hs = evaluate7(hf), vs = evaluate7(vf);
    if (hs > vs) win += 1; else if (hs === vs) win += 0.5;
    tot++;
  }
  return tot ? win / tot : 0.5;
}

/* ====== フロップCFR(フロップのみ、以降はランナウト/ショーダウン) ======
 * プレイヤー: OOP(BB, 先手) と IP(オープナー)。
 * アクション: フロップで check/bet(0.5P, 1.0P)/fold/call/jam。以降はショーダウン(=エクイティ)。
 * 終端利得は「投資後のスタックに対する、勝率で決まる期待チップ」。
 */
/* 2サイズ(33%/66%)対応の定数和CFR。利得OOP視点 = eqShare×最終ポット − 投資。
 * インフォセット: oop{check,betS,betB}, ipc{cb,betS,betB},
 *   oopfS/oopfB{fold,call}, ipfS/ipfB{fold,call}。
 */
function solveFlopV3(eqMat, P0, E, w, iters) {
  const B = 9;
  const sS = Math.round(P0 * 0.33), sB = Math.round(P0 * 0.66);
  const R = {}, Ss = {};
  const nd = (k, n) => { if (!R[k]) { R[k] = new Float64Array(n); Ss[k] = new Float64Array(n); } };
  const strat = (k, n) => { const r = R[k], s = new Float64Array(n); let sum = 0; for (let i = 0; i < n; i++) { s[i] = r[i] > 0 ? r[i] : 0; sum += s[i]; } if (sum > 0) for (let i = 0; i < n; i++) s[i] /= sum; else s.fill(1 / n); return s; };
  for (let bo = 0; bo < B; bo++) if (w.oop[bo]) { nd("oop|" + bo, 3); nd("oopfS|" + bo, 2); nd("oopfB|" + bo, 2); }
  for (let bi = 0; bi < B; bi++) if (w.ip[bi]) { nd("ipc|" + bi, 3); nd("ipfS|" + bi, 2); nd("ipfB|" + bi, 2); }
  const wIPsum = w.ip.reduce((a, x) => a + x, 0), wOOPsum = w.oop.reduce((a, x) => a + x, 0);
  const callVal = (eq, s) => eq * (P0 + 2 * s) - s;
  for (let t = 0; t < iters; t++) {
    const S = {}; for (const k in R) S[k] = strat(k, R[k].length);
    for (let bo = 0; bo < B; bo++) {
      if (!w.oop[bo]) continue;
      const sOop = S["oop|" + bo], sOfS = S["oopfS|" + bo], sOfB = S["oopfB|" + bo];
      let vChk = 0, vBS = 0, vBB = 0; const ofS = [0, 0], ofB = [0, 0]; let rS = 0, rB = 0;
      for (let bi = 0; bi < B; bi++) {
        if (!w.ip[bi]) continue;
        const wr = w.ip[bi] / wIPsum, eq = eqMat[bo][bi];
        const sIc = S["ipc|" + bi], sIfS = S["ipfS|" + bi], sIfB = S["ipfB|" + bi];
        const valSD = eq * P0;
        const oopVsS = sOfS[0] * 0 + sOfS[1] * callVal(eq, sS);
        const oopVsB = sOfB[0] * 0 + sOfB[1] * callVal(eq, sB);
        vChk += wr * (sIc[0] * valSD + sIc[1] * oopVsS + sIc[2] * oopVsB);
        ofS[0] += wr * 0; ofS[1] += wr * callVal(eq, sS); rS += wr * sIc[1];
        ofB[0] += wr * 0; ofB[1] += wr * callVal(eq, sB); rB += wr * sIc[2];
        vBS += wr * (sIfS[0] * P0 + sIfS[1] * callVal(eq, sS));
        vBB += wr * (sIfB[0] * P0 + sIfB[1] * callVal(eq, sB));
        const wo = w.oop[bo] / wOOPsum;
        accumR("ipc|" + bi, sIc, [P0 - valSD, P0 - oopVsS, P0 - oopVsB], wo);
        accumR("ipfS|" + bi, sIfS, [0, P0 - callVal(eq, sS)], wo);
        accumR("ipfB|" + bi, sIfB, [0, P0 - callVal(eq, sB)], wo);
      }
      accumR("oop|" + bo, sOop, [vChk, vBS, vBB], w.oop[bo]);
      if (rS > 0) accumR("oopfS|" + bo, sOfS, ofS, w.oop[bo] * rS);
      if (rB > 0) accumR("oopfB|" + bo, sOfB, ofB, w.oop[bo] * rB);
    }
    function accumR(k, s, evs, wgt) { const ev = s.reduce((a, v, i) => a + v * evs[i], 0); for (let i = 0; i < evs.length; i++) { R[k][i] += wgt * (evs[i] - ev); Ss[k][i] += wgt * s[i]; } }
  }
  const avg = (k, n) => { if (!Ss[k]) return null; const s = Ss[k]; let sum = 0; for (let i = 0; i < n; i++) sum += s[i]; const o = []; for (let i = 0; i < n; i++) o.push(sum > 0 ? s[i] / sum : 1 / n); return o; };
  const out = { oop: {}, ipc: {} };
  for (let x = 0; x < B; x++) { out.oop[x] = avg("oop|" + x, 3); out.ipc[x] = avg("ipc|" + x, 3); }
  return out;
}

/* 正しい定数和(ゼロサム)CFR。利得はOOP視点 = eqShare×最終ポット − フロップ投資。
 * 5つのインフォセット: oop(root), ipc(OOPチェック後), oopf(自分チェック→IPベット),
 *   ipf(OOPベットに直面), oopj(自分ベット→IPジャムに直面)。各バケット別。
 */
function solveFlopV2(eqMat, P0, E, w, iters) {
  const B = 9, b = Math.min(E, Math.round(P0 * 0.66));
  const R = {}, Ss = {};
  const nd = (k, n) => { if (!R[k]) { R[k] = new Float64Array(n); Ss[k] = new Float64Array(n); } };
  const strat = (k, n) => { const r = R[k], s = new Float64Array(n); let sum = 0; for (let i = 0; i < n; i++) { s[i] = r[i] > 0 ? r[i] : 0; sum += s[i]; } if (sum > 0) for (let i = 0; i < n; i++) s[i] /= sum; else s.fill(1 / n); return s; };
  for (let bo = 0; bo < B; bo++) { if (w.oop[bo]) { nd("oop|" + bo, 2); nd("oopf|" + bo, 2); nd("oopj|" + bo, 2); } }
  for (let bi = 0; bi < B; bi++) { if (w.ip[bi]) { nd("ipc|" + bi, 2); nd("ipf|" + bi, 3); } }
  const wIPsum = w.ip.reduce((a, x) => a + x, 0), wOOPsum = w.oop.reduce((a, x) => a + x, 0);

  // OOP視点の各終端利得
  const sdEq = (bo, bi) => eqMat[bo][bi];
  const oopCallVal = (eq) => eq * (P0 + 2 * b) - b;          // どちらかが小ベット、コール
  const oopJamCall = (eq) => eq * (P0 + 2 * E) - E;          // ジャムにコール

  for (let t = 0; t < iters; t++) {
    // 戦略スナップ
    const S = {}; for (const k in R) S[k] = strat(k, R[k].length);
    // 各バケット組で利得を計算し、各インフォセットの後悔を更新
    for (let bo = 0; bo < B; bo++) {
      if (!w.oop[bo]) continue;
      const sOop = S["oop|" + bo], sOopf = S["oopf|" + bo], sOopj = S["oopj|" + bo];
      let vCheck = 0, vBet = 0;
      // oopf / oopj の後悔蓄積用
      let oopfFold = 0, oopfCall = 0, oopfReach = 0;
      let oopjFold = 0, oopjCall = 0, oopjReach = 0;
      for (let bi = 0; bi < B; bi++) {
        if (!w.ip[bi]) continue;
        const wr = w.ip[bi] / wIPsum;
        const eq = sdEq(bo, bi);
        const sIPc = S["ipc|" + bi], sIPf = S["ipf|" + bi];
        // --- OOP check 経路 ---
        const valSD = eq * P0;                 // IP check back
        const valOOPfacingBet = sOopf[0] * 0 + sOopf[1] * oopCallVal(eq); // OOP fold/call
        const vOopCheck = sIPc[0] * valSD + sIPc[1] * valOOPfacingBet;
        vCheck += wr * vOopCheck;
        oopfFold += wr * 0; oopfCall += wr * oopCallVal(eq); oopfReach += wr * sIPc[1];
        // --- OOP bet 経路 ---
        const valIPfold = P0;                   // IP folds → OOP wins pot
        const valIPcall = oopCallVal(eq);
        const valOOPfacingJam = sOopj[0] * (-b) + sOopj[1] * oopJamCall(eq);
        const vOopBet = sIPf[0] * valIPfold + sIPf[1] * valIPcall + sIPf[2] * valOOPfacingJam;
        vBet += wr * vOopBet;
        oopjFold += wr * (-b); oopjCall += wr * oopJamCall(eq); oopjReach += wr * sIPf[2];

        // --- IP の後悔(IP視点 = P0 − OOP視点)。reach = OOP側 ---
        const wo = w.oop[bo] / wOOPsum;
        // ipc: checkback vs bet (IP視点)
        const ipc_cb = P0 - valSD, ipc_bet = P0 - valOOPfacingBet;
        accum("ipc|" + bi, sIPc, [ipc_cb, ipc_bet], wo);
        // ipf: fold / call / jam (IP視点)
        const ipf_fold = P0 - valIPfold, ipf_call = P0 - valIPcall, ipf_jam = P0 - valOOPfacingJam;
        accum("ipf|" + bi, sIPf, [ipf_fold, ipf_call, ipf_jam], wo);
      }
      // OOP root 後悔
      accumV("oop|" + bo, sOop, [vCheck, vBet], w.oop[bo]);
      // oopf 後悔(IPがベットしてきた分のreachで)
      if (oopfReach > 0) accumV("oopf|" + bo, sOopf, [oopfFold, oopfCall], w.oop[bo] * oopfReach);
      if (oopjReach > 0) accumV("oopj|" + bo, sOopj, [oopjFold, oopjCall], w.oop[bo] * oopjReach);
    }
    function accum(k, s, evs, wgt) { const ev = s.reduce((a, v, i) => a + v * evs[i], 0); for (let i = 0; i < evs.length; i++) { R[k][i] += wgt * (evs[i] - ev); Ss[k][i] += wgt * s[i]; } }
    function accumV(k, s, evs, wgt) { const ev = s.reduce((a, v, i) => a + v * evs[i], 0); for (let i = 0; i < evs.length; i++) { R[k][i] += wgt * (evs[i] - ev); Ss[k][i] += wgt * s[i]; } }
  }
  const avg = (k, n) => { if (!Ss[k]) return null; const s = Ss[k]; let sum = 0; for (let i = 0; i < n; i++) sum += s[i]; const o = []; for (let i = 0; i < n; i++) o.push(sum > 0 ? s[i] / sum : 1 / n); return o; };
  const out = { oop: {}, ipc: {}, ipf: {}, oopf: {}, oopj: {} };
  for (let x = 0; x < B; x++) { out.oop[x] = avg("oop|" + x, 2); out.ipc[x] = avg("ipc|" + x, 2); out.ipf[x] = avg("ipf|" + x, 3); out.oopf[x] = avg("oopf|" + x, 2); out.oopj[x] = avg("oopj|" + x, 2); }
  return out;
}

function solveFlop(oopB, ipB, eqMat, potChips, effChips, weights, iters) {
  // インフォセット: 各プレイヤー×バケット×履歴。簡易ツリー:
  //   OOP: check or bet
  //   IP vs check: check(→SD) or bet
  //   IP vs bet: fold or call(→SD) or jam
  //   OOP vs (IP bet after check): fold or call(→SD)
  //   vs jam: fold or call(→SD)
  // 利得はチップEV(両者0サムを勝率で計算)。
  const BUCKETS = 9;
  const betSize = Math.min(effChips, Math.round(potChips * 0.66));
  // 後悔・戦略累積: node ごとに [action]→regretSum, stratSum
  const R = {}; const Ssum = {};
  const node = (key, nA) => { if (!R[key]) { R[key] = new Float64Array(nA); Ssum[key] = new Float64Array(nA); } return key; };
  function strat(key, nA) {
    const r = R[key]; let sum = 0; const s = new Float64Array(nA);
    for (let i = 0; i < nA; i++) { s[i] = r[i] > 0 ? r[i] : 0; sum += s[i]; }
    if (sum > 0) for (let i = 0; i < nA; i++) s[i] /= sum; else for (let i = 0; i < nA; i++) s[i] = 1 / nA;
    return s;
  }
  // エクイティ(バケットoop vs ip)
  const eqOf = (bo, bi) => eqMat[bo][bi];

  // CFR: 片方のバケットを固定し、相手はバケット分布で期待を取る(weights[player][bucket])
  // 簡易化のため「相手バケットの加重平均エクイティ」を使い、相手の戦略も同時に学習。
  function cfr(iter) {
    // OOPの各バケットについて
    for (let bo = 0; bo < BUCKETS; bo++) {
      if (!weights.oop[bo]) continue;
      // OOP: check(0) or bet(1)
      const kOop = node("oop|" + bo, 2);
      const sOop = strat(kOop, 2);
      // IPの応答(相手バケット分布で期待利得)
      // --- OOPがbetした場合のIPの応答, OOPがcheckした場合のIPの応答 ---
      let evCheck = 0, evBet = 0, wsum = 0;
      for (let bi = 0; bi < BUCKETS; bi++) {
        const w = weights.ip[bi]; if (!w) continue; wsum += w;
        const eq = eqOf(bo, bi);
        // OOP check → IP: check(SD) or bet
        const kIPc = node("ip_vc|" + bi, 2);
        const sIPc = strat(kIPc, 2);
        const evIPc_check = eq2chips(eq, potChips, 0);                 // 両者0投資追加→SD
        // IP bet後、OOP: fold or call
        const kOopVB = node("oop_vb|" + bo, 2);
        const sOopVB = strat(kOopVB, 2);
        const evOop_foldVB = -0;                                        // OOPは何も足してない→0(ポット放棄)
        const evOop_callVB = eq2chips(eq, potChips + 2 * betSize, betSize);
        // OOPの check 経路利得(OOP視点)
        const oopVB = sOopVB[0] * evOop_foldVB + sOopVB[1] * evOop_callVB;
        const evOop_check = sIPc[0] * evIPc_check + sIPc[1] * oopVB;
        evCheck += w * evOop_check;

        // OOP bet → IP: fold / call(SD) / jam
        const kIPvb = node("ip_vb|" + bi, 3);
        const sIPvb = strat(kIPvb, 3);
        const evIP_fold = potChips;          // IP降りる→OOPがポット獲得(OOP視点 +pot)... ここはOOP視点に統一
        // OOP視点のbet経路:
        const oopBet_ipFold = potChips;                                  // IP fold → OOP wins pot
        const oopBet_ipCall = eq2chips(eq, potChips + 2 * betSize, betSize);
        const oopBet_ipJam = -betSize + eqJamBranch(eq, potChips, betSize, effChips); // OOPはjamにfold/call
        const evOop_bet = sIPvb[0] * oopBet_ipFold + sIPvb[1] * oopBet_ipCall + sIPvb[2] * oopBet_ipJam;
        evBet += w * evOop_bet;

        // --- IP側の後悔も更新(相手OOPのバケットboに対して) ---
        accumIP(kIPc, sIPc, [evIPc_check, -oopVB], weights.oop[bo]); // IP視点=−OOP視点(0サム)
        accumIP(kIPvb, sIPvb, [-oopBet_ipFold, -oopBet_ipCall, -oopBet_ipJam], weights.oop[bo]);
        accumIP(kOopVB, sOopVB, [evOop_foldVB, evOop_callVB], weights.ip[bi] * weights.oop[bo]); // OOP vs bet
      }
      if (wsum > 0) { evCheck /= wsum; evBet /= wsum; }
      // OOPの後悔更新
      const ev = sOop[0] * evCheck + sOop[1] * evBet;
      R[kOop][0] += weights.oop[bo] * (evCheck - ev);
      R[kOop][1] += weights.oop[bo] * (evBet - ev);
      for (let i = 0; i < 2; i++) Ssum[kOop][i] += weights.oop[bo] * sOop[i];
    }
  }
  function accumIP(key, s, evs, w) {
    const ev = s.reduce((a, v, i) => a + v * evs[i], 0);
    for (let i = 0; i < evs.length; i++) { R[key][i] += w * (evs[i] - ev); Ssum[key][i] += w * s[i]; }
  }
  function eq2chips(eq, finalPot, invest) { return eq * finalPot - invest; }
  function eqJamBranch(eq, pot, bet, eff) {
    // OOPがbet後にjamを受けた時のfold/call最適(OOP視点)
    const callRisk = eff - bet;
    const callEV = eq * (pot + 2 * eff) - eff;
    return Math.max(0, callEV); // fold=0(bet分は上で別計上), callが良ければそちら
  }

  for (let t = 0; t < iters; t++) cfr(t);

  // 平均戦略を返す(OOPのcheck/bet, IPの各応答)
  const avg = (key, nA) => { const s = Ssum[key]; let sum = 0; for (let i = 0; i < nA; i++) sum += s[i]; const o = []; for (let i = 0; i < nA; i++) o.push(sum > 0 ? s[i] / sum : 1 / nA); return o; };
  const out = { oop: {}, ip_vc: {}, ip_vb: {} };
  for (let b = 0; b < BUCKETS; b++) {
    if (R["oop|" + b]) out.oop[b] = avg("oop|" + b, 2);
    if (R["ip_vc|" + b]) out.ip_vc[b] = avg("ip_vc|" + b, 2);
    if (R["ip_vb|" + b]) out.ip_vb[b] = avg("ip_vb|" + b, 3);
  }
  return out;
}

/* ---------- 1フロップで試す ---------- */
const BUCKETS = 9;
function run(boardLabels, board) {
  const openRange = Ranges.open(6, 25);      // BTN 25BB オープン
  const bbCall = Ranges.bbCall("LP", 20);    // BB の LP に対するコール
  const dead = [];
  const ipByB = buildBuckets(openRange, board, dead);   // IP = オープナー
  const oopByB = buildBuckets(bbCall, board, dead);      // OOP = BB
  // バケット重み
  const w = { oop: new Array(BUCKETS).fill(0), ip: new Array(BUCKETS).fill(0) };
  for (let b = 0; b < BUCKETS; b++) { w.oop[b] = (oopByB[b] || []).length; w.ip[b] = (ipByB[b] || []).length; }
  // バケット間エクイティ行列(OOP視点)
  const eqMat = [];
  for (let bo = 0; bo < BUCKETS; bo++) {
    eqMat.push(new Array(BUCKETS).fill(0.5));
    if (!oopByB[bo]) continue;
    for (let bi = 0; bi < BUCKETS; bi++) {
      if (!ipByB[bi]) continue;
      eqMat[bo][bi] = bucketEquity(oopByB[bo], ipByB[bi], board, 600);
    }
  }
  const pot = 5 * 4000, eff = 18 * 4000;
  const st = solveFlopV3(eqMat, pot, eff, w, 5000);

  console.log(`\n=== フロップ ${boardLabels} ===`);
  const bn = ["エア", "2オーバー", "弱ペア", "ガット", "ミドルペア", "強ドロー", "中強/コンボ", "TP/OP", "セット+"];
  let cbetW = 0, cbetTot = 0;
  console.log("IP(オープナー) OOPチェック後 [チェック/小33%/大66%]:");
  for (let b = BUCKETS - 1; b >= 0; b--) {
    if (!st.ipc[b] || !w.ip[b]) continue;
    const s = st.ipc[b];
    console.log(`  ${bn[b]}(${w.ip[b]}): チェック${(s[0] * 100).toFixed(0)}% / 小${(s[1] * 100).toFixed(0)}% / 大${(s[2] * 100).toFixed(0)}%`);
    cbetW += w.ip[b] * (s[1] + s[2]); cbetTot += w.ip[b];
  }
  console.log(`  → IP C-bet率(小+大): ${(cbetW / cbetTot * 100).toFixed(1)}%`);
}

run("As 9d 4c (ドライ)", [C(12, 0), C(7, 2), C(2, 3)]);
run("8h 7h 6s (ウェット)", [C(6, 1), C(5, 1), C(4, 3)]);
run("Ks Ks... → Kd 7c 2h (ドライK)", [C(11, 2), C(5, 3), C(0, 1)]);
