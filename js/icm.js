/* =========================================================
 * icm.js — 簡易ICM(Malmuth-Harville)
 * ファイナルテーブルのオールイン・コール判断に賞金圧力の補正を加える。
 * 全プレイヤーのスタックが既知のFTでのみ適用(それまでの局面はChipEV)。
 * ========================================================= */
"use strict";

const Icm = (() => {
  // 賞金配分(プライズプール比)。参加人数別。
  const PAYOUTS_BY_FIELD = {
    18: [0.40, 0.27, 0.18, 0.15],
    27: [0.37, 0.25, 0.17, 0.12, 0.09],
    45: [0.34, 0.23, 0.16, 0.11, 0.09, 0.07],
  };

  function payoutsFor(fieldSize, aliveCount) {
    let base = PAYOUTS_BY_FIELD[fieldSize];
    if (!base) {
      // 任意の人数: 上位約22%が入賞のスケール配分
      const paid = Math.max(3, Math.round(fieldSize * 0.22));
      base = [];
      let v = 0.36;
      for (let i = 0; i < paid; i++) { base.push(v); v *= 0.66; }
      const s = base.reduce((a, b) => a + b, 0);
      base = base.map(x => x / s);
    }
    return base.slice(0, Math.max(1, aliveCount));
  }

  // Malmuth-Harville: 各プレイヤーの賞金期待値(プライズプール比)
  function icmEVs(stacks, payouts) {
    const n = stacks.length;
    const ev = new Array(n).fill(0);
    const places = Math.min(payouts.length, n);
    // 再帰: mask=残りプレイヤー, payIdx=今決める順位, prob=ここまでの確率
    function rec(mask, payIdx, prob, sumRemaining) {
      if (payIdx >= places || prob < 1e-12) return;
      for (let i = 0; i < n; i++) {
        if (!(mask & (1 << i))) continue;
        const si = stacks[i];
        if (si <= 0) continue;
        const pi = prob * si / sumRemaining;
        ev[i] += pi * payouts[payIdx];
        rec(mask & ~(1 << i), payIdx + 1, pi, sumRemaining - si);
      }
    }
    const total = stacks.reduce((a, b) => a + Math.max(0, b), 0);
    rec((1 << n) - 1, 0, 1, total);
    return ev;
  }

  /* オールインコールのICM必要勝率を計算
   * spec: { stacks: 現在の各自スタック(チップ), heroI, villI,
   *         potChips: 現在のポット(ジャム込み), toCallChips, payouts }
   * 戻り: { req: ICM必要勝率, evFold, evWin, evLose } | null
   */
  function requiredEq(spec) {
    try {
      const { stacks, heroI, villI, potChips, toCallChips, payouts } = spec;
      if (!stacks || stacks.length < 2 || heroI === villI) return null;
      const potAfter = potChips + toCallChips;

      const fold = stacks.slice();
      fold[villI] += potChips;

      const win = stacks.slice();
      win[heroI] = win[heroI] - toCallChips + potAfter;

      const lose = stacks.slice();
      lose[heroI] -= toCallChips;
      lose[villI] += potAfter;

      const eF = icmEVs(fold, payouts)[heroI];
      const eW = icmEVs(win, payouts)[heroI];
      const eL = icmEVs(lose, payouts)[heroI];
      if (!(eW > eL)) return null;
      const req = (eF - eL) / (eW - eL);
      return { req, evFold: eF, evWin: eW, evLose: eL };
    } catch (e) { return null; }
  }

  return { payoutsFor, icmEVs, requiredEq };
})();
