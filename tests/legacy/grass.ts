// Thousands of wind-swept grass and wheat tufts.
import * as THREE from 'three';
import { LAYER_GRASS, patch } from '@board/shaders';
import { INR, NORMALS, pixelToHex, prng } from './terrain';
import type { BState } from '@board/types';
import type { Board3D } from '@board/Board3D';

// a tuft of grass (or wheat): a few thin tapered blades with a vertical colour gradient
export function tuftGeometry(blades: number, height: number, width: number, base: string, tip: string) {
  const pos = [], col = [];
  const cb = new THREE.Color(base), ct = new THREE.Color(tip);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i;
    const lean = 0.25 + (i % 3) * 0.12;
    const h = height * (0.7 + ((i * 37) % 10) / 30);
    const ox = Math.cos(a) * 0.012, oz = Math.sin(a) * 0.012;
    const px = Math.cos(a + 1.57) * width, pz = Math.sin(a + 1.57) * width;
    const tx = ox + Math.cos(a) * lean * h, tz = oz + Math.sin(a) * lean * h;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(cb.r, cb.g, cb.b, cb.r, cb.g, cb.b, ct.r, ct.g, ct.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// thousands of wind-swept grass and wheat tufts
export function placeGrass(board: Board3D, st: BState) {
  const bd = st.board;
  const field = (board as any).field;
  const dens = board.params.grass;
  if (dens <= 0) return; // weak machines: no tufts at all
  const kinds: Record<string, [string, number]> = { sheep: ['grass', Math.round(320 * dens)], wheat: ['wheat', Math.round(420 * dens)], wood: ['grass', Math.round(60 * dens)], ore: ['grass', Math.round(50 * dens)], gold: ['grass', Math.round(20 * dens)] };
  const lists: Record<string, [number, number, number, number, number][]> = { grass: [], wheat: [] };
  for (const t of bd.tiles) {
    const spec = t.revealed && kinds[t.res];
    if (!spec) continue;
    const rnd = prng(t.id * 1543 + 17);
    const look = field.lookOf(t);
    // the woodcutter's clearing and the oak grove are grassier
    const count = t.res === 'wood' && (look === 2 || look === 3) ? spec[1] * 4 : spec[1];
    for (let i = 0; i < count; i++) {
      const x = t.x + (rnd() - 0.5) * 1.8, z = t.y + (rnd() - 0.5) * 1.8;
      const [q, r] = pixelToHex(x, z);
      if (q !== t.q || r !== t.r) continue;
      const dx = x - t.x, dz = z - t.y;
      const e = INR - Math.max(...NORMALS.map(n => Math.abs(dx * n[0] + dz * n[1])));
      if (e < 0.09) continue; // keep roads and corners clear
      if (field.nearClay(t, x, z)) continue;
      if (t.res === 'ore' && field.sample(x, z) > 0.55) continue;
      lists[spec[0]]!.push([x, field.sample(x, z), z, 0.7 + rnd() * 0.7, rnd() * 6.3]);
    }
  }
  if ((board as any).__collect) return (board as any).__collect(lists);
  const defs: Record<string, THREE.BufferGeometry> = {
    grass: tuftGeometry(6, 0.075, 0.009, '#3f6a2a', '#a6c95e'),
    wheat: tuftGeometry(7, 0.13, 0.008, '#8a6a26', '#f0d27a'),
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [k, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), { wind: k === 'wheat' ? 0.5 : 0.45, key: 'tuft' + k });
    const im = new THREE.InstancedMesh(defs[k]!, mat, list.length);
    im.layers.set(LAYER_GRASS);
    im.receiveShadow = true;
    im.castShadow = k === 'wheat';
    list.forEach(([x, y, z, s, ry], i) => {
      m4.compose(pv.set(x, y - 0.005, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s));
      im.setMatrixAt(i, m4);
    });
    im.userData.own = true;
    board.staticGroup.add(im);
  }
}
