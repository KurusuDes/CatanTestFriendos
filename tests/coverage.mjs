import { createGame, applyAction, pendingActors } from '../js/engine/game.js';
import { botAct } from '../js/engine/bot.js';
import { defaultConfig, MODES, PLAYER_COLORS } from '../js/engine/config.js';
const counts = {};
const bump = k => counts[k] = (counts[k]||0)+1;
for (let i=0;i<150;i++){
  const c = defaultConfig(); c.seed = 5000+i;
  const np = 3 + (i%4);
  c.players = Array.from({length:np},(_,k)=>({name:'B'+k,kind:'bot',level:'normal',color:PLAYER_COLORS[k]}));
  c.map.shape = np>4?'extended':'classic';
  c.modes.blindfold = true; c.modes.events = i%2===0; c.modes.chaosEvery = i%3===0?2:0; c.modes.fog = i%4===0;
  c.map.gold = i%5===0?2:0; c.rules.friendlyRobber = i%2===1;
  const s = createGame(c);
  while (s.phase!=='gameOver' && s.turn<800){
    const a = pendingActors(s).map(p=>botAct(s,p)).find(Boolean);
    const r = applyAction(s,a); if(!r.ok) throw new Error(r.error);
    for (const f of s.fx) bump('fx:'+f.kind + (f.kind==='devPlayed'?':'+f.card:''));
    if (a.type==='respondTrade') bump('trade:'+(a.accept?'accept':'reject'));
  }
  for (const l of s.log) { if (l.msg.includes('Choque')) bump('blindConflict'); if (l.msg.includes('Evento')) bump('events'); if (l.msg.includes('Tierra viva')) bump('chaos'); if (l.msg.includes('banco no tiene')) bump('shortage'); if(l.msg.includes('duerme')) bump('grace'); }
}
console.log(counts);
