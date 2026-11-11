// Ports: two walkways from the sign straight to the two corners that use it (like the classic
// board), a mooring post on each of those corners, a boat and a pixel sign.
import * as THREE from 'three';
import { pxIcon } from '@ui/pixel';
import { css2d } from './labels';
import { LabelSet, portCell, type LabelItem } from './labelsprites';
import { LAYER_LABELS } from './shaders';
import { shared } from './dispose';
import type { BState } from './types';
import type { Board3D } from './Board3D';

// shared by every port of every board: never disposed
const PLANK = shared(new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.85 }));
const POST = shared(new THREE.MeshStandardMaterial({ color: '#5b3e2b', roughness: 0.8 }));
const TIP = shared(new THREE.MeshStandardMaterial({ color: '#ffcd75', roughness: 0.5, emissive: '#ffcd75', emissiveIntensity: 0.25 }));
const WALK_GEO = shared(new THREE.BoxGeometry(1, 0.035, 0.1));
const POST_GEO = shared(new THREE.CylinderGeometry(0.035, 0.04, 0.26, 8));
const TIP_GEO = shared(new THREE.SphereGeometry(0.045, 8, 6));

export function buildPorts(b: Board3D, st: BState): void {
  const bd = st.board;
  const sprites = b.spriteLabels(), items: LabelItem[] = [];
  for (const port of bd.ports) {
    const E = bd.edges[port.edge]!;
    const hub = new THREE.Vector3(port.x - port.nx * 0.12, 0.07, port.y - port.ny * 0.12);
    for (const vid of [E.a, E.b]) {
      const V = bd.vertices[vid]!;
      const end = new THREE.Vector3(V.x, Math.max(b.heightAt(V.x, V.y), 0.05) + 0.03, V.y);
      const d = end.clone().sub(hub), flat = Math.hypot(d.x, d.z);
      const walk = new THREE.Mesh(WALK_GEO, PLANK);
      walk.scale.x = d.length();
      walk.position.copy(hub).add(end).multiplyScalar(0.5);
      walk.rotation.order = 'YZX';
      walk.rotation.y = -Math.atan2(d.z, d.x);
      walk.rotation.z = Math.atan2(d.y, flat);
      const post = new THREE.Mesh(POST_GEO, POST);
      post.position.set(end.x - (d.x / flat) * 0.06, end.y + 0.11, end.z - (d.z / flat) * 0.06);
      const tip = new THREE.Mesh(TIP_GEO, TIP);
      tip.position.set(post.position.x, post.position.y + 0.14, post.position.z);
      for (const m of [walk, post, tip]) m.castShadow = m.receiveShadow = true;
      b.staticGroup.add(walk, post, tip);
    }
    const boat = b.kit.boat.clone();
    boat.position.set(port.x + port.ny * 0.3, 0.0, port.y - port.nx * 0.3);
    boat.rotation.y = -Math.atan2(port.ny, port.nx) + Math.PI / 2;
    boat.scale.setScalar(1.35);
    b.bobbers.push({ obj: boat, y: 0.0, ph: port.id * 1.7 });
    if (sprites) {
      items.push({ x: port.x, y: 0.55, z: port.y, cell: portCell(port.type === 'any' ? 'any' : port.type), zoomScaled: true });
      b.staticGroup.add(boat);
      continue;
    }
    const sign = css2d('tok3d-at', `<div class="port3d">${port.type === 'any' ? '<b>3:1</b>' : `${pxIcon(port.type, 16).outerHTML}<b>2:1</b>`}</div>`);
    sign.position.set(port.x, 0.55, port.y);
    b.staticGroup.add(boat, sign);
  }
  if (items.length) {
    const set = (b.portSprites = new LabelSet(items, b.tk ?? 1, b.invalidate));
    set.mesh.layers.set(LAYER_LABELS);
    b.staticGroup.add(set.mesh);
  }
}
