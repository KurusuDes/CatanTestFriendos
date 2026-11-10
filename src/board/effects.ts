// Effects on top of the map: dice, table shake, pings, floaters, flip plates, anchor points.
import * as THREE from 'three';
import { Dice3D, diceFlyMs } from './dice3d';
import { LAYER_PIECES, pieceHook } from './shaders';
import { smooth } from './terrain';
import { shared } from './dispose';
import type { BState } from './types';
import type { Board3D } from './Board3D';

export interface Ping {
  stake: THREE.Group;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  pennant: THREE.Mesh;
  mats: THREE.Material[];
  y: number;
  t0: number;
}
export interface Floater {
  el: HTMLElement;
  point: { x: number; y: number; z: number };
  rise: number;
  life: number;
  wobble: number;
  t0: number;
  ph: number;
}
export interface Plate {
  obj: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  y: number;
  t0: number;
}

const PING_H = 0.42, PING_LIFE = 1700; // the middle-click marker: pole height, ms on the map

// ---------- effects that live on top of the map ----------
// returns how long the dice fly before they settle
export function rollDice(board: Board3D, values: number[], at: number, power = 0) {
  if (!board.diceFx) {
    board.diceFx = new Dice3D(board);
    // pieces layer: stays sharp under the tilt-shift and gets the see-through outline
    for (const m of board.diceFx.dice) {
      m.layers.set(LAYER_PIECES);
      m.userData.pc = new THREE.Color(m === board.diceFx.dice[0] ? '#f4f4f4' : '#b13e53');
      m.onBeforeRender = pieceHook;
    }
  }
  board.diceFx.roll(values, at, power);
  board.hasPieces = true;
  return diceFlyMs(power);
}

// a hard dice throw thumps the table
export function shake(board: Board3D, px: number) {
  board.canvas.animate(
    [0, 1, 2, 3, 4, 5].map(i => ({ transform: i === 5 ? 'none' : `translate(${((i % 2 ? -1 : 1) * px * (1 - i / 5)).toFixed(1)}px, ${(px * 0.6 * (1 - i / 5)).toFixed(1)}px)` })),
    { duration: 260, easing: 'steps(5)' },
  );
}

// a player's marker: a little pole with a pennant in their colour is planted on the map,
// sends a soft ring along the ground, then fades and sinks away
export function ping(board: Board3D, x: number, z: number, color: string) {
  if (!board.pingGeo) {
    const pen = new THREE.Shape();
    pen.moveTo(0, 0);
    pen.lineTo(0.17, -0.045);
    pen.lineTo(0, -0.09);
    board.pingGeo = {
      pole: new THREE.CylinderGeometry(0.013, 0.013, PING_H, 6).translate(0, PING_H / 2, 0),
      knob: new THREE.SphereGeometry(0.028, 10, 8).translate(0, PING_H + 0.01, 0),
      pennant: new THREE.ShapeGeometry(pen).translate(0.012, PING_H - 0.02, 0),
      ring: new THREE.RingGeometry(0.07, 0.095, 32).rotateX(-Math.PI / 2),
    };
    board.pings = [];
  }
  const g = board.pingGeo, c = new THREE.Color(color);
  const mat = (col: THREE.ColorRepresentation, extra?: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, transparent: true, ...extra });
  const mats = [
    mat('#3a2c24'),
    mat(c, { emissive: c.clone().multiplyScalar(0.3) }),
    mat(c, { emissive: c.clone().multiplyScalar(0.3), side: THREE.DoubleSide }),
  ];
  const stake = new THREE.Group();
  const parts = [new THREE.Mesh(g.pole, mats[0]), new THREE.Mesh(g.knob, mats[1]), new THREE.Mesh(g.pennant, mats[2])];
  for (const m of parts) m.castShadow = true;
  stake.add(...parts);
  // the pennant points to the right of the screen, so it reads from any angle
  const cam = board.camera.position;
  stake.rotation.y = Math.atan2(cam.x - x, cam.z - z);
  const ring = new THREE.Mesh(g.ring, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false }));
  const y = Math.max(board.heightAt(x, z), 0.02);
  ring.position.set(x, y + 0.03, z);
  stake.position.set(x, y, z);
  board.scene.add(stake, ring);
  board.pings!.push({ stake, ring, pennant: parts[2]!, mats: [...mats, ring.material], y, t0: board.now() });
}

export function updatePings(board: Board3D, now: number) {
  if (!board.pings || !board.pings.length) return;
  board.pings = board.pings.filter(pg => {
    const t = now - pg.t0;
    if (t >= PING_LIFE) {
      dropPing(board, pg);
      return false;
    }
    // planted from a little above, with a short wobble when it hits the ground
    const plant = Math.min(1, t / 200);
    const fade = Math.max(0, (t - PING_LIFE + 550) / 550);
    pg.stake.position.y = pg.y + (1 - plant) ** 2 * 0.5 - fade * 0.12;
    pg.stake.rotation.z = plant < 1 ? 0 : Math.sin(t / 45) * 0.14 * Math.exp(-(t - 200) / 260);
    pg.pennant.rotation.y = Math.sin(t / 110) * 0.35;
    for (let i = 0; i < 3; i++) pg.mats[i]!.opacity = 1 - fade;
    const u = Math.max(0, Math.min(1, (t - 180) / 900));
    pg.ring.scale.setScalar(1 + u * 2.4);
    pg.ring.material.opacity = t < 180 ? 0 : 0.65 * (1 - u);
    return true;
  });
}

export function dropPing(board: Board3D, pg: Ping) {
  board.scene.remove(pg.stake, pg.ring);
  for (const m of pg.mats) m.dispose();
}

export function tilePoint(board: Board3D, id: number) {
  const t = board.lastSt && board.lastSt.board.tiles[id];
  return t ? new THREE.Vector3(t.x, Math.max(board.heightAt(t.x, t.y), 0.1) + 0.2, t.y) : null;
}

// where a player's balloons rise from: their cities and settlements (or their roads)
export function playerPoints(board: Board3D, pid: number) {
  const st = board.lastSt;
  if (!st) return [];
  const bd = st.board, pts: THREE.Vector3[] = [];
  for (const k in st.buildings) {
    if (st.buildings[k]!.owner !== pid) continue;
    const V = bd.vertices[+k]!;
    pts.push(new THREE.Vector3(V.x, Math.max(board.heightAt(V.x, V.y), 0.05) + (st.buildings[k]!.type === 'city' ? 0.75 : 0.45), V.y));
  }
  if (!pts.length)
    for (const k in st.roads) {
      if (st.roads[k] !== pid) continue;
      const E = bd.edges[+k]!, a = bd.vertices[E.a]!, b = bd.vertices[E.b]!;
      pts.push(new THREE.Vector3((a.x + b.x) / 2, Math.max(board.heightAt((a.x + b.x) / 2, (a.y + b.y) / 2), 0.05) + 0.2, (a.y + b.y) / 2));
    }
  return pts;
}

// a DOM element glued to a point of the map (it follows pans/zooms) that rises and fades
export function float(board: Board3D, el: HTMLElement, point: { x: number; y: number; z: number }, { rise = 70, life = 3600, wobble = 6 }: { rise?: number; life?: number; wobble?: number } = {}) {
  el.style.position = 'fixed';
  el.style.left = el.style.top = '0';
  el.style.pointerEvents = 'none';
  document.body.append(el);
  board.floaters.push({ el, point, rise, life, wobble, t0: board.now(), ph: Math.random() * 6 });
}

export function updateFloaters(board: Board3D, now: number) {
  board.floaters = board.floaters.filter(f => {
    const k = (now - f.t0) / f.life;
    if (k >= 1) {
      f.el.remove();
      return false;
    }
    const p = board.toScreen(f.point.x, f.point.y, f.point.z);
    if (!p) {
      f.el.style.opacity = '0';
      return true;
    }
    const grow = Math.min(1, k * 8);
    const x = p.x + Math.sin(now / 420 + f.ph) * f.wobble;
    const y = p.y - f.rise * (1 - (1 - k) * (1 - k));
    f.el.style.opacity = String(k > 0.8 ? (1 - k) / 0.2 : 1);
    f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${(0.4 + grow * 0.6).toFixed(3)})`;
    return true;
  });
}

// one geometry for every plate of every board (never disposed); each plate owns its material
const PLATE_GEO = shared(new THREE.CylinderGeometry(0.98, 0.98, 0.06, 6));

export function flipPlates(board: Board3D, st: BState) {
  const bd = st.board;
  const cx = (bd.bounds.minX + bd.bounds.maxX) / 2, cz = (bd.bounds.minY + bd.bounds.maxY) / 2;
  const geo = PLATE_GEO;
  const now = board.now();
  for (const t of bd.tiles) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a6443', roughness: 0.8, transparent: true }));
    m.position.set(t.x, 1.6, t.y);
    m.castShadow = true;
    board.scene.add(m);
    board.plates.push({ obj: m, y: 1.6, t0: now + Math.hypot(t.x - cx, t.y - cz) * 130 });
  }
}

// the face-down plates flip away and fade; a finished plate is removed and its material freed
export function updatePlates(board: Board3D, now: number) {
  board.plates = board.plates.filter(p => {
    const k = Math.max(0, Math.min(1, (now - p.t0) / 900));
    const e = k * k * (3 - 2 * k);
    p.obj.rotation.x = e * Math.PI;
    p.obj.position.y = p.y + Math.sin(e * Math.PI) * 1.2 + e * 0.5;
    p.obj.material.opacity = 1 - smooth(0.6, 1, k);
    if (k >= 1) {
      board.scene.remove(p.obj);
      p.obj.material.dispose();
      return false;
    }
    return true;
  });
}
