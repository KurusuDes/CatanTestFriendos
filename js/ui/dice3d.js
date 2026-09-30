// Two real dice thrown onto the table on every roll: they fly in from the player's side,
// tumble, bounce twice and settle showing the rolled numbers, then sink away.
// The motion is scripted (not simulated) so every screen shows exactly the rolled result.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SIZE = 0.4;
// BoxGeometry material order: +x, -x, +y, -y, +z, -z (opposite faces add up to 7)
const FACE_VALUES = [2, 5, 1, 6, 3, 4];
const NORMALS = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [1, 0, 0], 5: [-1, 0, 0], 3: [0, 0, 1], 4: [0, 0, -1] };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const FLY = 1250, STAY = 2600, SINK = 450; // ms

function faceTexture(n, bg, pip) {
  const c = document.createElement('canvas');
  c.width = c.height = 32; // pixel-art faces to match the UI
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = pip;
  for (const i of PIPS[n]) g.fillRect(6 + (i % 3) * 8, 6 + Math.floor(i / 3) * 8, 5, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

function makeDie(bg, pip) {
  const geo = new RoundedBoxGeometry(SIZE, SIZE, SIZE, 3, SIZE * 0.14);
  const mats = FACE_VALUES.map(n => new THREE.MeshStandardMaterial({ map: faceTexture(n, bg, pip), roughness: 0.45, metalness: 0 }));
  const m = new THREE.Mesh(geo, mats);
  m.castShadow = m.receiveShadow = true;
  return m;
}

const easeOut = k => 1 - (1 - k) * (1 - k);

// height above the resting point along the throw: one drop, then two shrinking hops
function hop(k) {
  const H = 2.6;
  if (k < 0.42) return H * (1 - (k / 0.42) ** 2);
  if (k < 0.68) { const u = (k - 0.42) / 0.26; return 0.5 * 4 * u * (1 - u); }
  if (k < 0.84) { const u = (k - 0.68) / 0.16; return 0.12 * 4 * u * (1 - u); }
  return 0;
}

export class Dice3D {
  constructor(board) {
    this.board = board;
    this.dice = [makeDie('#f4f4f4', '#1a1c2c'), makeDie('#b13e53', '#f4f4f4')];
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.add(...this.dice);
    board.scene.add(this.group);
    this.throw = null;
  }

  // where the dice land: a bit below the middle of the screen, on the terrain
  landing() {
    const b = this.board, cam = b.camera;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, -0.35), cam);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.3), hit)) hit.copy(b.controls.target);
    const fwd = hit.clone().sub(cam.position).setY(0).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    return { hit, fwd, right };
  }

  roll(values, at) {
    if (!values || at === this.at) return;
    this.at = at;
    const { hit, fwd, right } = this.landing();
    const t0 = this.board.now();
    this.throw = {
      t0,
      dice: this.dice.map((mesh, i) => {
        const end = hit.clone().addScaledVector(right, (i ? 1 : -1) * 0.34).addScaledVector(fwd, (i ? 0.08 : -0.08));
        end.y = Math.max(this.board.heightAt(end.x, end.z), 0.02) + SIZE / 2;
        // thrown from the viewer's side, slightly fanned out
        const start = end.clone().addScaledVector(fwd, -2.6).addScaledVector(right, (i ? 0.5 : -0.5));
        const up = new THREE.Vector3(0, 1, 0);
        const final = new THREE.Quaternion().setFromAxisAngle(up, Math.random() * Math.PI * 2)
          .multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...NORMALS[values[i]]), up));
        const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).addScaledVector(right, 1.5).normalize();
        return { mesh, start, end, final, axis, spin: Math.PI * (5 + Math.random() * 3) };
      }),
    };
    this.group.visible = true;
  }

  update(now) {
    const th = this.throw;
    if (!th) return;
    const t = now - th.t0;
    if (t > FLY + STAY + SINK) {
      this.throw = null;
      this.group.visible = false;
      return;
    }
    const k = Math.min(1, t / FLY);
    const sink = Math.max(0, (t - FLY - STAY) / SINK);
    const q = new THREE.Quaternion();
    for (const d of th.dice) {
      d.mesh.position.lerpVectors(d.start, d.end, easeOut(Math.min(1, k * 1.15)));
      d.mesh.position.y = d.end.y + hop(k) - sink * SIZE * 1.4;
      // the spin unwinds to nothing exactly when the die settles on the rolled face
      const left = 1 - easeOut(Math.min(1, k / 0.9));
      d.mesh.quaternion.copy(d.final).multiply(q.setFromAxisAngle(d.axis, d.spin * left));
      d.mesh.scale.setScalar(1 - sink * 0.6);
    }
  }

  dispose() {
    this.board.scene.remove(this.group);
    for (const d of this.dice) {
      d.geometry.dispose();
      for (const m of d.material) {
        m.map.dispose();
        m.dispose();
      }
    }
  }
}
