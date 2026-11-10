// Player pieces (rebuilt when they change): roads, joints, buildings, banners, gold trims, the
// robber and the click hotspots.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { flagCanvas } from '@ui/flag';
import { goldOf, gild, tinted } from './assets';
import { LAYER_PIECES, patch, pieceHook } from './shaders';
import { disposeChildren, shared } from './dispose';
import type { BPlayer, BState, BoardViewState } from './types';
import type { Board3D } from './Board3D';

const KNOB_HOUSE = [0, 0.27, 0] as const, KNOB_CITY = [0, 0.57, 0] as const; // on top of the roof, in model units
const KNOB_GEO = shared(new THREE.SphereGeometry(0.024, 12, 8));
const KNOB_STEM = shared(new THREE.CylinderGeometry(0.006, 0.01, 0.04, 8).translate(0, -0.02, 0));
let knobBase: THREE.MeshStandardMaterial | null = null;
function goldKnob(x: number, y: number, z: number, glow: boolean) {
  knobBase = knobBase || new THREE.MeshStandardMaterial({ name: 'Knob' });
  const mat = goldOf(knobBase, glow);
  const g = new THREE.Group();
  const ball = new THREE.Mesh(KNOB_GEO, mat), stem = new THREE.Mesh(KNOB_STEM, mat);
  ball.castShadow = stem.castShadow = true;
  g.add(ball, stem);
  g.position.set(x, y, z);
  return g;
}

// ---------- kingdom banners waving on every building ----------
// shared constants: never disposed
const JOINT_CYL = shared(new THREE.CylinderGeometry(1, 1, 1, 20));
const JOINT_BOX = shared(new THREE.BoxGeometry(1, 1, 1));
const FLAG_GEO = shared(new THREE.PlaneGeometry(0.17, 0.12, 10, 1).translate(0.085, 0, 0));
const POLE_MAT = shared(new THREE.MeshStandardMaterial({ color: '#5b3e2b', roughness: 0.8 }));
const flagMats = new Map<string, THREE.MeshStandardMaterial>();
function flagMaterial(flag: unknown): THREE.MeshStandardMaterial {
  const key = (flag as string) || '-';
  if (flagMats.has(key)) return flagMats.get(key)!;
  const cv = flagCanvas(flag, 1) as HTMLCanvasElement & { pixel?: boolean; ready: Promise<unknown> };
  const tex = new THREE.CanvasTexture(cv);
  if (cv.pixel) tex.magFilter = tex.minFilter = THREE.NearestFilter;
  else tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  cv.ready.then(() => (tex.needsUpdate = true));
  const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  transformed.z += sin(uTime * 6.0 + position.x * 42.0) * 0.02 * (position.x / 0.17);`);
  };
  patch(m, { key: 'flag' });
  flagMats.set(key, shared(m));
  return m;
}
// pole geometries by height (a handful of values), shared by every banner
const poleGeos = new Map<number, THREE.CylinderGeometry>();
function poleGeo(height: number): THREE.CylinderGeometry {
  let g = poleGeos.get(height);
  if (!g) poleGeos.set(height, (g = shared(new THREE.CylinderGeometry(0.005, 0.006, height, 6).translate(0, height / 2, 0))));
  return g;
}
function banner(flag: unknown, x: number, z: number, height: number, size = 1) {
  const g = new THREE.Group();
  g.scale.setScalar(size);
  height /= size;
  const pole = new THREE.Mesh(poleGeo(height), patch(POLE_MAT, { key: 'pole' }));
  const cloth = new THREE.Mesh(FLAG_GEO, flagMaterial(flag));
  cloth.position.set(0.004, height - 0.065, 0);
  pole.castShadow = cloth.castShadow = true;
  g.add(pole, cloth);
  g.position.set(x, 0, z);
  return g;
}

// translucent ghosts of the blind-setup pieces: one clone per source material, never disposed
const ghostMats = new Map<THREE.Material, THREE.Material>();
function ghostMat(src: THREE.Material): THREE.Material {
  let g = ghostMats.get(src);
  if (!g) {
    g = src.clone();
    g.transparent = true;
    g.opacity = 0.5;
    ghostMats.set(src, shared(g));
  }
  return g;
}

// the road model's own materials (textured bed + tinted planks) for the joints, shared by every board
interface JointMats {
  top: THREE.Material;
  bed: THREE.Material;
}
const jm = new Map<string, JointMats>();
export function jointMats(board: Board3D, color: string, gold = 0): JointMats {
  if (gold) {
    // gold road edges: the bed under the planks turns gold (and shines at level 5)
    const key = color + '|' + gold;
    if (!jm.has(key)) {
      const m = jointMats(board, color);
      jm.set(key, { top: m.top, bed: goldOf(m.bed, gold >= 5) });
    }
    return jm.get(key)!;
  }
  if (!jm.has(color)) {
    const mats: Partial<JointMats> = {};
    tinted(board.kit.road, { Player: color, Banner: color, PlayerWood: color }).traverse(obj => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mt of ([] as THREE.Material[]).concat(m.material)) {
        const k = mt.name === 'PlayerWood' ? 'top' : 'bed';
        if (mats[k]) continue;
        // the kit bakes AO into vertex colours, which the plain joint geometry doesn't have
        const n = mt.clone() as THREE.MeshStandardMaterial;
        n.vertexColors = false;
        n.color.multiplyScalar(0.85);
        n.userData.patched = false;
        mats[k] = shared(patch(n, { key: 'joint' }));
      }
    });
    jm.set(color, mats as JointMats);
  }
  return jm.get(color)!;
}

// how gilded a player's pieces are: their ADHD wins this match, up to 5
export function goldLevel(_board: Board3D, p: BPlayer | undefined) {
  return p ? Math.min(5, p.adhdWins || 0) : 0;
}

export function buildDynamic(board: Board3D, st: BState, view: BoardViewState) {
  const bd = st.board;
  const kit = board.kit;
  // only rebuild when pieces or pick spots changed: recreating the hotspots on every state
  // update swaps the button under the finger and the click gets lost
  const inter = view.interaction;
  board.inter = inter;
  const robberOn = bd.robber >= 0 && !st.config.rules.noRobber && bd.tiles[bd.robber]!.revealed && !bd.robberHidden;
  board.robberTile = robberOn && bd.tiles[bd.robber]!.res !== 'desert' ? bd.tiles[bd.robber]! : null;
  const key = JSON.stringify([st.roads, st.buildings, robberOn && bd.robber, view.blindOwn || [], st.players.map(p => p.color + (p.flag || '').length + '|' + goldLevel(board, p)),
    inter && [inter.kind, inter.color, [...inter.legal].sort((a, b) => a - b)], board.staticKey]);
  if (key === board.dynKey) return;
  board.dynKey = key;
  // everything in here is shared (kit, tinted, gold, ghost, joint materials) except the CSS2D hotspots
  disposeChildren(board.dynGroup);
  const pieces = new Set<string>();
  board.hasPieces = false;
  const vy = (v: number) => Math.max(board.heightAt(bd.vertices[v]!.x, bd.vertices[v]!.y), 0.05);
  // player pieces go on their own layer so they stay sharp and get the x-ray outline
  const own = (obj: THREE.Object3D, color: string) => {
    const pc = new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace); // raw sRGB values for the masks
    obj.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.layers.set(LAYER_PIECES);
      m.userData.pc = pc;
      m.onBeforeRender = pieceHook;
    });
    board.hasPieces = true;
  };
  const add = (obj: THREE.Object3D, key: string, color?: string) => {
    if (color) own(obj, color);
    board.dynGroup.add(obj);
    pieces.add(key);
    if (board.prevPieces.size && !board.prevPieces.has(key)) board.spawns.push({ obj, y: obj.position.y, base: obj.scale.clone(), t0: board.now() });
  };
  // translucent copies of the real materials, made once per source material and shared
  const ghostify = (o: THREE.Object3D) => o.traverse(obj => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) m.material = ghostMat(m.material as THREE.Material);
  });
  const colors = (c: string) => ({ Player: c, Banner: c, PlayerWood: c });
  const road = (eid: number, color: string, ghost?: boolean) => {
    const E = bd.edges[eid]!, a = bd.vertices[E.a]!, b = bd.vertices[E.b]!;
    const lv = ghost ? 0 : goldLevel(board, st.players[st.roads[eid]!]);
    const o = gild(tinted(kit.road, colors(color)), lv >= 2 ? ['Wood'] : [], lv >= 5);
    const ya = vy(E.a), yb = vy(E.b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    o.position.set((a.x + b.x) / 2, (ya + yb) / 2 + 0.01, (a.y + b.y) / 2);
    o.rotation.order = 'YZX';
    o.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
    o.rotation.z = Math.atan2(yb - ya, len);
    if (ghost) ghostify(o);
    o.scale.set(1.08, 2.2, 2.1);
    add(o, 'r' + eid + (ghost ? 'g' : ''), color);
  };
  for (const k in st.roads) road(+k, st.players[st.roads[k]!]!.color);
  for (const b of view.blindOwn || []) if (b.eid != null) road(b.eid, st.players[b.pid]!.color, true);
  // road joints: the plank model stops short of the corners, so every road end gets an arm
  // that reaches its vertex plus a round cap there: bends connect and dead ends get a round tip
  const ends = new Map<string, number[]>(); // "vid:owner" -> other vertex of each of that owner's roads there
  for (const k in st.roads) {
    const E = bd.edges[+k]!, owner = st.roads[k]!;
    for (const [v, o] of [[E.a, E.b], [E.b, E.a]] as [number, number][]) {
      // a rival's house cuts the road: no joint under it, so the plank visibly stops short
      const b = st.buildings[v];
      if (b && b.owner !== owner) continue;
      const key = v + ':' + owner;
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key)!.push(o);
    }
  }
  for (const [key, others] of ends) {
    const [vid, owner] = key.split(':').map(Number) as [number, number];
    const color = st.players[owner]!.color;
    const lv = goldLevel(board, st.players[owner]!);
    const m = jointMats(board, color, lv >= 2 ? lv : 0);
    const V = bd.vertices[vid]!, y0 = vy(vid);
    const g = new THREE.Group();
    g.position.set(V.x, y0 + 0.01 + owner * 0.002, V.y);
    const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, sx: number, sy: number, sz: number, x: number, y: number, mat: THREE.Material) => {
      const p = new THREE.Mesh(geo, mat);
      p.scale.set(sx, sy, sz);
      p.position.set(x, y, 0);
      p.castShadow = p.receiveShadow = true;
      parent.add(p);
    };
    part(g, JOINT_CYL, 0.085, 0.057, 0.085, 0, 0.0285, m.bed);
    part(g, JOINT_CYL, 0.1, 0.024, 0.1, 0, 0.078, m.top);
    if (lv >= 2) part(g, JOINT_CYL, 0.055, 0.014, 0.055, 0, 0.096, m.bed); // a gold stud on the joint
    for (const o of others) {
      const O = bd.vertices[o]!;
      const dx = O.x - V.x, dz = O.y - V.y, len = Math.hypot(dx, dz);
      const arm = new THREE.Group();
      arm.rotation.order = 'YZX';
      arm.rotation.y = -Math.atan2(dz, dx);
      arm.rotation.z = Math.atan2(vy(o) - y0, len);
      part(arm, JOINT_BOX, 0.33, 0.057, 0.17, 0.165, 0.0285, m.bed);
      part(arm, JOINT_BOX, 0.33, 0.024, 0.2, 0.165, 0.078, m.top);
      g.add(arm);
    }
    add(g, 'j' + key, color);
  }
  const building = (vid: number, owner: number, type: string, ghost?: boolean) => {
    const V = bd.vertices[vid]!;
    const lv = ghost ? 0 : goldLevel(board, st.players[owner]!);
    const trims = [...(lv >= 1 ? ['Timber'] : []), ...(lv >= 3 ? ['Glass', 'StoneDark'] : [])];
    const o = gild(tinted(type === 'city' ? kit.city : kit.house, colors(st.players[owner]!.color)), trims, lv >= 5);
    if (lv >= 4) o.add(type === 'city' ? goldKnob(KNOB_CITY[0], KNOB_CITY[1], KNOB_CITY[2], lv >= 5) : goldKnob(KNOB_HOUSE[0], KNOB_HOUSE[1], KNOB_HOUSE[2], lv >= 5));
    o.position.set(V.x, vy(vid) - 0.01, V.y);
    o.rotation.y = ((vid * 2.39996) % 6.28) * 0.4;
    const pl = st.players[owner]!;
    if (pl.flag) {
      // the painted kingdom flag replaces the model's plain pennant
      o.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.material && (m.material as THREE.Material).name === 'Banner') m.visible = false;
      });
      o.add(type === 'city' ? banner(pl.flag, -0.06, 0.03, 0.78, 1.7) : banner(pl.flag, 0.1, 0.07, 0.36));
    }
    if (ghost) ghostify(o);
    o.scale.setScalar(type === 'city' ? 1.25 : 1.45);
    add(o, 'b' + vid + type + (ghost ? 'g' : ''), pl.color);
  };
  for (const k in st.buildings) building(+k, st.buildings[k]!.owner, st.buildings[k]!.type);
  for (const b of view.blindOwn || []) building(b.vid, b.pid, b.type, true);

  if (robberOn) {
    const t = bd.tiles[bd.robber]!;
    const o = kit.robber.clone();
    const x = t.x - 0.3, z = t.y + 0.22;
    o.position.set(x, Math.max(board.heightAt(x, z), 0.1), z);
    o.scale.setScalar(1.3);
    add(o, 'robber' + t.id);
  }

  if (inter) {
    const mk = (id: number, x: number, y: number, z: number, cls: string) => {
      const el = document.createElement('button');
      el.className = 'hot3d ' + cls;
      el.style.setProperty('--pc', inter.color || '#fff');
      el.addEventListener('pointerdown', e => e.stopPropagation());
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (board.inter) board.inter.onPick(id);
      });
      const o = new CSS2DObject(el);
      o.position.set(x, y, z);
      board.dynGroup.add(o);
    };
    if (inter.kind === 'settlement' || inter.kind === 'city')
      for (const v of inter.legal) {
        const V = bd.vertices[v]!;
        // corners served by a port say so right on the spot
        mk(v, V.x, vy(v) + (inter.kind === 'city' ? 0.45 : 0.08), V.y, 'v' + (inter.kind === 'settlement' && V.port != null ? ' port' : ''));
      }
    else if (inter.kind === 'road')
      for (const e of inter.legal) {
        const E = bd.edges[e]!, a = bd.vertices[E.a]!, b = bd.vertices[E.b]!;
        mk(e, (a.x + b.x) / 2, (vy(E.a) + vy(E.b)) / 2 + 0.06, (a.y + b.y) / 2, 'e');
      }
    else if (inter.kind === 'robber')
      for (const id of inter.legal) {
        const t = bd.tiles[id]!;
        mk(id, t.x + 0.3, Math.max(board.heightAt(t.x, t.y), 0.3) + 0.3, t.y - 0.25, 't');
      }
  }
  board.prevPieces = pieces;
}
