// Instanced Blender props (forests, sheep, improvements...) sitting on the terrain.
import * as THREE from 'three';
import { PROP_VARIANTS, VARIANT_TINT } from '@board/assets';
import { prng } from './terrain';
import { shared } from '@board/dispose';
import type { BState } from '@board/types';
import type { Board3D } from '@board/Board3D';

const DECOR = new Set(['pine', 'oak', 'bush', 'rock', 'rock#clay', 'cactus', 'crystal', 'hay', 'sheaf']);

export function placeProps(board: Board3D, st: BState) {
  const kit = board.kit;
  const field = (board as any).field;
  const bd = st.board;
  const inst: Record<string, [number, number, number, number, number][]> = {};
  // lighter tiers drop a fixed share of the DECORATIVE props, by running index (not random): every player
  // sees the same island shape, and the rng stream of the spot search is untouched
  const density = board.params.props;
  let seq = 0;
  const put = (name: string, x: number, z: number, s = 1, ry = 0) => {
    if (density < 1 && DECOR.has(name) && ((seq++ * 37) % 100) / 100 >= density) return;
    (inst[name] = inst[name] || []).push([x, field.sample(x, z) - 0.01, z, s, ry]);
  };
  // which way is downhill at a point (to turn a mine's entrance away from its mountain)
  const downhill = (x: number, z: number) => {
    const d = 0.05;
    return Math.atan2(field.sample(x - d, z) - field.sample(x + d, z), field.sample(x, z - d) - field.sample(x, z + d));
  };
  const low = (lim: number) => (x: number, z: number) => field.sample(x, z) < lim;
  const cornerSafe = (x: number, z: number) => !bd.vertices.some(v => (v.x - x) ** 2 + (v.y - z) ** 2 < 0.05);
  for (const t of bd.tiles) {
    if (!t.revealed) continue;
    const rnd = prng(t.id * 977 + t.q * 31 + t.r * 17 + 5);
    // `ok` filters the spots (e.g. only at the foot of the mountains); `room` keeps big props
    // (a kiln, a mine) from getting others on top of them
    const taken: [number, number, number][] = [];
    const free = (x: number, z: number, room: number) => cornerSafe(x, z) && !field.nearClay(t, x, z) && !taken.some(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 < (tr + room + 0.06) ** 2);
    // n props at random spots r0..r1 from (cx, cz), the tile's centre by default
    const spots = (n: number, r0: number, r1: number, fn: (x: number, z: number, i: number) => void, ok?: ((x: number, z: number) => boolean) | null, room = 0, cx = t.x, cz = t.y) => {
      let placed = 0;
      for (let tries = 0; placed < n && tries < n * 12; tries++) {
        const a = rnd() * Math.PI * 2, rr = r0 + rnd() * (r1 - r0);
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        if ((ok && !ok(x, z)) || !free(x, z, room)) continue;
        taken.push([x, z, room]);
        fn(x, z, placed++);
      }
    };
    // one prop at an exact point, in the tile's own axes: u along its direction, v across it
    const ta = prng(field.seedOf(t))() * 6.28, tc = Math.cos(ta), ts = Math.sin(ta);
    const at = (u: number, v: number, fn: (x: number, z: number) => void, room = 0) => {
      const x = t.x + u * tc - v * ts, z = t.y + u * ts + v * tc;
      if (!free(x, z, room)) return;
      taken.push([x, z, room]);
      fn(x, z);
    };
    const along = (x: number, z: number) => (x - t.x) * tc + (z - t.y) * ts;
    const look = field.lookOf(t);
    const R = () => rnd() * 6.3;
    switch (t.res) {
      case 'wood':
        if (look === 1) {
          // pine wood on a hill
          spots(34, 0.1, 0.8, (x, z) => put('pine', x, z, 1 + rnd() * 0.6, R()));
        } else if (look === 2) {
          // the woodcutter's clearing: hut in the middle, trees all around
          at(0, 0, (x, z) => put('lumber', x, z, 1.25, R()), 0.16);
          spots(2, 0.15, 0.28, (x, z) => put('rock', x, z, 0.45, R()), null, 0.04);
          spots(24, 0.42, 0.82, (x, z, i) => put(i % 4 ? 'pine' : 'oak', x, z, 0.85 + rnd() * 0.5, R()));
        } else if (look === 3) {
          // oak grove: fewer, bigger trees and bushes
          spots(13, 0.15, 0.8, (x, z) => put('oak', x, z, 1.15 + rnd() * 0.5, R()), null, 0.07);
          spots(7, 0.2, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.5, R()));
        } else if (look === 4) {
          // rocky forest
          spots(5, 0.2, 0.75, (x, z) => put('rock', x, z, 0.8 + rnd() * 0.6, R()), null, 0.1);
          spots(24, 0.15, 0.8, (x, z, i) => put(i % 3 ? 'pine' : 'oak', x, z, 0.85 + rnd() * 0.55, R()));
        } else {
          spots(30, 0.22, 0.8, (x, z, i) => put(i % 3 ? 'pine' : 'oak', x, z, 0.85 + rnd() * 0.55, R()));
          spots(1, 0.5, 0.6, (x, z) => put('lumber', x, z, 1.1, R()));
        }
        break;
      case 'sheep':
        if (look === 1) {
          // a round pen with the flock inside
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            at(Math.cos(a) * 0.4, Math.sin(a) * 0.4, (x, z) => put('fence', x, z, 1.1, -(ta + a + Math.PI / 2)));
          }
          spots(4, 0.0, 0.24, (x, z) => put('sheep', x, z, 1.15, R()), null, 0.03);
          spots(2, 0.58, 0.78, (x, z) => put('sheep', x, z, 1.15, R()));
          spots(1, 0.58, 0.78, (x, z) => put('oak', x, z, 1, R()));
        } else if (look === 2) {
          // rolling hills, a lone oak on top
          at(0.35, 0, (x, z) => put('oak', x, z, 1.2, R()), 0.08);
          spots(6, 0.15, 0.78, (x, z) => put('sheep', x, z, 1.15, R()));
          spots(3, 0.45, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.4, R()));
        } else if (look === 3) {
          // stony pasture
          spots(5, 0.2, 0.78, (x, z) => put('rock', x, z, 0.5 + rnd() * 0.4, R()), null, 0.06);
          spots(4, 0.2, 0.75, (x, z) => put('sheep', x, z, 1.15, R()));
          spots(4, 0.45, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.4, R()));
        } else if (look === 4) {
          // a big flock huddled on one side
          spots(10, 0.0, 0.26, (x, z) => put('sheep', x, z, 1.1, R()), null, 0.02, t.x + tc * 0.28, t.y + ts * 0.28);
          spots(1, 0.5, 0.7, (x, z) => put('oak', x, z, 1, R()));
          spots(2, 0.5, 0.8, (x, z) => put('bush', x, z, 1, R()));
          at(-0.5, 0, (x, z) => put('fence', x, z, 1.2, -ta));
        } else {
          spots(5, 0.3, 0.72, (x, z) => put('sheep', x, z, 1.15, R()));
          spots(3, 0.45, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.5, R()));
          spots(2, 0.5, 0.7, (x, z) => put('oak', x, z, 0.9, R()));
          spots(2, 0.55, 0.7, (x, z) => put('fence', x, z, 1.2, R()));
        }
        break;
      case 'wheat':
        if (look === 1) {
          // sheaves standing in two rows
          for (const v of [-0.25, 0.25]) for (const u of [-0.42, -0.14, 0.14, 0.42]) at(u, v, (x, z) => put('sheaf', x, z, 1, R()));
          spots(1, 0.5, 0.7, (x, z) => put('hay', x, z, 1, R()));
        } else if (look === 2) {
          // the mill on a knoll
          at(0, 0, (x, z) => put('windmill', x, z, 1.5, R()), 0.14);
          spots(2, 0.4, 0.7, (x, z) => put('hay', x, z, 1, R()));
        } else if (look === 4) {
          // a fence along the field and the mill beyond it
          for (const u of [-0.36, 0, 0.36]) at(u, -0.28, (x, z) => put('fence', x, z, 1.2, -ta));
          at(0.25, 0.3, (x, z) => put('windmill', x, z, 1.3, R()), 0.12);
          spots(2, 0.3, 0.7, (x, z) => put('sheaf', x, z, 1, R()));
        } else {
          spots(1, 0.45, 0.55, (x, z) => put('windmill', x, z, 1.35, R()));
          spots(3, 0.35, 0.75, (x, z) => put(rnd() > 0.5 ? 'hay' : 'sheaf', x, z, 1, R()));
        }
        break;
      case 'brick':
        // brick kilns and mounds of red clay (the rock prop, tinted)
        if (look === 1) {
          // clay pit: mounds on the rim, one kiln
          spots(1, 0.55, 0.68, (x, z) => put('kiln', x, z, 1.25, R()), null, 0.2);
          spots(5, 0.38, 0.62, (x, z) => put('rock#clay', x, z, 0.55 + rnd() * 0.4, R()), null, 0.08);
          spots(2, 0.6, 0.8, (x, z) => put('rock#clay', x, z, 0.4 + rnd() * 0.25, R()));
        } else if (look === 2) {
          // brickworks: three kilns in a row
          for (const u of [-0.36, 0, 0.36]) at(u, 0, (x, z) => put('kiln', x, z, 1.2, R()), 0.16);
          spots(2, 0.4, 0.75, (x, z) => put('rock#clay', x, z, 0.55 + rnd() * 0.35, R()), null, 0.08);
          spots(1, 0.6, 0.8, (x, z) => put('rock#clay', x, z, 0.4 + rnd() * 0.25, R()));
        } else if (look === 3) {
          // red hills, no buildings
          spots(6, 0.15, 0.78, (x, z) => put('rock#clay', x, z, 0.6 + rnd() * 0.5, R()), null, 0.08);
          spots(4, 0.4, 0.8, (x, z) => put('rock#clay', x, z, 0.4 + rnd() * 0.25, R()));
        } else if (look === 4) {
          // a clay bank: the kiln at the bottom, mounds along the edge, bushes up top
          at(-0.38, 0.1, (x, z) => put('kiln', x, z, 1.25, R()), 0.2);
          for (const v of [-0.4, -0.05, 0.3]) at(0.02, v, (x, z) => put('rock#clay', x, z, 0.6 + rnd() * 0.3, R()), 0.08);
          spots(2, 0.2, 0.75, (x, z) => put('rock#clay', x, z, 0.4 + rnd() * 0.25, R()), (x, z) => along(x, z) > 0.2);
        } else {
          spots(2, 0.3, 0.62, (x, z) => put('kiln', x, z, 1.25, R()), null, 0.2);
          spots(4, 0.3, 0.8, (x, z) => put('rock#clay', x, z, 0.55 + rnd() * 0.45, R()), null, 0.08);
          spots(2, 0.55, 0.8, (x, z) => put('rock#clay', x, z, 0.4 + rnd() * 0.25, R()));
        }
        break;
      case 'ore':
        // the mine and the boulders stay at the foot of the peaks, the entrance facing downhill
        if (look === 3) {
          // quarry: boulders all over the low rocky hills
          spots(1, 0.3, 0.72, (x, z) => put('mine', x, z, 1.3, downhill(x, z)), low(0.5), 0.24);
          spots(9, 0.15, 0.82, (x, z) => put('rock', x, z, 0.6 + rnd() * 0.7, R()), low(0.62), 0.08);
        } else if (look === 4) {
          // twin peaks with a pine wood at their feet
          spots(1, 0.45, 0.72, (x, z) => put('mine', x, z, 1.3, downhill(x, z)), low(0.46), 0.24);
          spots(3, 0.4, 0.82, (x, z) => put('rock', x, z, 0.7 + rnd() * 0.5, R()), low(0.5), 0.1);
          spots(9, 0.45, 0.82, (x, z) => put('pine', x, z, 0.75, R()), low(0.42), 0.04);
        } else {
          spots(1, 0.45, 0.72, (x, z) => put('mine', x, z, 1.3, downhill(x, z)), low(0.46), 0.24);
          spots(look === 1 ? 5 : 4, 0.4, 0.82, (x, z) => put('rock', x, z, 0.7 + rnd() * 0.6, R()), low(0.5), 0.1);
          spots(look === 1 ? 6 : 5, 0.55, 0.8, (x, z) => put('pine', x, z, 0.7, R()), low(0.4), 0.05);
        }
        break;
      case 'desert':
        spots(7, 0.2, 0.8, (x, z) => put('cactus', x, z, 1 + rnd() * 0.7, R()));
        spots(4, 0.3, 0.8, (x, z) => put('rock', x, z, 0.55 + rnd() * 0.5, R()), null, 0.06);
        break;
      case 'gold':
        spots(6, 0.3, 0.75, (x, z) => put('crystal', x, z, 1.2 + rnd() * 0.8, R()));
        break;
    }
  }
  if ((board as any).__collect) return (board as any).__collect(inst);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [key, list] of Object.entries(inst)) {
    const [name, variant] = key.split('#');
    const proto = kit[name!];
    if (!proto) continue;
    proto.updateMatrixWorld(true);
    proto.traverse(obj => {
      const child = obj as THREE.Mesh;
      if (!child.isMesh) return;
      let mat = child.material as THREE.MeshStandardMaterial | undefined;
      if (variant) {
        const cache = (PROP_VARIANTS[key] = PROP_VARIANTS[key] || new Map());
        mat = cache.get(child.material as THREE.Material) as THREE.MeshStandardMaterial | undefined;
        if (!mat) {
          const src = child.material as THREE.MeshStandardMaterial;
          mat = src.clone();
          mat.color.multiply(VARIANT_TINT[variant]!);
          // same shader patch (fog, wind...) as the original: clone() leaves those hooks behind
          mat.onBeforeCompile = src.onBeforeCompile;
          mat.customProgramCacheKey = src.customProgramCacheKey;
          cache.set(src, shared(mat));
        }
      }
      const im = new THREE.InstancedMesh(child.geometry, mat, list.length);
      im.castShadow = im.receiveShadow = true;
      list.forEach(([x, y, z, s, ry], i) => {
        m4.compose(pv.set(x, y, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s)).multiply(child.matrixWorld);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      board.staticGroup.add(im);
    });
  }
}
