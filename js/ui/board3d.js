// 3D map renderer, Civilization VI inspired: one continuous heightfield island
// (mountains, hills, dunes, ploughed fields) that blends across hex borders, cliffs
// and beaches at the coast, a translucent sea, dense instanced props from the
// Blender kit (assets/models/kit.glb), warm light and tilt-shift. Tokens, port
// signs and click targets are crisp pixel-art CSS2D labels (the UI style).
// Same interface as BoardView: render(state, view), setZoom(), resetView(), dispose().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { pips } from '../engine/constants.js';
import { pixelToHex, hk } from '../engine/board.js';
import { pxIcon } from './pixel.js';

export const SETTINGS = { pixel: 1, tiltShift: true, quality: 'high' };
try {
  Object.assign(SETTINGS, JSON.parse(localStorage.getItem('kchudites.gfx') || '{}'));
} catch {}

const INR = Math.sqrt(3) / 2; // hex inradius
const NORMALS = [0, 1, 2].map(k => [Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)]);
const C = hex => new THREE.Color(hex);
const PAL = {
  wood: [C('#46703a'), C('#5a8544')], sheep: [C('#8fbd58'), C('#a7cc6c')], wheat: [C('#dcbd55'), C('#c49f3a')],
  brick: [C('#a8774b'), C('#b35a3c')], ore: [C('#7d8c66'), C('#8a857f')], desert: [C('#e2cd95'), C('#d4b87c')],
  gold: [C('#b8a46a'), C('#e2bf55')], back: [C('#8a6443'), C('#74523a')], unknown: [C('#697866'), C('#5f6d5d')],
};
const ROCK = C('#8b7f6d'), SNOW = C('#f1f3f6'), SAND = C('#e4d4a4'), SEABED = C('#c9b98c'), DEEP = C('#3f7485');

// ---------- noise ----------
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function prng(seed) {
  let s = (Math.abs(seed | 0) % 233280) + 1;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

// ---------- kit ----------
let kitPromise = null;
export function loadKit() {
  if (!kitPromise)
    kitPromise = new GLTFLoader().loadAsync(new URL('../../assets/models/kit.glb', import.meta.url).href).then(g => {
      const kit = {};
      for (const o of [...g.scene.children]) {
        o.position.set(0, 0, 0);
        o.updateMatrixWorld(true);
        o.traverse(m => {
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          (Array.isArray(m.material) ? m.material : [m.material]).forEach(fogPatch);
        });
        kit[o.name] = o;
      }
      return kit;
    });
  return kitPromise;
}

// ---------- fog of war, injected into every material ----------
const FOG = {
  uFogTex: { value: null },
  uFogRect: { value: new THREE.Vector4(-10, -10, 20, 20) },
  uFogOn: { value: 0 },
  uFogColor: { value: new THREE.Color('#0a0e1a') },
};
function fogPatch(mat) {
  if (mat.userData.fog) return mat;
  mat.userData.fog = true;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, FOG);
    sh.vertexShader = 'varying vec3 vFogW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
    sh.fragmentShader = 'varying vec3 vFogW;\nuniform sampler2D uFogTex;\nuniform vec4 uFogRect;\nuniform float uFogOn;\nuniform vec3 uFogColor;\n' +
      sh.fragmentShader.replace('#include <dithering_fragment>', `
  if (uFogOn > 0.5) {
    vec2 fuv = (vFogW.xz - uFogRect.xy) / uFogRect.zw;
    float vis = texture2D(uFogTex, vec2(fuv.x, 1.0 - fuv.y)).r;
    gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, 0.05 + 0.95 * vis);
  }
  #include <dithering_fragment>`);
  };
  mat.customProgramCacheKey = () => 'kfog';
  return mat;
}

const tintCache = new Map();
function tinted(src, colors) {
  const o = src.clone(true);
  o.traverse(m => {
    if (!m.isMesh) return;
    const swap = mt => {
      const c = colors[mt.name];
      if (!c) return mt;
      const key = mt.uuid + c;
      if (!tintCache.has(key)) {
        const n = mt.clone();
        n.color = new THREE.Color(c);
        n.userData.fog = false;
        fogPatch(n);
        tintCache.set(key, n);
      }
      return tintCache.get(key);
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
  });
  return o;
}

function css2d(cls, html, tag = 'div') {
  const el = document.createElement(tag);
  el.className = cls;
  if (html) el.innerHTML = html;
  return new CSS2DObject(el);
}

// ---------- terrain field ----------
function terrainOf(st, faceDown) {
  const tiles = st.board.tiles;
  const land = new Map(tiles.map(t => [hk(t.q, t.r), t]));
  const kindOf = t => (!t.revealed ? (faceDown ? 'back' : 'unknown') : t.res);
  const seedOf = t => t.id * 7 + (t.q * 131 + t.r * 71);

  // height of a terrain type at local offset (dx,dz) from its centre; e = distance to hex edge
  function featureH(kind, dx, dz, e, seed) {
    const fade = smooth(0.04, 0.32, e);
    const n = fbm(dx * 3 + seed, dz * 3 - seed);
    const bump = (cx, cz, r, h) => h * Math.exp(-((dx - cx) ** 2 + (dz - cz) ** 2) / (r * r));
    const rs = prng(seed);
    switch (kind) {
      case 'ore': {
        const a = rs() * 6.28;
        const peaks = bump(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.3, 1.05) + bump(Math.cos(a + 2.3) * 0.45, Math.sin(a + 2.3) * 0.45, 0.24, 0.7) + bump(Math.cos(a - 2.1) * 0.4, Math.sin(a - 2.1) * 0.4, 0.2, 0.5);
        const ridge = 1 - Math.abs(vnoise(dx * 6 + seed, dz * 6) * 2 - 1);
        return 0.32 + fade * (peaks * (0.8 + 0.35 * ridge) + n * 0.05);
      }
      case 'brick': {
        const a = rs() * 6.28;
        return 0.3 + fade * (bump(Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.3, 0.2) + bump(Math.cos(a + 2.5) * 0.45, Math.sin(a + 2.5) * 0.45, 0.25, 0.16) + n * 0.06);
      }
      case 'gold':
        return 0.3 + fade * (n * 0.12 + bump(0.3, -0.3, 0.25, 0.15));
      case 'wood':
        return 0.3 + fade * n * 0.07;
      case 'sheep':
        return 0.28 + fade * n * 0.09;
      case 'wheat':
        return 0.26 + fade * n * 0.02;
      case 'desert':
        return 0.27 + fade * (Math.sin(dx * 8 + dz * 3.5 + seed) * 0.035 + n * 0.05);
      default:
        return 0.3;
    }
  }

  function featureColor(kind, dx, dz, e, h, seed, out) {
    const [a, b] = PAL[kind] || PAL.unknown;
    const n = fbm(dx * 5 + seed * 0.37, dz * 5 + seed * 0.11);
    out.copy(a).lerp(b, n);
    if (kind === 'wheat') {
      const ang = (seed % 6) * 0.52;
      const stripe = Math.sin((dx * Math.cos(ang) + dz * Math.sin(ang)) * 30);
      out.lerp(stripe > 0 ? PAL.wheat[0] : PAL.wheat[1], 0.75 * smooth(0.06, 0.2, e));
      if (e < 0.1) out.lerp(PAL.sheep[0], 0.5);
    } else if (kind === 'brick') {
      out.lerp(PAL.brick[1], smooth(0.55, 0.75, n) * 0.8);
    } else if (kind === 'ore') {
      out.lerp(ROCK, smooth(0.45, 0.7, h));
      out.lerp(SNOW, smooth(0.95, 1.12, h));
    } else if (kind === 'back') {
      const plank = Math.floor((dx + 2) * 7) % 2;
      out.copy(PAL.back[plank]).multiplyScalar(0.9 + n * 0.2);
    }
    return out;
  }

  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  // returns height and (optionally) colour at world point
  function sample(x, z, col) {
    const [q, r] = pixelToHex(x, z);
    const t = land.get(hk(q, r));
    const cx = Math.sqrt(3) * (q + r / 2), cz = 1.5 * r;
    let dx = x - cx, dz = z - cz;
    // nearest edge + neighbour across it
    let best = 0, bk = 0, bs = 1;
    for (let k = 0; k < 3; k++) {
      const p = dx * NORMALS[k][0] + dz * NORMALS[k][1];
      if (Math.abs(p) > best) {
        best = Math.abs(p);
        bk = k;
        bs = Math.sign(p) || 1;
      }
    }
    const e = INR - best;
    const nx = cx + NORMALS[bk][0] * bs * 2 * INR, nz = cz + NORMALS[bk][1] * bs * 2 * INR;
    const [nq, nr] = pixelToHex(nx, nz);
    const nt = land.get(hk(nq, nr));
    if (!t) {
      // sea: slope down with the distance to the nearest land hex
      let dLand = 3;
      for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        const lt = land.get(hk(q + dq, r + dr));
        if (!lt) continue;
        const ldx = x - lt.x, ldz = z - lt.y;
        dLand = Math.min(dLand, Math.max(...NORMALS.map(n => Math.abs(ldx * n[0] + ldz * n[1]))) - INR);
      }
      const depth = smooth(0, 1.1, dLand);
      const h = -0.34 - 0.65 * depth;
      if (col) col.copy(SEABED).lerp(DEEP, depth);
      return h;
    }
    const kind = kindOf(t);
    let h = featureH(kind, dx, dz, e, seedOf(t));
    if (col) featureColor(kind, dx, dz, e, h, seedOf(t), col);
    const BL = 0.2;
    if (e < BL) {
      if (nt) {
        const w = 0.5 * (1 - e / BL);
        const nk = kindOf(nt);
        const ndx = x - nx, ndz = z - nz;
        const ne = INR - Math.max(...NORMALS.map(n => Math.abs(ndx * n[0] + ndz * n[1])));
        const h2 = featureH(nk, ndx, ndz, ne, seedOf(nt));
        h = h * (1 - w) + h2 * w;
        if (col) col.lerp(featureColor(nk, ndx, ndz, ne, h2, seedOf(nt), tmp2), w);
      } else {
        // coast: cliff down to the sea, with a sandy lip at the foot
        const c = smooth(0.16, 0.0, e);
        const cliffTop = h;
        h = cliffTop * (1 - c) + -0.34 * c;
        const jag = (vnoise(x * 9, z * 9) - 0.5) * 0.06 * c;
        h += jag;
        if (col) {
          col.lerp(ROCK, smooth(0.15, 0.6, c));
          col.lerp(SAND, smooth(0.75, 1, c));
        }
      }
    }
    return h;
  }
  return { sample, land, kindOf };
}

export class Board3D {
  static SETTINGS_TILT() { return SETTINGS.tiltShift; }
  static SETTINGS_PIXEL() { return SETTINGS.pixel; }
  static SETTINGS_Q() { return SETTINGS.quality; }
  static async create(container) {
    const kit = await loadKit();
    return new Board3D(container, kit);
  }

  constructor(container, kit) {
    this.container = container;
    this.kit = kit;
    this.zoom = 1;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, SETTINGS.quality === 'high' ? 2 : 1));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement;
    this.canvas.className = 'board-3d';
    container.append(this.canvas);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-3d';
    container.append(this.labels.domElement);
    window.__board3d = this;

    const scene = (this.scene = new THREE.Scene());
    const skyC = document.createElement('canvas');
    skyC.width = 4;
    skyC.height = 256;
    const sg = skyC.getContext('2d');
    const grad = sg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#7fb4cf');
    grad.addColorStop(0.55, '#c8dfe2');
    grad.addColorStop(1, '#efe9d6');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 4, 256);
    const skyTex = new THREE.CanvasTexture(skyC);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    scene.background = skyTex;
    scene.fog = new THREE.Fog('#d9e4df', 30, 75);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.3, 250);
    scene.add(new THREE.HemisphereLight('#f3f7ff', '#6b6152', 1.05));
    const sun = (this.sun = new THREE.DirectionalLight('#ffe8c2', 3.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(SETTINGS.quality === 'high' ? 4096 : 2048, SETTINGS.quality === 'high' ? 4096 : 2048);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    // sea: deep floor + translucent animated water
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), fogPatch(new THREE.MeshStandardMaterial({ color: '#2d6477', roughness: 1 })));
    floor.position.y = -1.1;
    scene.add(floor);
    const wg = new THREE.PlaneGeometry(160, 160, 90, 90).rotateX(-Math.PI / 2);
    this.waterBase = wg.attributes.position.array.slice();
    this.water = new THREE.Mesh(wg, fogPatch(new THREE.MeshStandardMaterial({ color: '#2f86a8', roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.7 })));
    this.water.receiveShadow = true;
    scene.add(this.water);

    this.staticGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    scene.add(this.staticGroup, this.dynGroup);
    this.staticKey = '';
    this.spawns = [];
    this.plates = [];
    this.bobbers = [];
    this.prevPieces = new Set();

    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.15, minPolarAngle: 0.3, minDistance: 4, maxDistance: 50, screenSpacePanning: false });

    this.composer = new EffectComposer(r);
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = 512;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    FOG.uFogTex.value = this.fogTex;
    this.setupPasses();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.clock = new THREE.Clock();
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  setupPasses() {
    const c = this.composer;
    c.passes.slice().forEach(p => c.removePass(p));
    const px = SETTINGS.pixel | 0;
    c.addPass(px > 1 ? new RenderPixelatedPass(px, this.scene, this.camera, { normalEdgeStrength: 0.25, depthEdgeStrength: 0.35 }) : new RenderPass(this.scene, this.camera));
    this.hts = this.vts = null;
    if (SETTINGS.tiltShift) {
      this.hts = new ShaderPass(HorizontalTiltShiftShader);
      this.vts = new ShaderPass(VerticalTiltShiftShader);
      c.addPass(this.hts);
      c.addPass(this.vts);
    }
    c.addPass(new OutputPass());
    this.resize();
  }

  setGraphics(opts) {
    Object.assign(SETTINGS, opts);
    try {
      localStorage.setItem('kchudites.gfx', JSON.stringify(SETTINGS));
    } catch {}
    this.setupPasses();
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.hts) {
      this.hts.uniforms.h.value = 2.6 / w;
      this.vts.uniforms.v.value = 2.6 / h;
      this.hts.uniforms.r.value = this.vts.uniforms.r.value = 0.55;
    }
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.labels.domElement.remove();
  }

  setZoom(z) {
    const nz = Math.max(0.5, Math.min(4, z));
    const dir = this.camera.position.clone().sub(this.controls.target).multiplyScalar(this.zoom / nz);
    this.zoom = nz;
    this.camera.position.copy(this.controls.target).add(dir);
  }

  resetView() {
    this.zoom = 1;
    this.frame();
  }

  frame() {
    const b = this.bounds;
    if (!b) return;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    const size = Math.max(b.maxX - b.minX, (b.maxY - b.minY) * 1.2);
    const d = size * 0.82 + 1.2;
    this.controls.target.set(cx, 0.2, cz + 0.4);
    this.camera.position.set(cx, d * 0.8, cz + d * 0.62);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - 10, 16, cz + 6);
    this.controls.update();
  }

  tick() {
    const t = this.clock.getElapsedTime();
    const pos = this.water.geometry.attributes.position;
    const a = pos.array, base = this.waterBase;
    for (let i = 0; i < a.length; i += 3) a[i + 1] = Math.sin(base[i] * 0.8 + t * 1.2) * 0.025 + Math.cos(base[i + 2] * 0.9 + t * 0.95) * 0.025;
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    if (this.foam) this.foam.material.opacity = 0.55 + Math.sin(t * 1.7) * 0.2;
    for (const b of this.bobbers) {
      b.obj.position.y = b.y + Math.sin(t * 1.4 + b.ph) * 0.025;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.05;
    }
    const now = performance.now();
    this.spawns = this.spawns.filter(sp => {
      const k = Math.min(1, (now - sp.t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      sp.obj.position.y = sp.y + (1 - e) * 1.2;
      sp.obj.scale.copy(sp.base).multiplyScalar(0.6 + e * 0.4);
      return k < 1;
    });
    this.plates = this.plates.filter(p => {
      const k = Math.max(0, Math.min(1, (now - p.t0) / 900));
      const e = k * k * (3 - 2 * k);
      p.obj.rotation.x = e * Math.PI;
      p.obj.position.y = p.y + Math.sin(e * Math.PI) * 1.2 + e * 0.5;
      p.obj.material.opacity = 1 - smooth(0.6, 1, k);
      if (k >= 1) {
        this.scene.remove(p.obj);
        return false;
      }
      return true;
    });
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // ---------- build ----------
  render(st, view = {}) {
    const bd = st.board;
    this.bounds = bd.bounds;
    const faceDown = !!view.faceDown;
    const key = bd.tiles.map(t => `${t.res}${t.num}${t.revealed ? 1 : 0}${t.numRevealed ? 1 : 0}`).join('|') + (faceDown ? 'F' : '') + bd.ports.length;
    if (key !== this.staticKey) {
      const first = !this.staticKey;
      this.staticKey = key;
      this.buildStatic(st, faceDown);
      if (first) this.frame();
    }
    if (view.flipAt && view.flipAt !== this.lastFlip) {
      this.lastFlip = view.flipAt;
      this.flipPlates(st);
    }
    this.markRolled(view.rolled);
    this.updateFog(st, view);
    this.buildDynamic(st, view);
  }

  heightAt(x, z) {
    return this.field ? this.field.sample(x, z) : 0.3;
  }

  buildStatic(st, faceDown) {
    const bd = st.board;
    for (const c of [...this.staticGroup.children]) {
      this.staticGroup.remove(c);
      c.traverse(o => {
        if (o.isCSS2DObject) o.element.remove();
        if (o.geometry && o.userData.own) o.geometry.dispose();
      });
    }
    this.bobbers = [];
    this.tokens = [];
    const field = (this.field = terrainOf(st, faceDown));
    const b = bd.bounds;
    const STEP = SETTINGS.quality === 'high' ? 0.05 : 0.08;
    const x0 = b.minX - 0.6, z0 = b.minY - 0.6;
    const nx = Math.ceil((b.maxX - b.minX + 1.2) / STEP) + 1, nz = Math.ceil((b.maxY - b.minY + 1.2) / STEP) + 1;
    const posArr = new Float32Array(nx * nz * 3), colArr = new Float32Array(nx * nz * 3), uvArr = new Float32Array(nx * nz * 2);
    const col = new THREE.Color();
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * STEP, z = z0 + j * STEP;
        const h = field.sample(x, z, col);
        const k = j * nx + i;
        posArr.set([x, h, z], k * 3);
        colArr.set([col.r, col.g, col.b], k * 3);
        uvArr.set([x * 0.7, z * 0.7], k * 2);
      }
    const idx = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, bq = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, bq, bq, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // steep slopes become rock (cliffs)
    const nrm = geo.attributes.normal.array;
    for (let k = 0; k < nx * nz; k++) {
      const steep = smooth(0.82, 0.55, nrm[k * 3 + 1]);
      if (steep > 0 && posArr[k * 3 + 1] > -0.25) {
        col.setRGB(colArr[k * 3], colArr[k * 3 + 1], colArr[k * 3 + 2]).lerp(ROCK, steep * 0.85);
        colArr.set([col.r, col.g, col.b], k * 3);
      }
    }
    const terrain = new THREE.Mesh(geo, fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: detailTexture() })));
    terrain.receiveShadow = terrain.castShadow = true;
    terrain.userData.own = true;
    this.staticGroup.add(terrain);

    // hex grid lines hugging the terrain (Civ style)
    const lines = [];
    for (const e of bd.edges) {
      const a = bd.vertices[e.a], c = bd.vertices[e.b];
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6;
        const xa = a.x + (c.x - a.x) * t0, za = a.y + (c.y - a.y) * t0, xb = a.x + (c.x - a.x) * t1, zb = a.y + (c.y - a.y) * t1;
        lines.push(xa, field.sample(xa, za) + 0.012, za, xb, field.sample(xb, zb) + 0.012, zb);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    const grid = new THREE.LineSegments(lg, fogPatch(new THREE.LineBasicMaterial({ color: '#1e2a1c', transparent: true, opacity: 0.28 })));
    grid.userData.own = true;
    this.staticGroup.add(grid);

    // foam along the coastline
    const foamPts = [];
    const foamIdx = [];
    for (const e of bd.edges) {
      if (e.hexes.length !== 1) continue;
      const t = bd.tiles[e.hexes[0]];
      const a = bd.vertices[e.a], c = bd.vertices[e.b];
      const mx = (a.x + c.x) / 2 - t.x, mz = (a.y + c.y) / 2 - t.y;
      const l = Math.hypot(mx, mz);
      const ox = (mx / l) * 0.09, oz = (mz / l) * 0.09;
      const base = foamPts.length / 3;
      foamPts.push(a.x - ox * 0.6, 0.02, a.y - oz * 0.6, c.x - ox * 0.6, 0.02, c.y - oz * 0.6, c.x + ox * 1.6, 0.02, c.y + oz * 1.6, a.x + ox * 1.6, 0.02, a.y + oz * 1.6);
      foamIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(foamPts, 3));
    fg.setIndex(foamIdx);
    fg.computeVertexNormals();
    this.foam = new THREE.Mesh(fg, fogPatch(new THREE.MeshStandardMaterial({ color: '#f6fbfa', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })));
    this.foam.userData.own = true;
    this.staticGroup.add(this.foam);

    this.placeProps(st, faceDown);

    // tokens + face-down runes (pixel UI labels)
    for (const t of bd.tiles) {
      const h = field.sample(t.x, t.y);
      if (!t.revealed) {
        if (faceDown) {
          const rune = css2d('rune3d', '✦');
          rune.position.set(t.x, h + 0.05, t.y);
          this.staticGroup.add(rune);
        }
        continue;
      }
      if (t.res === 'desert') continue;
      const red = t.numRevealed && (t.num === 6 || t.num === 8);
      const tok = css2d('tok3d' + (red ? ' red' : ''), t.numRevealed ? `<span>${t.num}</span><i>${'•'.repeat(pips(t.num))}</i>` : '<span>?</span>');
      tok.position.set(t.x, Math.max(h, 0.3) + 0.12, t.y);
      tok.userData.num = t.numRevealed ? t.num : null;
      this.tokens.push(tok);
      this.staticGroup.add(tok);
    }

    // ports: pier, boat and a pixel sign
    for (const p of bd.ports) {
      const E = bd.edges[p.edge];
      const a = bd.vertices[E.a], c = bd.vertices[E.b];
      const mx = (a.x + c.x) / 2, mz = (a.y + c.y) / 2;
      const dock = this.kit.dock.clone();
      dock.position.set(mx + p.nx * 0.25, 0.08, mz + p.ny * 0.25);
      dock.rotation.y = -Math.atan2(p.ny, p.nx);
      dock.scale.setScalar(1.2);
      const boat = this.kit.boat.clone();
      boat.position.set(p.x + p.ny * 0.3, 0.0, p.y - p.nx * 0.3);
      boat.rotation.y = -Math.atan2(p.ny, p.nx) + Math.PI / 2;
      boat.scale.setScalar(1.35);
      this.bobbers.push({ obj: boat, y: 0.0, ph: p.id * 1.7 });
      const sign = css2d('port3d', p.type === 'any' ? '<b>3:1</b>' : `${pxIcon(p.type, 16).outerHTML}<b>2:1</b>`);
      sign.position.set(p.x, 0.55, p.y);
      this.staticGroup.add(dock, boat, sign);
    }
  }

  // scatter instanced props (forests, sheep, fields...) using the terrain height
  placeProps(st, faceDown) {
    const kit = this.kit;
    const field = this.field;
    const bd = st.board;
    const inst = {};
    const put = (name, x, z, s = 1, ry = 0) => (inst[name] = inst[name] || []).push([x, field.sample(x, z) - 0.01, z, s, ry]);
    const cornerSafe = (x, z) => !bd.vertices.some(v => (v.x - x) ** 2 + (v.y - z) ** 2 < 0.05);
    for (const t of bd.tiles) {
      if (!t.revealed) continue;
      const rnd = prng(t.id * 977 + t.q * 31 + t.r * 17 + 5);
      const spots = (n, r0, r1, fn) => {
        let placed = 0;
        for (let tries = 0; placed < n && tries < n * 6; tries++) {
          const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0);
          const x = t.x + Math.cos(a) * r, z = t.y + Math.sin(a) * r;
          if (!cornerSafe(x, z)) continue;
          fn(x, z, placed++);
        }
      };
      switch (t.res) {
        case 'wood':
          spots(26, 0.24, 0.8, (x, z, i) => put(i % 3 ? 'pine' : 'oak', x, z, 0.8 + rnd() * 0.5, rnd() * 6.3));
          spots(1, 0.5, 0.6, (x, z) => put('lumber', x, z, 1.1, rnd() * 6.3));
          break;
        case 'sheep':
          spots(5, 0.3, 0.72, (x, z) => put('sheep', x, z, 1.15, rnd() * 6.3));
          spots(3, 0.45, 0.8, (x, z) => put('bush', x, z, 1 + rnd() * 0.5, rnd() * 6.3));
          spots(2, 0.5, 0.7, (x, z) => put('oak', x, z, 0.9, rnd() * 6.3));
          spots(2, 0.55, 0.7, (x, z) => put('fence', x, z, 1.2, rnd() * 6.3));
          break;
        case 'wheat':
          spots(1, 0.45, 0.55, (x, z) => put('windmill', x, z, 1.35, rnd() * 6.3));
          spots(4, 0.35, 0.75, (x, z) => put(rnd() > 0.5 ? 'hay' : 'sheaf', x, z, 1, rnd() * 6.3));
          break;
        case 'brick':
          spots(1, 0.45, 0.6, (x, z) => put('kiln', x, z, 1.3, rnd() * 6.3));
          spots(3, 0.4, 0.8, (x, z) => put('rock', x, z, 0.9 + rnd() * 0.6, rnd() * 6.3));
          spots(4, 0.4, 0.8, (x, z) => put('bush', x, z, 0.9, rnd() * 6.3));
          break;
        case 'ore':
          spots(1, 0.35, 0.5, (x, z) => put('mine', x, z, 1.3, rnd() * 6.3));
          spots(4, 0.35, 0.8, (x, z) => put('rock', x, z, 1 + rnd() * 0.8, rnd() * 6.3));
          spots(4, 0.55, 0.8, (x, z) => put('pine', x, z, 0.7, rnd() * 6.3));
          break;
        case 'desert':
          spots(5, 0.3, 0.8, (x, z) => put('cactus', x, z, 1 + rnd() * 0.6, rnd() * 6.3));
          spots(3, 0.3, 0.8, (x, z) => put('rock', x, z, 0.8 + rnd() * 0.6, rnd() * 6.3));
          break;
        case 'gold':
          spots(6, 0.3, 0.75, (x, z) => put('crystal', x, z, 1.2 + rnd() * 0.8, rnd() * 6.3));
          break;
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const [name, list] of Object.entries(inst)) {
      const proto = kit[name];
      if (!proto) continue;
      proto.updateMatrixWorld(true);
      proto.traverse(child => {
        if (!child.isMesh) return;
        const im = new THREE.InstancedMesh(child.geometry, child.material, list.length);
        im.castShadow = im.receiveShadow = true;
        list.forEach(([x, y, z, s, ry], i) => {
          m4.compose(pv.set(x, y, z), q.setFromAxisAngle(up, ry), sv.set(s, s, s)).multiply(child.matrixWorld);
          im.setMatrixAt(i, m4);
        });
        im.instanceMatrix.needsUpdate = true;
        this.staticGroup.add(im);
      });
    }
  }

  flipPlates(st) {
    const bd = st.board;
    const cx = (bd.bounds.minX + bd.bounds.maxX) / 2, cz = (bd.bounds.minY + bd.bounds.maxY) / 2;
    const geo = new THREE.CylinderGeometry(0.98, 0.98, 0.06, 6);
    const now = performance.now();
    for (const t of bd.tiles) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a6443', roughness: 0.8, transparent: true }));
      m.position.set(t.x, 1.6, t.y);
      m.castShadow = true;
      this.scene.add(m);
      this.plates.push({ obj: m, y: 1.6, t0: now + Math.hypot(t.x - cx, t.y - cz) * 130 });
    }
  }

  markRolled(num) {
    for (const tk of this.tokens || []) tk.element.classList.toggle('rolled', num != null && tk.userData.num === num);
  }

  updateFog(st, view) {
    const vis = view.vision;
    FOG.uFogOn.value = vis ? 1 : 0;
    if (this.foam) this.foam.visible = !vis;
    if (!vis) return;
    const b = st.board.bounds;
    const pad = 8;
    const rect = { x: b.minX - pad, z: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };
    FOG.uFogRect.value.set(rect.x, rect.z, rect.w, rect.h);
    const c = this.fogCanvas, g = c.getContext('2d');
    const sx = c.width / rect.w, sz = c.height / rect.h;
    g.filter = 'none';
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    g.filter = `blur(${Math.max(2, Math.round(sx * 0.16))}px)`;
    g.fillStyle = g.strokeStyle = '#fff';
    g.lineCap = 'round';
    for (const [x, y, r] of vis.circles) {
      g.beginPath();
      g.arc((x - rect.x) * sx, (y - rect.z) * sz, r * sx, 0, Math.PI * 2);
      g.fill();
    }
    for (const [x1, y1, x2, y2, r] of vis.caps) {
      g.lineWidth = r * 2 * sx;
      g.beginPath();
      g.moveTo((x1 - rect.x) * sx, (y1 - rect.z) * sz);
      g.lineTo((x2 - rect.x) * sx, (y2 - rect.z) * sz);
      g.stroke();
    }
    g.filter = 'none';
    this.fogTex.needsUpdate = true;
    // labels in the dark are hidden too
    const lit = (x, z) => {
      const px = Math.floor((x - rect.x) * sx), pz = Math.floor((z - rect.z) * sz);
      return g.getImageData(Math.max(0, Math.min(511, px)), Math.max(0, Math.min(511, pz)), 1, 1).data[0] > 90;
    };
    this.staticGroup.traverse(o => {
      if (o.isCSS2DObject) o.visible = lit(o.position.x, o.position.z);
    });
  }

  buildDynamic(st, view) {
    const bd = st.board;
    const kit = this.kit;
    for (const c of [...this.dynGroup.children]) {
      this.dynGroup.remove(c);
      c.traverse(o => o.isCSS2DObject && o.element.remove());
    }
    const pieces = new Set();
    const vy = v => Math.max(this.heightAt(bd.vertices[v].x, bd.vertices[v].y), 0.05);
    const add = (obj, key, s) => {
      this.dynGroup.add(obj);
      pieces.add(key);
      if (this.prevPieces.size && !this.prevPieces.has(key)) this.spawns.push({ obj, y: obj.position.y, base: obj.scale.clone(), t0: performance.now() });
    };
    const ghostify = o => o.traverse(m => {
      if (m.isMesh) {
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.opacity = 0.5;
      }
    });
    const road = (eid, color, ghost) => {
      const E = bd.edges[eid], a = bd.vertices[E.a], b = bd.vertices[E.b];
      const o = tinted(kit.road, { Player: color });
      const ya = vy(E.a), yb = vy(E.b);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      o.position.set((a.x + b.x) / 2, (ya + yb) / 2 + 0.01, (a.y + b.y) / 2);
      o.rotation.order = 'YZX';
      o.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
      o.rotation.z = Math.atan2(yb - ya, len);
      if (ghost) ghostify(o);
      o.scale.set(1.08, 2.2, 2.1);
      add(o, 'r' + eid + (ghost ? 'g' : ''), 1);
    };
    for (const k in st.roads) road(+k, st.players[st.roads[k]].color);
    for (const b of view.blindOwn || []) if (b.eid != null) road(b.eid, st.players[b.pid].color, true);
    const building = (vid, owner, type, ghost) => {
      const V = bd.vertices[vid];
      const o = tinted(type === 'city' ? kit.city : kit.house, { Player: st.players[owner].color });
      o.position.set(V.x, vy(vid) - 0.01, V.y);
      o.rotation.y = ((vid * 2.39996) % 6.28) * 0.4;
      if (ghost) ghostify(o);
      const s = type === 'city' ? 1.25 : 1.45;
      o.scale.setScalar(s);
      add(o, 'b' + vid + type + (ghost ? 'g' : ''), s);
    };
    for (const k in st.buildings) building(+k, st.buildings[k].owner, st.buildings[k].type);
    for (const b of view.blindOwn || []) building(b.vid, b.pid, b.type, true);

    if (bd.robber >= 0 && !st.config.rules.noRobber && bd.tiles[bd.robber].revealed && !bd.robberHidden) {
      const t = bd.tiles[bd.robber];
      const o = kit.robber.clone();
      const x = t.x - 0.3, z = t.y + 0.22;
      o.position.set(x, Math.max(this.heightAt(x, z), 0.1), z);
      o.scale.setScalar(1.3);
      add(o, 'robber' + t.id, 1.3);
    }

    const inter = view.interaction;
    if (inter) {
      const mk = (id, x, y, z, cls) => {
        const el = document.createElement('button');
        el.className = 'hot3d ' + cls;
        el.style.setProperty('--pc', inter.color || '#fff');
        el.addEventListener('pointerdown', e => e.stopPropagation());
        el.addEventListener('click', e => {
          e.stopPropagation();
          inter.onPick(id);
        });
        const o = new CSS2DObject(el);
        o.position.set(x, y, z);
        this.dynGroup.add(o);
      };
      if (inter.kind === 'settlement' || inter.kind === 'city')
        for (const v of inter.legal) {
          const V = bd.vertices[v];
          mk(v, V.x, vy(v) + (inter.kind === 'city' ? 0.45 : 0.08), V.y, 'v');
        }
      else if (inter.kind === 'road')
        for (const e of inter.legal) {
          const E = bd.edges[e], a = bd.vertices[E.a], b = bd.vertices[E.b];
          mk(e, (a.x + b.x) / 2, (vy(E.a) + vy(E.b)) / 2 + 0.06, (a.y + b.y) / 2, 'e');
        }
      else if (inter.kind === 'robber')
        for (const id of inter.legal) {
          const t = bd.tiles[id];
          mk(id, t.x + 0.3, Math.max(this.heightAt(t.x, t.y), 0.3) + 0.3, t.y - 0.25, 't');
        }
    }
    this.prevPieces = pieces;
  }
}

let detailTex = null;
// painterly grayscale detail multiplied over the vertex colours
function detailTexture() {
  if (detailTex) return detailTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      // tileable fbm: sample on a torus
      const a = (x / 256) * Math.PI * 2, b = (y / 256) * Math.PI * 2;
      const n = fbm(Math.cos(a) * 3 + 10, Math.sin(a) * 3 + Math.cos(b) * 3) * 0.6 + fbm(Math.sin(b) * 6 + 3, Math.cos(a) * 6) * 0.4;
      const v = 205 + (n - 0.5) * 90;
      const i = (y * 256 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  detailTex = new THREE.CanvasTexture(c);
  detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
  detailTex.colorSpace = THREE.SRGBColorSpace;
  return detailTex;
}
