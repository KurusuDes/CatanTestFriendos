// Pure rules engine. The whole game is one JSON-serializable state object that is
// mutated only through applyAction(). No DOM access here: it runs in Node for tests.
import { RES, COSTS, DEV_DECKS, EVENTS, DEV_INFO, isRes, resEntries } from './constants';
import { randInt, shuffle, pick } from './rng';
import { generateBoard } from './board';
import type {
  Action, ActionOf, ActionType, ApplyResult, BlindPlacement, Config, DevType, Discovered, GameEvent, GameState,
  GameView, Hand, Res, Rng, SetupEntry, Vision,
} from './types';

export const zeroRes = (): Hand => ({ wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 });
export const handSize = (h: Partial<Hand>): number => RES.reduce((a, r) => a + (h[r] || 0), 0);
export const canAfford = (h: Partial<Hand>, cost: Partial<Hand>): boolean => resEntries(cost).every(([r, n]) => (h[r] || 0) >= n);
const resName = (r: Res) => `:${r}:`;

// messages (history and errors) are plain strings; "@3" stands for player 3 and the UI shows
// their name in their color
class GameError extends Error {
  m: string;
  constructor(m: string) {
    super(m);
    this.m = m;
  }
}
class Blocked extends Error {}
function fail(m: string): never {
  throw new GameError(m);
}

function log(s: GameState, msg: string, pid = -1) {
  s.log.push({ turn: s.turn, pid, msg });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function buildDevDeck(config: Config, n: number, rng: Rng): DevType[] {
  const d = DEV_DECKS[config.rules.devDeck] || DEV_DECKS.normal;
  const extra = n > 6 ? 2 : n > 4 ? 1 : 0; // 5-6 and 7-8 player expansions
  const deck: DevType[] = [];
  const add = (type: DevType, k: number) => { for (let i = 0; i < k; i++) deck.push(type); };
  add('knight', d.knight + (d.knight ? 6 * extra : 0));
  add('vp', d.vp + (d.vp && extra > 1 ? 1 : 0));
  add('roadBuilding', d.roadBuilding + (d.roadBuilding ? extra : 0));
  add('yearOfPlenty', d.yearOfPlenty + (d.yearOfPlenty ? extra : 0));
  add('monopoly', d.monopoly + (d.monopoly ? extra : 0));
  return shuffle(rng, deck);
}

export function createGame(configIn: Config): GameState {
  const config = structuredClone(configIn); // config is plain JSON
  const R = config.rules, M = config.modes;
  const rng = { s: (config.seed >>> 0) || 12345 };
  const n = config.players.length;
  const board = generateBoard(config, rng);
  const bankEach = n > 6 ? 30 : n > 4 ? 24 : 19;
  const s: GameState = {
    v: 1,
    config,
    rng,
    board,
    players: config.players.map((p, i) => ({
      id: i, name: p.name, color: p.color, kind: p.kind, level: p.level || 'normal', flag: p.flag || null, retired: false,
      res: zeroRes(), dev: [], knights: 0, roadLen: 0,
      roadsLeft: R.maxRoads, settlementsLeft: R.maxSettlements, citiesLeft: R.maxCities,
      stats: { gained: 0, stolen: 0, lost: 0 },
    })),
    buildings: {},
    roads: {},
    blind: [],
    bank: Object.fromEntries(RES.map(r => [r, bankEach])) as Hand,
    bankTotal: bankEach,
    devDeck: [],
    devTotal: 0,
    phase: 'setup',
    current: 0,
    first: 0,
    turn: 0,
    round: 0,
    setup: { queue: [], idx: 0, step: 'settlement', lastVid: null, blindActive: false, lastRound: 0, fixing: false }, // filled in below
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
    rollLog: [],
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
  const queue: SetupEntry[] = [];
  for (let round = 0; round < R.setupRounds; round++) {
    const o = round % 2 === 0 ? order : [...order].reverse();
    for (const pid of o) queue.push({ pid, round });
  }
  s.setup = { queue, idx: 0, step: 'settlement', lastVid: null, blindActive: !!M.blindfold, lastRound: R.setupRounds - 1, fixing: false };
  s.current = queue[0]!.pid;
  log(s, `Ván đấu bắt đầu! Bản đồ: ${board.tiles.length} ô.`);
  if (M.flipped) log(s, '🔄 Bàn cờ bị úp: đặt nhà mà không biết bên dưới là gì.');
  if (M.blindfold) log(s, '🤫 Nhà bí mật: không ai thấy bạn đặt ở đâu cho tới lúc lật mở.');
  if (M.fog) log(s, '🌑 Sương mù chiến tranh: bạn chỉ thấy xung quanh công trình của mình.');
  return s;
}

// ---------------- queries ----------------

// ---- Fog of war: per-player vision ----
// Houses light a circle that covers the three surrounding tiles; roads light a
// half-tile band on each side (you see the terrain but not the number token).
const VISION = { house: 1.25, road: 0.55 };

function visionOf(s: GameState, pid: number): Vision {
  const bd = s.board;
  const circles: Vision['circles'] = [], caps: Vision['caps'] = [];
  const house = (v: number) => circles.push([bd.vertices[v]!.x, bd.vertices[v]!.y, VISION.house]);
  const road = (e: number) => {
    const E = bd.edges[e]!, a = bd.vertices[E.a]!, b = bd.vertices[E.b]!;
    caps.push([a.x, a.y, b.x, b.y, VISION.road]);
  };
  for (const k in s.buildings) if (s.buildings[k]!.owner === pid) house(+k);
  for (const k in s.roads) if (s.roads[k] === pid) road(+k);
  for (const b of s.blind || []) if (b.pid === pid) {
    house(b.vid);
    if (b.eid != null) road(b.eid);
  }
  return { circles, caps };
}

function segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}

// how deep (x,y) lies inside the lit area (> 0 means visible)
export function visibility(vis: Vision, x: number, y: number): number {
  let best = -Infinity;
  for (const [cx, cy, r] of vis.circles) best = Math.max(best, r - Math.hypot(x - cx, y - cy));
  for (const [x1, y1, x2, y2, r] of vis.caps) best = Math.max(best, r - segDist(x, y, x1, y1, x2, y2));
  return best;
}

// What `pid` knows: other players' pieces outside their vision are removed and
// unseen tiles are marked hidden. Used by the UI and by bots (so they don't cheat).
export function viewFor(s: GameState, pid: number | null | undefined): GameView {
  if (!s.config.modes.fog || pid == null || pid < 0 || s.phase === 'gameOver') return s;
  const vis = visionOf(s, pid);
  const bd = s.board;
  const buildings: GameState['buildings'] = {}, roads: GameState['roads'] = {};
  const disc: Discovered = (s.discovered && s.discovered[pid]) || { v: [], e: [] };
  for (const k in s.buildings) {
    const b = s.buildings[k]!, V = bd.vertices[+k]!;
    if (b.owner === pid || visibility(vis, V.x, V.y) > 0 || disc.v.includes(+k)) buildings[k] = b;
  }
  for (const k in s.roads) {
    const E = bd.edges[+k]!, a = bd.vertices[E.a]!, c = bd.vertices[E.b]!;
    if (s.roads[k] === pid || visibility(vis, (a.x + c.x) / 2, (a.y + c.y) / 2) > 0 || disc.e.includes(+k)) roads[k] = s.roads[k]!;
  }
  const tiles = bd.tiles.map(t => {
    const lit = visibility(vis, t.x, t.y);
    return { ...t, revealed: t.revealed && lit > -0.86, numRevealed: t.numRevealed && lit > 0 };
  });
  const robberSeen = bd.robber >= 0 && tiles[bd.robber]!.numRevealed;
  return { ...s, buildings, roads, board: { ...bd, tiles, robberHidden: !robberSeen }, vision: vis };
}

export function victoryPoints(s: GameState, pid: number, hidden = true): number {
  let vp = 0;
  for (const k in s.buildings) {
    const b = s.buildings[k]!;
    if (b.owner === pid) vp += b.type === 'city' ? 2 : 1;
  }
  if (s.longestRoad.owner === pid) vp += 2;
  if (s.largestArmy.owner === pid) vp += 2;
  if (hidden) vp += s.players[pid]!.dev.filter(c => c.type === 'vp').length;
  return vp;
}

export function tradeRatio(s: GameState, pid: number, res: Res): number {
  let best = 4;
  if (s.event && s.event.id === 'fairTrade') best = 3;
  if (s.event && s.event.id === 'blackMarket' && s.event.res === res) best = 2;
  for (const k in s.buildings) {
    if (s.buildings[k]!.owner !== pid) continue;
    const port = s.board.vertices[+k]!.port;
    if (port === null || port === undefined) continue;
    const p = s.board.ports[port]!;
    if (p.type === 'any') best = Math.min(best, 3);
    else if (p.type === res) best = Math.min(best, 2);
  }
  return best;
}

function ownBlind(s: GameState, pid: number) {
  const own = s.blind.filter(b => b.pid === pid);
  return { verts: new Set(own.map(b => b.vid)), edges: new Set(own.filter(b => b.eid != null).map(b => b.eid)) };
}

function vertexOpen(s: GameState, v: number): boolean {
  if (s.buildings[v]) return false;
  return !s.board.vertices[v]!.adj.some(u => s.buildings[u]);
}

export function canSetupSettlement(s: GameState, pid: number, v: number): boolean {
  if (!s.board.vertices[v]) return false;
  if (s.setup.blindActive) {
    const { verts } = ownBlind(s, pid);
    if (verts.has(v)) return false;
    return !s.board.vertices[v]!.adj.some(u => verts.has(u));
  }
  return vertexOpen(s, v) && s.board.vertices[v]!.edges.some(e => s.roads[e] === undefined);
}

function canSetupRoad(s: GameState, pid: number, e: number): boolean {
  const E = s.board.edges[e];
  if (!E || (E.a !== s.setup.lastVid && E.b !== s.setup.lastVid)) return false;
  if (s.setup.blindActive) return !ownBlind(s, pid).edges.has(e);
  return s.roads[e] === undefined;
}

export function canBuildRoad(s: GameState, pid: number, e: number): boolean {
  const E = s.board.edges[e];
  if (!E || s.roads[e] !== undefined) return false;
  for (const v of [E.a, E.b]) {
    const b = s.buildings[v];
    if (b && b.owner === pid) return true;
    if (b) continue; // opponent building blocks continuing through this vertex
    if (s.board.vertices[v]!.edges.some(x => x !== e && s.roads[x] === pid)) return true;
  }
  return false;
}

function canBuildSettlement(s: GameState, pid: number, v: number): boolean {
  if (!s.board.vertices[v] || !vertexOpen(s, v)) return false;
  return s.board.vertices[v]!.edges.some(e => s.roads[e] === pid);
}

const canBuildCity = (s: GameState, pid: number, v: number): boolean => {
  const b = s.buildings[v];
  return !!b && b.owner === pid && b.type === 'settlement';
};

export function legalSetupSettlements(s: GameState, pid: number): number[] {
  return s.board.vertices.filter(v => canSetupSettlement(s, pid, v.id)).map(v => v.id);
}
export function legalSetupRoads(s: GameState, pid: number): number[] {
  const v = s.setup.lastVid === null ? undefined : s.board.vertices[s.setup.lastVid];
  return v ? v.edges.filter((e: number) => canSetupRoad(s, pid, e)) : [];
}
export function legalRoads(s: GameState, pid: number): number[] {
  return s.board.edges.filter(e => canBuildRoad(s, pid, e.id)).map(e => e.id);
}
export function legalSettlements(s: GameState, pid: number): number[] {
  return s.board.vertices.filter(v => canBuildSettlement(s, pid, v.id)).map(v => v.id);
}
export function legalCities(s: GameState, pid: number): number[] {
  return Object.keys(s.buildings).map(Number).filter(v => canBuildCity(s, pid, v));
}

function friendlyProtected(s: GameState, pid: number): boolean {
  return s.config.rules.friendlyRobber && victoryPoints(s, pid, false) <= 2;
}

export function robberVictims(s: GameState, pid: number, tile: number): number[] {
  const t = s.board.tiles[tile];
  if (!t) return [];
  const out = new Set<number>();
  for (const v of t.verts) {
    const b = s.buildings[v];
    if (b && b.owner !== pid && handSize(s.players[b.owner]!.res) > 0) out.add(b.owner);
  }
  return [...out];
}

export const stealTargets = (s: GameState, pid: number, tile: number): number[] => robberVictims(s, pid, tile).filter(v => !friendlyProtected(s, v));

export function legalRobberTiles(s: GameState, pid: number): number[] {
  const all = s.board.tiles.filter(t => t.id !== s.board.robber).map(t => t.id);
  if (!s.config.rules.friendlyRobber) return all;
  const ok = all.filter(id =>
    !s.board.tiles[id]!.verts.some(v => {
      const b = s.buildings[v];
      return b && b.owner !== pid && friendlyProtected(s, b.owner);
    })
  );
  return ok.length ? ok : all;
}

export function playableDev(s: GameState, pid: number): DevType[] {
  if (s.devPlayed) return [];
  const p = s.players[pid]!;
  const types = new Set<DevType>();
  for (const c of p.dev) {
    if (c.type === 'vp' || c.turn >= s.turn) continue;
    if (s.phase === 'main' || (s.phase === 'roll' && c.type === 'knight')) types.add(c.type);
  }
  return [...types];
}

// Which players must act right now.
export function pendingActors(s: GameState): number[] {
  if (s.phase === 'gameOver') return [];
  if (s.phase === 'setup') return [s.setup.queue[s.setup.idx]!.pid];
  if (s.phase === 'discard') return Object.keys(s.pendingDiscards).map(Number).filter(pid => !s.players[pid]!.retired);
  const out = [s.current];
  if (s.trade) for (const pid of s.trade.to) if (s.trade.responses[pid] == null && !s.players[pid]!.retired) out.push(pid);
  return out;
}

// ---------------- internal helpers ----------------
function pay(s: GameState, pid: number, cost: Partial<Hand>) {
  const p = s.players[pid]!;
  for (const [r, k] of resEntries(cost)) {
    p.res[r] -= k;
    s.bank[r] += k;
  }
}

function giveFromBank(s: GameState, pid: number, r: Res, k: number): number {
  const g = Math.min(k, s.bank[r]);
  s.bank[r] -= g;
  s.players[pid]!.res[r] += g;
  s.players[pid]!.stats.gained += g;
  return g;
}

function revealAround(s: GameState, v: number) {
  if (s.config.modes.flipped && s.phase === 'setup') return;
  for (const h of s.board.vertices[v]!.hexes) {
    const t = s.board.tiles[h]!;
    if (!t.revealed || !t.numRevealed) {
      t.revealed = t.numRevealed = true;
      s.fx.push({ kind: 'revealTile', tile: h });
    }
  }
}

function roadLength(s: GameState, pid: number): number {
  const bd = s.board;
  const starts = new Set<number>();
  for (const k in s.roads) if (s.roads[k] === pid) {
    starts.add(bd.edges[+k]!.a);
    starts.add(bd.edges[+k]!.b);
  }
  if (!starts.size) return 0;
  let best = 0;
  const used = new Set<number>();
  const blocked = (v: number) => {
    const b = s.buildings[v];
    return !!b && b.owner !== pid;
  };
  const dfs = (v: number, len: number): void => {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const e of bd.vertices[v]!.edges) {
      if (s.roads[e] !== pid || used.has(e)) continue;
      used.add(e);
      const E = bd.edges[e]!;
      dfs(E.a === v ? E.b : E.a, len + 1);
      used.delete(e);
    }
  };
  for (const v of starts) dfs(v, 0);
  return best;
}

function updateLongestRoad(s: GameState) {
  const lens = s.players.map(p => (p.roadLen = p.retired ? 0 : roadLength(s, p.id)));
  const cur = s.longestRoad.owner;
  const max = Math.max(...lens);
  let owner: number;
  if (cur >= 0 && lens[cur]! >= 5 && lens[cur] === max) owner = cur;
  else {
    const top = lens.map((l, i) => i).filter(i => lens[i] === max);
    owner = max >= 5 && top.length === 1 ? top[0]! : -1;
  }
  if (owner !== cur) {
    if (owner >= 0) {
      log(s, `🛣️ @${owner} giành Con đường dài nhất (${max}).`, owner);
      s.fx.push({ kind: 'award', what: 'road', pid: owner });
    } else log(s, '🛣️ Giờ không ai giữ Con đường dài nhất.');
  }
  s.longestRoad = { owner, len: owner >= 0 ? lens[owner]! : 0 };
}

function updateLargestArmy(s: GameState, pid: number) {
  const p = s.players[pid]!;
  const la = s.largestArmy;
  if (p.knights >= 3 && la.owner !== pid && p.knights > la.count) {
    s.largestArmy = { owner: pid, count: p.knights };
    log(s, `⚔️ @${pid} giành Đội quân lớn nhất (${p.knights}).`, pid);
    s.fx.push({ kind: 'award', what: 'army', pid });
  } else if (la.owner === pid) la.count = p.knights;
}

function checkWin(s: GameState) {
  if (s.phase === 'setup' || s.phase === 'gameOver') return;
  const vp = victoryPoints(s, s.current);
  if (vp >= s.config.rules.vpTarget) {
    s.winner = s.current;
    s.phase = 'gameOver';
    s.trade = null;
    log(s, `🏆 @${s.current} thắng ván với ${vp} điểm!`, s.current);
    s.fx.push({ kind: 'win', pid: s.current });
  }
}

function stealRandom(s: GameState, from: number, to: number): Res | null {
  const p = s.players[from]!;
  const bag: Res[] = [];
  for (const r of RES) for (let i = 0; i < p.res[r]; i++) bag.push(r);
  if (!bag.length) return null;
  const r = pick(s.rng, bag);
  p.res[r]--;
  s.players[to]!.res[r]++;
  s.players[to]!.stats.stolen++;
  p.stats.lost++;
  return r;
}

function produce(s: GameState, sum: number) {
  const bd = s.board;
  const mult = (s.config.rules.productionMult || 1) * (s.event && s.event.id === 'bonanza' ? 2 : 1);
  const gains = s.players.map(() => zeroRes());
  const from = s.players.map((): Partial<Record<Res, number[]>> => ({})); // tiles each gain came from (the UI flies the cards from there)
  for (const t of bd.tiles) {
    if (t.num !== sum || t.id === bd.robber) continue;
    if (s.event && s.event.id === 'drought' && s.event.res === t.res) continue;
    if (t.res === 'desert') continue;
    let produced = false;
    for (const v of t.verts) {
      const b = s.buildings[v];
      if (!b || s.players[b.owner]!.retired) continue;
      const amt = (b.type === 'city' ? 2 : 1) * mult;
      let r = t.res;
      if (r === 'gold') {
        // gold gives the resource the player has least of (hand + pending gains)
        const p = s.players[b.owner]!;
        r = RES.reduce((best, x) => (p.res[x] + gains[b.owner]![x] < p.res[best] + gains[b.owner]![best] ? x : best), RES[0]!);
      }
      gains[b.owner]![r] += amt;
      (from[b.owner]![r] ||= []).push(t.id);
      produced = true;
    }
    if (produced && t.revealed && !t.numRevealed) {
      t.numRevealed = true;
      s.fx.push({ kind: 'revealTile', tile: t.id });
    }
  }
  for (const r of RES) {
    const receivers = gains.map((g, i) => i).filter(i => gains[i]![r] > 0);
    const total = receivers.reduce((a, i) => a + gains[i]![r], 0);
    if (!total) continue;
    if (total > s.bank[r] && receivers.length > 1) {
      log(s, `🏦 Ngân hàng không đủ ${resName(r)}: không ai được nhận.`);
      continue;
    }
    for (const i of receivers) {
      const g = giveFromBank(s, i, r, gains[i]![r]);
      if (g) s.fx.push({ kind: 'gain', pid: i, res: r, n: g, tiles: from[i]![r] });
    }
  }
  const summary = gains
    .map((g, i) => {
      const parts = RES.filter(r => g[r]).map(r => `${g[r]}${resName(r)}`);
      return parts.length ? `@${i} ${parts.join(' ')}` : null;
    })
    .filter(Boolean);
  if (summary.length) log(s, '📦 ' + summary.join(' · ')); // only icons and numbers: nothing to translate
}

function rollDice(s: GameState): [number, number] {
  if (s.config.rules.diceMode === 'balanced') {
    if (s.diceDeck.length < 6) {
      s.diceDeck = [];
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) s.diceDeck.push([a, b]);
      shuffle(s.rng, s.diceDeck);
    }
    return s.diceDeck.pop()!;
  }
  return [1 + randInt(s.rng, 6), 1 + randInt(s.rng, 6)];
}

function randomLandTile(s: GameState, exclude: number): number {
  const ids = s.board.tiles.map(t => t.id).filter(id => id !== exclude);
  return pick(s.rng, ids);
}

function startRound(s: GameState) {
  const M = s.config.modes;
  // Tierra viva: reshuffle numbers/resources every N rounds
  if (M.chaosEvery > 0 && s.round > 1 && (s.round - 1) % M.chaosEvery === 0) {
    const tiles = s.board.tiles.filter(t => t.res !== 'desert');
    if (M.chaosWhat !== 'resources') {
      const nums = shuffle(s.rng, tiles.map(t => t.num));
      tiles.forEach((t, i) => (t.num = nums[i] ?? null));
    }
    if (M.chaosWhat !== 'numbers') {
      const res = shuffle(s.rng, tiles.map(t => t.res));
      tiles.forEach((t, i) => (t.res = res[i]!));
    }
    log(s, '🌀 Đất chuyển mình! Bản đồ vừa bị xáo trộn.');
    s.fx.push({ kind: 'chaos' });
  }
  if (!M.events) return;
  const ev = pick(s.rng, EVENTS);
  const E: GameEvent = { id: ev.id, name: ev.name, icon: ev.icon };
  s.event = E;
  const active = () => s.players.filter(p => !p.retired).map(p => p.id);
  const leader = () => active().sort((a, b) => victoryPoints(s, b, false) - victoryPoints(s, a, false))[0]!;
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
        s.board.robberFrom = s.board.robber;
        s.board.robber = randomLandTile(s, s.board.robber);
        E.tile = s.board.robber;
      }
      break;
    case 'gift':
      for (const p of s.players) {
        if (p.retired) continue;
        const r = pick(s.rng, RES);
        giveFromBank(s, p.id, r, 1);
      }
      break;
    case 'plague':
      for (const p of s.players) {
        if (handSize(p.res) < 6) continue;
        const bag: Res[] = RES.flatMap(r => Array<Res>(p.res[r]).fill(r));
        const r = pick(s.rng, bag);
        p.res[r]--;
        s.bank[r]++;
      }
      break;
    case 'tax': {
      const l = leader();
      const p = s.players[l]!;
      const bag: Res[] = RES.flatMap(r => Array<Res>(p.res[r]).fill(r));
      if (bag.length) {
        const r = pick(s.rng, bag);
        p.res[r]--;
        s.bank[r]++;
      }
      E.pid = l;
      break;
    }
    case 'rebellion': {
      const last = active().sort((a, b) => victoryPoints(s, a, false) - victoryPoints(s, b, false))[0]!;
      for (let i = 0; i < 2; i++) giveFromBank(s, last, pick(s.rng, RES), 1);
      E.pid = last;
      break;
    }
  }
  const extra = E.res ? ` (${resName(E.res)})` : E.pid != null ? ` (@${E.pid})` : '';
  log(s, `${E.icon} Sự kiện vòng ${s.round}: ${E.name}${extra}.`);
  s.fx.push({ kind: 'event', event: E });
}

function beginTurns(s: GameState) {
  if (s.config.modes.flipped) {
    const hideNums = s.config.modes.hiddenNumbers;
    for (const t of s.board.tiles) {
      t.revealed = true;
      t.numRevealed = !hideNums;
    }
    if (hideNums) for (const k in s.buildings) for (const h of s.board.vertices[+k]!.hexes) s.board.tiles[h]!.numRevealed = true;
    for (const [pid, vid] of s.setup.pendingRes || []) setupResources(s, pid, vid);
    s.setup.pendingRes = [];
    s.fx.push({ kind: 'flipAll' });
    log(s, '🔄 Lật bàn cờ! Giờ ai cũng thấy bên dưới có gì.');
  }
  s.phase = 'roll';
  s.current = s.players[s.first]!.retired ? nextActive(s, s.first).pid : s.first;
  s.turn = 1;
  s.round = 1;
  s.setup.blindActive = false;
  updateLongestRoad(s);
  log(s, `🎲 Lượt của @${s.current}.`, s.current);
  startRound(s);
}

function setupResources(s: GameState, pid: number, v: number) {
  for (const h of s.board.vertices[v]!.hexes) {
    const t = s.board.tiles[h]!;
    if (isRes(t.res)) giveFromBank(s, pid, t.res, 1);
    else if (t.res === 'gold') giveFromBank(s, pid, pick(s.rng, RES), 1);
  }
}

function advanceSetup(s: GameState) {
  const st = s.setup;
  st.idx++;
  st.step = 'settlement';
  st.lastVid = null;
  if (st.idx < st.queue.length) {
    s.current = st.queue[st.idx]!.pid;
    return;
  }
  if (st.blindActive) {
    resolveBlind(s);
    if (s.phase === 'setup') return;
  }
  beginTurns(s);
}

// Reveal blindfold placements; conflicting ones must be placed again.
function resolveBlind(s: GameState) {
  const st = s.setup;
  st.blindActive = false;
  const fix: SetupEntry[] = [];
  const accepted: BlindPlacement[] = [];
  for (const b of s.blind) {
    if (vertexOpen(s, b.vid)) {
      const p = s.players[b.pid]!;
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
      const p = s.players[b.pid]!;
      if (b.type === 'city') p.citiesLeft++;
      else p.settlementsLeft++;
      if (b.eid != null) p.roadsLeft++;
      fix.push({ pid: b.pid, round: b.round });
      log(s, `💥 Trùng chỗ! Nhà bí mật của @${b.pid} đụng nhà khác. Phải dời đi chỗ khác.`, b.pid);
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
  log(s, '🙈 Lật mở! Giờ đã thấy hết nhà đầu ván của mọi người.');
  s.blind = [];
  if (fix.length) {
    st.queue = fix;
    st.idx = 0;
    st.fixing = true;
    const first = fix[0]!;
    st.step = first.roadOnly ? 'road' : 'settlement';
    st.lastVid = first.roadOnly ? first.vid! : null;
    s.current = first.pid;
    s.phase = 'setup';
  } else {
    s.phase = 'roll';
  }
}

function nextFixOrBegin(s: GameState) {
  const st = s.setup;
  st.idx++;
  if (st.idx < st.queue.length) {
    const f = st.queue[st.idx]!;
    s.current = f.pid;
    st.step = f.roadOnly ? 'road' : 'settlement';
    st.lastVid = f.roadOnly ? f.vid! : null;
    return;
  }
  beginTurns(s);
}

// ---- fog relocation ----
// In fog mode a move that looks legal to the player (given what they can see) but
// collides with an unseen piece is moved to a random nearest legal spot.
function nearest(s: GameState, kind: 'vertex' | 'edge', from: number, ok: (x: number) => boolean): number | null {
  const bd = s.board;
  const seen = new Set([from]);
  let level: number[] = [from];
  while (level.length) {
    const hits = level.filter(x => x !== from && ok(x));
    if (hits.length) return pick(s.rng, hits);
    const next: number[] = [];
    for (const x of level) {
      const nbs = kind === 'vertex' ? bd.vertices[x]!.adj : [bd.edges[x]!.a, bd.edges[x]!.b].flatMap(v => bd.vertices[v]!.edges);
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
function discover(s: GameState, pid: number, kind: 'vertex' | 'edge', id: number) {
  const bd = s.board;
  s.discovered = s.discovered || {};
  const d: Discovered = (s.discovered[pid] = s.discovered[pid] || { v: [], e: [] });
  const addV = (v: number) => { const b = s.buildings[v]; if (b && b.owner !== pid && !d.v.includes(v)) d.v.push(v); };
  const addE = (e: number) => { if (s.roads[e] !== undefined && s.roads[e] !== pid && !d.e.includes(e)) d.e.push(e); };
  if (kind === 'vertex') {
    addV(id);
    bd.vertices[id]!.adj.forEach(addV);
    bd.vertices[id]!.edges.forEach(addE);
  } else {
    addE(id);
    addV(bd.edges[id]!.a);
    addV(bd.edges[id]!.b);
  }
}

function fogResolve<K extends 'vid' | 'eid' | 'at', A extends { pid: number } & Record<K, number>>(
  s: GameState, a: A, kind: 'vertex' | 'edge', okReal: (x: number) => boolean, okKnown: (view: GameState) => boolean, key: K,
): A {
  if (!s.config.modes.fog || (s.phase === 'setup' && s.setup.blindActive)) return a;
  if (okReal(a[key])) return a;
  if (!okKnown(viewFor(s, a.pid))) return a; // plainly illegal even with what you see: normal error
  discover(s, a.pid, kind, a[key]);
  const to = nearest(s, kind, a[key], okReal);
  if (to === null) {
    s.fx.push({ kind: 'blocked', pid: a.pid, what: kind, at: a[key] });
    log(s, `🌑 @${a.pid} đụng phải ai đó trong sương mù và không xây được.`, a.pid);
    throw new Blocked();
  }
  s.fx.push({ kind: 'relocated', pid: a.pid, what: kind, from: a[key], to });
  log(s, `🌑 Có người trong sương mù! Công trình của @${a.pid} bị dời đi.`, a.pid);
  return { ...a, [key]: to } as A;
}

// ---------------- action handlers ----------------
type Handlers = { [K in ActionType]: (s: GameState, a: ActionOf<K>) => void };
// every handler is assigned below (the table is complete once the module has loaded)
const H = {} as Handlers;

H.placeSettlement = (s, a) => {
  if (s.phase !== 'setup' || s.setup.step !== 'settlement') fail('Chưa phải lúc đặt nhà.');
  const st = s.setup;
  const entry = st.queue[st.idx]!;
  if (entry.pid !== a.pid) fail('Chưa tới lượt bạn.');
  a = fogResolve(s, a, 'vertex', v => canSetupSettlement(s, a.pid, v), kv => canSetupSettlement(kv, a.pid, a.vid), 'vid');
  if (!canSetupSettlement(s, a.pid, a.vid)) fail('Không đặt ở đó được (luật khoảng cách).');
  const p = s.players[a.pid]!;
  const isCity = s.config.rules.setupCity && entry.round === st.lastRound && p.citiesLeft > 0;
  const type = isCity ? 'city' : 'settlement';
  if (isCity) p.citiesLeft--;
  else {
    if (p.settlementsLeft <= 0) fail('Bạn hết nhà rồi.');
    p.settlementsLeft--;
  }
  st.lastVid = a.vid;
  st.step = 'road';
  if (st.blindActive) {
    s.blind.push({ pid: a.pid, vid: a.vid, eid: null, round: entry.round, type });
    log(s, isCity ? `🙈 @${a.pid} đã bí mật đặt thành phố.` : `🙈 @${a.pid} đã bí mật đặt nhà.`, a.pid);
  } else {
    s.buildings[a.vid] = { owner: a.pid, type };
    revealAround(s, a.vid);
    if (entry.round === st.lastRound) {
      // face-down board: resources would give away what's underneath, pay them on the flip
      if (s.config.modes.flipped) (st.pendingRes = st.pendingRes || []).push([a.pid, a.vid]);
      else setupResources(s, a.pid, a.vid);
    }
    log(s, isCity ? `🏠 @${a.pid} đặt một thành phố.` : `🏠 @${a.pid} đặt một nhà.`, a.pid);
  }
  s.fx.push({ kind: 'build', what: type, pid: a.pid, at: a.vid, hidden: st.blindActive });
};

H.placeRoad = (s, a) => {
  if (s.phase !== 'setup' || s.setup.step !== 'road') fail('Chưa phải lúc đặt đường.');
  const st = s.setup;
  if (st.queue[st.idx]!.pid !== a.pid) fail('Chưa tới lượt bạn.');
  a = fogResolve(s, a, 'edge', e => canSetupRoad(s, a.pid, e), kv => canSetupRoad(kv, a.pid, a.eid), 'eid');
  if (!canSetupRoad(s, a.pid, a.eid)) fail('Đường phải đi ra từ nhà bạn vừa đặt.');
  const p = s.players[a.pid]!;
  if (p.roadsLeft <= 0) fail('Bạn hết đường rồi.');
  p.roadsLeft--;
  if (st.blindActive) {
    const b = s.blind.find(x => x.pid === a.pid && x.vid === st.lastVid && x.eid == null)!;
    b.eid = a.eid;
  } else {
    s.roads[a.eid] = a.pid;
    const E = s.board.edges[a.eid]!;
    revealAround(s, E.a);
    revealAround(s, E.b);
  }
  s.fx.push({ kind: 'build', what: 'road', pid: a.pid, at: a.eid, hidden: st.blindActive });
  if (st.fixing) nextFixOrBegin(s);
  else advanceSetup(s);
};

H.roll = (s, a) => {
  if (s.phase !== 'roll') fail('Giờ chưa phải lúc tung xúc xắc.');
  if (a.pid !== s.current) fail('Chưa tới lượt bạn.');
  const d = rollDice(s);
  const sum = d[0] + d[1];
  s.dice = d;
  s.stats.rolls[sum]!++;
  (s.rollLog ||= []).push({ pid: a.pid, sum });
  if (s.rollLog.length > 30) s.rollLog.shift();
  // how hard the dice were thrown (hold the button to charge it): only changes the animation
  const power = Math.round(Math.min(1, Math.max(0, +(a.power ?? 0) || 0)) * 100) / 100;
  s.fx.push({ kind: 'dice', dice: d, power });
  log(s, `🎲 @${a.pid} tung ra ${sum}.`, a.pid);
  if (sum !== 7) {
    produce(s, sum);
    s.phase = 'main';
    return;
  }
  const R = s.config.rules;
  if (s.round <= R.robberGrace) {
    log(s, '😴 Kẻ trộm còn ngủ trong mấy vòng đầu.');
    s.phase = 'main';
    return;
  }
  s.pendingDiscards = {};
  for (const p of s.players) {
    const n = handSize(p.res);
    if (n > R.handLimit && !p.retired) s.pendingDiscards[p.id] = Math.floor(n / 2);
  }
  s.robberReturn = 'main';
  if (Object.keys(s.pendingDiscards).length) s.phase = 'discard';
  else s.phase = R.noRobber ? 'main' : 'robber';
};

H.discard = (s, a) => {
  if (s.phase !== 'discard') fail('Không ai phải bỏ thẻ.');
  const need = s.pendingDiscards[a.pid];
  if (!need) fail('Bạn không phải bỏ thẻ.');
  const res = a.res || {};
  const total = RES.reduce((t, r) => t + (res[r] || 0), 0);
  if (total !== need) fail(`Bạn phải bỏ đúng ${need} thẻ.`);
  const p = s.players[a.pid]!;
  for (const r of RES) if ((res[r] || 0) < 0 || (res[r] || 0) > p.res[r]) fail('Bạn không có những thẻ đó.');
  for (const r of RES) {
    p.res[r] -= res[r] || 0;
    s.bank[r] += res[r] || 0;
  }
  p.stats.lost += need;
  s.fx.push({ kind: 'discard', pid: a.pid, res: Object.fromEntries(RES.map(r => [r, res[r] || 0])) as Hand });
  delete s.pendingDiscards[a.pid];
  log(s, `🗑️ @${a.pid} bỏ ${need} thẻ.`, a.pid);
  if (!Object.keys(s.pendingDiscards).length) s.phase = s.config.rules.noRobber ? 'main' : 'robber';
};

H.moveRobber = (s, a) => {
  if (s.phase !== 'robber') fail('Chưa phải lúc di chuyển kẻ trộm.');
  if (a.pid !== s.current) fail('Chưa tới lượt bạn.');
  const known = s.config.modes.fog ? viewFor(s, a.pid) : s;
  if (!legalRobberTiles(known, a.pid).includes(a.tile)) fail('Không đặt kẻ trộm ở đó được.');
  const victims = stealTargets(s, a.pid, a.tile);
  let victim = a.victim;
  if (victims.length === 1 && victim == null) victim = victims[0];
  const isVictim = (v: number | null | undefined) => v != null && victims.includes(v);
  // in the fog you may not see who is there: steal from a random neighbour
  if (s.config.modes.fog && victims.length && !isVictim(victim)) victim = pick(s.rng, victims);
  if (victims.length && !isVictim(victim)) fail('Chọn người để cướp.');
  if (!victims.length) victim = null;
  s.board.robberFrom = s.board.robber; // bots use it so they don't just send it back
  s.board.robber = a.tile;
  s.fx.push({ kind: 'robber', tile: a.tile });
  log(s, `🦹 @${a.pid} di chuyển kẻ trộm.`, a.pid);
  if (victim != null) {
    const r = stealRandom(s, victim, a.pid);
    s.fx.push({ kind: 'steal', from: victim, to: a.pid, res: r });
    log(s, `🫳 @${a.pid} cướp một thẻ của @${victim}.`, a.pid);
  }
  s.phase = s.robberReturn;
};

function assertMain(s: GameState, a: Action) {
  if (a.pid !== s.current) fail('Chưa tới lượt bạn.');
  if (s.phase !== 'main') fail(s.phase === 'roll' ? 'Tung xúc xắc trước đã.' : 'Làm nốt việc đang dở trước đã.');
}

H.build = (s, a) => {
  if (a.pid !== s.current) fail('Chưa tới lượt bạn.');
  const p = s.players[a.pid]!;
  const free = s.phase === 'roadBuilding' && a.what === 'road';
  if (!free) assertMain(s, a);
  if (a.what === 'road') {
    if (p.roadsLeft <= 0) fail('Bạn hết đường rồi.');
    a = fogResolve(s, a, 'edge', e => canBuildRoad(s, a.pid, e), kv => canBuildRoad(kv, a.pid, a.at), 'at');
    if (!canBuildRoad(s, a.pid, a.at)) fail('Đường phải nối với mạng đường của bạn.');
    if (!free && !canAfford(p.res, COSTS.road)) fail('Bạn không đủ tài nguyên.');
    if (!free) pay(s, a.pid, COSTS.road);
    p.roadsLeft--;
    s.roads[a.at] = a.pid;
    const E = s.board.edges[a.at]!;
    revealAround(s, E.a);
    revealAround(s, E.b);
    log(s, free ? `🛤️ @${a.pid} làm một đoạn đường miễn phí.` : `🛤️ @${a.pid} làm một đoạn đường.`, a.pid);
    if (free) {
      s.freeRoads--;
      if (s.freeRoads <= 0 || p.roadsLeft <= 0 || !legalRoads(s, a.pid).length) s.phase = 'main';
    }
  } else if (a.what === 'settlement') {
    if (p.settlementsLeft <= 0) fail('Bạn hết nhà rồi.');
    a = fogResolve(s, a, 'vertex', v => canBuildSettlement(s, a.pid, v), kv => canBuildSettlement(kv, a.pid, a.at), 'at');
    if (!canBuildSettlement(s, a.pid, a.at)) fail('Không xây nhà ở đó được.');
    if (!canAfford(p.res, COSTS.settlement)) fail('Bạn không đủ tài nguyên.');
    pay(s, a.pid, COSTS.settlement);
    p.settlementsLeft--;
    s.buildings[a.at] = { owner: a.pid, type: 'settlement' };
    revealAround(s, a.at);
    log(s, `🏠 @${a.pid} xây một nhà.`, a.pid);
  } else if (a.what === 'city') {
    if (p.citiesLeft <= 0) fail('Bạn hết thành phố rồi.');
    if (!canBuildCity(s, a.pid, a.at)) fail('Bạn chỉ nâng cấp được nhà của mình.');
    if (!canAfford(p.res, COSTS.city)) fail('Bạn không đủ tài nguyên.');
    pay(s, a.pid, COSTS.city);
    p.citiesLeft--;
    p.settlementsLeft++;
    s.buildings[a.at]!.type = 'city';
    log(s, `🏰 @${a.pid} nâng cấp lên thành phố.`, a.pid);
  } else fail('Công trình không hợp lệ.');
  s.fx.push({ kind: 'build', what: a.what, pid: a.pid, at: a.at });
  if (a.what !== 'city') updateLongestRoad(s);
};

H.endRoadBuilding = (s, a) => {
  if (s.phase !== 'roadBuilding' || a.pid !== s.current) fail('Bạn đâu có đang xây đường.');
  s.freeRoads = 0;
  s.phase = 'main';
};

H.buyDev = (s, a) => {
  assertMain(s, a);
  const p = s.players[a.pid]!;
  if (!s.devDeck.length) fail('Hết thẻ phát triển rồi.');
  if (!canAfford(p.res, COSTS.dev)) fail('Bạn không đủ tài nguyên.');
  pay(s, a.pid, COSTS.dev);
  const type = s.devDeck.pop()!;
  p.dev.push({ type, turn: s.turn });
  s.fx.push({ kind: 'devBought', pid: a.pid, type });
  log(s, `🃏 @${a.pid} mua một thẻ phát triển.`, a.pid);
};

H.playDev = (s, a) => {
  if (a.pid !== s.current) fail('Chưa tới lượt bạn.');
  if (!playableDev(s, a.pid).includes(a.card)) fail('Giờ chưa dùng thẻ đó được.');
  const p = s.players[a.pid]!;
  // validate parameters before mutating
  if (a.card === 'yearOfPlenty') {
    const rs = a.res || [];
    if (rs.length !== 2 || !rs.every(isRes)) fail('Chọn 2 tài nguyên.');
    const need: Partial<Record<Res, number>> = {};
    rs.forEach(r => (need[r] = (need[r] || 0) + 1));
    for (const [r, k] of resEntries(need)) if (s.bank[r] < k) fail('Ngân hàng không đủ.');
  }
  if (a.card === 'monopoly' && !isRes(a.res)) fail('Chọn một tài nguyên.');
  const idx = p.dev.findIndex(c => c.type === a.card && c.turn < s.turn);
  p.dev.splice(idx, 1);
  s.devPlayed = true;
  s.fx.push({ kind: 'devPlayed', pid: a.pid, card: a.card });
  log(s, `${DEV_INFO[a.card].icon} @${a.pid} dùng thẻ ${DEV_INFO[a.card].name}.`, a.pid);
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
      s.fx.push({ kind: 'fromBank', pid: a.pid, res: a.res });
      break;
    case 'monopoly': {
      let got = 0;
      const from: [number, number][] = [];
      for (const o of s.players) {
        if (o.id === a.pid) continue;
        if (o.res[a.res]) from.push([o.id, o.res[a.res]]);
        got += o.res[a.res];
        o.stats.lost += o.res[a.res];
        o.res[a.res] = 0;
      }
      p.res[a.res] += got;
      s.fx.push({ kind: 'monopoly', pid: a.pid, res: a.res, from });
      log(s, `👑 @${a.pid} gom được ${got} ${resName(a.res)}.`, a.pid);
      break;
    }
  }
};

H.bankTrade = (s, a) => {
  assertMain(s, a);
  if (!RES.includes(a.give) || !RES.includes(a.get) || a.give === a.get) fail('Giao dịch không hợp lệ.');
  const ratio = tradeRatio(s, a.pid, a.give);
  const p = s.players[a.pid]!;
  if (p.res[a.give] < ratio) fail(`Bạn cần ${ratio} thẻ loại đó.`);
  if (s.bank[a.get] < 1) fail('Ngân hàng hết loại tài nguyên đó.');
  p.res[a.give] -= ratio;
  s.bank[a.give] += ratio;
  p.res[a.get]++;
  s.bank[a.get]--;
  s.fx.push({ kind: 'bankTrade', pid: a.pid, give: a.give, n: ratio, get: a.get });
  log(s, `🏦 @${a.pid} đổi ${ratio}${resName(a.give)} lấy 1${resName(a.get)}.`, a.pid);
};

const validOffer = (o: Partial<Hand> | null | undefined): boolean => !!o && RES.every(r => Number.isInteger(o[r] || 0) && (o[r] || 0) >= 0);

H.proposeTrade = (s, a) => {
  assertMain(s, a);
  if (s.trade) fail('Đang có một lời mời chưa xong.');
  if (!validOffer(a.give) || !validOffer(a.get)) fail('Lời mời không hợp lệ.');
  if (!handSize(a.give) || !handSize(a.get)) fail('Lời mời phải có cả thứ đưa và thứ nhận.');
  if (RES.some(r => (a.give[r] || 0) && (a.get[r] || 0))) fail('Không thể đưa và đòi cùng một loại tài nguyên.');
  if (!canAfford(s.players[a.pid]!.res, a.give)) fail('Bạn không có thứ mình định đưa.');
  const to = (a.to && a.to.length ? a.to : s.players.map(p => p.id)).filter(i => i !== a.pid && s.players[i] && !s.players[i]!.retired);
  if (!to.length) fail('Không có ai để mời.');
  const give = zeroRes(), get = zeroRes();
  for (const r of RES) {
    give[r] = a.give[r] || 0;
    get[r] = a.get[r] || 0;
  }
  const p = s.players[a.pid]!;
  if (p.tradeTurn !== s.turn) p.tradeTurn = s.turn, p.tradeCount = 0;
  p.tradeCount!++;
  s.trade = { id: ++s.tradeSeq, from: a.pid, give, get, to, responses: Object.fromEntries(to.map(i => [i, null])) };
  log(s, `🤝 @${a.pid} mời giao dịch.`, a.pid);
};

H.respondTrade = (s, a) => {
  const t = s.trade;
  if (!t || !t.to.includes(a.pid)) fail('Không có lời mời nào cho bạn.');
  if (a.tradeId != null && a.tradeId !== t.id) fail('Lời mời đó không còn nữa.');
  if (a.accept && !canAfford(s.players[a.pid]!.res, t.get)) fail('Bạn không có thứ họ cần.');
  t.responses[a.pid] = a.accept ? 'accept' : 'reject';
};

H.confirmTrade = (s, a) => {
  const t = s.trade;
  if (!t || t.from !== a.pid) fail('Bạn chưa đưa ra lời mời nào.');
  if (t.responses[a.with] !== 'accept') fail('Người đó chưa đồng ý.');
  const p = s.players[a.pid]!, o = s.players[a.with]!;
  if (!canAfford(p.res, t.give) || !canAfford(o.res, t.get)) {
    s.trade = null;
    fail('Có người không còn đủ tài nguyên nữa.');
  }
  for (const r of RES) {
    p.res[r] += t.get[r] - t.give[r];
    o.res[r] += t.give[r] - t.get[r];
  }
  s.trade = null;
  s.fx.push({ kind: 'trade', a: a.pid, b: a.with, give: t.give, get: t.get });
  log(s, `🤝 @${a.pid} và @${a.with} trao đổi với nhau.`, a.pid);
};

H.cancelTrade = (s, a) => {
  if (!s.trade || s.trade.from !== a.pid) fail('Bạn chưa đưa ra lời mời nào.');
  s.trade = null;
};

// next seat still in the game; `wrapped` when we pass the first player (new round)
function nextActive(s: GameState, from: number): { pid: number; wrapped: boolean } {
  const n = s.players.length;
  const pos = (p: number) => (p - s.first + n) % n;
  for (let k = 1; k <= n; k++) {
    const c = (from + k) % n;
    if (!s.players[c]!.retired) return { pid: c, wrapped: pos(c) <= pos(from) };
  }
  return { pid: from, wrapped: true };
}

function advanceTurn(s: GameState) {
  s.trade = null;
  const { pid, wrapped } = nextActive(s, s.current);
  s.current = pid;
  s.turn++;
  s.devPlayed = false;
  s.freeRoads = 0;
  s.phase = 'roll';
  if (wrapped) {
    s.round++;
    s.event = null;
    startRound(s);
  }
  log(s, `🎲 Lượt của @${s.current}.`, s.current);
}

H.endTurn = (s, a) => {
  assertMain(s, a);
  advanceTurn(s);
};

// ---- seat management (host only: disconnections, votes) ----
H.setController = (s, a) => {
  const p = s.players[a.pid]!;
  if (p.retired) fail('Người đó đã rời ván.');
  if (a.kind !== 'bot' && a.kind !== 'human') fail('Lệnh điều khiển không hợp lệ.');
  if (p.kind === a.kind) return;
  p.kind = a.kind;
  if (a.kind === 'bot') p.level = p.level || 'normal';
  log(s, a.kind === 'bot' ? `🤖 Bot chơi thay @${a.pid}.` : `👋 @${a.pid} đã quay lại chơi tiếp.`, a.pid);
  s.fx.push({ kind: 'controller', pid: a.pid, to: a.kind });
};

H.retirePlayer = (s, a) => {
  const pid = a.pid;
  const p = s.players[pid]!;
  if (p.retired) fail('Người đó đã rời ván.');
  if (s.players.filter(x => !x.retired).length <= 2) fail('Phải còn ít nhất 2 người chơi.');
  p.retired = true;
  // hand back to the bank, development cards leave the game
  for (const r of RES) {
    s.bank[r] += p.res[r];
    p.res[r] = 0;
  }
  p.dev = [];
  // pending secret placements go back to the box
  for (const b of s.blind.filter(x => x.pid === pid)) {
    if (b.type === 'city') p.citiesLeft++;
    else p.settlementsLeft++;
    if (b.eid != null) p.roadsLeft++;
  }
  s.blind = s.blind.filter(x => x.pid !== pid);
  // trades
  if (s.trade) {
    if (s.trade.from === pid) s.trade = null;
    else if (s.trade.to.includes(pid)) {
      s.trade.to = s.trade.to.filter(x => x !== pid);
      delete s.trade.responses[pid];
      if (!s.trade.to.length) s.trade = null;
    }
  }
  // awards
  if (s.largestArmy.owner === pid) {
    const act = s.players.filter(x => !x.retired && x.knights >= 3);
    const max = Math.max(0, ...act.map(x => x.knights));
    const top = act.filter(x => x.knights === max);
    s.largestArmy = top.length === 1 ? { owner: top[0]!.id, count: max } : { owner: -1, count: 0 };
  }
  updateLongestRoad(s);
  log(s, `🚪 @${pid} rời ván.`, pid);
  s.fx.push({ kind: 'retired', pid });
  // keep the game flowing
  delete s.pendingDiscards[pid];
  if (s.phase === 'setup') {
    const st = s.setup;
    const cur = st.queue[st.idx]!;
    st.queue = st.queue.filter((e, i) => i <= st.idx || e.pid !== pid);
    if (cur.pid === pid) {
      st.queue.splice(st.idx, 1);
      if (st.idx < st.queue.length) {
        const nx = st.queue[st.idx]!;
        s.current = nx.pid;
        st.step = nx.roadOnly ? 'road' : 'settlement';
        st.lastVid = nx.roadOnly ? nx.vid! : null;
      } else {
        st.step = 'settlement';
        st.lastVid = null;
        if (!st.fixing && st.blindActive) {
          resolveBlind(s);
          if (s.phase === 'setup') return;
        }
        beginTurns(s);
      }
    }
    return;
  }
  if (s.phase === 'discard' && !Object.keys(s.pendingDiscards).length) s.phase = s.config.rules.noRobber ? 'main' : 'robber';
  if (s.current === pid && s.phase !== 'gameOver') {
    s.pendingDiscards = {};
    advanceTurn(s);
  }
};

// actions that leave the trade on the table when the current player makes them
const TRADE_ACTIONS = new Set(['proposeTrade', 'respondTrade', 'confirmTrade', 'cancelTrade']);

export function applyAction(s: GameState, a: Action): ApplyResult {
  s.fx = [];
  try {
    // `a` may be garbage coming over the network: look the handler up without trusting its type
    const h = (H as unknown as Record<string, ((s: GameState, a: Action) => void) | undefined>)[a && a.type];
    if (!h) fail('Hành động không hợp lệ.');
    if (typeof a.pid !== 'number' || !s.players[a.pid]) fail('Người chơi không hợp lệ.');
    if (s.phase === 'gameOver') fail('Ván đã kết thúc.');
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
    if (e instanceof GameError) return { ok: false, error: e.m };
    throw e;
  }
}

