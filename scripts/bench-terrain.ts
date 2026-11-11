// Times the terrain generation (what the worker does) and the main-thread part left (building geometry),
// and measures heightAt grid error vs the exact field. Usage: pnpm exec tsx scripts/bench-terrain.ts
import * as THREE from 'three';
import { createGame } from '../src/engine/game';
import { defaultConfig } from '../src/engine/config';
import { PARAMS, TIERS } from '../src/board/quality';
import { generate, gridHeight, terrainOf, type GenInput } from '../src/board/terrainGen';

const SHAPES: [string, number | undefined][] = [['classic', undefined], ['big', undefined], ['huge', undefined], ['pangea', 40]];
for (const [shape, size] of SHAPES) {
  const cfg = defaultConfig();
  cfg.seed = 5;
  cfg.map.shape = shape as any;
  if (size) cfg.map.size = size;
  const bd: any = createGame(cfg).board;
  for (const tier of TIERS) {
    const p = PARAMS[tier];
    const inp: GenInput = {
      tiles: bd.tiles.map((t: any) => ({ id: t.id, q: t.q, r: t.r, x: t.x, y: t.y, res: t.res, revealed: true })),
      vertices: bd.vertices.map((v: any) => ({ x: v.x, y: v.y })), edges: bd.edges.map((e: any) => ({ a: e.a, b: e.b })),
      bounds: bd.bounds, faceDown: false, step: p.terrainStep, grass: p.grass, props: p.props,
    };
    let t0 = performance.now();
    const res = generate(inp);
    const gen = performance.now() - t0;
    // what stays on the main thread: BufferGeometry + seabed expand + instance matrices
    t0 = performance.now();
    const geo = new THREE.BufferGeometry();
    for (const [n, a, s] of [['position', res.pos, 3], ['normal', res.normal, 3], ['color', res.color, 3], ['uv', res.uv, 2], ['aW0', res.aW0, 4], ['aW1', res.aW1, 4], ['aRow', res.aRow, 1]] as const) geo.setAttribute(n, new THREE.BufferAttribute(a, s));
    geo.setIndex(new THREE.BufferAttribute(res.index, 1));
    const hd = new Uint8Array(256 * 256 * 4);
    for (let k = 0; k < 65536; k++) { hd[k * 4] = hd[k * 4 + 1] = hd[k * 4 + 2] = res.seabed[k]!; hd[k * 4 + 3] = 255; }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let inst = 0;
    for (const l of [...Object.values(res.props), ...Object.values(res.grassLists)]) {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial(), l.length / 5);
      for (let i = 0; i < l.length / 5; i++) { const o = i * 5; m4.compose(pv.set(l[o]!, l[o + 1]!, l[o + 2]!), q.setFromAxisAngle(up, l[o + 4]!), sv.setScalar(l[o + 3]!)); im.setMatrixAt(i, m4); }
      inst += l.length / 5;
    }
    const main = performance.now() - t0;
    // old main-thread cost = generation + normals + the same geometry part (approx: gen + main)
    const field = terrainOf({ board: bd }, false);
    const b = bd.bounds;
    let s = 99;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    let max = 0, maxLand = 0;
    for (let i = 0; i < 20000; i++) {
      const x = b.minX - 0.5 + rnd() * (b.maxX - b.minX + 1), z = b.minY - 0.5 + rnd() * (b.maxY - b.minY + 1);
      const ex = field.sample(x, z), gh = gridHeight(res, x, z);
      if (gh === null) continue;
      max = Math.max(max, Math.abs(gh - ex));
      if (ex > 0.05 && gh > 0.05) maxLand = Math.max(maxLand, Math.abs(gh - ex));
    }
    console.log(`${shape}${size ?? ''} ${tier}: tiles ${bd.tiles.length} verts ${res.pos.length / 3} inst ${inst} | old main ~${(gen + main).toFixed(0)}ms | gen(worker) ${gen.toFixed(0)}ms | new main ${main.toFixed(0)}ms | heightAt err max ${max.toFixed(3)} landOnly ${maxLand.toFixed(3)}`);
  }
}
