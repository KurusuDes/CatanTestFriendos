// 3D board renderer (three.js, loaded from CDN through the import map in index.html).
// Same interface as BoardView: render(state, view), setZoom(), resetView(), dispose().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TILE_INFO, pips } from '../engine/constants.js';

const HEIGHT = { wood: 0.26, brick: 0.3, sheep: 0.24, wheat: 0.22, ore: 0.36, desert: 0.2, gold: 0.3 };
const TOP = { wood: '#4f9a45', brick: '#c7743f', sheep: '#9fd26a', wheat: '#e9c24c', ore: '#8b909c', desert: '#e7d49a', gold: '#e8b43a' };
const SIDE = '#7a6448';

// deterministic pseudo random per tile so decorations don't jump between renders
function prng(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const geo = {};
const mat = {};
function G(key, make) {
  return geo[key] || (geo[key] = make());
}
function M(key, make) {
  return mat[key] || (mat[key] = make());
}
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...extra });

function canvasTexture(draw, w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const tokenTex = {};
function tokenTexture(num, hidden) {
  const key = hidden ? '?' : num;
  if (tokenTex[key]) return tokenTex[key];
  return (tokenTex[key] = canvasTexture((g, w, h) => {
    g.fillStyle = '#f7ecd0';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    const red = num === 6 || num === 8;
    g.fillStyle = hidden ? '#8a7a55' : red ? '#d32f2f' : '#2a2a2a';
    g.font = `bold ${hidden ? 70 : 62}px Fredoka, Nunito, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(hidden ? '?' : String(num), w / 2, h / 2 - (hidden ? 0 : 8));
    if (!hidden) {
      const p = pips(num);
      for (let i = 0; i < p; i++) {
        g.beginPath();
        g.arc(w / 2 + (i - (p - 1) / 2) * 13, h / 2 + 36, 4.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }));
}

const signTex = {};
function signTexture(text, icon) {
  const key = text + icon;
  if (signTex[key]) return signTex[key];
  return (signTex[key] = canvasTexture((g, w, h) => {
    g.fillStyle = 'rgba(253,246,227,0.95)';
    g.strokeStyle = '#8a6b3c';
    g.lineWidth = 8;
    g.beginPath();
    g.roundRect(6, 6, w - 12, h - 12, 26);
    g.fill();
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (icon) {
      g.font = '54px sans-serif';
      g.fillText(icon, w / 2, h / 2 - 18);
    }
    g.fillStyle = '#5a3d12';
    g.font = `900 ${icon ? 34 : 50}px Nunito, sans-serif`;
    g.fillText(text, w / 2, icon ? h / 2 + 34 : h / 2);
  }));
}

const hitMat = () => M('hit', () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));

export class Board3D {
  static async create(container) {
    return new Board3D(container);
  }

  constructor(container) {
    this.container = container;
    this.zoom = 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'board-3d';
    window.__board3d = this;
    container.append(this.canvas);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#8ecbee');
    scene.fog = new THREE.Fog('#8ecbee', 20, 48);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.camera.position.set(0, 11, 9);

    scene.add(new THREE.HemisphereLight('#dff4ff', '#4a3b25', 1.1));
    const sun = (this.sun = new THREE.DirectionalLight('#fff3dd', 2.4));
    sun.position.set(-7, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -14;
    sun.shadow.camera.right = sun.shadow.camera.top = 14;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);

    // ocean
    const og = new THREE.PlaneGeometry(90, 90, 110, 110);
    og.rotateX(-Math.PI / 2);
    this.oceanBase = og.attributes.position.array.slice();
    this.ocean = new THREE.Mesh(og, new THREE.MeshStandardMaterial({ color: '#1a6aa6', roughness: 0.35, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.94 }));
    this.ocean.receiveShadow = true;
    this.ocean.position.y = 0.02;
    scene.add(this.ocean);

    this.staticGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    scene.add(this.staticGroup, this.dynGroup);
    this.staticKey = '';
    this.pickables = [];
    this.pulse = [];
    this.spawns = [];
    this.prevPieces = new Set();
    this.clouds = [];

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.25;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 30;
    this.controls.screenSpacePanning = false;

    this.raycaster = new THREE.Raycaster();
    let down = null;
    this.canvas.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      this.click(e);
    });
    this.canvas.addEventListener('pointermove', e => this.hover(e));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  setZoom(z) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const f = this.zoom / Math.max(0.5, Math.min(4, z));
    this.zoom = Math.max(0.5, Math.min(4, z));
    dir.multiplyScalar(f);
    this.camera.position.copy(this.controls.target).add(dir);
  }

  resetView() {
    this.zoom = 1;
    this.frame(true);
  }

  frame() {
    const b = this.bounds;
    if (!b) return;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.1);
    this.controls.target.set(cx, 0, cz);
    const d = size * 0.72 + 1.6;
    this.camera.position.set(cx, d * 0.95, cz + d * 0.7);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 7, 14, cz + 6);
    this.controls.update();
  }

  // ---------- picking ----------
  ray(e) {
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    return hits.length ? hits[0].object : null;
  }
  click(e) {
    const o = this.ray(e);
    if (o && this.inter) this.inter.onPick(o.userData.id);
  }
  hover(e) {
    let o = this.ray(e);
    if (o && o.userData.proxy) o = o.userData.proxy;
    this.canvas.style.cursor = o ? 'pointer' : 'grab';
    if (this.hovered && this.hovered !== o) this.hovered.userData.hover = false;
    if (o) o.userData.hover = true;
    this.hovered = o;
  }

  tick() {
    const t = this.clock.getElapsedTime();
    // waves
    const pos = this.ocean.geometry.attributes.position;
    const a = pos.array, base = this.oceanBase;
    for (let i = 0; i < a.length; i += 3) {
      const x = base[i], z = base[i + 2];
      a[i + 1] = Math.sin(x * 0.9 + t * 1.3) * 0.045 + Math.cos(z * 1.1 + t * 1.1) * 0.045;
    }
    pos.needsUpdate = true;
    this.ocean.geometry.computeVertexNormals();
    for (const p of this.pulse) {
      const k = 1 + Math.sin(t * 6 + p.userData.phase) * 0.18 + (p.userData.hover ? 0.35 : 0);
      p.scale.setScalar(k);
      if (p.material.opacity !== undefined && p.userData.fade) p.material.opacity = 0.35 + (Math.sin(t * 5) + 1) * 0.25 + (p.userData.hover ? 0.3 : 0);
    }
    for (const c of this.clouds) c.position.y = c.userData.y + Math.sin(t * 1.2 + c.userData.phase) * 0.06;
    const now = performance.now();
    this.spawns = this.spawns.filter(sp => {
      const k = Math.min(1, (now - sp.t0) / 500);
      const e = 1 - Math.pow(1 - k, 3);
      sp.obj.position.y = sp.y + (1 - e) * 1.6;
      sp.obj.scale.setScalar(0.6 + e * 0.4);
      return k < 1;
    });
    if (this.rolledTiles) for (const m of this.rolledTiles) m.material.emissiveIntensity = 0.35 + Math.sin(t * 7) * 0.25;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- build ----------
  render(st, view = {}) {
    const bd = st.board;
    this.bounds = bd.bounds;
    const key = bd.tiles.map(t => `${t.res}${t.num}${t.revealed ? 1 : 0}${t.numRevealed ? 1 : 0}`).join('|') + bd.ports.length;
    if (key !== this.staticKey) {
      const first = !this.staticKey;
      this.staticKey = key;
      this.buildStatic(st);
      if (first) this.frame();
    }
    this.buildDynamic(st, view);
  }

  clearGroup(g) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse(o => {
        if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
        if (o.userData.ownMat && o.material) o.material.dispose();
      });
    }
  }

  buildStatic(st) {
    const bd = st.board;
    this.clearGroup(this.staticGroup);
    this.clouds = [];
    this.tileTops = {};
    const hexGeo = G('hex', () => new THREE.CylinderGeometry(0.985, 0.985, 1, 6, 1));
    const sideMat = M('side', () => std(SIDE));
    // sandy shelf under every land tile
    for (const t of bd.tiles) {
      const shelf = new THREE.Mesh(G('shelf', () => new THREE.CylinderGeometry(1.08, 1.12, 0.12, 6)), M('sand', () => std('#e8d7a2')));
      shelf.position.set(t.x, 0.02, t.y);
      shelf.receiveShadow = true;
      this.staticGroup.add(shelf);
    }
    for (const t of bd.tiles) {
      const hidden = !t.revealed;
      const res = hidden ? 'fog' : t.res;
      const hgt = hidden ? 0.22 : HEIGHT[t.res] || 0.24;
      const topMat = hidden ? M('fogtop', () => std('#6b7488')) : new THREE.MeshStandardMaterial({ color: TOP[t.res], roughness: 0.9, flatShading: true, emissive: '#fff3a0', emissiveIntensity: 0 });
      const m = new THREE.Mesh(hexGeo, [sideMat, topMat, sideMat]);
      if (!hidden) m.userData.ownMat = false;
      m.scale.y = hgt;
      m.position.set(t.x, hgt / 2 + 0.05, t.y);
      m.receiveShadow = true;
      m.castShadow = true;
      this.staticGroup.add(m);
      this.tileTops[t.id] = { mesh: m, top: hgt + 0.05, mat: topMat };
      const top = hgt + 0.05;
      this.decorate(t, res, top);
      // token
      if (!hidden && t.res !== 'desert') {
        const tok = new THREE.Mesh(G('token', () => new THREE.CylinderGeometry(0.3, 0.3, 0.06, 28)), [
          M('tokside', () => std('#d9c9a0')),
          new THREE.MeshStandardMaterial({ map: tokenTexture(t.num, !t.numRevealed), roughness: 0.7 }),
          M('tokside', () => std('#d9c9a0')),
        ]);
        tok.position.set(t.x, top + 0.04, t.y);
        tok.rotation.y = Math.PI / 2;
        tok.castShadow = true;
        this.staticGroup.add(tok);
      }
    }
    // ports: wooden pier + sign
    for (const p of bd.ports) {
      const E = bd.edges[p.edge];
      const g = new THREE.Group();
      for (const v of [E.a, E.b]) {
        const V = bd.vertices[v];
        const dx = p.x - V.x, dz = p.y - V.y;
        const len = Math.hypot(dx, dz);
        const plank = new THREE.Mesh(G('plank', () => new THREE.BoxGeometry(1, 0.05, 0.12)), M('wood', () => std('#9b6b3d')));
        plank.scale.x = len;
        plank.position.set((p.x + V.x) / 2, 0.14, (p.y + V.y) / 2);
        plank.rotation.y = -Math.atan2(dz, dx);
        plank.castShadow = true;
        g.add(plank);
      }
      const post = new THREE.Mesh(G('post', () => new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6)), M('wood', () => std('#9b6b3d')));
      post.position.set(p.x, 0.45, p.y);
      post.castShadow = true;
      g.add(post);
      const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(p.type === 'any' ? '3:1' : '2:1', p.type === 'any' ? '' : TILE_INFO[p.type].icon) }));
      sign.userData.ownMat = true;
      sign.scale.set(0.62, 0.62, 1);
      sign.position.set(p.x, 1.05, p.y);
      g.add(sign);
      this.staticGroup.add(g);
    }
  }

  decorate(t, res, top) {
    const rnd = prng(t.id * 31 + (res.charCodeAt(0) || 1));
    const g = new THREE.Group();
    g.position.set(t.x, top, t.y);
    const spot = (minR = 0.42, maxR = 0.78) => {
      const a = rnd() * Math.PI * 2, r = minR + rnd() * (maxR - minR);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const add = (mesh, x, y, z, s = 1, ry = 0) => {
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(s);
      mesh.rotation.y = ry;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    };
    switch (res) {
      case 'wood': {
        const n = 7 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const [x, z] = spot(0.38, 0.8);
          const s = 0.75 + rnd() * 0.5;
          add(new THREE.Mesh(G('trunk', () => new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5)), M('trunk', () => std('#6b4a2b'))), x, 0.07 * s, z, s);
          const cone = new THREE.Mesh(G('pine', () => new THREE.ConeGeometry(0.14, 0.42, 6)), M(rnd() > 0.5 ? 'pine' : 'pine2', () => std(rnd() > 0.5 ? '#2f6e33' : '#3a7f36')));
          add(cone, x, 0.32 * s, z, s, rnd() * 3);
        }
        break;
      }
      case 'ore': {
        const n = 3;
        for (let i = 0; i < n; i++) {
          const [x, z] = i === 0 ? [-0.1 + rnd() * 0.2, -0.45] : spot(0.45, 0.72);
          const s = i === 0 ? 1.25 : 0.7 + rnd() * 0.35;
          add(new THREE.Mesh(G('mount', () => new THREE.ConeGeometry(0.34, 0.7, 5)), M('rock', () => std('#7d828e'))), x, 0.35 * s, z, s, rnd() * 3);
          add(new THREE.Mesh(G('snow', () => new THREE.ConeGeometry(0.13, 0.22, 5)), M('snowm', () => std('#f4f7fb'))), x, 0.6 * s, z, s, rnd() * 3);
        }
        break;
      }
      case 'brick': {
        for (let i = 0; i < 3; i++) {
          const [x, z] = spot(0.45, 0.7);
          const hill = new THREE.Mesh(G('hill', () => new THREE.DodecahedronGeometry(0.26, 0)), M('clay', () => std('#a8552c')));
          add(hill, x, 0.02, z, 0.8 + rnd() * 0.4, rnd() * 3);
          hill.scale.y *= 0.55;
        }
        for (let i = 0; i < 4; i++) {
          const [x, z] = spot(0.4, 0.75);
          add(new THREE.Mesh(G('brick', () => new THREE.BoxGeometry(0.14, 0.07, 0.07)), M('brickm', () => std('#b5452a'))), x, 0.04, z, 1, rnd() * 3);
        }
        break;
      }
      case 'wheat': {
        for (let i = 0; i < 16; i++) {
          const [x, z] = spot(0.4, 0.8);
          add(new THREE.Mesh(G('stalk', () => new THREE.ConeGeometry(0.05, 0.22, 4)), M('wheatm', () => std('#d9a92a'))), x, 0.11, z, 0.9 + rnd() * 0.4, rnd() * 3);
        }
        const [x, z] = spot(0.55, 0.65);
        add(new THREE.Mesh(G('barn', () => new THREE.BoxGeometry(0.2, 0.16, 0.16)), M('barnm', () => std('#b0413e'))), x, 0.08, z, 1, rnd() * 3);
        break;
      }
      case 'sheep': {
        for (let i = 0; i < 4; i++) {
          const [x, z] = spot(0.42, 0.75);
          const sg = new THREE.Group();
          const body = new THREE.Mesh(G('sheepb', () => new THREE.IcosahedronGeometry(0.09, 0)), M('wool', () => std('#f7f7f2')));
          body.scale.set(1.3, 1, 1);
          body.position.y = 0.1;
          const head = new THREE.Mesh(G('sheeph', () => new THREE.BoxGeometry(0.06, 0.06, 0.06)), M('sheepface', () => std('#2c2c2c')));
          head.position.set(0.12, 0.13, 0);
          body.castShadow = head.castShadow = true;
          sg.add(body, head);
          sg.position.set(x, 0, z);
          sg.rotation.y = rnd() * 6;
          g.add(sg);
        }
        for (let i = 0; i < 3; i++) {
          const [x, z] = spot(0.5, 0.8);
          add(new THREE.Mesh(G('bush', () => new THREE.IcosahedronGeometry(0.08, 0)), M('bushm', () => std('#5c9e3f'))), x, 0.05, z, 1 + rnd() * 0.5);
        }
        break;
      }
      case 'desert': {
        for (let i = 0; i < 3; i++) {
          const [x, z] = spot(0.45, 0.75);
          add(new THREE.Mesh(G('cactus', () => new THREE.CylinderGeometry(0.045, 0.05, 0.3, 6)), M('cactusm', () => std('#4c8a3a'))), x, 0.15, z, 0.8 + rnd() * 0.5);
        }
        for (let i = 0; i < 2; i++) {
          const [x, z] = spot(0.3, 0.7);
          const dune = new THREE.Mesh(G('dune', () => new THREE.SphereGeometry(0.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)), M('dunem', () => std('#d9c07d')));
          add(dune, x, -0.02, z, 1);
          dune.scale.y = 0.35;
        }
        break;
      }
      case 'gold': {
        for (let i = 0; i < 6; i++) {
          const [x, z] = spot(0.4, 0.75);
          add(new THREE.Mesh(G('gem', () => new THREE.OctahedronGeometry(0.1, 0)), M('goldm', () => std('#ffcc33', { metalness: 0.8, roughness: 0.25, emissive: '#6b4a00', emissiveIntensity: 0.4 }))), x, 0.1, z, 0.8 + rnd() * 0.7, rnd() * 3);
        }
        break;
      }
      case 'fog': {
        for (let i = 0; i < 6; i++) {
          const [x, z] = i === 0 ? [0, 0] : spot(0.2, 0.6);
          const puff = new THREE.Mesh(G('puff', () => new THREE.IcosahedronGeometry(0.3, 1)), M('cloud', () => std('#e9edf5', { roughness: 1, transparent: true, opacity: 0.93 })));
          add(puff, x, 0.35 + rnd() * 0.15, z, 0.8 + rnd() * 0.6);
          puff.userData.y = puff.position.y;
          puff.userData.phase = rnd() * 6;
          this.clouds.push(puff);
        }
        break;
      }
    }
    this.staticGroup.add(g);
  }

  playerMat(color) {
    return M('p' + color, () => std(color, { roughness: 0.55 }));
  }

  buildDynamic(st, view) {
    const bd = st.board;
    this.clearGroup(this.dynGroup);
    this.pickables = [];
    this.pulse = [];
    this.inter = view.interaction || null;
    const pieces = new Set();
    const vy = v => {
      const V = bd.vertices[v];
      return Math.max(...V.hexes.map(h => this.tileTops[h].top)) + 0.02;
    };
    const spawn = (obj, key) => {
      pieces.add(key);
      if (this.prevPieces.size && !this.prevPieces.has(key)) this.spawns.push({ obj, y: obj.position.y, t0: performance.now() });
    };

    // rolled highlight
    for (const k in this.tileTops) this.tileTops[k].mat.emissiveIntensity = 0;
    this.rolledTiles = [];
    if (view.rolled) for (const t of bd.tiles) if (t.num === view.rolled && t.revealed && this.tileTops[t.id].mat.emissive) this.rolledTiles.push(this.tileTops[t.id].mesh.material[1] ? { material: this.tileTops[t.id].mat } : null);
    this.rolledTiles = this.rolledTiles.filter(Boolean);

    const road = (eid, color, ghost) => {
      const E = bd.edges[eid];
      const a = bd.vertices[E.a], b = bd.vertices[E.b];
      const m = new THREE.Mesh(G('road', () => new THREE.BoxGeometry(0.62, 0.09, 0.13)), ghost ? M('ghost' + color, () => std(color, { transparent: true, opacity: 0.55 })) : this.playerMat(color));
      m.position.set((a.x + b.x) / 2, Math.min(vy(E.a), vy(E.b)) + 0.05, (a.y + b.y) / 2);
      m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      m.castShadow = true;
      this.dynGroup.add(m);
      spawn(m, 'r' + eid + (ghost ? 'g' : ''));
    };
    for (const k in st.roads) road(+k, st.players[st.roads[k]].color);
    for (const b of view.blindOwn || []) if (b.eid != null) road(b.eid, st.players[b.pid].color, true);

    const building = (vid, owner, type, ghost) => {
      const V = bd.vertices[vid];
      const color = st.players[owner].color;
      const pm = ghost ? M('ghost' + color, () => std(color, { transparent: true, opacity: 0.55 })) : this.playerMat(color);
      const g = new THREE.Group();
      if (type === 'city') {
        const base = new THREE.Mesh(G('cityb', () => new THREE.BoxGeometry(0.34, 0.2, 0.24)), pm);
        base.position.y = 0.1;
        const tower = new THREE.Mesh(G('cityt', () => new THREE.BoxGeometry(0.15, 0.36, 0.15)), pm);
        tower.position.set(-0.08, 0.18, 0);
        const roof = new THREE.Mesh(G('cityr', () => new THREE.ConeGeometry(0.13, 0.16, 4)), M('roofd', () => std('#5b3a24')));
        roof.position.set(-0.08, 0.44, 0);
        roof.rotation.y = Math.PI / 4;
        g.add(base, tower, roof);
      } else {
        const body = new THREE.Mesh(G('house', () => new THREE.BoxGeometry(0.2, 0.15, 0.18)), pm);
        body.position.y = 0.075;
        const roof = new THREE.Mesh(G('houser', () => new THREE.ConeGeometry(0.17, 0.14, 4)), pm);
        roof.position.y = 0.22;
        roof.rotation.y = Math.PI / 4;
        g.add(body, roof);
      }
      g.traverse(o => (o.castShadow = true));
      g.position.set(V.x, vy(vid), V.y);
      g.rotation.y = (vid * 1.3) % 6;
      this.dynGroup.add(g);
      spawn(g, 'b' + vid + type + (ghost ? 'g' : ''));
    };
    for (const k in st.buildings) building(+k, st.buildings[k].owner, st.buildings[k].type);
    for (const b of view.blindOwn || []) building(b.vid, b.pid, b.type, true);

    // robber
    if (bd.robber >= 0 && !st.config.rules.noRobber && bd.tiles[bd.robber].revealed) {
      const t = bd.tiles[bd.robber];
      const g = new THREE.Group();
      const body = new THREE.Mesh(G('robb', () => new THREE.CylinderGeometry(0.1, 0.17, 0.42, 10)), M('robm', () => std('#2b2b33', { roughness: 0.5 })));
      body.position.y = 0.21;
      const head = new THREE.Mesh(G('robh', () => new THREE.SphereGeometry(0.1, 12, 8)), M('robm', () => std('#2b2b33')));
      head.position.y = 0.5;
      const band = new THREE.Mesh(G('robband', () => new THREE.TorusGeometry(0.1, 0.025, 6, 16)), M('robred', () => std('#e53935')));
      band.position.y = 0.52;
      band.rotation.x = Math.PI / 2;
      g.add(body, head, band);
      g.traverse(o => (o.castShadow = true));
      g.position.set(t.x - 0.42, this.tileTops[t.id].top, t.y + 0.05);
      this.dynGroup.add(g);
      spawn(g, 'robber' + bd.robber);
    }

    // interaction hotspots
    const inter = this.inter;
    if (inter) {
      const hot = M('hot' + inter.color, () => new THREE.MeshStandardMaterial({ color: inter.color, emissive: inter.color, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 }));
      if (inter.kind === 'settlement' || inter.kind === 'city') {
        for (const v of inter.legal) {
          const V = bd.vertices[v];
          const m = new THREE.Mesh(G('hotv', () => new THREE.SphereGeometry(0.11, 16, 10)), hot);
          m.position.set(V.x, vy(v) + (inter.kind === 'city' ? 0.55 : 0.12), V.y);
          m.userData = { id: v, phase: v };
          this.dynGroup.add(m);
          this.pulse.push(m);
          const hit = new THREE.Mesh(G('hitv', () => new THREE.SphereGeometry(0.3, 8, 6)), hitMat());
          hit.position.copy(m.position);
          hit.userData = { id: v, proxy: m };
          this.dynGroup.add(hit);
          this.pickables.push(hit);
        }
      } else if (inter.kind === 'road') {
        for (const e of inter.legal) {
          const E = bd.edges[e];
          const a = bd.vertices[E.a], b = bd.vertices[E.b];
          const m = new THREE.Mesh(G('hote', () => new THREE.BoxGeometry(0.5, 0.08, 0.16)), hot);
          m.position.set((a.x + b.x) / 2, Math.min(vy(E.a), vy(E.b)) + 0.08, (a.y + b.y) / 2);
          m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
          m.userData = { id: e, phase: e };
          this.dynGroup.add(m);
          this.pulse.push(m);
          const hit = new THREE.Mesh(G('hite', () => new THREE.BoxGeometry(0.62, 0.35, 0.34)), hitMat());
          hit.position.copy(m.position);
          hit.rotation.copy(m.rotation);
          hit.userData = { id: e, proxy: m };
          this.dynGroup.add(hit);
          this.pickables.push(hit);
        }
      } else if (inter.kind === 'robber') {
        for (const id of inter.legal) {
          const t = bd.tiles[id];
          const m = new THREE.Mesh(G('hott', () => new THREE.CylinderGeometry(0.9, 0.9, 0.04, 6)), new THREE.MeshBasicMaterial({ color: '#ff5a5a', transparent: true, opacity: 0.4, depthWrite: false }));
          m.userData = { id, phase: id, fade: true, ownMat: true };
          m.position.set(t.x, this.tileTops[id].top + 0.08, t.y);
          this.dynGroup.add(m);
          this.pickables.push(m);
          this.pulse.push(m);
        }
      }
    }
    this.prevPieces = pieces;
  }
}
