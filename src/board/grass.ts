// Thousands of wind-swept grass and wheat tufts.
import * as THREE from 'three';
import { LAYER_GRASS, patch } from './shaders';
import type { Board3D } from './Board3D';

// a tuft of grass (or wheat): a few thin tapered blades with a vertical colour gradient
function tuftGeometry(blades: number, height: number, width: number, base: string, tip: string) {
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

// thousands of wind-swept grass and wheat tufts (the lists come from terrainGen: flat [x, y, z, scale, rotY])
export function placeGrass(board: Board3D, lists: Record<string, Float32Array>) {
  const defs: Record<string, THREE.BufferGeometry> = {
    grass: tuftGeometry(6, 0.075, 0.009, '#3f6a2a', '#a6c95e'),
    wheat: tuftGeometry(7, 0.13, 0.008, '#8a6a26', '#f0d27a'),
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const [k, list] of Object.entries(lists)) {
    const n = list.length / 5;
    if (!n) continue;
    const mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }), { wind: k === 'wheat' ? 0.5 : 0.45, key: 'tuft' + k });
    const im = new THREE.InstancedMesh(defs[k]!, mat, n);
    im.layers.set(LAYER_GRASS);
    im.receiveShadow = true;
    im.castShadow = k === 'wheat';
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      m4.compose(pv.set(list[o]!, list[o + 1]! - 0.005, list[o + 2]!), q.setFromAxisAngle(up, list[o + 4]!), sv.setScalar(list[o + 3]!));
      im.setMatrixAt(i, m4);
    }
    im.userData.own = true;
    board.staticGroup.add(im);
  }
}
