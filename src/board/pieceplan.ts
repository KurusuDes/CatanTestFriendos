// Pure planning of the player pieces (no three.js, no DOM): from a game state it lists which pieces
// should exist, each with a signature of everything that changes its look. Two plans are compared to
// find the pieces to add, remove or replace (3D-6), so a state update touches only what changed.
import type { BState, BlindPiece } from './types';

export type PieceSpec =
  | { kind: 'road'; key: string; sig: string; eid: number; color: string; ghost: boolean }
  | { kind: 'joint'; key: string; sig: string; vid: number; owner: number; color: string; others: number[] }
  | { kind: 'building'; key: string; sig: string; vid: number; owner: number; type: string; color: string; ghost: boolean };

export interface PlanInput {
  st: Pick<BState, 'roads' | 'buildings' | 'players'> & { board: { edges: { a: number; b: number }[] } };
  blindOwn?: BlindPiece[];
  /** identity of a player's flag (any string that changes when the flag does) */
  flag: (pid: number) => string;
}

export function planPieces(inp: PlanInput): Map<string, PieceSpec> {
  const { st } = inp;
  const out = new Map<string, PieceSpec>();
  const color = (pid: number) => st.players[pid]!.color;
  const road = (eid: number, pid: number, ghost: boolean) => {
    const key = 'r' + eid + (ghost ? 'g' : '');
    out.set(key, { kind: 'road', key, sig: color(pid), eid, color: color(pid), ghost });
  };
  for (const k in st.roads) road(+k, st.roads[k]!, false);
  for (const b of inp.blindOwn || []) if (b.eid != null) road(b.eid, b.pid, true);

  // road joints: every road end gets an arm that reaches its vertex plus a round cap there. A rival's
  // house cuts the road: no joint under it. One joint per (vertex, owner); its arms are that owner's
  // roads at the vertex, so only the vertices a change touches get a new signature.
  const ends = new Map<string, number[]>();
  for (const k in st.roads) {
    const E = st.board.edges[+k]!, owner = st.roads[k]!;
    for (const [v, o] of [[E.a, E.b], [E.b, E.a]] as [number, number][]) {
      const b = st.buildings[v];
      if (b && b.owner !== owner) continue;
      const key = v + ':' + owner;
      let l = ends.get(key);
      if (!l) ends.set(key, (l = []));
      l.push(o);
    }
  }
  for (const [k, others] of ends) {
    const [vid, owner] = k.split(':').map(Number) as [number, number];
    others.sort((a, b) => a - b);
    const key = 'j' + k;
    out.set(key, { kind: 'joint', key, sig: color(owner) + '|' + others.join(','), vid, owner, color: color(owner), others });
  }

  const building = (vid: number, owner: number, type: string, ghost: boolean) => {
    const key = 'b' + vid + type + (ghost ? 'g' : '');
    out.set(key, { kind: 'building', key, sig: [color(owner), inp.flag(owner), owner].join('|'), vid, owner, type, color: color(owner), ghost });
  };
  for (const k in st.buildings) building(+k, st.buildings[k]!.owner, st.buildings[k]!.type, false);
  for (const b of inp.blindOwn || []) building(b.vid, b.pid, b.type, true);
  return out;
}

interface PlanDiff {
  added: string[];
  removed: string[];
  /** same key, different signature: the piece is rebuilt in place (no drop-in animation) */
  changed: string[];
}

/** Compares the signatures of the pieces on the board with a new plan. */
export function diffPlan(prev: ReadonlyMap<string, string>, next: ReadonlyMap<string, { sig: string }>): PlanDiff {
  const d: PlanDiff = { added: [], removed: [], changed: [] };
  for (const k of prev.keys()) if (!next.has(k)) d.removed.push(k);
  for (const [k, s] of next) {
    const p = prev.get(k);
    if (p === undefined) d.added.push(k);
    else if (p !== s.sig) d.changed.push(k);
  }
  return d;
}

/** Key of the click hotspots: they are rebuilt only when this changes (a rebuild under a finger loses the click). */
export function interKey(inter: { kind: string; color?: string; legal: Iterable<number> } | null | undefined): string {
  if (!inter) return '';
  return inter.kind + '|' + (inter.color || '') + '|' + [...inter.legal].sort((a, b) => a - b).join(',');
}
