import { RES } from './constants.js';
import { rand, randInt, shuffle } from './rng.js';

const SQ3 = Math.sqrt(3);
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const hk = (q, r) => q + ',' + r;
export const hexCenter = (q, r) => ({ x: SQ3 * (q + r / 2), y: 1.5 * r });
export const hexDist = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[0] + a[1] - b[0] - b[1])) / 2;

function corner(q, r, i) {
  const c = hexCenter(q, r);
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: c.x + Math.cos(a), y: c.y + Math.sin(a) };
}
const pkey = p => Math.round(p.x * 1000) + ',' + Math.round(p.y * 1000);

// ---------- shapes ----------
export function hexagon(R) {
  const out = [];
  for (let q = -R; q <= R; q++)
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) out.push([q, r]);
  return out;
}

export function rows(counts) {
  const out = [];
  const half = Math.floor(counts.length / 2);
  counts.forEach((c, i) => {
    const r = i - half;
    const qmin = -Math.floor((c - 1 + r) / 2);
    for (let k = 0; k < c; k++) out.push([qmin + k, r]);
  });
  return out;
}

function neighborsOf([q, r]) {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

function weightedPick(rng, items, w) {
  const tot = items.reduce((a, it) => a + w(it), 0);
  let x = rand(rng) * tot;
  for (const it of items) {
    x -= w(it);
    if (x <= 0) return it;
  }
  return items[items.length - 1];
}

// Random compact continent grown from the center.
export function blob(rng, n) {
  const set = new Map([[hk(0, 0), [0, 0]]]);
  while (set.size < n) {
    const cands = new Map();
    for (const h of set.values())
      for (const nb of neighborsOf(h)) {
        const k = hk(...nb);
        if (set.has(k)) continue;
        const c = cands.get(k) || [nb[0], nb[1], 0];
        c[2]++;
        cands.set(k, c);
      }
    const c = weightedPick(rng, [...cands.values()], c => c[2] ** 3);
    set.set(hk(c[0], c[1]), [c[0], c[1]]);
  }
  return [...set.values()];
}

export function pixelToHex(x, y) {
  const q = (SQ3 / 3) * x - y / 3;
  const r = (2 / 3) * y;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dz > dy) rz = -rx - ry;
  return [rx, rz];
}

// Several islands separated by at least one sea hex.
export function islands(rng, n, k) {
  const size = Math.ceil(n / k);
  const rad = 1.9 * Math.sqrt(size) + 1.4;
  const off = rand(rng) * Math.PI * 2;
  const owner = new Map();
  const isl = [];
  for (let i = 0; i < k; i++) {
    const a = off + (i / k) * Math.PI * 2;
    const c = pixelToHex(Math.cos(a) * rad * (k > 1 ? 1 : 0), Math.sin(a) * rad * (k > 1 ? 1 : 0));
    isl.push([c]);
    owner.set(hk(...c), i);
  }
  let total = k;
  let stuck = 0;
  while (total < n && stuck < k * 4) {
    let grew = false;
    for (let i = 0; i < k && total < n; i++) {
      const cands = [];
      for (const h of isl[i])
        for (const nb of neighborsOf(h)) {
          const kk = hk(...nb);
          if (owner.has(kk)) continue;
          // must not touch any other island
          if (neighborsOf(nb).some(x => owner.has(hk(...x)) && owner.get(hk(...x)) !== i)) continue;
          const touching = neighborsOf(nb).filter(x => owner.get(hk(...x)) === i).length;
          cands.push([nb, touching]);
        }
      if (!cands.length) continue;
      const [nb] = weightedPick(rng, cands, c => c[1] ** 3);
      owner.set(hk(...nb), i);
      isl[i].push(nb);
      total++;
      grew = true;
    }
    stuck = grew ? 0 : stuck + 1;
  }
  return isl.flat();
}

export const SHAPES = {
  classic: { name: 'Clásico', desc: 'El tablero de siempre: 19 hexágonos.', gen: () => hexagon(2) },
  mini: { name: 'Mini', desc: '14 hexágonos. Duelo rápido para 2-3.', gen: () => rows([2, 3, 4, 3, 2]) },
  extended: { name: 'Extendido', desc: '30 hexágonos, pensado para 5-6 jugadores.', gen: () => rows([3, 4, 5, 6, 5, 4, 3]) },
  big: { name: 'Grande', desc: '37 hexágonos para partidas largas.', gen: () => hexagon(3) },
  huge: { name: 'Gigante', desc: '61 hexágonos. Un continente entero.', gen: () => hexagon(4) },
  ring: {
    name: 'Anillo del Lago', desc: 'Un anillo de tierra alrededor de un lago central con puertos.',
    gen: () => hexagon(3).filter(h => hexDist(h, [0, 0]) > 1),
  },
  star: {
    name: 'Estrella', desc: 'Hexágono con seis puntas: peleas en las esquinas.',
    gen: () => [...hexagon(2), ...DIRS.map(([q, r]) => [q * 3, r * 3]), ...DIRS.map(([q, r], i) => {
      const [q2, r2] = DIRS[(i + 1) % 6];
      return [q * 2 + q2, r * 2 + r2];
    })].filter((h, i, arr) => arr.findIndex(o => o[0] === h[0] && o[1] === h[1]) === i),
  },
  kingdoms: {
    name: 'Dos Reinos', desc: 'Dos mitades unidas por dos puentes de tierra.',
    gen: () => hexagon(3).filter(([q, r]) => r !== 0 || q === -1 || q === 1),
  },
  islands: {
    name: 'Archipiélago', desc: 'Islas separadas por el mar. Elige bien dónde empiezas.', random: true,
    gen: (rng, m, np) => islands(rng, m.size || 26, np > 4 ? 4 : 3),
  },
  pangea: {
    name: 'Pangea aleatoria', desc: 'Un continente con forma aleatoria. Tamaño configurable.', random: true,
    gen: (rng, m) => blob(rng, m.size || 24),
  },
  custom: { name: 'Personalizado', desc: 'Un mapa hecho en el editor.', gen: () => hexagon(2) },
};

// ---------- resources & numbers ----------
const RES_WEIGHT = { wood: 4, brick: 3, sheep: 4, wheat: 4, ore: 3 };

function balancedResources(rng, count) {
  const total = 18;
  const alloc = RES.map(r => {
    const exact = (count * RES_WEIGHT[r]) / total;
    return { r, n: Math.floor(exact), frac: exact - Math.floor(exact) + rand(rng) * 1e-3 };
  });
  let left = count - alloc.reduce((a, x) => a + x.n, 0);
  alloc.sort((a, b) => b.frac - a.frac);
  for (let i = 0; left > 0; i = (i + 1) % alloc.length, left--) alloc[i].n++;
  const out = [];
  for (const a of alloc) for (let i = 0; i < a.n; i++) out.push(a.r);
  return shuffle(rng, out);
}

function chaosResources(rng, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(i < 5 && count >= 5 ? RES[i] : RES[randInt(rng, 5)]);
  return shuffle(rng, out);
}

const BASE_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const EXTRA_ORDER = [5, 9, 4, 10, 6, 8, 3, 11, 5, 9, 4, 10, 2, 12, 6, 8, 3, 11];

export function genTokens(k) {
  const out = [];
  while (out.length + BASE_TOKENS.length <= k) out.push(...BASE_TOKENS);
  for (let i = 0; out.length < k; i++) out.push(EXTRA_ORDER[i % EXTRA_ORDER.length]);
  return out;
}

function adjacencyViolations(tiles, adj) {
  let bad = 0;
  const per = new Array(tiles.length).fill(0);
  for (let i = 0; i < tiles.length; i++) {
    const a = tiles[i].num;
    if (!a) continue;
    for (const j of adj[i]) {
      if (j < i) continue;
      const b = tiles[j].num;
      if (!b) continue;
      const red = (a === 6 || a === 8) && (b === 6 || b === 8);
      if (red || a === b) {
        bad++;
        per[i]++;
        per[j]++;
      }
    }
  }
  return { bad, per };
}

// Place tokens trying to avoid adjacent 6/8 and equal numbers (hill climbing).
function placeNumbers(rng, tiles, adj, movable, balanced) {
  if (!balanced || movable.length < 2) return;
  let { bad, per } = adjacencyViolations(tiles, adj);
  for (let it = 0; it < 4000 && bad > 0; it++) {
    const offenders = movable.filter(i => per[i] > 0);
    const a = offenders.length ? offenders[randInt(rng, offenders.length)] : movable[randInt(rng, movable.length)];
    const b = movable[randInt(rng, movable.length)];
    if (a === b) continue;
    [tiles[a].num, tiles[b].num] = [tiles[b].num, tiles[a].num];
    const next = adjacencyViolations(tiles, adj);
    if (next.bad <= bad || rand(rng) < 0.02) {
      bad = next.bad;
      per = next.per;
    } else {
      [tiles[a].num, tiles[b].num] = [tiles[b].num, tiles[a].num];
    }
  }
}

// ---------- full board ----------
export function generateBoard(config, rng) {
  const m = config.map;
  const np = config.players.length;
  let coords;
  let fixed = null;
  if (m.shape === 'custom' && m.custom && m.custom.tiles && m.custom.tiles.length >= 3) {
    fixed = m.custom.tiles;
    coords = fixed.map(t => [t.q, t.r]);
  } else {
    coords = (SHAPES[m.shape] || SHAPES.classic).gen(rng, m, np);
  }
  const N = coords.length;
  const tiles = coords.map(([q, r], i) => ({ id: i, q, r, ...hexCenter(q, r), kind: 'land', res: null, num: null, verts: [], revealed: true, numRevealed: true }));
  const index = new Map(tiles.map(t => [hk(t.q, t.r), t.id]));
  const adj = tiles.map(t => neighborsOf([t.q, t.r]).map(h => index.get(hk(...h))).filter(x => x !== undefined));

  // resources
  const free = [];
  tiles.forEach((t, i) => {
    const f = fixed && fixed[i];
    if (f && f.res && f.res !== 'random') t.res = f.res;
    else free.push(i);
  });
  let deserts = m.deserts === 'auto' || m.deserts == null ? Math.max(1, Math.round(N / 19)) : +m.deserts;
  let gold = +m.gold || 0;
  if (fixed) {
    // on custom maps deserts/gold painted by hand count towards the totals
    deserts = Math.max(0, deserts - tiles.filter(t => t.res === 'desert').length);
    gold = Math.max(0, gold - tiles.filter(t => t.res === 'gold').length);
  }
  deserts = Math.min(deserts, free.length);
  gold = Math.min(gold, free.length - deserts);
  shuffle(rng, free);
  const pool = [];
  for (let i = 0; i < deserts; i++) pool.push('desert');
  for (let i = 0; i < gold; i++) pool.push('gold');
  const rest = free.length - pool.length;
  pool.push(...(m.resources === 'chaos' ? chaosResources(rng, rest) : balancedResources(rng, rest)));
  shuffle(rng, pool);
  free.forEach((ti, k) => (tiles[ti].res = pool[k]));

  // numbers
  const needNum = [];
  tiles.forEach((t, i) => {
    if (t.res === 'desert') return;
    const f = fixed && fixed[i];
    if (f && f.num) t.num = f.num;
    else needNum.push(i);
  });
  const tokens = shuffle(rng, genTokens(needNum.length));
  needNum.forEach((ti, k) => (tiles[ti].num = tokens[k]));
  placeNumbers(rng, tiles, adj, needNum, m.numbers !== 'random');

  // sea ring (visual only)
  const seaKeys = new Map();
  for (const t of tiles)
    for (const nb of neighborsOf([t.q, t.r])) {
      const k = hk(...nb);
      if (!index.has(k) && !seaKeys.has(k)) seaKeys.set(k, nb);
    }
  const sea = [...seaKeys.values()].map(([q, r]) => ({ q, r, ...hexCenter(q, r) }));

  // vertices & edges
  const vmap = new Map();
  const vertices = [];
  const emap = new Map();
  const edges = [];
  for (const t of tiles) {
    for (let i = 0; i < 6; i++) {
      const p = corner(t.q, t.r, i);
      const k = pkey(p);
      let v = vmap.get(k);
      if (v === undefined) {
        v = vertices.length;
        vmap.set(k, v);
        vertices.push({ id: v, x: p.x, y: p.y, hexes: [], adj: [], edges: [], port: null });
      }
      vertices[v].hexes.push(t.id);
      t.verts.push(v);
    }
    for (let i = 0; i < 6; i++) {
      const a = t.verts[i], b = t.verts[(i + 1) % 6];
      const k = a < b ? a + '-' + b : b + '-' + a;
      let e = emap.get(k);
      if (e === undefined) {
        e = edges.length;
        emap.set(k, e);
        edges.push({ id: e, a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
        vertices[a].edges.push(e);
        vertices[b].edges.push(e);
        vertices[a].adj.push(b);
        vertices[b].adj.push(a);
      }
      edges[e].hexes.push(t.id);
    }
  }

  // ports on coastal edges
  const ports = [];
  const cx = tiles.reduce((a, t) => a + t.x, 0) / N;
  const cy = tiles.reduce((a, t) => a + t.y, 0) / N;
  const coastal = edges
    .filter(e => e.hexes.length === 1)
    .map(e => {
      const va = vertices[e.a], vb = vertices[e.b];
      const mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
      return { e, mx, my, ang: Math.atan2(my - cy, mx - cx) };
    })
    .sort((a, b) => a.ang - b.ang);
  const portDensity = { none: 0, few: 1 / 5, normal: 1 / 3.3, many: 1 / 2.2 }[m.ports || 'normal'] ?? 1 / 3.3;
  const nPorts = Math.min(Math.round(coastal.length * portDensity), Math.floor(coastal.length / 2));
  if (nPorts > 0) {
    const nSpecific = Math.round((nPorts * 5) / 9);
    const types = [];
    const resOrder = shuffle(rng, [...RES]);
    for (let i = 0; i < nPorts; i++) types.push(i < nSpecific ? resOrder[i % 5] : 'any');
    shuffle(rng, types);
    const step = coastal.length / nPorts;
    const start = rand(rng) * step;
    const used = new Set();
    for (let i = 0; i < nPorts; i++) {
      const base = Math.floor(start + i * step) % coastal.length;
      for (const d of [0, 1, -1, 2, -2]) {
        const c = coastal[(base + d + coastal.length) % coastal.length];
        if (used.has(c.e.a) || used.has(c.e.b)) continue;
        used.add(c.e.a);
        used.add(c.e.b);
        const land = tiles[c.e.hexes[0]];
        let nx = c.mx - land.x, ny = c.my - land.y;
        const len = Math.hypot(nx, ny);
        nx /= len;
        ny /= len;
        const type = types[ports.length];
        const pid = ports.length;
        ports.push({ id: pid, edge: c.e.id, type, ratio: type === 'any' ? 3 : 2, x: c.mx + nx * 0.62, y: c.my + ny * 0.62, nx, ny });
        vertices[c.e.a].port = pid;
        vertices[c.e.b].port = pid;
        break;
      }
    }
  }

  const all = [...tiles, ...sea];
  const bounds = {
    minX: Math.min(...all.map(t => t.x)) - 1,
    maxX: Math.max(...all.map(t => t.x)) + 1,
    minY: Math.min(...all.map(t => t.y)) - 1.2,
    maxY: Math.max(...all.map(t => t.y)) + 1.2,
  };
  const desert = tiles.find(t => t.res === 'desert');
  return { tiles, sea, vertices, edges, ports, bounds, robber: desert ? desert.id : -1 };
}
