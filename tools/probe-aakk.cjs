/* AA/KKがフォールド推奨される実例を捕捉して ctx/data を出力(原因特定用) */
const fs = require("fs"); const path = require("path");
const load = f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8");
const src = ["engine.js","data-equity.js","data-nash.js","data-rejam.js","icm.js","ranges.js","strategy.js","poker.js","coach.js"].map(load).join("\n;\n")
  + `\n;const __origPF=preflopAdvice; preflopAdvice=async function(ctx){const a=await __origPF(ctx); if((ctx.heroLabel==="AA"||ctx.heroLabel==="KK")&&a.primary==="fold"&&global.__REC){global.__REC(ctx,a,"preflop");} return a;};`
  + `\n;const __origPP=postflopAdvice; postflopAdvice=async function(ctx){const a=await __origPP(ctx); const lbl=(ctx.heroCards&&ctx.heroCards.length===2)?handLabelOf(ctx.heroCards[0],ctx.heroCards[1]):""; if((lbl==="AA"||lbl==="KK")&&a.primary==="fold"&&global.__REC){global.__REC({...ctx,heroLabel:lbl,street:ctx.street},a,"postflop");} return a;};`
  + `\n;global.__A={newTournament,playHand};`;
const c = path.join(__dirname,"_aakk.cjs"); fs.writeFileSync(c, src); require(c);
const A = global.__A;
const hits = [];
global.__REC = (ctx,a,phase)=>{ if(hits.length<8) hits.push({phase,street:ctx.street,hand:ctx.heroLabel,facing:ctx.facing,eq:+a.data.equity?.toFixed(3),be:+a.data.breakeven?.toFixed(3),thr:+a.data.threshold?.toFixed(3)}); };
(async()=>{
  const io={delay:()=>Promise.resolve(),render:()=>{},log:()=>{},heroAct:async(ctx,legal)=>legal.find(x=>x.id==="fold")||legal[0]};
  let hands=0;
  while(hands<4000 && hits.length<6){ const st=A.newTournament("自分",9); st.fastMode=true; let g=0; while(!st.over&&st.handNo<400&&g++<420) await A.playHand(st,io); hands+=st.handNo; }
  console.log("AA/KKフォールド実例:", hits.length, "件");
  for(const h of hits) console.log(JSON.stringify(h));
})().catch(e=>{console.error(e);process.exitCode=1;});
