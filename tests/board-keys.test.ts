// Rebuild keys of the 3D board (pure functions, no WebGL needed). Usage: pnpm test
import { test, expect } from 'vitest';
import { generateBoard } from '@engine/board';
import { defaultConfig } from '@engine/config';
import { terrainKey, terrainOf } from '@board/terrain';
import { tokenKey } from '@board/labels';
import { visionKey } from '@board/fog';
import { visibility } from '@engine/game';

function board(seed: number): any {
  const cfg = defaultConfig();
  cfg.seed = seed;
  return generateBoard(cfg, { s: seed });
}
const withTile = (bd: any, i: number, patch: object) => ({ ...bd, tiles: bd.tiles.map((t: any, k: number) => (k === i ? { ...t, ...patch } : t)) });

test('3D-4: a number change only changes tokenKey, not terrainKey', () => {
  const bd = board(5);
  const k0 = terrainKey(bd, false), t0 = tokenKey(bd);
  const changed = withTile(bd, 3, { num: (bd.tiles[3].num || 4) + 1 });
  expect(terrainKey(changed, false)).toBe(k0);
  expect(tokenKey(changed)).not.toBe(t0);
  const shown = withTile(bd, 2, { numRevealed: !bd.tiles[2].numRevealed });
  expect(terrainKey(shown, false)).toBe(k0);
  expect(tokenKey(shown)).not.toBe(t0);
});

test('3D-4: revealing a tile, face-down mode and tile positions change terrainKey', () => {
  const bd = board(5);
  const k0 = terrainKey(bd, false);
  expect(terrainKey(withTile(bd, 3, { revealed: !bd.tiles[3].revealed }), false)).not.toBe(k0);
  expect(terrainKey(bd, true)).not.toBe(k0);
  expect(terrainKey(withTile(bd, 1, { q: bd.tiles[1].q + 1 }), false)).not.toBe(k0);
  expect(terrainKey({ ...bd, ports: bd.ports.slice(1) }, false)).not.toBe(k0);
});

test('3D-8: visionKey ignores sub-1/100 noise and tracks real changes', () => {
  const b = { minX: 0, maxX: 10, minY: 0, maxY: 8 };
  const v = { circles: [[1, 2, 1.25]] as [number, number, number][], caps: [[0, 0, 1, 1, 0.55]] as [number, number, number, number, number][] };
  const k = visionKey(v, b);
  expect(visionKey({ ...v, circles: [[1.0004, 2, 1.25]] }, b)).toBe(k);
  expect(visionKey({ ...v, circles: [[1.5, 2, 1.25]] }, b)).not.toBe(k);
  expect(visionKey({ ...v, caps: [] }, b)).not.toBe(k);
});

test('3D-8: visibility() + blur margin classifies label points like the lit area', () => {
  const vis = { circles: [[0, 0, 1.25]] as [number, number, number][], caps: [] };
  expect(visibility(vis, 0.2, 0.2)).toBeGreaterThan(0); // well inside
  expect(visibility(vis, 3, 0)).toBeLessThan(0); // far outside
  // a tile centre of the generated board is either clearly inside or clearly outside a house circle
  const bd = board(9);
  const V = bd.vertices[0];
  const lit = { circles: [[V.x, V.y, 1.25]] as [number, number, number][], caps: [] };
  const inside = bd.tiles.filter((t: any) => visibility(lit, t.x, t.y) > 0).length;
  expect(inside).toBeGreaterThan(0);
  expect(inside).toBeLessThan(bd.tiles.length);
});

test('terrainOf is deterministic for a board', () => {
  const bd = board(11);
  const st: any = { board: bd };
  const a = terrainOf(st, false), b = terrainOf(st, false);
  for (const t of bd.tiles) expect(a.sample(t.x + 0.1, t.y - 0.2)).toBe(b.sample(t.x + 0.1, t.y - 0.2));
});
