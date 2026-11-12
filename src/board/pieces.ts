// Player pieces (added / removed / replaced one by one when they change): roads, joints, buildings, banners, the
// robber and the click hotspots.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { flagCanvas } from '@ui/flag/flag';
import { tinted } from './assets';
import { LAYER_PIECES, patch, pieceHook } from './shaders';
import { disposeChildren, disposeTree, shared } from './dispose';
import { diffPlan, interKey, planPieces, type PieceSpec, type PlanInput } from './pieceplan';
import type { BState, BoardViewState } from './types';
import type { Board3D } from './Board3D';

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
function jointMats(board: Board3D, color: string): JointMats {
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

// ---------- incremental pieces (3D-6) ----------
// Roads and joints are InstancedMeshes, one per (player colour x part): the whole road network
// is a few dozen draw calls instead of hundreds, in the main pass, the shadow pass and the mask passes alike.
// Houses, cities, ghosts and the robber stay clones (shared geometry, cached materials).

/** A drop-in animation of a freshly placed piece; `step(e)` takes the eased progress 0..1. */
export interface Spawn {
  t0: number;
  owner: object;
  step: (e: number) => void;
}

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const ID_Q = new THREE.Quaternion();
const mat4 = (px: number, py: number, pz: number, sx: number, sy: number, sz: number, q: THREE.Quaternion = ID_Q) =>
  new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));

/** The instances of one geometry + material + colour: add / set / remove by key, swap-remove keeps it dense. */
class InstGroup {
  mesh!: THREE.InstancedMesh;
  keys: string[] = [];
  idx = new Map<string, number>();
  private cap = 0;
  constructor(private parent: THREE.Object3D, private geo: THREE.BufferGeometry, private mat: THREE.Material, private color: string) {
    this.alloc(16, null);
  }
  private alloc(cap: number, old: THREE.InstancedMesh | null) {
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // the bounding sphere would have to follow every instance
    m.castShadow = m.receiveShadow = true;
    m.layers.set(LAYER_PIECES);
    m.userData.pc = new THREE.Color().setStyle(this.color, THREE.LinearSRGBColorSpace); // raw sRGB values for the masks
    m.onBeforeRender = pieceHook;
    m.count = 0;
    m.visible = false;
    if (old) {
      m.instanceMatrix.array.set(old.instanceMatrix.array);
      m.count = old.count;
      m.visible = old.visible;
      this.parent.remove(old);
      old.dispose(); // frees only its instance buffer: the geometry and material are shared
    }
    this.parent.add(m);
    this.mesh = m;
    this.cap = cap;
  }
  private flush() {
    this.mesh.count = this.keys.length;
    this.mesh.visible = this.keys.length > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  add(key: string, m: THREE.Matrix4) {
    if (this.keys.length === this.cap) this.alloc(this.cap * 2, this.mesh);
    m.toArray(this.mesh.instanceMatrix.array as unknown as number[], this.keys.length * 16);
    this.idx.set(key, this.keys.length);
    this.keys.push(key);
    this.flush();
  }
  set(key: string, m: THREE.Matrix4) {
    const i = this.idx.get(key);
    if (i === undefined) return;
    m.toArray(this.mesh.instanceMatrix.array as unknown as number[], i * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  remove(key: string) {
    const i = this.idx.get(key);
    if (i === undefined) return;
    const last = this.keys.length - 1, a = this.mesh.instanceMatrix.array as unknown as Float32Array;
    if (i !== last) {
      a.copyWithin(i * 16, last * 16, last * 16 + 16);
      const lk = this.keys[last]!;
      this.keys[i] = lk;
      this.idx.set(lk, i);
    }
    this.keys.pop();
    this.idx.delete(key);
    this.flush();
  }
}

// the road model's two submeshes (bed + player planks) with their tinted materials, once per colour
const roadParts = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }[]>();
function roadPartsOf(kit: Board3D['kit'], color: string) {
  const key = color;
  let parts = roadParts.get(key);
  if (!parts) {
    const o = tinted(kit.road, { Player: color, Banner: color, PlayerWood: color });
    parts = [];
    o.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) parts!.push({ geo: m.geometry, mat: m.material as THREE.Material });
    });
    roadParts.set(key, parts);
  }
  return parts;
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

type Spec = PieceSpec | { kind: 'robber'; key: string; sig: string; tile: { id: number; x: number; y: number } };
interface Rec {
  sig: string;
  owned: boolean;
  remove: () => void;
}

export class PieceSet {
  recs = new Map<string, Rec>();
  private groups = new Map<string, InstGroup>();
  private root = new THREE.Group();
  private hot = new THREE.Group();
  private built = false;
  private heightKey: unknown = null;
  private heightField: unknown = null;
  private hotKey = '';
  private owned = 0;
  constructor(private board: Board3D) {
    board.dynGroup.add(this.root, this.hot);
  }

  private group(id: string, geo: THREE.BufferGeometry, mat: THREE.Material, color: string): InstGroup {
    let g = this.groups.get(id);
    if (!g) this.groups.set(id, (g = new InstGroup(this.root, geo, mat, color)));
    return g;
  }

  private spawn(rec: Rec, step: Spawn['step']) {
    this.board.spawns.push({ t0: this.board.now(), owner: rec, step });
  }

  private drop(key: string) {
    const r = this.recs.get(key);
    if (!r) return;
    r.remove();
    if (r.owned) this.owned--;
    this.recs.delete(key);
    this.board.spawns = this.board.spawns.filter(s => s.owner !== r);
  }

  sync(st: BState, view: BoardViewState) {
    const b = this.board, bd = st.board;
    const vy = (v: number) => Math.max(b.heightAt(bd.vertices[v]!.x, bd.vertices[v]!.y), 0.05);
    // the robber sits on a revealed tile only: never read a masked tile (online clients)
    const rt = bd.robber >= 0 ? bd.tiles[bd.robber] : undefined;
    const robberOn = !!rt && !st.config.rules.noRobber && rt.revealed && !bd.robberHidden;
    b.robberTile = robberOn && rt!.res !== 'desert' ? rt! : null;

    const flags = st.players.map(p => (p.flag ? p.flag.length + ':' + hashStr(p.flag) : ''));
    const next = new Map<string, Spec>(
      planPieces({ st: st as PlanInput['st'], blindOwn: view.blindOwn, flag: pid => flags[pid] || '' }),
    );
    if (robberOn) next.set('robber' + rt!.id, { kind: 'robber', key: 'robber' + rt!.id, sig: '', tile: rt! });

    // new terrain (other heights) = every piece moves: rebuild them all in place, without drop-in animations
    const reset = this.heightKey !== b.staticKey || this.heightField !== b.field;
    const known = new Set(this.recs.keys());
    if (reset) for (const k of [...this.recs.keys()]) this.drop(k);
    const prev = new Map<string, string>();
    for (const [k, r] of this.recs) prev.set(k, r.sig);
    const d = diffPlan(prev, next);
    for (const k of d.removed) this.drop(k);
    for (const k of d.changed) this.drop(k);
    for (const k of d.changed) this.create(next.get(k)!, st, vy, false);
    for (const k of d.added) this.create(next.get(k)!, st, vy, this.built && !known.has(k));
    this.heightKey = b.staticKey;
    this.heightField = b.field;
    this.built = true;
    b.hasPieces = this.owned > 0;

    this.syncHotspots(st, view, vy, reset);
  }

  // ---- one piece
  private create(spec: Spec, st: BState, vy: (v: number) => number, spawn: boolean) {
    switch (spec.kind) {
      case 'road': return this.createRoad(spec, st, vy, spawn);
      case 'joint': return this.createJoint(spec, st, vy, spawn);
      case 'building': return this.createBuilding(spec, st, vy, spawn);
      case 'robber': return this.createRobber(spec, spawn);
    }
  }

  private colors = (c: string) => ({ Player: c, Banner: c, PlayerWood: c });

  /** a whole Object3D piece (clone): ghosts, houses, cities, the robber */
  private addObject(spec: Spec, obj: THREE.Object3D, color: string | undefined, spawn: boolean) {
    if (color) {
      const pc = new THREE.Color().setStyle(color, THREE.LinearSRGBColorSpace);
      obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.layers.set(LAYER_PIECES); // sharp under the tilt-shift + the x-ray outline
        m.userData.pc = pc;
        m.onBeforeRender = pieceHook;
      });
      this.owned++;
    }
    this.root.add(obj);
    const rec: Rec = { sig: spec.sig, owned: !!color, remove: () => (this.root.remove(obj), disposeTree(obj)) };
    this.recs.set(spec.key, rec);
    if (spawn) {
      const y = obj.position.y, base = obj.scale.clone();
      this.spawn(rec, e => {
        obj.position.y = y + (1 - e) * 1.2;
        obj.scale.copy(base).multiplyScalar(0.6 + e * 0.4);
      });
    }
  }

  // translucent copies of the real materials, made once per source material and shared
  private ghostify(o: THREE.Object3D) {
    o.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) m.material = ghostMat(m.material as THREE.Material);
    });
  }

  private createRoad(s: Extract<PieceSpec, { kind: 'road' }>, st: BState, vy: (v: number) => number, spawn: boolean) {
    const b = this.board, bd = st.board;
    const E = bd.edges[s.eid]!, a = bd.vertices[E.a]!, c = bd.vertices[E.b]!;
    const ya = vy(E.a), yb = vy(E.b);
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const pos = new THREE.Vector3((a.x + c.x) / 2, (ya + yb) / 2 + 0.01, (a.y + c.y) / 2);
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(c.y - a.y, c.x - a.x), Math.atan2(yb - ya, len), 'YZX'));
    const scale = new THREE.Vector3(1.08, 2.2, 2.1);
    if (s.ghost) {
      const o = tinted(b.kit.road, this.colors(s.color));
      o.position.copy(pos);
      o.quaternion.copy(quat);
      this.ghostify(o);
      o.scale.copy(scale);
      return this.addObject(s, o, s.color, spawn);
    }
    const ents = roadPartsOf(b.kit, s.color).map((p, i) => ({ g: this.group(`r|${s.color}|${i}`, p.geo, p.mat, s.color), k: s.key + '#' + i }));
    const place = (e: number, first: boolean) => {
      _p.set(pos.x, pos.y + (1 - e) * 1.2, pos.z);
      _s.copy(scale).multiplyScalar(0.6 + e * 0.4);
      _m.compose(_p, quat, _s);
      for (const t of ents) first ? t.g.add(t.k, _m) : t.g.set(t.k, _m);
    };
    place(1, true);
    this.owned++;
    const rec: Rec = { sig: s.sig, owned: true, remove: () => ents.forEach(t => t.g.remove(t.k)) };
    this.recs.set(s.key, rec);
    if (spawn) this.spawn(rec, e => place(e, false));
  }

  private createJoint(s: Extract<PieceSpec, { kind: 'joint' }>, st: BState, vy: (v: number) => number, spawn: boolean) {
    const b = this.board, bd = st.board;
    const m = jointMats(b, s.color), V = bd.vertices[s.vid]!, y0 = vy(s.vid);
    const P = new THREE.Vector3(V.x, y0 + 0.01 + s.owner * 0.002, V.y);
    const id = (part: string, geo: THREE.BufferGeometry, mat: THREE.Material) => this.group(`j|${s.color}|${part}`, geo, mat, s.color);
    // [group, instance key, matrix relative to the joint's origin]
    const ents: [InstGroup, string, THREE.Matrix4][] = [
      [id('cb', JOINT_CYL, m.bed), s.key + '#cb', mat4(0, 0.0285, 0, 0.085, 0.057, 0.085)],
      [id('ct', JOINT_CYL, m.top), s.key + '#ct', mat4(0, 0.078, 0, 0.1, 0.024, 0.1)],
    ];
    for (const o of s.others) {
      const O = bd.vertices[o]!, dx = O.x - V.x, dz = O.y - V.y, len = Math.hypot(dx, dz);
      _q.setFromEuler(_e.set(0, -Math.atan2(dz, dx), Math.atan2(vy(o) - y0, len), 'YZX'));
      const arm = new THREE.Matrix4().makeRotationFromQuaternion(_q);
      ents.push([id('ab', JOINT_BOX, m.bed), s.key + '#ab' + o, arm.clone().multiply(mat4(0.165, 0.0285, 0, 0.33, 0.057, 0.17))]);
      ents.push([id('at', JOINT_BOX, m.top), s.key + '#at' + o, arm.clone().multiply(mat4(0.165, 0.078, 0, 0.33, 0.024, 0.2))]);
    }
    const place = (e: number, first: boolean) => {
      _p.set(P.x, P.y + (1 - e) * 1.2, P.z);
      const f = 0.6 + e * 0.4;
      _w.compose(_p, ID_Q, _s.set(f, f, f));
      for (const [g, k, L] of ents) {
        _m.multiplyMatrices(_w, L);
        first ? g.add(k, _m) : g.set(k, _m);
      }
    };
    place(1, true);
    this.owned++;
    const rec: Rec = { sig: s.sig, owned: true, remove: () => ents.forEach(([g, k]) => g.remove(k)) };
    this.recs.set(s.key, rec);
    if (spawn) this.spawn(rec, e => place(e, false));
  }

  private createBuilding(s: Extract<PieceSpec, { kind: 'building' }>, st: BState, vy: (v: number) => number, spawn: boolean) {
    const kit = this.board.kit, V = st.board.vertices[s.vid]!, pl = st.players[s.owner]!, city = s.type === 'city';
    const o = tinted(city ? kit.city : kit.house, this.colors(pl.color));
    o.position.set(V.x, vy(s.vid) - 0.01, V.y);
    o.rotation.y = ((s.vid * 2.39996) % 6.28) * 0.4;
    if (pl.flag) {
      // the painted kingdom flag replaces the model's plain pennant
      o.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.isMesh && m.material && (m.material as THREE.Material).name === 'Banner') m.visible = false;
      });
      o.add(city ? banner(pl.flag, -0.06, 0.03, 0.78, 1.7) : banner(pl.flag, 0.1, 0.07, 0.36));
    }
    if (s.ghost) this.ghostify(o);
    o.scale.setScalar(city ? 1.25 : 1.45);
    this.addObject(s, o, pl.color, spawn);
  }

  private createRobber(s: Extract<Spec, { kind: 'robber' }>, spawn: boolean) {
    const o = this.board.kit.robber.clone();
    const x = s.tile.x - 0.3, z = s.tile.y + 0.22;
    o.position.set(x, Math.max(this.board.heightAt(x, z), 0.1), z);
    o.scale.setScalar(1.3);
    this.addObject(s, o, undefined, spawn);
  }

  // ---- click hotspots (CSS2D buttons): their own group, rebuilt only when the pick spots change.
  // Recreating them on every state update swaps the button under the finger and the click gets lost.
  private syncHotspots(st: BState, view: BoardViewState, vy: (v: number) => number, force: boolean) {
    const board = this.board, bd = st.board, inter = view.interaction;
    board.inter = inter; // the click handler reads the latest onPick
    const key = interKey(inter);
    if (key === this.hotKey && !force) return;
    this.hotKey = key;
    disposeChildren(this.hot);
    if (!inter) return;
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
      this.hot.add(o);
    };
    if (inter.kind === 'settlement' || inter.kind === 'city')
      for (const v of inter.legal) {
        const V = bd.vertices[v]!;
        // corners served by a port say so right on the spot
        mk(v, V.x, vy(v) + (inter.kind === 'city' ? 0.45 : 0.08), V.y, 'v' + (inter.kind === 'settlement' && V.port != null ? ' port' : ''));
      }
    else if (inter.kind === 'road')
      for (const e of inter.legal) {
        const E = bd.edges[e]!, a = bd.vertices[E.a]!, c = bd.vertices[E.b]!;
        mk(e, (a.x + c.x) / 2, (vy(E.a) + vy(E.b)) / 2 + 0.06, (a.y + c.y) / 2, 'e');
      }
    else if (inter.kind === 'robber')
      for (const id of inter.legal) {
        const t = bd.tiles[id]!;
        mk(id, t.x + 0.3, Math.max(board.heightAt(t.x, t.y), 0.3) + 0.3, t.y - 0.25, 't');
      }
  }
}

export function buildDynamic(board: Board3D, st: BState, view: BoardViewState) {
  (board.pieceSet || (board.pieceSet = new PieceSet(board))).sync(st, view);
}
