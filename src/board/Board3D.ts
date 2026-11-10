// 3D map renderer: "realistic tabletop miniature". This file only orchestrates; the pieces live in
// terrain / water / props / grass / ports / labels / pieces / effects / camera / fog (see src/board).
// One continuous heightfield island textured by splatting 8 PBR-ish layers, lit by a physical sky
// (IBL), with a depth-aware sea, instanced Blender props, wind-swept grass, drifting cloud shadows,
// GTAO and tilt-shift. Tokens, port signs and click targets are crisp pixel-art CSS2D labels.
// Same interface as BoardView (see BoardRenderer): render(state, view), setZoom(), resetView(), dispose().
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, type CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import type { BoardRenderer } from './BoardRenderer';
import { loadKit, loadTextures, goldGlow, type Kit, type Textures } from './assets';
import { FOV, frame, framing, lens, pickGround, resetView, scaleTokens, setTopView, setZoom, toScreen, updateCamAnim } from './camera';
import { Dice3D } from './dice3d';
import { disposeChildren, disposeTree } from './dispose';
import { dropPing, float, flipPlates, ping, playerPoints, rollDice, shake, tilePoint, updateFloaters, updatePings, updatePlates, type Floater, type Ping, type Plate } from './effects';
import { updateFog } from './fog';
import { buildTokens, tokenKey } from './labels';
import { placeGrass } from './grass';
import { buildDynamic } from './pieces';
import { buildPorts } from './ports';
import { placeProps } from './props';
import { saveSettings, SETTINGS, type Settings } from './settings';
import { LAYER_GRASS, LAYER_PIECES, OutlineShader, patch, pieceColorMat, tiltShader, U } from './shaders';
import { buildHexGrid, buildTerrainMesh, smooth, terrainKey, terrainOf, type TerrainField } from './terrain';
import { buildWater } from './water';
import type { BState, BoardViewState, BBounds, Interaction } from './types';

declare global {
  interface Window {
    __board3d?: Board3D;
  }
}

export { SETTINGS };
export { TILE_LOOKS, LOOK_OVERRIDE } from './terrain';

export class Board3D implements BoardRenderer {
  // ---- state shared with the helper modules
  container: HTMLElement;
  kit: Kit;
  tex: Textures;
  zoom = 1;
  renderer: THREE.WebGLRenderer;
  maxPR: number;
  perf: { t: number; n: number; sum: number; good: number; last?: number; cap?: number };
  shadowDirty = true;
  canvas: HTMLCanvasElement;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  sunDir: THREE.Vector3;
  envRT: THREE.WebGLRenderTarget;
  camera: THREE.PerspectiveCamera;
  maskVis: THREE.WebGLRenderTarget;
  maskAll: THREE.WebGLRenderTarget;
  depthOnly: THREE.MeshBasicMaterial;
  visMat: THREE.ShaderMaterial;
  allMat: THREE.ShaderMaterial;
  hasPieces = false;
  sun: THREE.DirectionalLight;
  staticGroup: THREE.Group;
  dynGroup: THREE.Group;
  tokenGroup: THREE.Group | null = null;
  staticKey = ''; // terrain key; setting it to '' forces a full static rebuild
  tokenKey = ''; // numbers key; a change rebuilds only the number labels
  dynKey: string | undefined;
  spawns: { obj: THREE.Object3D; y: number; base: THREE.Vector3; t0: number }[] = [];
  plates: Plate[] = [];
  bobbers: { obj: THREE.Object3D; y: number; ph: number }[] = [];
  prevPieces = new Set<string>();
  floaters: Floater[] = [];
  pings: Ping[] | undefined;
  pingGeo: Record<string, THREE.BufferGeometry> | undefined;
  controls: OrbitControls;
  composer: EffectComposer;
  fogCanvas: HTMLCanvasElement;
  fogTex: THREE.CanvasTexture;
  fogKey = ''; // vision the fog canvas currently shows
  fogLabelKey = ''; // vision + label generation the label visibility was computed for
  labelRev = 0; // bumped whenever CSS2D labels are recreated
  resizeObs: ResizeObserver;
  forgetRect: () => void;
  canvasRect: DOMRect | null = null;
  clock: THREE.Clock;
  now: () => number;
  alive: boolean;
  raf = 0;
  aoPass: GTAOPass | null = null;
  hts: ShaderPass | null = null;
  vts: ShaderPass | null = null;
  outlinePass: ShaderPass | null = null;
  viewH = 600;
  masksStale = true;
  labelsDirty = true;
  masksDirty = false;
  top = false;
  beforeTop: { target: THREE.Vector3; pos: THREE.Vector3; fov: number; zoom: number } | undefined;
  camAnim: { from: { target: THREE.Vector3; pos: THREE.Vector3; fov: number }; to: { target: THREE.Vector3; pos: THREE.Vector3; fov: number }; t0: number } | null = null;
  tk: number | undefined;
  diceFx: Dice3D | undefined;
  onPing: ((x: number, z: number) => void) | undefined;
  lastSt: BState | undefined;
  bounds: BBounds | undefined;
  field: TerrainField | undefined;
  water: THREE.Mesh | undefined;
  tokens: CSS2DObject[] = [];
  robberTile: { x: number; y: number } | null = null;
  inter: Interaction | null | undefined;
  lastFlip: number | undefined;
  rolledAt: number | undefined;
  viewSig: Float64Array | undefined;
  viewCur: Float64Array | undefined;
  /** resolves once the first build and the shader compile are done (see render) */
  floor: THREE.Mesh;
  ready: Promise<void>;
  private markReady!: () => void;

  static SETTINGS_TILT(): boolean { return SETTINGS.tiltShift; }
  static SETTINGS_PIXEL() { return SETTINGS.pixel; }
  static SETTINGS_Q() { return SETTINGS.quality; }
  static SETTINGS_AO() { return SETTINGS.ao; }
  static SETTINGS_OUTLINE() { return SETTINGS.outline; }

  static async create(container: HTMLElement): Promise<Board3D> {
    const [kit, tex] = await Promise.all([loadKit(), loadTextures()]);
    return new Board3D(container, kit, tex);
  }

  constructor(container: HTMLElement, kit: Kit, tex: Textures) {
    this.ready = new Promise<void>(res => (this.markReady = res));
    this.container = container;
    this.kit = kit;
    this.tex = tex;
    this.zoom = 1;
    const hi = SETTINGS.quality === 'high';
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    // sharp on retina screens; the frame-time watcher in tick() lowers it when the GPU can't keep up
    this.maxPR = Math.min(window.devicePixelRatio || 1, hi ? 2 : 1.5);
    r.setPixelRatio(this.maxPR);
    this.perf = { t: 0, n: 0, sum: 0, good: 0 };
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    // the scene barely moves: shadows are redrawn only when something changes (see tick)
    r.shadowMap.autoUpdate = false;
    this.shadowDirty = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.canvas = r.domElement;
    this.canvas.className = 'board-3d';
    container.append(this.canvas);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-3d';
    container.append(this.labels.domElement);
    window.__board3d = this;

    const scene = (this.scene = new THREE.Scene());
    // physical sky + image based lighting from it
    const sky = new Sky();
    sky.scale.setScalar(450);
    const su = sky.material.uniforms;
    su.turbidity!.value = 5.5;
    su.rayleigh!.value = 1.3;
    su.mieCoefficient!.value = 0.004;
    su.mieDirectionalG!.value = 0.82;
    const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 34), THREE.MathUtils.degToRad(-125));
    su.sunPosition!.value.copy(sunDir);
    this.sunDir = sunDir;
    scene.add(sky);
    const pm = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.envRT = pm.fromScene(envScene, 0.02);
    scene.environment = this.envRT.texture;
    scene.environmentIntensity = 0.55;
    pm.dispose();
    scene.fog = new THREE.Fog('#bfd3db', 34, 95);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 600);
    this.camera.layers.enable(LAYER_PIECES);
    this.camera.layers.enable(LAYER_GRASS);
    const rtOpts = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.maskVis = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true });
    this.maskAll = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: false });
    this.depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.visMat = pieceColorMat(false);
    this.allMat = pieceColorMat(true);
    this.hasPieces = false;
    scene.add(new THREE.HemisphereLight('#e9f2ff', '#5b5243', 0.35));
    const sun = (this.sun = new THREE.DirectionalLight('#fff0d8', 3.4));
    sun.castShadow = true;
    const sm = hi ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 90 });
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2.5;
    scene.add(sun, sun.target);

    const floor = (this.floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), patch(new THREE.MeshStandardMaterial({ color: '#1d4f63', roughness: 1 }), { key: 'floor' })));
    floor.position.y = -1.25;
    scene.add(floor);

    this.staticGroup = new THREE.Group();
    this.dynGroup = new THREE.Group();
    scene.add(this.staticGroup, this.dynGroup);
    this.staticKey = '';
    this.spawns = [];
    this.plates = [];
    this.bobbers = [];
    this.prevPieces = new Set();
    this.floaters = [];

    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.15, minPolarAngle: 0.3, minDistance: 3, maxDistance: 50, screenSpacePanning: false });
    // middle button = drop a 1 s marker there (zoom stays on the wheel)
    this.controls.mouseButtons.MIDDLE = -1 as unknown as THREE.MOUSE;
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 1) return;
      e.preventDefault();
      const p = this.pickGround(e.clientX, e.clientY);
      if (p && this.onPing) this.onPing(p.x, p.z);
    });
    this.canvas.addEventListener('mousedown', e => e.button === 1 && e.preventDefault()); // no autoscroll

    // the composer draws into its own target, so the canvas' antialias never applied: MSAA there,
    // but only on 1x screens (on retina the resolution is already enough and MSAA nearly halved the fps)
    const samples = this.maxPR <= 1 ? (hi ? 4 : 2) : 0;
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples }));
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = 512;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    U.uFogTex.value = this.fogTex;
    this.setupPasses();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.forgetRect = () => (this.canvasRect = null);
    addEventListener('scroll', this.forgetRect, true);
    addEventListener('resize', this.forgetRect);
    this.clock = new THREE.Clock();
    this.now = () => performance.now(); // overridable time source (frame-by-frame recording)
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
    this.aoPass = null;
    const px = SETTINGS.pixel | 0;
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    if (px > 1) c.addPass(new RenderPixelatedPass(px, this.scene, this.camera, { normalEdgeStrength: 0.25, depthEdgeStrength: 0.35 }));
    else {
      c.addPass(new RenderPass(this.scene, this.camera));
      if (SETTINGS.ao && SETTINGS.quality === 'high') {
        const ao = new GTAOPass(this.scene, this.camera, w, h);
        ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.2, samples: 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
        ao.blendIntensity = 0.9;
        c.addPass(ao);
        this.aoPass = ao;
      }
    }
    this.hts = this.vts = null;
    if (SETTINGS.tiltShift) {
      this.hts = new ShaderPass(tiltShader('1.0, 0.0'));
      this.vts = new ShaderPass(tiltShader('0.0, 1.0'));
      this.hts.uniforms.tMask!.value = this.vts!.uniforms.tMask!.value = this.maskVis.texture;
      c.addPass(this.hts);
      c.addPass(this.vts);
      this.hts.enabled = this.vts!.enabled = !this.top;
    }
    c.addPass(new OutputPass());
    this.outlinePass = null;
    if (SETTINGS.outline) {
      this.outlinePass = new ShaderPass(OutlineShader);
      this.outlinePass.uniforms.tVis!.value = this.maskVis.texture;
      this.outlinePass.uniforms.tAll!.value = this.maskAll.texture;
      c.addPass(this.outlinePass);
    }
    const vig = new ShaderPass(VignetteShader);
    vig.uniforms.offset!.value = 0.95;
    vig.uniforms.darkness!.value = 1.05;
    c.addPass(vig);
    this.resize();
  }

  // the frame-time watcher moves the resolution between maxPR and 1
  applyPixelRatio(pr: number) {
    if (Math.abs(pr - this.renderer.getPixelRatio()) < 0.01) return;
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  // every ~1.5 s: slow frames drop the resolution a step, a long run of fast ones climbs back
  watchPerf(now: number) {
    const p = this.perf;
    if (p.last != null && !document.hidden) {
      const dt = now - p.last;
      if (dt < 250) (p.sum += dt), p.n++; // ignore pauses (tab switch, modal)
    }
    p.last = now;
    if (!p.t) p.t = now;
    if (now - p.t < 1500 || p.n < 20) return;
    const avg = p.sum / p.n;
    p.t = now;
    p.sum = p.n = 0;
    const pr = this.renderer.getPixelRatio();
    if (p.cap == null) p.cap = this.maxPR;
    if (avg > 22 && this.aoPass && this.aoPass.enabled) {
      // too slow: first drop the ambient occlusion (for this session only), it is the priciest pass
      p.good = 0;
      this.aoPass.enabled = false;
    } else if (avg > 22 && pr > 1) {
      // still too slow: one resolution step down, and never climb back to the level that failed
      p.good = 0;
      p.cap = pr - 0.25;
      this.applyPixelRatio(Math.max(1, pr >= 1.75 ? 1.5 : pr - 0.25));
    } else if (avg < 18 && pr + 0.25 <= p.cap + 0.01) {
      if (++p.good >= 4) {
        p.good = 0;
        this.applyPixelRatio(Math.min(p.cap, pr + 0.25));
      }
    } else p.good = 0;
  }

  setGraphics(opts: Partial<Settings>) {
    Object.assign(SETTINGS, opts, { v: 2 });
    saveSettings();
    this.setupPasses();
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.viewH = h;
    this.canvasRect = null; // re-measured on the next toScreen()
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    const mw = Math.round(w * pr), mh = Math.round(h * pr);
    this.maskVis.setSize(mw, mh);
    this.maskAll.setSize(mw, mh);
    if (this.outlinePass) this.outlinePass.uniforms.uTexel!.value.set(pr / mw, pr / mh); // ~1-2 css px
    if (this.hts) {
      this.hts.uniforms.h!.value = 2.4 / w;
      this.vts!.uniforms.h!.value = 2.4 / h;
      this.hts.uniforms.r!.value = this.vts!.uniforms.r!.value = 0.55;
    }
  }

  // masks of the player pieces (see OutlineShader / tiltShader)
  // `fresh` = the camera, the pieces or the size changed since the last masks; otherwise they still hold
  renderMasks(fresh: boolean) {
    const r = this.renderer, cam = this.camera, sc = this.scene;
    const need = !!(this.hasPieces && (this.hts || this.outlinePass));
    if (!need && !this.masksDirty) return;
    if (need && !fresh && this.masksDirty) return;
    const prevAuto = r.autoClear, prevShadow = r.shadowMap.autoUpdate, prevMask = cam.layers.mask;
    const prevClear = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.maskVis);
    r.clear();
    if (need) {
      cam.layers.set(0); // landscape depth only, so hidden pieces fail the depth test
      sc.overrideMaterial = this.depthOnly;
      r.render(sc, cam);
      cam.layers.set(LAYER_PIECES);
      sc.overrideMaterial = this.visMat;
      r.render(sc, cam);
    }
    r.setRenderTarget(this.maskAll);
    r.clear();
    if (need && this.outlinePass) {
      sc.overrideMaterial = this.allMat;
      r.render(sc, cam);
    }
    sc.overrideMaterial = null;
    cam.layers.mask = prevMask;
    r.setRenderTarget(null);
    r.setClearColor(prevClear, prevAlpha);
    r.autoClear = prevAuto;
    r.shadowMap.autoUpdate = prevShadow;
    this.masksDirty = need;
  }

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    removeEventListener('scroll', this.forgetRect, true);
    removeEventListener('resize', this.forgetRect);
    this.controls.dispose();
    this.composer.dispose();
    this.maskVis.dispose();
    this.maskAll.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.labels.domElement.remove();
    if (this.diceFx) this.diceFx.dispose();
    for (const pg of this.pings || []) dropPing(this, pg);
    if (this.pingGeo) for (const k in this.pingGeo) this.pingGeo[k]!.dispose();
    U.uRobber.value.set(0, 0, 0);
    for (const f of this.floaters) f.el.remove();
    this.floaters = [];
    // free what this board built: static/dynamic meshes (shared caches are left alone), plates, floor
    for (const p of this.plates) {
      this.scene.remove(p.obj);
      (p.obj.material as THREE.Material).dispose();
    }
    this.plates = [];
    disposeChildren(this.staticGroup);
    disposeChildren(this.dynGroup);
    disposeTree(this.floor);
    this.markReady();
  }

  /** Dev check: GPU resource counts (geometries/textures should not grow on rebuilds). */
  memInfo() {
    const r = this.renderer.info;
    const info = { geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs ? r.programs.length : 0, calls: r.render.calls, triangles: r.render.triangles };
    console.log('[board3d] renderer.info', info);
    return info;
  }

  tick() {
    const t = this.clock.getElapsedTime();
    U.uTime.value = t;
    for (const b of this.bobbers) {
      b.obj.position.y = b.y + Math.sin(t * 1.4 + b.ph) * 0.025;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.05;
    }
    const now = this.now();
    this.spawns = this.spawns.filter(sp => {
      const k = Math.min(1, (now - sp.t0) / 450);
      const e = 1 - Math.pow(1 - k, 3);
      sp.obj.position.y = sp.y + (1 - e) * 1.2;
      sp.obj.scale.copy(sp.base).multiplyScalar(0.6 + e * 0.4);
      return k < 1;
    });
    updatePlates(this, now);
    if (this.diceFx) this.diceFx.update(now);
    updatePings(this, now);
    // the robber's red stain fades in on its new tile
    const rt = this.robberTile, ru = U.uRobber.value;
    if (rt && (rt.x !== ru.x || rt.y !== ru.y)) ru.set(rt.x, rt.y, 0);
    ru.z += ((rt ? 1 : 0) - ru.z) * 0.06;
    if (goldGlow.size) {
      const shine = 0.22 + 0.4 * Math.max(0, Math.sin(t * 2.4)) ** 3;
      for (const m of goldGlow) m.emissiveIntensity = shine;
    }
    updateCamAnim(this, now);
    this.controls.update();
    scaleTokens(this);
    updateFloaters(this, now);
    this.watchPerf(now);
    if (this.compiling) return;
    const moved = this.viewChanged();
    const dicing = !!(this.diceFx && this.diceFx.throw);
    this.renderMasks(moved || this.masksStale || this.spawns.length > 0 || dicing);
    this.masksStale = false;
    // shadows only when something that casts them moved (set after the masks so they don't use it up)
    if (this.shadowDirty || this.spawns.length || this.plates.length || (this.pings && this.pings.length) || dicing) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.composer.render();
    // the labels only move with the camera: re-placing ~100 of them every frame cost a style recalc
    if (moved || this.labelsDirty) {
      this.labelsDirty = false;
      this.labels.render(this.scene, this.camera);
      // snap the pixel labels to whole pixels: sub-pixel positions blur the pixel font
      for (const el of this.labels.domElement.children as HTMLCollectionOf<HTMLElement>) {
        const t = el.style.transform;
        if (t && t.indexOf('.') >= 0) el.style.transform = t.replace(/(-?\d+\.\d+)px/g, (_m: string, n: string) => Math.round(+n) + 'px');
      }
    }
  }

  // did the camera move or change lens since the last frame?
  viewChanged() {
    const c = this.camera, pm = c.projectionMatrix.elements;
    const s = this.viewSig || (this.viewSig = new Float64Array(23).fill(NaN));
    const cur = this.viewCur || (this.viewCur = new Float64Array(23));
    c.position.toArray(cur, 0);
    c.quaternion.toArray(cur, 3);
    for (let i = 0; i < 16; i++) cur[7 + i] = pm[i]!;
    let changed = false;
    for (let i = 0; i < 23; i++) {
      if (!(Math.abs(s[i]! - cur[i]!) < 1e-7)) {
        changed = true;
        break;
      }
    }
    if (changed) s.set(cur);
    return changed;
  }

  placeSun(cx: number, cz: number) {
    const d = 28;
    this.sun.position.set(cx + this.sunDir.x * d, this.sunDir.y * d, cz + this.sunDir.z * d);
    this.sun.target.position.set(cx, 0, cz);
  }

  // ---------- thin wrappers: the logic lives in the helper modules ----------
  rollDice(values: number[], at: number, power = 0): number { return rollDice(this, values, at, power); }
  shake(px: number) { shake(this, px); }
  pickGround(cx: number, cy: number) { return pickGround(this, cx, cy); }
  ping(x: number, z: number, color: string) { ping(this, x, z, color); }
  toScreen(x: number, y: number, z: number) { return toScreen(this, x, y, z); }
  tilePoint(id: number) { return tilePoint(this, id); }
  playerPoints(pid: number) { return playerPoints(this, pid); }
  float(el: HTMLElement, point: THREE.Vector3, opts?: { rise?: number; life?: number; wobble?: number }) { float(this, el, point, opts); }
  setZoom(z: number) { setZoom(this, z); }
  resetView() { resetView(this); }
  framing(top: boolean) { return framing(this, top); }
  frame() { frame(this); }
  lens(fov: number) { lens(this, fov); }
  setTopView(on: boolean) { setTopView(this, on); }

  heightAt(x: number, z: number): number {
    return this.field ? this.field.sample(x, z) : 0.3;
  }

  // ---------- build ----------
  render(st: BState, view: BoardViewState = {}) {
    this.lastSt = st;
    // a state update may add pieces, labels or fog: redraw shadows, masks and labels once
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    const bd = st.board;
    this.bounds = bd.bounds;
    const faceDown = !!view.faceDown;
    // terrain, props, grass and ports depend on the terrain key; the numbers have their own key,
    // so a number-only change (changing-land mode, revealed numbers) rebuilds just the labels
    const key = terrainKey(bd, faceDown);
    if (key !== this.staticKey) {
      const first = !this.staticKey;
      this.staticKey = key;
      this.buildStatic(st, faceDown);
      if (first) this.frame();
    } else {
      const tk = tokenKey(bd);
      if (tk !== this.tokenKey) {
        this.tokenKey = tk;
        buildTokens(this, st, faceDown);
      }
    }
    if (view.flipAt && view.flipAt !== this.lastFlip) {
      this.lastFlip = view.flipAt;
      flipPlates(this, st);
    }
    this.markRolled(view.rolled, view.rolledAt);
    updateFog(this, st, view);
    buildDynamic(this, st, view);
    // compile the shaders now (not on the first visible frame); `ready` resolves when done
    if (!this.compileStarted) {
      this.compileStarted = true;
      this.compile();
    }
  }

  private compileStarted = false;
  private compiling = false;
  private async compile() {
    this.compiling = true; // no frames while the shaders build: the loader covers the canvas
    try {
      // a timeout so a stuck compile can never keep the loader up
      await Promise.race([this.renderer.compileAsync(this.scene, this.camera), new Promise(res => setTimeout(res, 6000))]);
    } catch (e) {
      console.warn('compileAsync failed', e);
    }
    this.compiling = false;
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    this.markReady();
  }

  // the winning numbers blink green for a few seconds (the CSS animation ends by itself).
  // Never animate `transform` on these labels: CSS2DRenderer positions them with it.
  markRolled(num: number | null | undefined, at: number | undefined) {
    const fresh = at && at !== this.rolledAt;
    if (fresh) this.rolledAt = at;
    for (const tk of this.tokens || []) {
      const on = num != null && tk.userData.num === num, el = tk.element.firstChild as HTMLElement;
      if (fresh && on) {
        el.classList.remove('rolled');
        void el.offsetWidth; // same number twice in a row: restart the blink
      }
      el.classList.toggle('rolled', on);
    }
  }

  buildStatic(st: BState, faceDown: boolean) {
    const bd = st.board;
    disposeChildren(this.staticGroup);
    this.tokenGroup = null;
    this.bobbers = [];
    this.tokens = [];
    this.labelRev++;
    const field = (this.field = terrainOf(st, faceDown));
    const b = bd.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    this.placeSun(cx, cz);
    this.staticGroup.add(buildTerrainMesh(this, st, field));
    this.water = buildWater(this, st, field);
    this.staticGroup.add(this.water);
    this.staticGroup.add(buildHexGrid(st, field));
    placeProps(this, st);
    placeGrass(this, st);
    buildTokens(this, st, faceDown);
    this.tokenKey = tokenKey(bd);
    buildPorts(this, st);
  }
}
