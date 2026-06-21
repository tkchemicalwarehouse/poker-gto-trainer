/* 検証の自動計測。監査/検証ツールが実行のたびに「実際に回した実数」をここへ記録する。
 * - tools/verification-log.json : 全実行の監査証跡(追記)
 * - js/verification-auto.js     : 集計(ホームの累計カウンタが手書き台帳に加算して読む)
 * ★誠実さの憲章★ 実数のみ。ツールが実際に数えた判断数/ハンド数/チェック数だけを渡すこと(推定で水増ししない)。
 * 使い方(各ツール末尾):
 *   require("./record-verification.cjs").recordVerification({ tool:"selfplay-audit", checks: 24901, hands: 3150 });
 */
const fs = require("fs");
const path = require("path");
const LOG = path.join(__dirname, "verification-log.json");
const OUT = path.join(__dirname, "..", "js", "verification-auto.js");

function recordVerification(rec) {
  if (!rec) return null;
  const entry = {
    tool: rec.tool || "?",
    eq: Math.max(0, Math.round(rec.eq || 0)),
    checks: Math.max(0, Math.round(rec.checks || 0)),
    hands: Math.max(0, Math.round(rec.hands || 0)),
    note: rec.note || "",
    at: new Date().toISOString(),
  };
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOG, "utf8")); } catch (e) { log = []; }
  if (!Array.isArray(log)) log = [];
  log.push(entry);
  fs.writeFileSync(LOG, JSON.stringify(log));
  // 集計(全実行の累計)
  let eq = 0, checks = 0, hands = 0;
  for (const r of log) { eq += r.eq || 0; checks += r.checks || 0; hands += r.hands || 0; }
  const agg = { eq, checks, hands, runs: log.length, updated: entry.at.slice(0, 10) };
  const js = `"use strict";\n` +
    `/* 自動生成 — tools/record-verification.cjs が監査ツール実行のたびに更新。手で編集しない。\n` +
    ` * 累計の実測値(均衡計算/整合性検証/シミュレーション)。ホームの累計カウンタが手書き台帳に加算して表示。 */\n` +
    `const VERIFICATION_AUTO = ${JSON.stringify(agg)};\n`;
  fs.writeFileSync(OUT, js);
  console.log(`[検証記録] ${entry.tool}: +checks ${entry.checks.toLocaleString()} / +hands ${entry.hands.toLocaleString()} → 自動累計 checks ${checks.toLocaleString()} / hands ${hands.toLocaleString()} (${log.length}実行)`);
  return agg;
}

module.exports = { recordVerification };
