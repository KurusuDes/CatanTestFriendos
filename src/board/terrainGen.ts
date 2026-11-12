// Pure terrain generation (no DOM, no three.js, no GPU): the terrain field (height + splat weights + tint at any
// world point), the heightfield mesh arrays, the seabed heightmap, the hex grid lines, the props and grass
// placements. It runs in terrain.worker.ts (off the main thread) or, if no Worker is available, on the main thread.
// Colours are plain linear-RGB numbers (what THREE.Color('#hex') holds); the maths and the prng call order are the
// same as before the move, so the island looks exactly the same.
import { hk } from '@engine/board';
import { INR, L, NORMALS, TINT, fbm, pixelToHex, prng, smooth, tileLook, vnoise, type GenInput, type RGB } from './terrainBase';
import { computeProps } from './propsGen';
import { computeGrass } from './grassGen';

export * from './terrainBase';
import type { GenTile } from './terrainBase';

// out = a + (b - a) * t, per channel (THREE.Color.copy(a).lerp(b, t))
function mix(out: RGB, a: RGB, b: RGB, t: number) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
}

// ---------- terrain field: height + splat weights + tint at any world point ----------
export function terrainOf(st: { board: { tiles: GenTile[] } }, faceDown: boolean) {
  const tiles = st.board.tiles;
  const land = new Map<string, GenTile>(tiles.map((t): [string, GenTile] => [hk(t.q, t.r), t]));
  const kindOf = (t: GenTile) => (!t.revealed ? (faceDown ? 'back' : 'unknown') : t.res);
  const seedOf = (t: GenTile) => t.id * 7 + (t.q * 131 + t.r * 71);
  const lookOf = (t: GenTile) => (t.revealed ? tileLook(t.res, seedOf(t)) : 0);

  function featureH(kind: string, dx: number, dz: number, e: number, seed: number, look = 0) {
    const fade = smooth(0.04, 0.32, e);
    const n = fbm(dx * 3 + seed, dz * 3 - seed);
    const bump = (cx: number, cz: number, r: number, h: number) => h * Math.exp(-((dx - cx) ** 2 + (dz - cz) ** 2) / (r * r));
    const rs = prng(seed);
    const a = rs() * 6.28;
    // the tile's own direction: looks line their hills and rows up along it
    const ca = Math.cos(a), sa = Math.sin(a);
    const along = dx * ca + dz * sa;
    switch (kind) {
      case 'ore': {
        let peaks;
        if (look === 1) peaks = bump(0, 0, 0.4, 1.35) + bump(ca * 0.45, sa * 0.45, 0.2, 0.35); // one big snowy peak
        else if (look === 2) peaks = [-0.5, -0.17, 0.17, 0.5].reduce((t, k, i) => t + bump(ca * k - sa * 0.08 * (i % 2), sa * k + ca * 0.08 * (i % 2), 0.21, [0.6, 0.95, 0.8, 0.55][i]!), 0); // a range
        else if (look === 3) peaks = bump(ca * 0.33, sa * 0.33, 0.3, 0.38) + bump(-sa * 0.38, ca * 0.38, 0.26, 0.3) + bump(-ca * 0.3 + sa * 0.2, -sa * 0.3 - ca * 0.2, 0.28, 0.34); // quarry: low rocky hills
        else if (look === 4) peaks = bump(ca * 0.3, sa * 0.3, 0.27, 0.95) + bump(-ca * 0.3, -sa * 0.3, 0.27, 0.9); // twin peaks
        else peaks = bump(ca * 0.42, sa * 0.42, 0.3, 1.05) + bump(Math.cos(a + 2.3) * 0.45, Math.sin(a + 2.3) * 0.45, 0.24, 0.7) + bump(Math.cos(a - 2.1) * 0.4, Math.sin(a - 2.1) * 0.4, 0.2, 0.5);
        const ridge = 1 - Math.abs(vnoise(dx * 6 + seed, dz * 6) * 2 - 1);
        return 0.32 + fade * (peaks * (0.8 + 0.35 * ridge) + n * 0.05);
      }
      case 'brick': {
        if (look === 1) return 0.3 + fade * (-bump(0, 0, 0.32, 0.13) + n * 0.05); // clay pit
        if (look === 2) return 0.3 + fade * n * 0.05; // brickworks on flat ground
        if (look === 3) return 0.3 + fade * (bump(ca * 0.35, sa * 0.35, 0.28, 0.3) + bump(-ca * 0.35, -sa * 0.35, 0.25, 0.24) + bump(-sa * 0.4, ca * 0.4, 0.2, 0.2) + n * 0.06); // red hills
        if (look === 4) return 0.3 + fade * (0.2 * smooth(-0.08, 0.1, along + (n - 0.5) * 0.2) + n * 0.05); // a bank: high on one side
        return 0.3 + fade * (bump(ca * 0.4, sa * 0.4, 0.3, 0.2) + bump(Math.cos(a + 2.5) * 0.45, Math.sin(a + 2.5) * 0.45, 0.25, 0.16) + n * 0.06);
      }
      case 'gold':
        return 0.3 + fade * (n * 0.12 + bump(0.3, -0.3, 0.25, 0.15));
      case 'wood':
        if (look === 1) return 0.3 + fade * (bump(0, 0, 0.45, 0.2) + n * 0.07); // pines on a hill
        if (look === 4) return 0.3 + fade * (bump(ca * 0.3, sa * 0.3, 0.22, 0.1) + n * 0.08);
        return 0.3 + fade * n * 0.07;
      case 'sheep':
        if (look === 2) return 0.28 + fade * (bump(ca * 0.35, sa * 0.35, 0.3, 0.2) + bump(-ca * 0.3 - sa * 0.2, -sa * 0.3 + ca * 0.2, 0.25, 0.14) + n * 0.07); // rolling hills
        return 0.28 + fade * n * 0.09;
      case 'wheat':
        if (look === 2) return 0.26 + fade * (bump(0, 0, 0.35, 0.16) + n * 0.02); // the mill on a knoll
        return 0.26 + fade * n * 0.02;
      case 'desert':
        // pale sand in clear dune ripples, so it never reads as a golden wheat field
        return 0.27 + fade * (Math.sin(dx * 8 + dz * 3.5 + seed) * 0.06 + n * 0.06);
      default:
        return 0.3;
    }
  }

  // splat weights (8 layers) of a terrain kind; w must be zeroed by the caller
  function featureW(kind: string, dx: number, dz: number, e: number, h: number, seed: number, w: Float32Array, k: number, look = 0) {
    const n = fbm(dx * 4 + seed * 0.3, dz * 4 - seed * 0.2);
    switch (kind) {
      case 'wood': {
        let f = 0.75 + 0.25 * smooth(0.05, 0.25, e);
        if (look === 2) f *= smooth(0.28, 0.46, Math.hypot(dx, dz)); // the woodcutter's clearing
        if (look === 3) f *= 0.55; // an oak grove: lighter undergrowth
        const r = look === 4 ? smooth(0.6, 0.72, n) * 0.8 : 0; // rocky forest: patches of stone
        w[L.forest]! += k * f * (1 - r);
        w[L.rock]! += k * f * r;
        w[look === 3 || look === 2 ? L.meadow : L.grass]! += k * (1 - f);
        break;
      }
      case 'sheep':
        w[L.meadow]! += k;
        break;
      case 'wheat': {
        const f = smooth(0.05, 0.14, e);
        w[L.field]! += k * f;
        w[L.grass]! += k * (1 - f);
        break;
      }
      case 'brick': {
        // red clay: bare earth tinted terracotta and nothing green, so it never reads as stone
        w[L.dirt]! += k;
        break;
      }
      case 'ore': {
        const r = look === 3 ? Math.max(0.7, smooth(0.36, 0.5, h)) : smooth(0.42, 0.7, h), s = smooth(0.95, 1.12, h);
        w[L.snow]! += k * s;
        w[L.rock]! += k * r * (1 - s);
        w[L.grass]! += k * (1 - r) * 0.7;
        w[L.dirt]! += k * (1 - r) * 0.3;
        break;
      }
      case 'desert':
        w[L.sand]! += k;
        break;
      case 'gold':
        w[L.rock]! += k * 0.55;
        w[L.sand]! += k * 0.45;
        break;
      case 'back':
        w[L.dirt]! += k;
        break;
      default:
        w[L.grass]! += k;
    }
  }

  // out: {w: Float32Array(8), tint: Color, row: number}
  interface SampleOut {
    w: Float32Array;
    tint: RGB;
    row: number;
  }
  function sample(x: number, z: number, out?: SampleOut) {
    const [q, r] = pixelToHex(x, z);
    const t = land.get(hk(q, r));
    const cx = Math.sqrt(3) * (q + r / 2), cz = 1.5 * r;
    const dx = x - cx, dz = z - cz;
    let best = 0, bk = 0, bs = 1;
    for (let k = 0; k < 3; k++) {
      const p = dx * NORMALS[k]![0] + dz * NORMALS[k]![1];
      if (Math.abs(p) > best) {
        best = Math.abs(p);
        bk = k;
        bs = Math.sign(p) || 1;
      }
    }
    const e = INR - best;
    const nx = cx + NORMALS[bk]![0] * bs * 2 * INR, nz = cz + NORMALS[bk]![1] * bs * 2 * INR;
    const [nq, nr] = pixelToHex(nx, nz);
    const nt = land.get(hk(nq, nr));
    if (out) {
      out.w.fill(0);
      out.tint[0] = out.tint[1] = out.tint[2] = 1;
      out.row = 0;
    }
    if (!t) {
      let dLand = 3;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as [number, number][]) {
        const lt = land.get(hk(q + dq, r + dr));
        if (!lt) continue;
        const ldx = x - lt.x, ldz = z - lt.y;
        dLand = Math.min(dLand, Math.max(...NORMALS.map(n => Math.abs(ldx * n[0] + ldz * n[1]))) - INR);
      }
      const depth = smooth(0, 1.1, dLand);
      if (out) {
        out.w[L.sand] = 1 - depth * 0.6;
        out.w[L.rock] = depth * 0.6;
        out.tint[0] = 1 - depth * 0.35;
        out.tint[1] = 1 - depth * 0.3;
        out.tint[2] = 1 - depth * 0.25;
      }
      return -0.34 - 0.65 * depth;
    }
    const kind = kindOf(t);
    const seed = seedOf(t);
    const look = lookOf(t);
    let h = featureH(kind, dx, dz, e, seed, look);
    // red clay keeps a crisp edge: a narrow blend, so the neighbour's grass never tints it green
    const BL = kind === 'brick' || (nt && kindOf(nt) === 'brick') ? 0.07 : 0.2;
    let wSelf = 1;
    if (e < BL && nt) {
      const wN = 0.5 * (1 - e / BL);
      wSelf = 1 - wN;
      const nk = kindOf(nt);
      const ndx = x - nx, ndz = z - nz;
      const ne = INR - Math.max(...NORMALS.map(n => Math.abs(ndx * n[0] + ndz * n[1])));
      const nl = lookOf(nt);
      const h2 = featureH(nk, ndx, ndz, ne, seedOf(nt), nl);
      const hs = h;
      h = hs * wSelf + h2 * wN;
      if (out) {
        featureW(kind, dx, dz, e, hs, seed, out.w, wSelf, look);
        featureW(nk, ndx, ndz, ne, h2, seedOf(nt), out.w, wN, nl);
        const ta = TINT[kind] || TINT.white, tb = TINT[nk] || TINT.white;
        mix(out.tint, ta, tb, wN);
      }
    } else if (e < BL && !nt) {
      // coast: cliff down to the sea, sandy foot
      const c = smooth(0.16, 0.0, e);
      const top = h;
      h = top * (1 - c) - 0.34 * c + (vnoise(x * 9, z * 9) - 0.5) * 0.06 * c;
      if (out) {
        featureW(kind, dx, dz, e, top, seed, out.w, 1 - c, look);
        out.w[L.rock]! += c * (1 - smooth(0.75, 1, c));
        out.w[L.sand]! += c * smooth(0.75, 1, c);
        mix(out.tint, TINT[kind] || TINT.white, TINT.white, c);
      }
    } else if (out) {
      featureW(kind, dx, dz, e, h, seed, out.w, 1, look);
      mix(out.tint, TINT[kind] || TINT.white, TINT.white, 0);
    }
    if (out) {
      const a = (seed % 6) * 0.52;
      out.row = dx * Math.cos(a) + dz * Math.sin(a);
    }
    return h;
  }
  // true when (x, z), inside tile t, lies in the band along an edge shared with red clay:
  // other tiles keep their bushes, trees and grass out of it
  function nearClay(t: GenTile, x: number, z: number) {
    if (t.res === 'brick') return false;
    const dx = x - t.x, dz = z - t.y;
    for (let k = 0; k < 3; k++) {
      const p = dx * NORMALS[k]![0] + dz * NORMALS[k]![1];
      if (INR - Math.abs(p) > 0.22) continue;
      const sg = Math.sign(p) || 1;
      const nb = land.get(hk(...pixelToHex(t.x + NORMALS[k]![0] * sg * 2 * INR, t.y + NORMALS[k]![1] * sg * 2 * INR)));
      if (nb && kindOf(nb) === 'brick') return true;
    }
    return false;
  }
  return { sample, land, kindOf, seedOf, lookOf, nearClay };
}

export type TerrainField = ReturnType<typeof terrainOf>;

// ---------- the static island as typed arrays ----------
export const SEABED_RES = 256;
export const SEABED_PAD = 3;

export interface GenResult {
  nx: number;
  nz: number;
  /** world position of vertex (0, 0) of the terrain grid, and the grid spacing */
  x0: number;
  z0: number;
  step: number;
  pos: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv: Float32Array;
  aW0: Float32Array;
  aW1: Float32Array;
  aRow: Float32Array;
  index: Uint32Array;
  /** terrain height at each grid vertex (nx * nz): the lookup behind Board3D.heightAt */
  heights: Float32Array;
  /** seabed heightmap, SEABED_RES x SEABED_RES, one byte per texel */
  seabed: Uint8Array;
  /** exact field height at the spots pieces stand on (vertices, tile centres, edge midpoints): [x, z, h] triples */
  exact: Float64Array;
  /** hex grid lines, 6 floats (two points) per segment */
  grid: Float32Array;
  /** prop instances per kit key (`name` or `name#variant`): flat [x, y, z, scale, rotY] */
  props: Record<string, Float32Array>;
  /** grass / wheat tuft instances: flat [x, y, z, scale, rotY] */
  grassLists: Record<string, Float32Array>;
}

/** Same result as THREE.BufferGeometry.computeVertexNormals on the indexed terrain geometry. */
function computeNormals(pos: Float32Array, index: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i]! * 3, b = index[i + 1]! * 3, c = index[i + 2]! * 3;
    // cb = pC - pB, ab = pA - pB, cb = cb x ab
    const cbx = pos[c]! - pos[b]!, cby = pos[c + 1]! - pos[b + 1]!, cbz = pos[c + 2]! - pos[b + 2]!;
    const abx = pos[a]! - pos[b]!, aby = pos[a + 1]! - pos[b + 1]!, abz = pos[a + 2]! - pos[b + 2]!;
    const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;
    n[a]! += x; n[a + 1]! += y; n[a + 2]! += z;
    n[b]! += x; n[b + 1]! += y; n[b + 2]! += z;
    n[c]! += x; n[c + 1]! += y; n[c + 2]! += z;
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i]!, y = n[i + 1]!, z = n[i + 2]!;
    const inv = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * inv; n[i + 1] = y * inv; n[i + 2] = z * inv;
  }
  return n;
}

const flat = (list: number[][]): Float32Array => {
  const a = new Float32Array(list.length * 5);
  list.forEach((p, i) => a.set(p, i * 5));
  return a;
};

export function generate(inp: GenInput): GenResult {
  const field = terrainOf({ board: { tiles: inp.tiles } }, inp.faceDown);
  const b = inp.bounds;
  // ---- terrain mesh: one continuous heightfield
  const STEP = inp.step;
  const x0 = b.minX - 0.8, z0 = b.minY - 0.8;
  const nx = Math.ceil((b.maxX - b.minX + 1.6) / STEP) + 1, nz = Math.ceil((b.maxY - b.minY + 1.6) / STEP) + 1;
  const N = nx * nz;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  const w0 = new Float32Array(N * 4), w1 = new Float32Array(N * 4), row = new Float32Array(N);
  const out = { w: new Float32Array(8), tint: [1, 1, 1] as RGB, row: 0 };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      const h = field.sample(x, z, out);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      col[k * 3] = out.tint[0];
      col[k * 3 + 1] = out.tint[1];
      col[k * 3 + 2] = out.tint[2];
      uv[k * 2] = x;
      uv[k * 2 + 1] = z;
      w0.set(out.w.subarray(0, 4), k * 4);
      w1.set(out.w.subarray(4, 8), k * 4);
      row[k] = out.row;
    }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, bq = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = bq; idx[p++] = bq; idx[p++] = c; idx[p++] = d;
    }
  const normal = computeNormals(pos, idx);
  // steep slopes become rock
  const heights = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    heights[k] = pos[k * 3 + 1]!;
    const steep = smooth(0.84, 0.58, normal[k * 3 + 1]!);
    if (steep <= 0 || pos[k * 3 + 1]! < -0.3) continue;
    for (let q = 0; q < 4; q++) {
      w0[k * 4 + q]! *= 1 - steep;
      w1[k * 4 + q]! *= 1 - steep;
    }
    w0[k * 4 + 3]! += steep;
  }
  // ---- seabed heightmap for the water shader
  const HM = SEABED_RES, pad = SEABED_PAD;
  const rx = b.minX - pad, rz = b.minY - pad, rw = b.maxX - b.minX + 2 * pad, rh = b.maxY - b.minY + 2 * pad;
  const seabed = new Uint8Array(HM * HM);
  for (let j = 0; j < HM; j++)
    for (let i = 0; i < HM; i++) {
      const hh = field.sample(rx + ((i + 0.5) / HM) * rw, rz + ((j + 0.5) / HM) * rh);
      seabed[j * HM + i] = Math.max(0, Math.min(255, Math.round(((hh + 1.2) / 2.7) * 255)));
    }
  // ---- subtle hex grid hugging the terrain
  const lines: number[] = [];
  for (const e of inp.edges) {
    const a = inp.vertices[e.a]!, c = inp.vertices[e.b]!;
    for (let s = 0; s < 6; s++) {
      const t0 = s / 6, t1 = (s + 1) / 6;
      const xa = a.x + (c.x - a.x) * t0, za = a.y + (c.y - a.y) * t0, xb = a.x + (c.x - a.x) * t1, zb = a.y + (c.y - a.y) * t1;
      lines.push(xa, field.sample(xa, za) + 0.014, za, xb, field.sample(xb, zb) + 0.014, zb);
    }
  }
  // ---- exact heights where pieces go (the grid would be off by up to ~0.6 at coastal corners: the cliff is steeper than a cell)
  const pts: number[] = [];
  for (const v of inp.vertices) pts.push(v.x, v.y, field.sample(v.x, v.y));
  for (const t of inp.tiles) pts.push(t.x, t.y, field.sample(t.x, t.y));
  for (const e of inp.edges) {
    const a = inp.vertices[e.a]!, c = inp.vertices[e.b]!, mx = (a.x + c.x) / 2, mz = (a.y + c.y) / 2;
    pts.push(mx, mz, field.sample(mx, mz));
  }
  // ---- props and grass
  const props: Record<string, Float32Array> = {};
  for (const [k, list] of Object.entries(computeProps(field, inp.tiles, inp.vertices, inp.props))) props[k] = flat(list);
  const grassLists: Record<string, Float32Array> = {};
  for (const [k, list] of Object.entries(computeGrass(field, inp.tiles, inp.grass))) grassLists[k] = flat(list);
  return { nx, nz, x0, z0, step: STEP, pos, normal, color: col, uv, aW0: w0, aW1: w1, aRow: row, index: idx, heights, seabed, exact: new Float64Array(pts), grid: new Float32Array(lines), props, grassLists };
}

/** Every ArrayBuffer of a result (to transfer them). */
export function resultBuffers(r: GenResult): ArrayBuffer[] {
  const bufs: ArrayBuffer[] = [];
  for (const v of Object.values(r)) {
    if (ArrayBuffer.isView(v)) bufs.push(v.buffer as ArrayBuffer);
    else if (v && typeof v === 'object') for (const a of Object.values(v)) if (ArrayBuffer.isView(a)) bufs.push(a.buffer as ArrayBuffer);
  }
  return bufs;
}

// ---------- height lookup on the terrain grid ----------
export interface HeightGrid {
  nx: number;
  nz: number;
  x0: number;
  z0: number;
  step: number;
  heights: Float32Array;
}
/** Height of the terrain MESH at (x, z): the two triangles of each cell, as drawn. null outside the grid. */
export const spotKey = (x: number, z: number) => Math.round(x * 1000) + ',' + Math.round(z * 1000);
export function gridHeight(g: HeightGrid, x: number, z: number): number | null {
  const fx = (x - g.x0) / g.step, fz = (z - g.z0) / g.step;
  if (!(fx >= 0 && fz >= 0 && fx <= g.nx - 1 && fz <= g.nz - 1)) return null;
  const i = Math.min(Math.floor(fx), g.nx - 2), j = Math.min(Math.floor(fz), g.nz - 2);
  const u = fx - i, v = fz - j, h = g.heights, a = j * g.nx + i;
  const ha = h[a]!, hb = h[a + 1]!, hc = h[a + g.nx]!, hd = h[a + g.nx + 1]!;
  // triangles (a, c, b) and (b, c, d) share the diagonal b-c: u + v = 1
  return u + v <= 1 ? ha + (hb - ha) * u + (hc - ha) * v : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
}
