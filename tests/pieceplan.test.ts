// Incremental pieces of the 3D board (3D-6) and sprite labels (3D-10). Usage: pnpm test
import { test, expect } from 'vitest';
import { diffPlan, goldClass, interKey, planPieces } from '@board/pieceplan';
import { spriteLabels } from '@board/quality';
import { NUMS, PORT_TYPES, portCell, runeCell, tokenCell, ATLAS_H, ATLAS_W } from '@board/labelsprites';

// a line of vertices 0-1-2-3 joined by edges 0:(0,1) 1:(1,2) 2:(2,3)
const edges = [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }];
const players = [{ color: '#f00' }, { color: '#00f' }];
const mk = (roads: Record<number, number>, buildings: Record<number, { owner: number; type: string }> = {}, gold = [0, 0]) => ({
  st: { board: { edges }, roads, buildings, players } as any,
  gold: (p: number) => gold[p]!,
  flag: () => '',
});
const sigs = (m: Map<string, { sig: string }>) => new Map([...m].map(([k, v]) => [k, v.sig]));

test('first plan: every piece is added', () => {
  const d = diffPlan(new Map(), planPieces(mk({ 0: 0 })));
  expect(d.added.sort()).toEqual(['j0:0', 'j1:0', 'r0']);
  expect(d.removed).toEqual([]);
});

test('a new road adds itself and only rebuilds the joint it touches', () => {
  const prev = sigs(planPieces(mk({ 0: 0 })));
  const d = diffPlan(prev, planPieces(mk({ 0: 0, 1: 0 })));
  expect(d.added.sort()).toEqual(['j2:0', 'r1']);
  expect(d.changed).toEqual(['j1:0']); // vertex 1 now has two arms
  expect(d.removed).toEqual([]);
});

test('a rival building cuts the joint under it, nothing else changes', () => {
  const prev = sigs(planPieces(mk({ 0: 0, 1: 0 })));
  const d = diffPlan(prev, planPieces(mk({ 0: 0, 1: 0 }, { 1: { owner: 1, type: 'settlement' } })));
  expect(d.added).toEqual(['b1settlement']);
  expect(d.changed).toEqual([]);
  expect(d.removed).toEqual(['j1:0']);
  expect(d.changed.includes('r0') || d.changed.includes('r1')).toBe(false);
});

test('settlement -> city is a new piece (drop-in) and the old one goes away', () => {
  const prev = sigs(planPieces(mk({}, { 2: { owner: 0, type: 'settlement' } })));
  const d = diffPlan(prev, planPieces(mk({}, { 2: { owner: 0, type: 'city' } })));
  expect(d.added).toEqual(['b2city']);
  expect(d.removed).toEqual(['b2settlement']);
});

test('gold levels rebuild only that player\'s pieces, and only when the look changes', () => {
  const roads = { 0: 0, 2: 1 };
  const b = { 0: { owner: 0, type: 'city' } };
  const prev = sigs(planPieces(mk(roads, b, [0, 0])));
  expect(diffPlan(prev, planPieces(mk(roads, b, [1, 0]))).changed).toEqual(['b0city']); // level 1 = beams only
  const d2 = diffPlan(prev, planPieces(mk(roads, b, [2, 0])));
  expect(d2.changed).toContain('r0');
  expect(d2.changed).not.toContain('r2');
  expect(goldClass(1)).toBe(0);
  expect(goldClass(4)).toBe(2);
  expect(goldClass(5)).toBe(5);
});

test('ghosts (blind mode) are separate pieces', () => {
  const inp = { ...mk({}), blindOwn: [{ pid: 0, vid: 1, eid: 0, type: 'settlement' }] };
  expect([...planPieces(inp).keys()].sort()).toEqual(['b1settlementg', 'r0g']);
});

test('hotspot key changes only with kind / colour / legal set', () => {
  const a = interKey({ kind: 'road', color: '#f00', legal: new Set([3, 1, 2]) });
  expect(interKey({ kind: 'road', color: '#f00', legal: [1, 2, 3] })).toBe(a);
  expect(interKey({ kind: 'road', color: '#f00', legal: [1, 2] })).not.toBe(a);
  expect(interKey(null)).toBe('');
});

test('3D-10: sprite labels on low / medium only; atlas cells fit and do not overlap', () => {
  expect((['low', 'medium', 'high', 'ultra'] as const).map(spriteLabels)).toEqual([true, true, false, false]);
  const cells = [...NUMS.flatMap(n => [tokenCell(n), tokenCell(n, true)]), tokenCell(null), ...PORT_TYPES.map(portCell), runeCell()];
  for (const c of cells) expect(c.x + c.w <= ATLAS_W && c.y + c.h <= ATLAS_H).toBe(true);
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i]!, b = cells[j]!;
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
});
