// Targeted rule tests. Usage: node tests/rules.mjs
import * as G from '../js/engine/game.js';
import { defaultConfig } from '../js/engine/config.js';

let pass = 0, failN = 0;
const t = (name, fn) => {
  try {
    fn();
    pass++;
  } catch (e) {
    failN++;
    console.log('❌', name, '\n   ', e.message);
  }
};
const eq = (a, b, m = '') => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);
};
const ok = (c, m) => {
  if (!c) throw new Error(m || 'falló');
};

function fresh(mut) {
  const c = defaultConfig();
  c.seed = 99;
  c.rules.randomStart = false;
  c.players.forEach(p => (p.kind = 'bot'));
  if (mut) mut(c);
  const s = G.createGame(c);
  // skip setup: jump straight into main phase with empty board
  s.phase = 'main';
  s.turn = 1;
  s.round = 1;
  s.current = 0;
  s.setup.blindActive = false;
  return s;
}
const give = (s, pid, res) => {
  for (const [r, n] of Object.entries(res)) {
    s.players[pid].res[r] += n;
    s.bank[r] -= n;
  }
};
const act = (s, a) => G.applyAction(s, a);

// a path of edges: walk vertex -> neighbor greedily avoiding revisits
function path(s, len, start = 0) {
  const bd = s.board;
  const edges = [];
  const seen = new Set([start]);
  let v = start;
  for (let i = 0; i < len; i++) {
    const e = bd.vertices[v].edges.find(e => {
      const E = bd.edges[e];
      const u = E.a === v ? E.b : E.a;
      return !seen.has(u) && !edges.includes(e);
    });
    if (e === undefined) break;
    const E = bd.edges[e];
    v = E.a === v ? E.b : E.a;
    seen.add(v);
    edges.push(e);
  }
  return { edges, verts: [...seen] };
}

t('camino más largo: 5 tramos otorgan +2 y cortar con poblado lo quita', () => {
  const s = fresh();
  const { edges, verts } = path(s, 6);
  s.buildings[verts[0]] = { owner: 0, type: 'settlement' };
  s.players[0].settlementsLeft--;
  for (let i = 0; i < 5; i++) {
    give(s, 0, { wood: 1, brick: 1 });
    const r = act(s, { type: 'build', pid: 0, what: 'road', at: edges[i] });
    ok(r.ok, r.error);
  }
  eq(s.longestRoad.owner, 0, 'dueño');
  eq(s.players[0].roadLen, 5, 'largo');
  eq(G.victoryPoints(s, 0), 3, 'PV');
  // opponent settles in the middle of the road (vertex 3), via own road from outside
  const mid = [verts[2], verts[3], verts[1], verts[4]].find(v => s.board.vertices[v].edges.some(e => s.roads[e] === undefined));
  s.buildings[mid] = { owner: 1, type: 'settlement' };
  s.current = 1;
  // trigger recompute through a legal action: build a road for player 1 next to mid
  const e1 = s.board.vertices[mid].edges.find(e => s.roads[e] === undefined);
  give(s, 1, { wood: 1, brick: 1 });
  const r = act(s, { type: 'build', pid: 1, what: 'road', at: e1 });
  ok(r.ok, r.error);
  ok(s.players[0].roadLen < 5, 'debería romperse: ' + s.players[0].roadLen);
  eq(s.longestRoad.owner, -1, 'nadie');
});

t('regla de distancia y conexión de poblados', () => {
  const s = fresh();
  const v = 10;
  s.buildings[v] = { owner: 1, type: 'settlement' };
  const nb = s.board.vertices[v].adj[0];
  ok(!G.canSetupSettlement({ ...s, setup: { ...s.setup, blindActive: false } }, 0, nb), 'adyacente no permitido');
  give(s, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
  const r = act(s, { type: 'build', pid: 0, what: 'settlement', at: 30 });
  ok(!r.ok, 'sin camino no se puede');
});

t('producción: poblado 1, ciudad 2, ladrón bloquea', () => {
  const s = fresh();
  const tile = s.board.tiles.find(x => x.num === 8);
  const [v1, , v3] = tile.verts;
  s.buildings[v1] = { owner: 0, type: 'settlement' };
  s.buildings[v3] = { owner: 1, type: 'city' };
  s.phase = 'roll';
  s.config.rules.diceMode = 'balanced';
  s.diceDeck = [[3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [3, 5], [4, 4]];
  const b0 = s.players[0].res[tile.res], b1 = s.players[1].res[tile.res];
  act(s, { type: 'roll', pid: 0 });
  eq(s.players[0].res[tile.res] - b0, 1, 'poblado');
  eq(s.players[1].res[tile.res] - b1, 2, 'ciudad');
  s.board.robber = tile.id;
  s.phase = 'roll';
  act(s, { type: 'roll', pid: 0 });
  eq(s.players[0].res[tile.res] - b0, 1, 'bloqueado por ladrón');
});

t('7: descarta la mitad quien supera el límite', () => {
  const s = fresh();
  give(s, 1, { wood: 5, ore: 4 });
  give(s, 2, { wheat: 7 });
  s.phase = 'roll';
  s.config.rules.diceMode = 'balanced';
  s.diceDeck = Array(7).fill([3, 4]);
  act(s, { type: 'roll', pid: 0 });
  eq(s.phase, 'discard');
  eq(s.pendingDiscards, { 1: 4 });
  ok(!act(s, { type: 'discard', pid: 1, res: { wood: 3 } }).ok, 'cantidad incorrecta');
  ok(act(s, { type: 'discard', pid: 1, res: { wood: 2, ore: 2 } }).ok);
  eq(s.phase, 'robber');
});

t('ladrón: roba a una víctima adyacente', () => {
  const s = fresh();
  const tile = s.board.tiles.find(x => x.id !== s.board.robber);
  s.buildings[tile.verts[0]] = { owner: 2, type: 'settlement' };
  give(s, 2, { brick: 1 });
  s.phase = 'robber';
  const r = act(s, { type: 'moveRobber', pid: 0, tile: tile.id });
  ok(r.ok, r.error);
  eq(s.players[0].res.brick, 1);
  eq(s.players[2].res.brick, 0);
  eq(s.phase, 'main');
});

t('puertos: 3:1 y 2:1', () => {
  const s = fresh();
  const p2 = s.board.ports.find(p => p.type !== 'any');
  const v = s.board.edges[p2.edge].a;
  s.buildings[v] = { owner: 0, type: 'settlement' };
  eq(G.tradeRatio(s, 0, p2.type), 2);
  eq(G.tradeRatio(s, 1, p2.type), 4);
  give(s, 0, { [p2.type]: 2 });
  const other = ['wood', 'brick', 'sheep', 'wheat', 'ore'].find(r => r !== p2.type);
  ok(act(s, { type: 'bankTrade', pid: 0, give: p2.type, get: other }).ok);
  eq(s.players[0].res[other], 1);
});

t('cartas de desarrollo: no se juegan el turno en que se compran', () => {
  const s = fresh();
  s.devDeck.push('knight');
  give(s, 0, { sheep: 1, wheat: 1, ore: 1 });
  ok(act(s, { type: 'buyDev', pid: 0 }).ok);
  ok(!act(s, { type: 'playDev', pid: 0, card: 'knight' }).ok, 'no debería poder');
  s.turn = 5;
  ok(act(s, { type: 'playDev', pid: 0, card: 'knight' }).ok);
  eq(s.phase, 'robber');
  s.phase = 'main';
  s.players[0].dev.push({ type: 'monopoly', turn: 0 });
  ok(!act(s, { type: 'playDev', pid: 0, card: 'monopoly', res: 'ore' }).ok, 'solo una por turno');
});

t('monopolio y año de abundancia', () => {
  const s = fresh();
  give(s, 1, { ore: 3 });
  give(s, 2, { ore: 2 });
  s.players[0].dev.push({ type: 'monopoly', turn: 0 });
  ok(act(s, { type: 'playDev', pid: 0, card: 'monopoly', res: 'ore' }).ok);
  eq(s.players[0].res.ore, 5);
  const s2 = fresh();
  s2.players[0].dev.push({ type: 'yearOfPlenty', turn: 0 });
  ok(act(s2, { type: 'playDev', pid: 0, card: 'yearOfPlenty', res: ['wood', 'wood'] }).ok);
  eq(s2.players[0].res.wood, 2);
});

t('ejército más grande con 3 caballeros', () => {
  const s = fresh(c => (c.rules.noRobber = true));
  for (let i = 0; i < 3; i++) {
    s.players[0].dev.push({ type: 'knight', turn: 0 });
    s.devPlayed = false;
    ok(act(s, { type: 'playDev', pid: 0, card: 'knight' }).ok);
  }
  eq(s.largestArmy.owner, 0);
  eq(G.victoryPoints(s, 0), 2);
});

t('escasez del banco: nadie cobra si no alcanza para todos', () => {
  const s = fresh();
  const tile = s.board.tiles.find(x => x.num === 6);
  s.buildings[tile.verts[0]] = { owner: 0, type: 'city' };
  s.buildings[tile.verts[3]] = { owner: 1, type: 'city' };
  const r = tile.res;
  const extra = s.bank[r] - 3;
  s.players[2].res[r] += extra;
  s.bank[r] = 3;
  s.phase = 'roll';
  s.config.rules.diceMode = 'balanced';
  s.diceDeck = Array(7).fill([3, 3]);
  act(s, { type: 'roll', pid: 0 });
  eq(s.players[0].res[r], 0);
  eq(s.bank[r], 3);
});

t('victoria solo en tu turno', () => {
  const s = fresh(c => (c.rules.vpTarget = 3));
  for (const v of [0, 20, 40]) s.buildings[v] = { owner: 1, type: 'settlement' };
  give(s, 0, { wood: 4 });
  ok(act(s, { type: 'bankTrade', pid: 0, give: 'wood', get: 'ore' }).ok);
  eq(s.phase, 'main', 'P1 no gana en el turno de P0');
  act(s, { type: 'endTurn', pid: 0 });
  eq(s.winner, 1, 'gana al empezar su turno');
  eq(s.phase, 'gameOver');
});

t('intercambio entre jugadores', () => {
  const s = fresh();
  give(s, 0, { wood: 2 });
  give(s, 1, { ore: 1 });
  ok(act(s, { type: 'proposeTrade', pid: 0, give: { wood: 2 }, get: { ore: 1 }, to: [1, 2] }).ok);
  ok(!act(s, { type: 'respondTrade', pid: 2, accept: true }).ok, 'P2 no tiene mineral');
  ok(act(s, { type: 'respondTrade', pid: 1, accept: true }).ok);
  ok(act(s, { type: 'confirmTrade', pid: 0, with: 1 }).ok);
  eq(s.players[0].res.ore, 1);
  eq(s.players[1].res.wood, 2);
});

t('blindfold: choque en el mismo vértice obliga a reubicar', () => {
  const c = defaultConfig();
  c.seed = 5;
  c.rules.randomStart = false;
  c.modes.blindfold = true;
  c.players = c.players.slice(0, 2);
  const s = G.createGame(c);
  const v = 12;
  const e0 = s.board.vertices[v].edges[0];
  ok(act(s, { type: 'placeSettlement', pid: 0, vid: v }).ok);
  ok(act(s, { type: 'placeRoad', pid: 0, eid: e0 }).ok);
  ok(act(s, { type: 'placeSettlement', pid: 1, vid: v }).ok, 'P1 no ve la casa de P0');
  ok(act(s, { type: 'placeRoad', pid: 1, eid: s.board.vertices[v].edges[1] }).ok);
  eq(Object.keys(s.buildings).length, 0, 'nada visible todavía');
  const far = s.board.vertices.filter(x => x.id !== v && !x.adj.includes(v) && !s.board.vertices[v].adj.some(u => x.adj.includes(u)));
  const a1 = far[5].id, a2 = far.find(x => x.id !== a1 && !x.adj.includes(a1) && !x.adj.some(u => far[5].adj.includes(u))).id;
  ok(act(s, { type: 'placeSettlement', pid: 1, vid: a1 }).ok, 'P1 ronda 2');
  ok(act(s, { type: 'placeRoad', pid: 1, eid: s.board.vertices[a1].edges[0] }).ok);
  ok(act(s, { type: 'placeSettlement', pid: 0, vid: a2 }).ok, 'P0 ronda 2');
  ok(act(s, { type: 'placeRoad', pid: 0, eid: s.board.vertices[a2].edges[0] }).ok);
  eq(s.phase, 'setup', 'fase de reubicación');
  ok(s.setup.fixing, 'reubicando');
  eq(s.current, 1, 'P1 reubica');
  eq(s.buildings[v].owner, 0, 'P0 llegó primero');
});

t('volteado: casillas boca abajo durante la colocación, casas visibles, y se voltea todo al terminar', () => {
  const c = defaultConfig();
  c.seed = 8;
  c.rules.randomStart = false;
  c.modes.flipped = true;
  c.players = c.players.slice(0, 2).map(p => ({ ...p, kind: 'bot' }));
  const s = G.createGame(c);
  ok(s.board.tiles.every(t => !t.revealed), 'todo boca abajo');
  ok(act(s, { type: 'placeSettlement', pid: 0, vid: 12 }).ok);
  eq(s.buildings[12].owner, 0, 'la casa es visible para todos');
  ok(s.board.tiles.every(t => !t.revealed), 'poner casa no revela');
  ok(act(s, { type: 'placeRoad', pid: 0, eid: G.legalSetupRoads(s, 0)[0] }).ok);
  for (const pid of [1, 1, 0]) {
    const v = G.legalSetupSettlements(s, pid)[5];
    ok(act(s, { type: 'placeSettlement', pid, vid: v }).ok);
    ok(act(s, { type: 'placeRoad', pid, eid: G.legalSetupRoads(s, pid)[0] }).ok);
  }
  eq(s.phase, 'roll');
  ok(s.board.tiles.every(t => t.revealed && t.numRevealed), 'todo volteado');
  ok(s.fx.some(f => f.kind === 'flipAll'), 'animación de volteo');
});

t('niebla: solo ves lo tuyo; construir sobre alguien oculto te desvía al hueco más cercano', () => {
  const c = defaultConfig();
  c.seed = 3;
  c.rules.randomStart = false;
  c.modes.fog = true;
  c.players = c.players.slice(0, 2).map(p => ({ ...p, kind: 'bot' }));
  const s = G.createGame(c);
  const v0 = s.board.vertices.find(x => x.hexes.length === 3).id;
  ok(act(s, { type: 'placeSettlement', pid: 0, vid: v0 }).ok);
  ok(act(s, { type: 'placeRoad', pid: 0, eid: G.legalSetupRoads(s, 0)[0] }).ok);
  const v1 = G.viewFor(s, 1);
  eq(Object.keys(v1.buildings).length, 0, 'P1 no ve la casa de P0');
  ok(v1.board.tiles.every(t => !t.numRevealed), 'P1 lo ve todo oscuro');
  eq(G.viewFor(s, 0).board.tiles.filter(t => t.numRevealed).length, 3, 'P0 ve sus 3 casillas');
  const target = s.board.vertices[v0].adj[0];
  const r = act(s, { type: 'placeSettlement', pid: 1, vid: target });
  ok(r.ok, r.error);
  ok(s.fx.some(f => f.kind === 'relocated'), 'se desvió');
  const placed = Object.keys(s.buildings).map(Number).find(v => s.buildings[v].owner === 1);
  ok(placed !== target, 'no quedó donde apuntó');
  ok(!s.board.vertices[placed].adj.some(u => s.buildings[u]), 'respeta la distancia');
  ok(G.viewFor(s, 1).buildings[v0], 'P1 descubrió la casa de P0');
});

t('retirarse en su turno: pasa al siguiente, devuelve su mano y pierde premios', () => {
  const s = fresh();
  give(s, 0, { wood: 3, ore: 2 });
  s.largestArmy = { owner: 0, count: 3 };
  s.players[0].knights = 3;
  s.players[2].knights = 4;
  const bankWood = s.bank.wood;
  ok(act(s, { type: 'retirePlayer', pid: 0 }).ok);
  ok(s.players[0].retired);
  eq(s.current, 1, 'turno del siguiente');
  eq(s.phase, 'roll');
  eq(s.bank.wood, bankWood + 3, 'mano al banco');
  eq(s.largestArmy.owner, 2, 'el ejército pasa al que más tiene');
  // turn order skips the retired seat
  s.phase = 'main';
  s.current = 3;
  ok(act(s, { type: 'endTurn', pid: 3 }).ok);
  eq(s.current, 1, 'salta al retirado');
  eq(s.round, 2, 'nueva ronda al dar la vuelta');
});

t('retirarse durante la colocación inicial y relevo por bot', () => {
  const c = defaultConfig();
  c.seed = 11;
  c.rules.randomStart = false;
  c.players = c.players.map(p => ({ ...p, kind: 'bot' }));
  const s = G.createGame(c);
  ok(act(s, { type: 'retirePlayer', pid: 0 }).ok, 'retira al que coloca');
  eq(s.current, 1);
  ok(s.setup.queue.every((e, i) => i < s.setup.idx || e.pid !== 0), 'sin turnos pendientes del retirado');
  ok(act(s, { type: 'setController', pid: 1, kind: 'human' }).ok);
  eq(s.players[1].kind, 'human');
  ok(act(s, { type: 'retirePlayer', pid: 2 }).ok);
  ok(!act(s, { type: 'retirePlayer', pid: 3 }).ok, 'deben quedar 2');
});

t('ADHD: la victoria cuenta para cualquiera, en cualquier momento, y no corta el trato', () => {
  const s = fresh();
  give(s, 0, { wood: 1 });
  ok(act(s, { type: 'proposeTrade', pid: 0, give: { wood: 1 }, get: { brick: 1 } }).ok, 'oferta');
  ok(act(s, { type: 'adhdWin', pid: 0 }).ok);
  ok(act(s, { type: 'adhdWin', pid: 2 }).ok, 'fuera de turno también');
  ok(act(s, { type: 'adhdWin', pid: 0 }).ok);
  eq(s.players.map(p => p.adhdWins), [2, 0, 1, 0]);
  ok(s.trade, 'el trato sigue en la mesa');
  eq(s.fx, [{ kind: 'cheer', pid: 0, n: 2 }]);
});

t('historial de tiradas: quién y cuánto, como mucho 30', () => {
  const s = fresh();
  for (let i = 0; i < 35; i++) {
    s.phase = 'roll';
    s.current = i % 4;
    ok(act(s, { type: 'roll', pid: s.current }).ok);
    s.pendingDiscards = {};
  }
  eq(s.rollLog.length, 30);
  const last = s.rollLog[29];
  eq(last.pid, 34 % 4);
  eq(last.sum, s.dice[0] + s.dice[1]);
});

console.log(`\n${pass} ok, ${failN} fallos`);
process.exit(failN ? 1 : 0);
