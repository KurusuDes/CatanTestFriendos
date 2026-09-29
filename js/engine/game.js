// Pure rules engine. The whole game is one JSON-serializable state object that is
// mutated only through applyAction(). No DOM access here: it runs in Node for tests.
import { RES, COSTS, DEV_DECKS, EVENTS, TILE_INFO, DEV_INFO } from './constants.js';
import { rand, randInt, shuffle, pick } from './rng.js';
import { generateBoard } from './board.js';

export const zeroRes = () => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const handSize = h => RES.reduce((a, r) => a + (h[r] || 0), 0);
export const canAfford = (h, cost) => Object.entries(cost).every(([r, n]) => (h[r] || 0) >= n);
const resName = r => `:${r}:`;

class GameError extends Error {}
class Blocked extends Error {}
const fail = m => {
  throw new GameError(m);
};

function log(s, msg, pid = -1) {
  s.log.push({ turn: s.turn, pid, msg });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function buildDevDeck(config, n, rng) {
  const d = DEV_DECKS[config.rules.devDeck] || DEV_DECKS.normal;
  const big = n > 4;
  const deck = [];
  const add = (type, k) => { for (let i = 0; i < k; i++) deck.push(type); };
  add('knight', d.knight + (big && d.knight ? 6 : 0));
  add('vp', d.vp);
  add('roadBuilding', d.roadBuilding + (big && d.roadBuilding ? 1 : 0));
  add('yearOfPlenty', d.yearOfPlenty + (big && d.yearOfPlenty ? 1 : 0));
  add('monopoly', d.monopoly + (big && d.monopoly ? 1 : 0));
  return shuffle(rng, deck);
}

export function createGame(configIn) {
  const config = JSON.parse(JSON.stringify(configIn));
  const R = config.rules, M = config.modes;
  const rng = { s: (config.seed >>> 0) || 12345 };
  const n = config.players.length;
  const board = generateBoard(config, rng);
  const bankEach = n > 4 ? 24 : 19;
  const s = {
    v: 1,
    config,
    rng,
    board,
    players: config.players.map((p, i) => ({
      id: i, name: p.name, color: p.color, kind: p.kind, level: p.level || 'normal',
      res: zeroRes(), dev: [], knights: 0, roadLen: 0,
      roadsLeft: R.maxRoads, settlementsLeft: R.maxSettlements, citiesLeft: R.maxCities,
      stats: { gained: 0, stolen: 0, lost: 0 },
    })),
    buildings: {},
    roads: {},
    blind: [],
    bank: Object.fromEntries(RES.map(r => [r, bankEach])),
    bankTotal: bankEach,
    devDeck: [],
    devTotal: 0,
    phase: 'setup',
    current: 0,
    first: 0,
    turn: 0,
    round: 0,
    setup: null,
    dice: null,
    diceDeck: [],
    pendingDiscards: {},
    robberReturn: 'main',
    freeRoads: 0,
    devPlayed: false,
    trade: null,
    tradeSeq: 0,
    longestRoad: { owner: -1, len: 0 },
    largestArmy: { owner: -1, count: 0 },
    event: null,
    winner: null,
    log: [],
    fx: [],
    stats: { rolls: Array(13).fill(0) },
    actions: 0,
  };
  s.devDeck = buildDevDeck(config, n, rng);
  s.devTotal = s.devDeck.length;

  if (M.flipped) {
    // Volteado: every tile starts face down until the initial placement ends
    for (const t of board.tiles) t.revealed = t.numRevealed = false;
  } else if (M.hiddenNumbers) {
    for (const t of board.tiles) t.numRevealed = false;
  }

  if (R.startBonus > 0)
    for (const p of s.players)
      for (const r of RES) {
        const k = Math.min(R.startBonus, s.bank[r]);
        p.res[r] += k;
        s.bank[r] -= k;
      }

  s.first = R.randomStart ? randInt(rng, n) : 0;
  const order = [...Array(n).keys()].map(i => (i + s.first) % n);
  const queue = [];
  for (let round = 0; round < R.setupRounds; round++) {
    const o = round % 2 === 0 ? order : [...order].reverse();
    for (const pid of o) queue.push({ pid, round });
  }
  s.setup = { queue, idx: 0, step: 'settlement', lastVid: null, blindActive: !!M.blindfold, lastRound: R.setupRounds - 1, fixing: false };
  s.current = queue[0].pid;
  log(s, `¡Empieza la partida! Mapa: ${board.tiles.length} hexágonos.`);
  if (M.flipped) log(s, '🔄 Tablero volteado: coloca tus casas sin saber qué hay debajo.');
  if (M.blindfold) log(s, '🤫 Casas secretas: nadie ve dónde pones hasta la revelación.');
  if (M.fog) log(s, '🌑 Niebla de guerra: solo ves lo que rodea a tus piezas.');
  return s;
}

// ---------------- queries ----------------
export const B = s => s.board;

// ---- Fog of war: per-player vision ----
// Houses light a circle that covers the three surrounding tiles; roads light a
// half-tile band on each side (you see the terrain but not the number token).
export const VISION = { house: 1.25, road: 0.55 };

export function visionOf(s, pid) {
  const bd = s.board;
  const circles = [], caps = [];
  const house = v => circles.push([bd.vertices[v].x, bd.vertices[v].y, VISION.house]);
  const road = e => {
    const E = bd.edges[e], a = bd.vertices[E.a], b = bd.vertices[E.b];
    caps.push([a.x, a.y, b.x, b.y, VISION.road]);
  };
  for (const k in s.buildings) if (s.buildings[k].owner === pid) house(+k);
  for (const k in s.roads) if (s.roads[k] === pid) road(+k);
  for (const b of s.blind || []) if (b.pid === pid) {
    house(b.vid);
    if (b.eid != null) road(b.eid);
  }
  return { circles, caps };
}

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

// how deep (x,y) lies inside the lit area (> 0 means visible)
export function visibility(vis, x, y) {
  let best = -Infinity;
  for (const [cx, cy, r] of vis.circles) best = Math.max(best, r - Math.hypot(x - cx, y - cy));
  for (const [x1, y1, x2, y2, r] of vis.caps) best = Math.max(best, r - segDist(x, y, x1, y1, x2, y2));
  return best;
}

// What `pid` knows: other players' pieces outside their vision are removed and
// unseen tiles are marked hidden. Used by the UI and by bots (so they don't cheat).
export function viewFor(s, pid) {
  if (!s.config.modes.fog || pid == null || pid < 0 || s.phase === 'gameOver') return s;
  const vis = visionOf(s, pid);
  const bd = s.board;
  const buildings = {}, roads = {};
  const disc = (s.discovered && s.discovered[pid]) || { v: [], e: [] };
  for (const k in s.buildings) {
    const b = s.buildings[k], V = bd.vertices[k];
    if (b.owner === pid || visibility(vis, V.x, V.y) > 0 || disc.v.includes(+k)) buildings[k] = b;
  }
  for (const k in s.roads) {
    const E = bd.edges[k], a = bd.vertices[E.a], c = bd.vertices[E.b];
    if (s.roads[k] === pid || visibility(vis, (a.x + c.x) / 2, (a.y + c.y) / 2) > 0 || disc.e.includes(+k)) roads[k] = s.roads[k];
  }
  const tiles = bd.tiles.map(t => {
    const lit = visibility(vis, t.x, t.y);
    return { ...t, revealed: t.revealed && lit > -0.86, numRevealed: t.numRevealed && lit > 0 };
  });
  const robberSeen = bd.robber >= 0 && tiles[bd.robber].numRevealed;
  return { ...s, buildings, roads, board: { ...bd, tiles, robberHidden: !robberSeen }, vision: vis };
}

export function victoryPoints(s, pid, hidden = true) {
  let vp = 0;
  for (const k in s.buildings) {
    const b = s.buildings[k];
    if (b.owner === pid) vp += b.type === 'city' ? 2 : 1;
  }
  if (s.longestRoad.owner === pid) vp += 2;
  if (s.largestArmy.owner === pid) vp += 2;
  if (hidden) vp += s.players[pid].dev.filter(c => c.type === 'vp').length;
  return vp;
}

export function tradeRatio(s, pid, res) {
  let best = 4;
  if (s.event && s.event.id === 'fairTrade') best = 3;
  if (s.event && s.event.id === 'blackMarket' && s.event.res === res) best = 2;
  for (const k in s.buildings) {
    if (s.buildings[k].owner !== pid) continue;
    const port = s.board.vertices[k].port;
    if (port === null || port === undefined) continue;
    const p = s.board.ports[port];
    if (p.type === 'any') best = Math.min(best, 3);
    else if (p.type === res) best = Math.min(best, 2);
  }
  return best;
}

function ownBlind(s, pid) {
  const own = s.blind.filter(b => b.pid === pid);
  return { verts: new Set(own.map(b => b.vid)), edges: new Set(own.filter(b => b.eid != null).map(b => b.eid)) };
}

function vertexOpen(s, v) {
  if (s.buildings[v]) return false;
  return !s.board.vertices[v].adj.some(u => s.buildings[u]);
}

export function canSetupSettlement(s, pid, v) {
  if (!s.board.vertices[v]) return false;
  if (s.setup.blindActive) {
    const { verts } = ownBlind(s, pid);
    if (verts.has(v)) return false;
    return !s.board.vertices[v].adj.some(u => verts.has(u));
  }
  return vertexOpen(s, v) && s.board.vertices[v].edges.some(e => s.roads[e] === undefined);
}

export function canSetupRoad(s, pid, e) {
  const E = s.board.edges[e];
  if (!E || (E.a !== s.setup.lastVid && E.b !== s.setup.lastVid)) return false;
  if (s.setup.blindActive) return !ownBlind(s, pid).edges.has(e);
  return s.roads[e] === undefined;
}

export function canBuildRoad(s, pid, e) {
  const E = s.board.edges[e];
  if (!E || s.roads[e] !== undefined) return false;
  for (const v of [E.a, E.b]) {
    const b = s.buildings[v];
    if (b && b.owner === pid) return true;
    if (b) continue; // opponent building blocks continuing through this vertex
    if (s.board.vertices[v].edges.some(x => x !== e && s.roads[x] === pid)) return true;
  }
  return false;
}

export function canBuildSettlement(s, pid, v) {
  if (!s.board.vertices[v] || !vertexOpen(s, v)) return false;
  return s.board.vertices[v].edges.some(e => s.roads[e] === pid);
}

export const canBuildCity = (s, pid, v) => {
  const b = s.buildings[v];
  return !!b && b.owner === pid && b.type === 'settlement';
};

export function legalSetupSettlements(s, pid) {
  return s.board.vertices.filter(v => canSetupSettlement(s, pid, v.id)).map(v => v.id);
}
export function legalSetupRoads(s, pid) {
  const v = s.board.vertices[s.setup.lastVid];
  return v ? v.edges.filter(e => canSetupRoad(s, pid, e)) : [];
}
export function legalRoads(s, pid) {
  return s.board.edges.filter(e => canBuildRoad(s, pid, e.id)).map(e => e.id);
}
export function legalSettlements(s, pid) {
  return s.board.vertices.filter(v => canBuildSettlement(s, pid, v.id)).map(v => v.id);
}
export function legalCities(s, pid) {
  return Object.keys(s.buildings).map(Number).filter(v => canBuildCity(s, pid, v));
}

function friendlyProtected(s, pid) {
  return s.config.rules.friendlyRobber && victoryPoints(s, pid, false) <= 2;
}

export function robberVictims(s, pid, tile) {
  const t = s.board.tiles[tile];
  if (!t) return [];
  const out = new Set();
  for (const v of t.verts) {
    const b = s.buildings[v];
    if (b && b.owner !== pid && handSize(s.players[b.owner].res) > 0) out.add(b.owner);
  }
  return [...out];
}

export const stealTargets = (s, pid, tile) => robberVictims(s, pid, tile).filter(v => !friendlyProtected(s, v));

export function legalRobberTiles(s, pid) {
  const all = s.board.tiles.filter(t => t.id !== s.board.robber).map(t => t.id);
  if (!s.config.rules.friendlyRobber) return all;
  const ok = all.filter(id =>
    !s.board.tiles[id].verts.some(v => {
      const b = s.buildings[v];
      return b && b.owner !== pid && friendlyProtected(s, b.owner);
    })
  );
  return ok.length ? ok : all;
}

export function playableDev(s, pid) {
  if (s.devPlayed) return [];
  const p = s.players[pid];
  const types = new Set();
  for (const c of p.dev) {
    if (c.type === 'vp' || c.turn >= s.turn) continue;
    if (s.phase === 'main' || (s.phase === 'roll' && c.type === 'knight')) types.add(c.type);
  }
  return [...types];
}

// Which players must act right now.
export function pendingActors(s) {
  if (s.phase === 'gameOver') return [];
  if (s.phase === 'setup') return [s.setup.queue[s.setup.idx].pid];
  if (s.phase === 'discard') return Object.keys(s.pendingDiscards).map(Number);
  const out = [s.current];
  if (s.trade) for (const pid of s.trade.to) if (s.trade.responses[pid] == null) out.push(pid);
  return out;
}

// ---------------- internal helpers ----------------
function pay(s, pid, cost) {
  const p = s.players[pid];
  for (const [r, k] of Object.entries(cost)) {
    p.res[r] -= k;
    s.bank[r] += k;
  }
}

function giveFromBank(s, pid, r, k) {
  const g = Math.min(k, s.bank[r]);
  s.bank[r] -= g;
  s.players[pid].res[r] += g;
  s.players[pid].stats.gained += g;
  return g;
}

function revealAround(s, v) {
  if (s.config.modes.flipped && s.phase === 'setup') return;
  for (const h of s.board.vertices[v].hexes) {
    const t = s.board.tiles[h];
    if (!t.revealed || !t.numRevealed) {
      t.revealed = t.numRevealed = true;
      s.fx.push({ kind: 'revealTile', tile: h });
    }
  }
}

function roadLength(s, pid) {
  const bd = s.board;
  const starts = new Set();
  for (const k in s.roads) if (s.roads[k] === pid) {
    starts.add(bd.edges[k].a);
    starts.add(bd.edges[k].b);
  }
  if (!starts.size) return 0;
  let best = 0;
  const used = new Set();
  const blocked = v => {
    const b = s.buildings[v];
    return b && b.owner !== pid;
  };
  const dfs = (v, len) => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const e of bd.vertices[v].edges) {
      if (s.roads[e] !== pid || used.has(e)) continue;
      used.add(e);
      const E = bd.edges[e];
      dfs(E.a === v ? E.b : E.a, len + 1);
      used.delete(e);
    }
  };
  for (const v of starts) dfs(v, 0);
  return best;
}

function updateLongestRoad(s) {
  const lens = s.players.map(p => (p.roadLen = roadLength(s, p.id)));
  const cur = s.longestRoad.owner;
  const max = Math.max(...lens);
  let owner;
  if (cur >= 0 && lens[cur] >= 5 && lens[cur] === max) owner = cur;
  else {
    const top = lens.map((l, i) => i).filter(i => lens[i] === max);
    owner = max >= 5 && top.length === 1 ? top[0] : -1;
  }
  if (owner !== cur) {
    if (owner >= 0) {
      log(s, `🛣️ @${owner} consigue el Camino más largo (${max}).`, owner);
      s.fx.push({ kind: 'award', what: 'road', pid: owner });
    } else log(s, '🛣️ Nadie tiene el Camino más largo ahora.');
  }
  s.longestRoad = { owner, len: owner >= 0 ? lens[owner] : 0 };
}

function updateLargestArmy(s, pid) {
  const p = s.players[pid];
  const la = s.largestArmy;
  if (p.knights >= 3 && la.owner !== pid && p.knights > la.count) {
    s.largestArmy = { owner: pid, count: p.knights };
    log(s, `⚔️ @${pid} consigue el Ejército más grande (${p.knights}).`, pid);
    s.fx.push({ kind: 'award', what: 'army', pid });
  } else if (la.owner === pid) la.count = p.knights;
}

function checkWin(s) {
  if (s.phase === 'setup' || s.phase === 'gameOver') return;
  const vp = victoryPoints(s, s.current);
  if (vp >= s.config.rules.vpTarget) {
    s.winner = s.current;
    s.phase = 'gameOver';
    s.trade = null;
    log(s, `🏆 ¡@${s.current} gana la partida con ${vp} puntos!`, s.current);
    s.fx.push({ kind: 'win', pid: s.current });
  }
}

function stealRandom(s, from, to) {
  const p = s.players[from];
  const bag = [];
  for (const r of RES) for (let i = 0; i < p.res[r]; i++) bag.push(r);
  if (!bag.length) return null;
  const r = pick(s.rng, bag);
  p.res[r]--;
  s.players[to].res[r]++;
  s.players[to].stats.stolen++;
  p.stats.lost++;
  return r;
}

function produce(s, sum) {
  const bd = s.board;
  const mult = (s.config.rules.productionMult || 1) * (s.event && s.event.id === 'bonanza' ? 2 : 1);
  const gains = s.players.map(() => zeroRes());
  for (const t of bd.tiles) {
    if (t.num !== sum || t.id === bd.robber) continue;
    if (s.event && s.event.id === 'drought' && s.event.res === t.res) continue;
    if (t.res === 'desert') continue;
    let produced = false;
    for (const v of t.verts) {
      const b = s.buildings[v];
      if (!b) continue;
      const amt = (b.type === 'city' ? 2 : 1) * mult;
      let r = t.res;
      if (r === 'gold') {
        // gold gives the resource the player has least of (hand + pending gains)
        const p = s.players[b.owner];
        r = RES.reduce((best, x) => (p.res[x] + gains[b.owner][x] < p.res[best] + gains[b.owner][best] ? x : best), RES[0]);
      }
      gains[b.owner][r] += amt;
      produced = true;
    }
    if (produced && t.revealed && !t.numRevealed) {
      t.numRevealed = true;
      s.fx.push({ kind: 'revealTile', tile: t.id });
    }
  }
  for (const r of RES) {
    const receivers = gains.map((g, i) => i).filter(i => gains[i][r] > 0);
    const total = receivers.reduce((a, i) => a + gains[i][r], 0);
    if (!total) continue;
    if (total > s.bank[r] && receivers.length > 1) {
      log(s, `🏦 El banco no tiene suficiente ${resName(r)}: nadie lo recibe.`);
      continue;
    }
    for (const i of receivers) {
      const g = giveFromBank(s, i, r, gains[i][r]);
      if (g) s.fx.push({ kind: 'gain', pid: i, res: r, n: g });
    }
  }
  const summary = gains
    .map((g, i) => {
      const parts = RES.filter(r => g[r]).map(r => `${g[r]}${resName(r)}`);
      return parts.length ? `@${i} ${parts.join(' ')}` : null;
    })
    .filter(Boolean);
  if (summary.length) log(s, `📦 ${summary.join(' · ')}`);
}

function rollDice(s) {
  if (s.config.rules.diceMode === 'balanced') {
    if (s.diceDeck.length < 6) {
      s.diceDeck = [];
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) s.diceDeck.push([a, b]);
      shuffle(s.rng, s.diceDeck);
    }
    return s.diceDeck.pop();
  }
  return [1 + randInt(s.rng, 6), 1 + randInt(s.rng, 6)];
}

function randomLandTile(s, exclude) {
  const ids = s.board.tiles.map(t => t.id).filter(id => id !== exclude);
  return pick(s.rng, ids);
}

function startRound(s) {
  const M = s.config.modes;
  // Tierra viva: reshuffle numbers/resources every N rounds
  if (M.chaosEvery > 0 && s.round > 1 && (s.round - 1) % M.chaosEvery === 0) {
    const tiles = s.board.tiles.filter(t => t.res !== 'desert');
    if (M.chaosWhat !== 'resources') {
      const nums = shuffle(s.rng, tiles.map(t => t.num));
      tiles.forEach((t, i) => (t.num = nums[i]));
    }
    if (M.chaosWhat !== 'numbers') {
      const res = shuffle(s.rng, tiles.map(t => t.res));
      tiles.forEach((t, i) => (t.res = res[i]));
    }
    log(s, '🌀 ¡Tierra viva! El mapa se ha reordenado.');
    s.fx.push({ kind: 'chaos' });
  }
  if (!M.events) return;
  const ev = { ...pick(s.rng, EVENTS) };
  delete ev.desc;
  s.event = { id: ev.id, name: ev.name, icon: ev.icon };
  const E = s.event;
  const leader = () => s.players.map(p => p.id).sort((a, b) => victoryPoints(s, b, false) - victoryPoints(s, a, false))[0];
  switch (E.id) {
    case 'drought':
    case 'blackMarket':
      E.res = pick(s.rng, RES);
      break;
    case 'earthquake': {
      const tiles = s.board.tiles.filter(t => t.num);
      if (tiles.length >= 2) {
        const a = pick(s.rng, tiles);
        const b = pick(s.rng, tiles.filter(t => t !== a));
        [a.num, b.num] = [b.num, a.num];
        E.tiles = [a.id, b.id];
      }
      break;
    }
    case 'storm':
      if (!s.config.rules.noRobber) {
        s.board.robber = randomLandTile(s, s.board.robber);
        E.tile = s.board.robber;
      }
      break;
    case 'gift':
      for (const p of s.players) {
        const r = pick(s.rng, RES);
        giveFromBank(s, p.id, r, 1);
      }
      break;
    case 'plague':
      for (const p of s.players) {
        if (handSize(p.res) < 6) continue;
        const bag = RES.flatMap(r => Array(p.res[r]).fill(r));
        const r = pick(s.rng, bag);
        p.res[r]--;
        s.bank[r]++;
      }
      break;
    case 'tax': {
      const l = leader();
      const p = s.players[l];
      const bag = RES.flatMap(r => Array(p.res[r]).fill(r));
      if (bag.length) {
        const r = pick(s.rng, bag);
        p.res[r]--;
        s.bank[r]++;
      }
      E.pid = l;
      break;
    }
    case 'rebellion': {
      const last = s.players.map(p => p.id).sort((a, b) => victoryPoints(s, a, false) - victoryPoints(s, b, false))[0];
      for (let i = 0; i < 2; i++) giveFromBank(s, last, pick(s.rng, RES), 1);
      E.pid = last;
      break;
    }
  }
  const extra = E.res ? ` (${resName(E.res)})` : E.pid != null ? ` (@${E.pid})` : '';
  log(s, `${E.icon} Evento de la ronda ${s.round}: ${E.name}${extra}.`);
  s.fx.push({ kind: 'event', event: E });
}

function beginTurns(s) {
  if (s.config.modes.flipped) {
    const hideNums = s.config.modes.hiddenNumbers;
    for (const t of s.board.tiles) {
      t.revealed = true;
      t.numRevealed = !hideNums;
    }
    if (hideNums) for (const k in s.buildings) for (const h of s.board.vertices[k].hexes) s.board.tiles[h].numRevealed = true;
    for (const [pid, vid] of s.setup.pendingRes || []) setupResources(s, pid, vid);
    s.setup.pendingRes = [];
    s.fx.push({ kind: 'flipAll' });
    log(s, '🔄 ¡Se voltea el tablero! Ahora todos ven qué hay debajo.');
  }
  s.phase = 'roll';
  s.current = s.first;
  s.turn = 1;
  s.round = 1;
  s.setup.blindActive = false;
  updateLongestRoad(s);
  log(s, `🎲 Turno de @${s.current}.`, s.current);
  startRound(s);
}

function setupResources(s, pid, v) {
  for (const h of s.board.vertices[v].hexes) {
    const t = s.board.tiles[h];
    if (RES.includes(t.res)) giveFromBank(s, pid, t.res, 1);
    else if (t.res === 'gold') giveFromBank(s, pid, pick(s.rng, RES), 1);
  }
}

function advanceSetup(s) {
  const st = s.setup;
  st.idx++;
  st.step = 'settlement';
  st.lastVid = null;
  if (st.idx < st.queue.length) {
    s.current = st.queue[st.idx].pid;
    return;
  }
  if (st.blindActive) {
    resolveBlind(s);
    if (s.phase === 'setup') return;
  }
  beginTurns(s);
}

// Reveal blindfold placements; conflicting ones must be placed again.
function resolveBlind(s) {
  const st = s.setup;
  st.blindActive = false;
  const fix = [];
  const accepted = [];
  for (const b of s.blind) {
    if (vertexOpen(s, b.vid)) {
      const p = s.players[b.pid];
      const isCity = b.type === 'city';
      s.buildings[b.vid] = { owner: b.pid, type: b.type };
      if (b.eid != null && s.roads[b.eid] === undefined) {
        s.roads[b.eid] = b.pid;
      } else if (b.eid != null) {
        p.roadsLeft++;
        fix.push({ pid: b.pid, round: b.round, roadOnly: true, vid: b.vid });
      }
      accepted.push(b);
      void isCity;
    } else {
      const p = s.players[b.pid];
      if (b.type === 'city') p.citiesLeft++;
      else p.settlementsLeft++;
      if (b.eid != null) p.roadsLeft++;
      fix.push({ pid: b.pid, round: b.round });
      log(s, `💥 ¡Choque! La casa secreta de @${b.pid} coincidía con otra. Debe reubicarla.`, b.pid);
    }
  }
  s.fx.push({ kind: 'blindReveal', placements: s.blind.map(b => ({ pid: b.pid, vid: b.vid, eid: b.eid, ok: accepted.includes(b) })) });
  for (const b of accepted) {
    revealAround(s, b.vid);
    if (b.round === st.lastRound) {
      if (s.config.modes.flipped) (st.pendingRes = st.pendingRes || []).push([b.pid, b.vid]);
      else setupResources(s, b.pid, b.vid);
    }
  }
  log(s, `🙈 ¡Revelación! Todas las casas iniciales ya son visibles.`);
  s.blind = [];
  if (fix.length) {
    st.queue = fix;
    st.idx = 0;
    st.fixing = true;
    st.step = fix[0].roadOnly ? 'road' : 'settlement';
    st.lastVid = fix[0].roadOnly ? fix[0].vid : null;
    s.current = fix[0].pid;
    s.phase = 'setup';
  } else {
    s.phase = 'roll';
  }
}

function nextFixOrBegin(s) {
  const st = s.setup;
  st.idx++;
  if (st.idx < st.queue.length) {
    const f = st.queue[st.idx];
    s.current = f.pid;
    st.step = f.roadOnly ? 'road' : 'settlement';
    st.lastVid = f.roadOnly ? f.vid : null;
    return;
  }
  beginTurns(s);
}

// ---- fog relocation ----
// In fog mode a move that looks legal to the player (given what they can see) but
// collides with an unseen piece is moved to a random nearest legal spot.
function nearest(s, kind, from, ok) {
  const bd = s.board;
  const seen = new Set([from]);
  let level = [from];
  while (level.length) {
    const hits = level.filter(x => x !== from && ok(x));
    if (hits.length) return pick(s.rng, hits);
    const next = [];
    for (const x of level) {
      const nbs = kind === 'vertex' ? bd.vertices[x].adj : [bd.edges[x].a, bd.edges[x].b].flatMap(v => bd.vertices[v].edges);
      for (const y of nbs) if (!seen.has(y)) {
        seen.add(y);
        next.push(y);
      }
    }
    level = next;
  }
  return null;
}

// remember the hidden pieces you bumped into
function discover(s, pid, kind, id) {
  const bd = s.board;
  s.discovered = s.discovered || {};
  const d = (s.discovered[pid] = s.discovered[pid] || { v: [], e: [] });
  const addV = v => { const b = s.buildings[v]; if (b && b.owner !== pid && !d.v.includes(v)) d.v.push(v); };
  const addE = e => { if (s.roads[e] !== undefined && s.roads[e] !== pid && !d.e.includes(e)) d.e.push(e); };
  if (kind === 'vertex') {
    addV(id);
    bd.vertices[id].adj.forEach(addV);
    bd.vertices[id].edges.forEach(addE);
  } else {
    addE(id);
    addV(bd.edges[id].a);
    addV(bd.edges[id].b);
  }
}

function fogResolve(s, a, kind, okReal, okKnown, key) {
  if (!s.config.modes.fog || (s.phase === 'setup' && s.setup.blindActive)) return a;
  if (okReal(a[key])) return a;
  if (!okKnown(viewFor(s, a.pid))) return a; // plainly illegal even with what you see: normal error
  discover(s, a.pid, kind, a[key]);
  const to = nearest(s, kind, a[key], okReal);
  if (to === null) {
    s.fx.push({ kind: 'blocked', pid: a.pid, what: kind, at: a[key] });
    log(s, `🌑 @${a.pid} tropezó con alguien en la niebla y no pudo construir.`, a.pid);
    throw new Blocked();
  }
  s.fx.push({ kind: 'relocated', pid: a.pid, what: kind, from: a[key], to });
  log(s, `🌑 ¡Había alguien en la niebla! La pieza de @${a.pid} se desvió.`, a.pid);
  return { ...a, [key]: to };
}

// ---------------- action handlers ----------------
const H = {};

H.placeSettlement = (s, a) => {
  if (s.phase !== 'setup' || s.setup.step !== 'settlement') fail('No es momento de colocar un poblado.');
  const st = s.setup;
  const entry = st.queue[st.idx];
  if (entry.pid !== a.pid) fail('No es tu turno.');
  a = fogResolve(s, a, 'vertex', v => canSetupSettlement(s, a.pid, v), kv => canSetupSettlement(kv, a.pid, a.vid), 'vid');
  if (!canSetupSettlement(s, a.pid, a.vid)) fail('No puedes colocar ahí (regla de distancia).');
  const p = s.players[a.pid];
  const isCity = s.config.rules.setupCity && entry.round === st.lastRound && p.citiesLeft > 0;
  const type = isCity ? 'city' : 'settlement';
  if (isCity) p.citiesLeft--;
  else {
    if (p.settlementsLeft <= 0) fail('No te quedan poblados.');
    p.settlementsLeft--;
  }
  st.lastVid = a.vid;
  st.step = 'road';
  if (st.blindActive) {
    s.blind.push({ pid: a.pid, vid: a.vid, eid: null, round: entry.round, type });
    log(s, `🙈 @${a.pid} colocó su ${isCity ? 'ciudad' : 'poblado'} en secreto.`, a.pid);
  } else {
    s.buildings[a.vid] = { owner: a.pid, type };
    revealAround(s, a.vid);
    if (entry.round === st.lastRound) {
      // face-down board: resources would give away what's underneath, pay them on the flip
      if (s.config.modes.flipped) (st.pendingRes = st.pendingRes || []).push([a.pid, a.vid]);
      else setupResources(s, a.pid, a.vid);
    }
    log(s, `🏠 @${a.pid} coloca ${isCity ? 'una ciudad' : 'un poblado'}.`, a.pid);
  }
  s.fx.push({ kind: 'build', what: type, pid: a.pid, at: a.vid, hidden: st.blindActive });
};

H.placeRoad = (s, a) => {
  if (s.phase !== 'setup' || s.setup.step !== 'road') fail('No es momento de colocar un camino.');
  const st = s.setup;
  if (st.queue[st.idx].pid !== a.pid) fail('No es tu turno.');
  a = fogResolve(s, a, 'edge', e => canSetupRoad(s, a.pid, e), kv => canSetupRoad(kv, a.pid, a.eid), 'eid');
  if (!canSetupRoad(s, a.pid, a.eid)) fail('El camino debe salir de tu nuevo poblado.');
  const p = s.players[a.pid];
  if (p.roadsLeft <= 0) fail('No te quedan caminos.');
  p.roadsLeft--;
  if (st.blindActive) {
    const b = s.blind.find(x => x.pid === a.pid && x.vid === st.lastVid && x.eid == null);
    b.eid = a.eid;
  } else {
    s.roads[a.eid] = a.pid;
    const E = s.board.edges[a.eid];
    revealAround(s, E.a);
    revealAround(s, E.b);
  }
  s.fx.push({ kind: 'build', what: 'road', pid: a.pid, at: a.eid, hidden: st.blindActive });
  if (st.fixing) nextFixOrBegin(s);
  else advanceSetup(s);
};

H.roll = (s, a) => {
  if (s.phase !== 'roll') fail('Ahora no se tiran dados.');
  if (a.pid !== s.current) fail('No es tu turno.');
  const d = rollDice(s);
  const sum = d[0] + d[1];
  s.dice = d;
  s.stats.rolls[sum]++;
  s.fx.push({ kind: 'dice', dice: d });
  log(s, `🎲 @${a.pid} saca ${sum}.`, a.pid);
  if (sum !== 7) {
    produce(s, sum);
    s.phase = 'main';
    return;
  }
  const R = s.config.rules;
  if (s.round <= R.robberGrace) {
    log(s, '😴 El ladrón duerme durante las primeras rondas.');
    s.phase = 'main';
    return;
  }
  s.pendingDiscards = {};
  for (const p of s.players) {
    const n = handSize(p.res);
    if (n > R.handLimit) s.pendingDiscards[p.id] = Math.floor(n / 2);
  }
  s.robberReturn = 'main';
  if (Object.keys(s.pendingDiscards).length) s.phase = 'discard';
  else s.phase = R.noRobber ? 'main' : 'robber';
};

H.discard = (s, a) => {
  if (s.phase !== 'discard') fail('No hay descartes pendientes.');
  const need = s.pendingDiscards[a.pid];
  if (!need) fail('No tienes que descartar.');
  const res = a.res || {};
  const total = RES.reduce((t, r) => t + (res[r] || 0), 0);
  if (total !== need) fail(`Debes descartar exactamente ${need} cartas.`);
  const p = s.players[a.pid];
  for (const r of RES) if ((res[r] || 0) < 0 || (res[r] || 0) > p.res[r]) fail('No tienes esas cartas.');
  for (const r of RES) {
    p.res[r] -= res[r] || 0;
    s.bank[r] += res[r] || 0;
  }
  p.stats.lost += need;
  delete s.pendingDiscards[a.pid];
  log(s, `🗑️ @${a.pid} descarta ${need} cartas.`, a.pid);
  if (!Object.keys(s.pendingDiscards).length) s.phase = s.config.rules.noRobber ? 'main' : 'robber';
};

H.moveRobber = (s, a) => {
  if (s.phase !== 'robber') fail('No toca mover el ladrón.');
  if (a.pid !== s.current) fail('No es tu turno.');
  const known = s.config.modes.fog ? viewFor(s, a.pid) : s;
  if (!legalRobberTiles(known, a.pid).includes(a.tile)) fail('No puedes poner el ladrón ahí.');
  const victims = stealTargets(s, a.pid, a.tile);
  let victim = a.victim;
  if (victims.length === 1 && victim == null) victim = victims[0];
  // in the fog you may not see who is there: steal from a random neighbour
  if (s.config.modes.fog && victims.length && !victims.includes(victim)) victim = pick(s.rng, victims);
  if (victims.length && !victims.includes(victim)) fail('Elige a quién robar.');
  if (!victims.length) victim = null;
  s.board.robber = a.tile;
  s.fx.push({ kind: 'robber', tile: a.tile });
  log(s, `🦹 @${a.pid} mueve el ladrón.`, a.pid);
  if (victim != null) {
    const r = stealRandom(s, victim, a.pid);
    s.fx.push({ kind: 'steal', from: victim, to: a.pid, res: r });
    log(s, `🫳 @${a.pid} le roba una carta a @${victim}.`, a.pid);
  }
  s.phase = s.robberReturn;
};

function assertMain(s, a) {
  if (a.pid !== s.current) fail('No es tu turno.');
  if (s.phase !== 'main') fail(s.phase === 'roll' ? 'Primero tira los dados.' : 'Termina la acción pendiente.');
}

H.build = (s, a) => {
  if (a.pid !== s.current) fail('No es tu turno.');
  const p = s.players[a.pid];
  const free = s.phase === 'roadBuilding' && a.what === 'road';
  if (!free) assertMain(s, a);
  if (a.what === 'road') {
    if (p.roadsLeft <= 0) fail('No te quedan caminos.');
    a = fogResolve(s, a, 'edge', e => canBuildRoad(s, a.pid, e), kv => canBuildRoad(kv, a.pid, a.at), 'at');
    if (!canBuildRoad(s, a.pid, a.at)) fail('El camino debe conectar con tu red.');
    if (!free && !canAfford(p.res, COSTS.road)) fail('Te faltan recursos.');
    if (!free) pay(s, a.pid, COSTS.road);
    p.roadsLeft--;
    s.roads[a.at] = a.pid;
    const E = s.board.edges[a.at];
    revealAround(s, E.a);
    revealAround(s, E.b);
    log(s, `🛤️ @${a.pid} construye un camino${free ? ' gratis' : ''}.`, a.pid);
    if (free) {
      s.freeRoads--;
      if (s.freeRoads <= 0 || p.roadsLeft <= 0 || !legalRoads(s, a.pid).length) s.phase = 'main';
    }
  } else if (a.what === 'settlement') {
    if (p.settlementsLeft <= 0) fail('No te quedan poblados.');
    a = fogResolve(s, a, 'vertex', v => canBuildSettlement(s, a.pid, v), kv => canBuildSettlement(kv, a.pid, a.at), 'at');
    if (!canBuildSettlement(s, a.pid, a.at)) fail('Ahí no se puede construir un poblado.');
    if (!canAfford(p.res, COSTS.settlement)) fail('Te faltan recursos.');
    pay(s, a.pid, COSTS.settlement);
    p.settlementsLeft--;
    s.buildings[a.at] = { owner: a.pid, type: 'settlement' };
    revealAround(s, a.at);
    log(s, `🏠 @${a.pid} construye un poblado.`, a.pid);
  } else if (a.what === 'city') {
    if (p.citiesLeft <= 0) fail('No te quedan ciudades.');
    if (!canBuildCity(s, a.pid, a.at)) fail('Solo puedes mejorar tus poblados.');
    if (!canAfford(p.res, COSTS.city)) fail('Te faltan recursos.');
    pay(s, a.pid, COSTS.city);
    p.citiesLeft--;
    p.settlementsLeft++;
    s.buildings[a.at].type = 'city';
    log(s, `🏰 @${a.pid} mejora a ciudad.`, a.pid);
  } else fail('Construcción desconocida.');
  s.fx.push({ kind: 'build', what: a.what, pid: a.pid, at: a.at });
  if (a.what !== 'city') updateLongestRoad(s);
};

H.endRoadBuilding = (s, a) => {
  if (s.phase !== 'roadBuilding' || a.pid !== s.current) fail('No estás construyendo caminos.');
  s.freeRoads = 0;
  s.phase = 'main';
};

H.buyDev = (s, a) => {
  assertMain(s, a);
  const p = s.players[a.pid];
  if (!s.devDeck.length) fail('No quedan cartas de desarrollo.');
  if (!canAfford(p.res, COSTS.dev)) fail('Te faltan recursos.');
  pay(s, a.pid, COSTS.dev);
  const type = s.devDeck.pop();
  p.dev.push({ type, turn: s.turn });
  s.fx.push({ kind: 'devBought', pid: a.pid, type });
  log(s, `🃏 @${a.pid} compra una carta de desarrollo.`, a.pid);
};

H.playDev = (s, a) => {
  if (a.pid !== s.current) fail('No es tu turno.');
  if (!playableDev(s, a.pid).includes(a.card)) fail('No puedes jugar esa carta ahora.');
  const p = s.players[a.pid];
  // validate parameters before mutating
  if (a.card === 'yearOfPlenty') {
    const rs = a.res || [];
    if (rs.length !== 2 || !rs.every(r => RES.includes(r))) fail('Elige 2 recursos.');
    const need = {};
    rs.forEach(r => (need[r] = (need[r] || 0) + 1));
    for (const r in need) if (s.bank[r] < need[r]) fail('El banco no tiene suficientes.');
  }
  if (a.card === 'monopoly' && !RES.includes(a.res)) fail('Elige un recurso.');
  const idx = p.dev.findIndex(c => c.type === a.card && c.turn < s.turn);
  p.dev.splice(idx, 1);
  s.devPlayed = true;
  s.fx.push({ kind: 'devPlayed', pid: a.pid, card: a.card });
  log(s, `${DEV_INFO[a.card].icon} @${a.pid} juega ${DEV_INFO[a.card].name}.`, a.pid);
  switch (a.card) {
    case 'knight':
      p.knights++;
      updateLargestArmy(s, a.pid);
      if (s.config.rules.noRobber) break;
      s.robberReturn = s.phase;
      s.phase = 'robber';
      break;
    case 'roadBuilding':
      s.freeRoads = Math.min(2, p.roadsLeft);
      if (s.freeRoads > 0 && legalRoads(s, a.pid).length) s.phase = 'roadBuilding';
      break;
    case 'yearOfPlenty':
      for (const r of a.res) giveFromBank(s, a.pid, r, 1);
      break;
    case 'monopoly': {
      let got = 0;
      for (const o of s.players) {
        if (o.id === a.pid) continue;
        got += o.res[a.res];
        o.stats.lost += o.res[a.res];
        o.res[a.res] = 0;
      }
      p.res[a.res] += got;
      log(s, `👑 @${a.pid} se lleva ${got} ${resName(a.res)}.`, a.pid);
      break;
    }
  }
};

H.bankTrade = (s, a) => {
  assertMain(s, a);
  if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) fail('Intercambio inválido.');
  const ratio = tradeRatio(s, a.pid, a.give);
  const p = s.players[a.pid];
  if (p.res[a.give] < ratio) fail(`Necesitas ${ratio} de ese recurso.`);
  if (s.bank[a.get] < 1) fail('El banco no tiene ese recurso.');
  p.res[a.give] -= ratio;
  s.bank[a.give] += ratio;
  p.res[a.get]++;
  s.bank[a.get]--;
  log(s, `🏦 @${a.pid} cambia ${ratio}${resName(a.give)} por 1${resName(a.get)}.`, a.pid);
};

const validOffer = o => o && RES.every(r => Number.isInteger(o[r] || 0) && (o[r] || 0) >= 0);

H.proposeTrade = (s, a) => {
  assertMain(s, a);
  if (s.trade) fail('Ya hay una oferta abierta.');
  if (!validOffer(a.give) || !validOffer(a.get)) fail('Oferta inválida.');
  if (!handSize(a.give) || !handSize(a.get)) fail('La oferta debe dar y pedir algo.');
  if (RES.some(r => (a.give[r] || 0) && (a.get[r] || 0))) fail('No puedes dar y pedir el mismo recurso.');
  if (!canAfford(s.players[a.pid].res, a.give)) fail('No tienes lo que ofreces.');
  const to = (a.to && a.to.length ? a.to : s.players.map(p => p.id)).filter(i => i !== a.pid && s.players[i]);
  if (!to.length) fail('Nadie a quien ofrecer.');
  const give = zeroRes(), get = zeroRes();
  for (const r of RES) {
    give[r] = a.give[r] || 0;
    get[r] = a.get[r] || 0;
  }
  const p = s.players[a.pid];
  if (p.tradeTurn !== s.turn) p.tradeTurn = s.turn, p.tradeCount = 0;
  p.tradeCount++;
  s.trade = { id: ++s.tradeSeq, from: a.pid, give, get, to, responses: Object.fromEntries(to.map(i => [i, null])) };
  log(s, `🤝 @${a.pid} ofrece un intercambio.`, a.pid);
};

H.respondTrade = (s, a) => {
  const t = s.trade;
  if (!t || !t.to.includes(a.pid)) fail('No hay oferta para ti.');
  if (a.tradeId != null && a.tradeId !== t.id) fail('Esa oferta ya no existe.');
  if (a.accept && !canAfford(s.players[a.pid].res, t.get)) fail('No tienes lo que te piden.');
  t.responses[a.pid] = a.accept ? 'accept' : 'reject';
};

H.confirmTrade = (s, a) => {
  const t = s.trade;
  if (!t || t.from !== a.pid) fail('No hay oferta tuya.');
  if (t.responses[a.with] !== 'accept') fail('Ese jugador no aceptó.');
  const p = s.players[a.pid], o = s.players[a.with];
  if (!canAfford(p.res, t.give) || !canAfford(o.res, t.get)) {
    s.trade = null;
    fail('Alguien ya no tiene los recursos.');
  }
  for (const r of RES) {
    p.res[r] += t.get[r] - t.give[r];
    o.res[r] += t.give[r] - t.get[r];
  }
  s.trade = null;
  s.fx.push({ kind: 'trade', a: a.pid, b: a.with });
  log(s, `🤝 @${a.pid} y @${a.with} intercambian.`, a.pid);
};

H.cancelTrade = (s, a) => {
  if (!s.trade || s.trade.from !== a.pid) fail('No hay oferta tuya.');
  s.trade = null;
};

H.endTurn = (s, a) => {
  assertMain(s, a);
  s.trade = null;
  const n = s.players.length;
  s.current = (s.current + 1) % n;
  s.turn++;
  s.devPlayed = false;
  s.freeRoads = 0;
  s.phase = 'roll';
  if (s.current === s.first) {
    s.round++;
    s.event = null;
    startRound(s);
  }
  log(s, `🎲 Turno de @${s.current}.`, s.current);
};

const TRADE_ACTIONS = new Set(['proposeTrade', 'respondTrade', 'confirmTrade', 'cancelTrade']);

export function applyAction(s, a) {
  s.fx = [];
  try {
    const h = H[a && a.type];
    if (!h) fail('Acción desconocida.');
    if (typeof a.pid !== 'number' || !s.players[a.pid]) fail('Jugador inválido.');
    if (s.phase === 'gameOver') fail('La partida terminó.');
    if (s.trade && a.pid === s.current && !TRADE_ACTIONS.has(a.type)) s.trade = null;
    h(s, a);
    s.actions++;
    checkWin(s);
    return { ok: true };
  } catch (e) {
    if (e instanceof Blocked) {
      s.actions++;
      return { ok: true, blocked: true };
    }
    if (e instanceof GameError) return { ok: false, error: e.message };
    throw e;
  }
}

export { TILE_INFO };
