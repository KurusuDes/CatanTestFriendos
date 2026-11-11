// 3D-5: the pure terrain generator (terrainGen.ts, what the worker runs) must give exactly what the old
// main-thread code gave. tests/legacy/* is a verbatim copy of the old terrain/props/grass/water modules
// (props and grass only got a hook to hand back their lists instead of building meshes).
import { test, expect } from 'vitest';
import { createGame } from '@engine/game';
import { defaultConfig } from '@engine/config';
import { PARAMS, type Tier } from '@board/quality';
import { generate, gridHeight, terrainOf, type GenInput, type HeightGrid } from '@board/terrainGen';
import * as oldTerrain from './legacy/terrain';
import { buildWater as oldWater } from './legacy/water';
import { placeProps as oldProps } from './legacy/props';
import { placeGrass as oldGrass } from './legacy/grass';

function boardOf(shape: string, seed: number, size?: number): any {
  const cfg = defaultConfig();
  cfg.seed = seed;
  cfg.map.shape = shape as any;
  if (size) cfg.map.size = size;
  if (shape === 'islands' || shape === 'pangea') cfg.map.gold = 2;
  return createGame(cfg).board;
}
const reveal = (bd: any, mod: number) => ({ ...bd, tiles: bd.tiles.map((t: any, i: number) => ({ ...t, revealed: mod === 0 || i % mod !== 0 })) });

function inputOf(bd: any, faceDown: boolean, tier: Tier): GenInput {
  const p = PARAMS[tier];
  return {
    tiles: bd.tiles.map((t: any) => ({ id: t.id, q: t.q, r: t.r, x: t.x, y: t.y, res: t.res, revealed: !!t.revealed })),
    vertices: bd.vertices.map((v: any) => ({ x: v.x, y: v.y })),
    edges: bd.edges.map((e: any) => ({ a: e.a, b: e.b })),
    bounds: bd.bounds, faceDown, step: p.terrainStep, grass: p.grass, props: p.props,
  };
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}

function compare(bd: any, faceDown: boolean, tier: Tier) {
  const st: any = { board: bd };
  const inp = inputOf(bd, faceDown, tier);
  const res = generate(inp);
  // ---- old path
  const field = oldTerrain.terrainOf(st, faceDown);
  const fake: any = { params: PARAMS[tier], tex: {}, staticGroup: { add() {} } };
  const mesh = oldTerrain.buildTerrainMesh(fake, st, field);
  const at = (n: string) => (mesh.geometry.attributes[n] as any).array as Float32Array;
  expect(maxDiff(res.pos, at('position'))).toBe(0);
  expect(maxDiff(res.normal, at('normal'))).toBeLessThanOrEqual(1e-6);
  expect(maxDiff(res.color, at('color'))).toBeLessThanOrEqual(1e-6);
  expect(maxDiff(res.uv, at('uv'))).toBe(0);
  expect(maxDiff(res.aW0, at('aW0'))).toBeLessThanOrEqual(1e-6);
  expect(maxDiff(res.aW1, at('aW1'))).toBeLessThanOrEqual(1e-6);
  expect(maxDiff(res.aRow, at('aRow'))).toBeLessThanOrEqual(1e-6);
  expect(maxDiff(res.index, mesh.geometry.index!.array as any)).toBe(0);
  // seabed
  const water = oldWater(fake, st, field);
  const hd = (water.userData.extra[0] as any).image.data as Uint8Array;
  const sea = new Uint8Array(res.seabed.length * 4);
  res.seabed.forEach((v, k) => { sea[k * 4] = sea[k * 4 + 1] = sea[k * 4 + 2] = v; sea[k * 4 + 3] = 255; });
  expect(maxDiff(sea, hd)).toBe(0);
  // grid lines
  const grid = oldTerrain.buildHexGrid(st, field);
  expect(maxDiff(res.grid, (grid.geometry.attributes.position as any).array)).toBe(0);
  // props and grass (the new lists are float32)
  const lists = (fn: (b: any, s: any) => void) => {
    let got: Record<string, number[][]> = {};
    fn({ ...fake, field, kit: {}, __collect: (l: any) => (got = l) }, st);
    return got;
  };
  const same = (neu: Record<string, Float32Array>, old: Record<string, number[][]>) => {
    const keys = Object.keys(old).filter(k => old[k]!.length);
    expect(Object.keys(neu).sort()).toEqual(keys.sort());
    for (const k of keys) expect(maxDiff(neu[k]!, new Float32Array(old[k]!.flat()))).toBe(0);
    return keys.reduce((n, k) => n + old[k]!.length, 0);
  };
  const nProps = same(res.props, lists(oldProps));
  const nGrass = PARAMS[tier].grass > 0 ? same(res.grassLists, lists(oldGrass)) : 0;
  if (PARAMS[tier].grass <= 0) expect(Object.values(res.grassLists).every(a => a.length === 0)).toBe(true);
  return { res, field, nProps, nGrass };
}

const CASES: [string, number, number | undefined, Tier][] = [
  ['classic', 1, undefined, 'ultra'],
  ['classic', 7, undefined, 'low'],
  ['mini', 3, undefined, 'high'],
  ['islands', 11, 27, 'medium'],
  ['big', 5, undefined, 'medium'],
  ['huge', 9, undefined, 'low'],
  ['pangea', 2, 40, 'low'],
  ['star', 4, undefined, 'high'],
];
for (const [shape, seed, size, tier] of CASES)
  for (const [mod, faceDown] of [[0, false], [3, false], [2, true]] as [number, boolean][])
    test(`3D-5: terrainGen = old code (${shape} #${seed}, ${tier}, ${mod ? 'part revealed' : 'all revealed'}${faceDown ? ', face down' : ''})`, () => {
      const bd = reveal(boardOf(shape, seed, size), mod);
      const r = compare(bd, faceDown, tier);
      expect(r.nProps).toBeGreaterThan(0);
    }, 120_000);

test('3D-5: heightAt grid lookup stays close to the exact field', () => {
  const rows: string[] = [];
  for (const [shape, seed, size, tier] of CASES) {
    const bd = reveal(boardOf(shape, seed, size), 4);
    const res = generate(inputOf(bd, false, tier));
    const g: HeightGrid = res;
    const field = terrainOf({ board: bd }, false);
    const b = bd.bounds;
    let s = 12345 + seed;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    let max = 0, maxLand = 0, outside = 0, sum = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const x = b.minX - 1.2 + rnd() * (b.maxX - b.minX + 2.4), z = b.minY - 1.2 + rnd() * (b.maxY - b.minY + 2.4);
      const ex = field.sample(x, z), gh = gridHeight(g, x, z);
      if (gh === null) { outside++; continue; }
      const d = Math.abs(gh - ex);
      max = Math.max(max, d); sum += d; n++;
      if (ex > 0) maxLand = Math.max(maxLand, d);
    }
    rows.push(`${shape}/${tier}: step ${g.step} max ${max.toFixed(4)} maxOnLand ${maxLand.toFixed(4)} mean ${(sum / n).toFixed(5)} outsideGrid ${outside}`);
    expect(max).toBeLessThan(1); // a cliff edge falls 1 unit within ~2 cells: this guards against a broken lookup only
  }
  console.log(rows.join('\n'));
});
