// Headless self-play: runs many bot-only games over every map/mode combination and
// checks rule invariants after every single action.  Usage: node tests/sim.mjs [games]
import { createGame, applyAction, pendingActors, victoryPoints, handSize, canBuildRoad } from '../js/engine/game.js';
import { botAct } from '../js/engine/bot.js';
import { defaultConfig, MODES, PLAYER_COLORS } from '../js/engine/config.js';
import { SHAPES } from '../js/engine/board.js';
import { RES } from '../js/engine/constants.js';

const GAMES = +process.argv[2] || 200;
const shapes = Object.keys(SHAPES).filter(k => k !== 'custom');

function makeConfig(i) {
  const c = defaultConfig();
  c.seed = 1000 + i * 7919;
  const np = 2 + (i % 5);
  c.players = Array.from({ length: np }, (_, k) => ({ name: 'B' + k, kind: 'bot', level: ['easy', 'normal', 'hard'][(i + k) % 3], color: PLAYER_COLORS[k] }));
  c.map.shape = shapes[i % shapes.length];
  if (np > 4 && ['classic', 'mini'].includes(c.map.shape)) c.map.shape = 'extended';
  c.map.size = 18 + (i % 20);
  c.map.gold = i % 4 === 0 ? 2 : 0;
  c.map.resources = i % 3 === 0 ? 'chaos' : 'balanced';
  c.map.numbers = i % 5 === 0 ? 'random' : 'balanced';
  c.map.ports = ['normal', 'many', 'few', 'none'][i % 4];
  // toggle modes pseudo-randomly
  MODES.forEach((m, k) => m.set(c, ((i * 2654435761) >>> (k + 3)) % 3 === 0));
  if (i % 7 === 0) c.rules.vpTarget = 6 + (i % 9);
  if (i % 6 === 0) c.rules.startBonus = 1;
  if (i % 8 === 0) c.rules.setupRounds = 3;
  if (i % 9 === 0) c.rules.devDeck = ['war', 'progress', 'none'][i % 3];
  c.rules.robberGrace = i % 10 === 0 ? 2 : 0;
  return c;
}

function check(s, where) {
  const errs = [];
  const bankEach = s.bankTotal;
  for (const r of RES) {
    const tot = s.bank[r] + s.players.reduce((a, p) => a + p.res[r], 0);
    if (tot !== bankEach * RES.length / RES.length && tot !== bankEach) errs.push(`conservación ${r}: ${tot} != ${bankEach}`);
    if (s.bank[r] < 0) errs.push(`banco negativo ${r}`);
    for (const p of s.players) if (p.res[r] < 0) errs.push(`mano negativa ${p.id} ${r}`);
  }
  const R = s.config.rules;
  for (const p of s.players) {
    const setts = Object.values(s.buildings).filter(b => b.owner === p.id && b.type === 'settlement').length;
    const cities = Object.values(s.buildings).filter(b => b.owner === p.id && b.type === 'city').length;
    const roads = Object.values(s.roads).filter(o => o === p.id).length;
    const blindS = s.blind.filter(b => b.pid === p.id && b.type === 'settlement').length;
    const blindC = s.blind.filter(b => b.pid === p.id && b.type === 'city').length;
    const blindR = s.blind.filter(b => b.pid === p.id && b.eid != null).length;
    if (setts + blindS + p.settlementsLeft !== R.maxSettlements) errs.push(`poblados ${p.id}: ${setts}+${blindS}+${p.settlementsLeft}`);
    if (cities + blindC + p.citiesLeft !== R.maxCities) errs.push(`ciudades ${p.id}`);
    if (roads + blindR + p.roadsLeft !== R.maxRoads) errs.push(`caminos ${p.id}: ${roads}+${blindR}+${p.roadsLeft}`);
  }
  // distance rule
  for (const k in s.buildings) for (const u of s.board.vertices[k].adj) if (s.buildings[u]) errs.push(`distancia violada ${k}-${u}`);
  // road connectivity: every road must touch own building or own road
  if (s.phase !== 'setup' || !s.setup.blindActive)
    for (const k in s.roads) {
      const pid = s.roads[k];
      const E = s.board.edges[k];
      const ok = [E.a, E.b].some(v => (s.buildings[v] && s.buildings[v].owner === pid) || s.board.vertices[v].edges.some(e => e != k && s.roads[e] === pid));
      if (!ok) errs.push(`camino suelto ${k}`);
    }
  // dev cards conservation
  const devHeld = s.players.reduce((a, p) => a + p.dev.length, 0);
  if (devHeld + s.devDeck.length > s.devTotal) errs.push('cartas de desarrollo duplicadas');
  if (s.phase !== 'gameOver' && s.phase !== 'setup' && victoryPoints(s, s.current) >= R.vpTarget) errs.push('ganador no detectado');
  if (s.phase === 'discard' && !Object.keys(s.pendingDiscards).length) errs.push('fase descarte vacía');
  if (errs.length) throw new Error(`[${where}] ` + errs.join('; '));
}

const summary = { games: 0, finished: 0, turns: 0, byShape: {}, winnerVP: [], errors: 0 };
for (let i = 0; i < GAMES; i++) {
  const cfg = makeConfig(i);
  let s;
  try {
    s = createGame(cfg);
    let guard = 0;
    while (s.phase !== 'gameOver' && s.turn < 1500) {
      if (++guard > 200000) throw new Error('bucle infinito');
      const actors = pendingActors(s);
      let acted = false;
      for (const pid of actors) {
        const a = botAct(s, pid);
        if (!a) continue;
        const before = JSON.stringify({ bank: s.bank, res: s.players.map(p => p.res) });
        const r = applyAction(s, a);
        if (!r.ok) throw new Error(`acción ilegal del bot ${JSON.stringify(a)} en fase ${s.phase}: ${r.error}`);
        check(s, a.type);
        acted = true;
        void before;
        break;
      }
      if (!acted) throw new Error(`bloqueo: fase=${s.phase} actores=${actors} trade=${JSON.stringify(s.trade)}`);
    }
    summary.games++;
    summary.turns += s.turn;
    const sh = (summary.byShape[cfg.map.shape] ||= { n: 0, done: 0, turns: 0 });
    sh.n++;
    sh.turns += s.turn;
    if (s.phase === 'gameOver') {
      summary.finished++;
      sh.done++;
      summary.winnerVP.push(victoryPoints(s, s.winner));
    } else {
      console.log(`⚠️  partida ${i} (${cfg.map.shape}, ${cfg.players.length}p) no terminó en 1500 turnos. VP: ${s.players.map(p => victoryPoints(s, p.id)).join(',')}`);
    }
  } catch (e) {
    summary.errors++;
    console.log(`❌ partida ${i} seed=${cfg.seed} shape=${cfg.map.shape} players=${cfg.players.length} modes=${JSON.stringify(cfg.modes)} rules=${JSON.stringify(cfg.rules)}`);
    console.log('   ', e.stack.split('\n').slice(0, 4).join('\n    '));
    if (summary.errors > 5) break;
  }
}
console.log(`\nPartidas: ${summary.games}, terminadas: ${summary.finished}, errores: ${summary.errors}, turnos medios: ${(summary.turns / Math.max(1, summary.games)).toFixed(1)}`);
for (const [k, v] of Object.entries(summary.byShape)) console.log(`  ${k.padEnd(9)} ${v.done}/${v.n} terminadas, ${(v.turns / v.n).toFixed(0)} turnos`);
process.exit(summary.errors ? 1 : 0);
