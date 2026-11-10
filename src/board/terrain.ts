// Terrain field: height + splat weights + tint at any world point, plus the splat material.
// Pure sampling (terrainOf) has no DOM/GPU dependency.
import * as THREE from 'three';
import { pixelToHex as pixelToHexJs, hk } from '@engine/board';
import type { BBoard, BState, BTile } from './types';
import { patch } from './shaders';
import { SETTINGS } from './settings';
import type { Textures } from './assets';
import type { Board3D } from './Board3D';

export const pixelToHex = (x: number, z: number) => pixelToHexJs(x, z) as [number, number];

export const INR = Math.sqrt(3) / 2; // hex inradius
export const NORMALS = [0, 1, 2].map((k): [number, number] => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
export const L = { grass: 0, forest: 1, dirt: 2, rock: 3, sand: 4, snow: 5, field: 6, meadow: 7 };
export const TINT: { [kind: string]: THREE.Color | undefined; white: THREE.Color } = { brick: new THREE.Color('#ffa488'), desert: new THREE.Color('#f4ece2'), back: new THREE.Color('#b99873'), unknown: new THREE.Color('#9aa39c'), gold: new THREE.Color('#f0d27a'), white: new THREE.Color('#ffffff') };

// ---------- noise ----------
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x: number, y: number) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function prng(seed: number) {
  let s = (Math.abs(seed | 0) % 233280) + 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

// ---------- tile looks: 5 variations per resource ----------
// Which looks each resource may use. A tile's look comes from its id and position, so every player
// sees the same map. LOOK_OVERRIDE forces one look for a resource (samples, debugging).
export const TILE_LOOKS: Record<string, number[]> = { wood: [0, 1, 2, 3], sheep: [0, 1, 2, 3, 4], wheat: [0, 1, 2, 4], brick: [0, 1, 2, 3, 4], ore: [0, 1, 2, 3, 4] };
export const LOOK_OVERRIDE: Record<string, number> = {};
export function tileLook(res: string, seed: number) {
  if (LOOK_OVERRIDE[res] != null) return LOOK_OVERRIDE[res];
  const list = TILE_LOOKS[res];
  return list && list.length ? list[(Math.imul(seed, 2654435761) >>> 0) % list.length] : 0;
}

// ---------- terrain field: height + splat weights + tint at any world point ----------
export function terrainOf(st: BState, faceDown: boolean) {
  const tiles = st.board.tiles;
  const land = new Map<string, BTile>(tiles.map((t): [string, BTile] => [hk(t.q, t.r), t]));
  const kindOf = (t: BTile) => (!t.revealed ? (faceDown ? 'back' : 'unknown') : t.res);
  const seedOf = (t: BTile) => t.id * 7 + (t.q * 131 + t.r * 71);
  const lookOf = (t: BTile) => (t.revealed ? tileLook(t.res, seedOf(t)) : 0);

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
    tint: THREE.Color;
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
      out.tint.copy(TINT.white);
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
        out.tint.setRGB(1 - depth * 0.35, 1 - depth * 0.3, 1 - depth * 0.25);
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
        out.tint.copy(ta).lerp(tb, wN);
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
        out.tint.copy(TINT[kind] || TINT.white).lerp(TINT.white, c);
      }
    } else if (out) {
      featureW(kind, dx, dz, e, h, seed, out.w, 1, look);
      out.tint.copy(TINT[kind] || TINT.white);
    }
    if (out) {
      const a = (seed % 6) * 0.52;
      out.row = dx * Math.cos(a) + dz * Math.sin(a);
    }
    return h;
  }
  // true when (x, z), inside tile t, lies in the band along an edge shared with red clay:
  // other tiles keep their bushes, trees and grass out of it
  function nearClay(t: BTile, x: number, z: number) {
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

// terrain material: splat 8 array-texture layers + normals + wheat furrows
export function terrainMaterial(tex: Textures) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  m.normalMap = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  m.normalMap.needsUpdate = true;
  m.normalScale = new THREE.Vector2(1.1, 1.1);
  const base = m;
  base.onBeforeCompile = sh => {
    sh.uniforms.uAlb = { value: tex.alb };
    sh.uniforms.uNrm = { value: tex.nrm };
    sh.vertexShader = 'attribute vec4 aW0;\nattribute vec4 aW1;\nattribute float aRow;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying float vRow;\nvarying vec2 vSplatUv;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vW0 = aW0; vW1 = aW1; vRow = aRow;
  vSplatUv = (modelMatrix * vec4(position, 1.0)).xz * 1.35;`);
    sh.fragmentShader = 'precision highp sampler2DArray;\nuniform sampler2DArray uAlb;\nuniform sampler2DArray uNrm;\nvarying vec4 vW0;\nvarying vec4 vW1;\nvarying float vRow;\nvarying vec2 vSplatUv;\n' +
      `vec3 splat(sampler2DArray s, vec2 uv) {
        vec3 c = vec3(0.0);
        if (vW0.x > 0.004) c += vW0.x * texture(s, vec3(uv, 0.0)).rgb;
        if (vW0.y > 0.004) c += vW0.y * texture(s, vec3(uv, 1.0)).rgb;
        if (vW0.z > 0.004) c += vW0.z * texture(s, vec3(uv, 2.0)).rgb;
        if (vW0.w > 0.004) c += vW0.w * texture(s, vec3(uv * 0.55, 3.0)).rgb;
        if (vW1.x > 0.004) c += vW1.x * texture(s, vec3(uv, 4.0)).rgb;
        if (vW1.y > 0.004) c += vW1.y * texture(s, vec3(uv * 0.7, 5.0)).rgb;
        if (vW1.z > 0.004) c += vW1.z * texture(s, vec3(uv, 6.0)).rgb;
        if (vW1.w > 0.004) c += vW1.w * texture(s, vec3(uv, 7.0)).rgb;
        return c / max(dot(vW0, vec4(1.0)) + dot(vW1, vec4(1.0)), 0.0001);
      }\n` +
      sh.fragmentShader
        .replace('#include <map_fragment>', `
  vec3 salb = splat(uAlb, vSplatUv);
  // ploughed furrows on wheat fields
  float fur = smoothstep(0.18, 0.5, abs(fract(vRow * 7.5) - 0.5));
  salb = mix(salb, salb * vec3(0.62, 0.55, 0.45), vW1.z * (1.0 - fur) * 0.85);
  diffuseColor.rgb *= salb;`)
        .replace('texture2D( normalMap, vNormalMapUv ).xyz', 'splat(uNrm, vSplatUv)');
  };
  base.customProgramCacheKey = () => 'terrainSplat';
  return patch(base, { clouds: true, key: 'terrain' });
}

export type TerrainField = ReturnType<typeof terrainOf>;

// ---- terrain mesh: one continuous heightfield (the caller adds it to the static group)
export function buildTerrainMesh(board: Board3D, st: BState, field: TerrainField): THREE.Mesh {
  const bd = st.board;
  const b = bd.bounds;
  const STEP = SETTINGS.quality === 'high' ? 0.045 : 0.075;
  const x0 = b.minX - 0.8, z0 = b.minY - 0.8;
  const nx = Math.ceil((b.maxX - b.minX + 1.6) / STEP) + 1, nz = Math.ceil((b.maxY - b.minY + 1.6) / STEP) + 1;
  const N = nx * nz;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2);
  const w0 = new Float32Array(N * 4), w1 = new Float32Array(N * 4), row = new Float32Array(N);
  const out = { w: new Float32Array(8), tint: new THREE.Color(), row: 0 };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * STEP, z = z0 + j * STEP;
      const h = field.sample(x, z, out);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      col[k * 3] = out.tint.r;
      col[k * 3 + 1] = out.tint.g;
      col[k * 3 + 2] = out.tint.b;
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('aW0', new THREE.BufferAttribute(w0, 4));
  geo.setAttribute('aW1', new THREE.BufferAttribute(w1, 4));
  geo.setAttribute('aRow', new THREE.BufferAttribute(row, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // steep slopes become rock
  const nrm = geo.attributes.normal!.array;
  for (let k = 0; k < N; k++) {
    const steep = smooth(0.84, 0.58, nrm[k * 3 + 1]!);
    if (steep <= 0 || pos[k * 3 + 1]! < -0.3) continue;
    for (let q = 0; q < 4; q++) {
      w0[k * 4 + q]! *= 1 - steep;
      w1[k * 4 + q]! *= 1 - steep;
    }
    w0[k * 4 + 3]! += steep;
  }
  const terrain = new THREE.Mesh(geo, terrainMaterial(board.tex));
  terrain.receiveShadow = terrain.castShadow = true;
  terrain.userData.own = true;
  return terrain;
}

// ---- subtle hex grid hugging the terrain (Civ style)
export function buildHexGrid(st: BState, field: TerrainField): THREE.LineSegments {
  const bd = st.board;
  const lines = [];
  for (const e of bd.edges) {
    const a = bd.vertices[e.a]!, c = bd.vertices[e.b]!;
    for (let s = 0; s < 6; s++) {
      const t0 = s / 6, t1 = (s + 1) / 6;
      const xa = a.x + (c.x - a.x) * t0, za = a.y + (c.y - a.y) * t0, xb = a.x + (c.x - a.x) * t1, zb = a.y + (c.y - a.y) * t1;
      lines.push(xa, field.sample(xa, za) + 0.014, za, xb, field.sample(xb, zb) + 0.014, zb);
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const grid = new THREE.LineSegments(lg, patch(new THREE.LineBasicMaterial({ color: '#fff6dc', transparent: true, opacity: 0.16 }), { key: 'grid' }));
  grid.userData.own = true;
  return grid;
}

/** Everything the terrain, props, grass and ports depend on (not the numbers: see tokenKey). */
export function terrainKey(bd: BBoard, faceDown: boolean): string {
  return bd.tiles.map(t => `${t.id}:${t.q},${t.r}${t.res}${t.revealed ? 1 : 0}`).join('|') + (faceDown ? 'F' : '') + bd.ports.length;
}
