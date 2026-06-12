/* 優勝パス(FT→ショートハンド→HU→優勝)の集中検証 */
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "js");
let src = ["engine.js", "data-equity.js", "data-nash.js", "ranges.js", "strategy.js", "poker.js", "coach.js"]
  .map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("\n;\n");
src += `
(async () => {
  let wins = 0, finals = 0, hu = 0, crashes = 0;
  const places = [];
  for (let i = 0; i < 40; i++) {
    const st = newTournament("bot", 18);
    st.fastMode = true;
    const io = { delay: () => Promise.resolve(), render: () => {}, log: () => {},
      heroAct: (ctx, legal) => botAct(st, st.players[0], ctx, legal, io) };
    try {
      let minAlive = 9;
      while (!st.over && st.handNo < 400) {
        await playHand(st, io);
        const alive = st.players.filter(p => !p.out).length;
        if (alive < minAlive) minAlive = alive;
        for (const p of st.players) if (p.chips < 0) throw new Error("負のチップ: " + p.name + " " + p.chips);
      }
      if (st.finalTable) finals++;
      if (minAlive <= 2) hu++;
      if (st.won) { wins++; places.push(1); } else places.push(st.fieldLeft);
    } catch (e) {
      crashes++;
      console.error("CRASH t" + i + ": " + e.message);
      console.error(e.stack.split("\\n").slice(1, 3).join("\\n"));
    }
  }
  console.log("40回(18人戦): 優勝 " + wins + " / FT到達 " + finals + " / HU経験 " + hu + " / クラッシュ " + crashes);
  console.log("順位サンプル:", places.slice(0, 15).join(","));
  if (crashes > 0 || wins === 0) { console.error("検証失敗(クラッシュ or 優勝ゼロ)"); process.exitCode = 1; }
  else console.log("=== 優勝パス検証OK ===");
})().catch(e => { console.error(e); process.exitCode = 1; });
`;
const out = path.join(__dirname, "_victory_combined.cjs");
fs.writeFileSync(out, src);
require(out);
