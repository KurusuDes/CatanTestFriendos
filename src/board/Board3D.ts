// 3D map renderer: "realistic tabletop miniature". This file only orchestrates; the pieces live in
// terrain / water / props / grass / ports / labels / pieces / effects / camera / fog (see src/board).
// One continuous heightfield island textured by splatting 8 PBR-ish layers, lit by a physical sky
// (IBL), with a depth-aware sea, instanced Blender props, wind-swept grass, drifting cloud shadows,
// GTAO and tilt-shift. Tokens, port signs and click targets are crisp pixel-art CSS2D labels.
// Same interface as BoardView (see BoardRenderer): render(state, view), setZoom(), resetView(), dispose().
//
// Rendering is ON DEMAND: a frame is drawn only when something changed (camera, state, a transient
// effect, a resize, a setting) or, for the ambient animations (water, wind, flags), at the quality tier's
// `ambientFps`. At the `low` tier that is 0: when nobody touches the board the GPU sits idle.
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
import { ensureTerrainNormals, loadKit, loadTextures, type Kit, type Textures } from './assets';
import { FOV, frame, framing, lens, pickGround, resetView, scaleTokens, setTopView, setZoom, toScreen, updateCamAnim } from './camera';
import { Dice3D } from './dice3d';
import { disposeChildren, disposeTree } from './dispose';
import { dropPing, float, flipPlates, ping, playerPoints, rollDice, shake, tilePoint, updateFloaters, updatePings, updatePlates, type Floater, type Ping, type Plate } from './effects';
import { updateFog } from './fog';
import { buildTokens, tokenKey } from './labels';
import type { LabelSet } from './labelsprites';
import { placeGrass } from './grass';
import { buildDynamic, type PieceSet, type Spawn } from './pieces';
import { buildPorts } from './ports';
import { placeProps } from './props';
import { detailKey, dioramaParams, PARAMS, spriteLabels, type Tier, type TierParams } from './quality';
import { applyLowFx, effective, saveSettings, SETTINGS, type Settings } from './settings';
import { LAYER_GRASS, LAYER_LABELS, LAYER_PIECES, OutlineOverlayShader, OutlineShader, patch, pieceColorMat, tiltShader, U } from './shaders';
import { buildHexGrid, buildTerrainMesh, terrainKey } from './terrain';
import { gridHeight, spotKey, terrainOf, type GenInput, type GenResult, type HeightGrid, type TerrainField } from './terrainGen';
import { generateIsland } from './terrainClient';
import { buildWater } from './water';
import type { BState, BoardViewState, BBounds, Interaction } from './types';

declare global {
  interface Window {
    __board3d?: Board3D;
  }
}


interface BoardOptions {
  /** the rotating menu / lobby background: always the light profile, no labels, 30 fps (see dioramaParams) */
  diorama?: boolean;
}

export class Board3D implements BoardRenderer {
  // ---- state shared with the helper modules
  container: HTMLElement;
  kit: Kit;
  tex: Textures;
  zoom = 1;
  renderer!: THREE.WebGLRenderer; // assigned by makeRenderer
  maxPR: number;
  /** live parameters: the tier's table + the player's chips; the adaptive ladder lowers them during the session */
  params: TierParams;
  diorama: boolean;
  perf: { t: number; n: number; sum: number; slow: number; grace: number; last?: number };
  shadowDirty = true;
  canvas: HTMLCanvasElement;
  labels: CSS2DRenderer;
  scene: THREE.Scene;
  sunDir: THREE.Vector3;
  envRT: THREE.WebGLRenderTarget;
  private envSky!: Sky;
  /** is the canvas context multisampled (WebGLRenderer `antialias`)? */
  canvasAA = false;
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
  staticKey = ''; // terrain key of the island on screen; setting it to '' forces a full static rebuild
  private pendingKey: string | null = null; // key of the build in flight (the island is made in a worker)
  private buildSeq = 0; // a result is used only if no newer build was asked for meanwhile
  tokenKey = ''; // numbers key; a change rebuilds only the number labels
  pieceSet: PieceSet | undefined;
  spawns: Spawn[] = [];
  plates: Plate[] = [];
  bobbers: { obj: THREE.Object3D; y: number; ph: number }[] = [];
  floaters: Floater[] = [];
  pings: Ping[] | undefined;
  pingGeo: Record<string, THREE.BufferGeometry> | undefined;
  controls: OrbitControls;
  /** null at the tiers that render straight to the canvas (medium, low) */
  composer: EffectComposer | null = null;
  fogCanvas: HTMLCanvasElement;
  fogTex: THREE.CanvasTexture;
  fogKey = ''; // vision the fog canvas currently shows
  fogLabelKey = ''; // vision + label generation the label visibility was computed for
  labelRev = 0; // bumped whenever CSS2D labels are recreated
  resizeObs: ResizeObserver;
  forgetRect: () => void;
  canvasRect: DOMRect | null = null;
  t0 = performance.now(); // THREE.Clock is deprecated since r183
  now: () => number;
  alive: boolean;
  raf = 0;
  aoPass: GTAOPass | null = null;
  hts: ShaderPass | null = null;
  vts: ShaderPass | null = null;
  outlinePass: ShaderPass | null = null;
  /** outline drawn as a blended quad on the canvas (no composer) */
  overlay: { scene: THREE.Scene; cam: THREE.OrthographicCamera; mat: THREE.ShaderMaterial; geo: THREE.BufferGeometry } | null = null;
  vignetteEl: HTMLElement;
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
  /** called once when the adaptive ladder ran out of cheap steps and the machine is still slow */
  onSlow: (() => void) | undefined;
  lastSt: BState | undefined;
  lastView: BoardViewState = {};
  bounds: BBounds | undefined;
  /** height of the island on screen at (x, z): present once the first island has landed (it reads the height grid) */
  field: { sample(x: number, z: number): number } | undefined;
  private hgrid: HeightGrid | undefined;
  private builtTiles: GenInput['tiles'] = [];
  private builtFaceDown = false;
  private spots = new Map<string, number>(); // exact heights at vertices, tile centres and edge midpoints
  private exact: TerrainField | undefined; // the exact field, made only for points outside the height grid
  water: THREE.Mesh | undefined;
  tokens: CSS2DObject[] = [];
  /** number tokens / runes and port signs as GPU quads on the light tiers (labelsprites.ts); null = CSS2D labels */
  tokenSprites: LabelSet | null = null;
  portSprites: LabelSet | null = null;
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

  // ---- render on demand
  /** something changed: draw a frame on the next tick (see invalidate) */
  needsRender = true;
  /** hard cap on the frame rate (the menu background: 30); 0 = none */
  fpsCap = 0;
  private lastRender = 0;
  private renderedLastTick = false;
  private movedPending = false;
  private frameLog: number[] = [];
  private lastDrawCalls = 0;
  private lastTriangles = 0;
  private suggested = false;
  private builtDetail = '';
  private builtLabels = false;

  static SETTINGS_TILT(): boolean { return SETTINGS.tiltShift; }
  static SETTINGS_PIXEL() { return SETTINGS.pixel; }
  static SETTINGS_Q(): Tier { return SETTINGS.quality; }
  static SETTINGS_AO() { return SETTINGS.ao; }
  static SETTINGS_OUTLINE() { return SETTINGS.outline; }

  static async create(container: HTMLElement, opts: BoardOptions = {}): Promise<Board3D> {
    const low = opts.diorama ? true : PARAMS[SETTINGS.quality].lowTextures;
    const [kit, tex] = await Promise.all([loadKit(), loadTextures(low)]);
    // the terrain normal layers are only fetched for the tiers that use them (high / ultra), never for the diorama
    if (!opts.diorama && PARAMS[SETTINGS.quality].surfaceNormals) await ensureTerrainNormals(tex, low);
    return new Board3D(container, kit, tex, opts);
  }

  constructor(container: HTMLElement, kit: Kit, tex: Textures, opts: BoardOptions = {}) {
    this.ready = new Promise<void>(res => (this.markReady = res));
    this.container = container;
    this.kit = kit;
    this.tex = tex;
    this.zoom = 1;
    this.diorama = !!opts.diorama;
    const P = (this.params = this.diorama ? dioramaParams(effective()) : effective());
    // sharp on retina screens; the frame-time watcher lowers it when the GPU can't keep up
    this.maxPR = Math.min(window.devicePixelRatio || 1, P.maxPR);
    this.perf = { t: 0, n: 0, sum: 0, slow: 0, grace: 0 };
    this.shadowDirty = true;
    this.canvas = this.makeRenderer(P.canvasAA).domElement;
    container.append(this.canvas);
    // the vignette for the tiers without a vignette pass: a CSS gradient costs next to nothing
    this.vignetteEl = document.createElement('div');
    this.vignetteEl.className = 'vignette-css';
    this.vignetteEl.style.display = 'none';
    container.append(this.vignetteEl);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-3d';
    if (this.diorama) this.labels.domElement.style.display = 'none';
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
    this.envSky = sky;
    this.envRT = this.bakeEnvironment();
    scene.environmentIntensity = 0.55;
    scene.fog = new THREE.Fog('#bfd3db', 34, 95);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 600);
    this.camera.layers.enable(LAYER_PIECES);
    this.camera.layers.enable(LAYER_GRASS);
    this.camera.layers.enable(LAYER_LABELS);
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
    sun.shadow.mapSize.set(P.shadow.size, P.shadow.size);
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
    this.floaters = [];

    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, maxPolarAngle: 1.15, minPolarAngle: 0.3, minDistance: 3, maxDistance: 50, screenSpacePanning: false });
    // middle button = drop a 1 s marker there (zoom stays on the wheel)
    this.controls.mouseButtons.MIDDLE = -1 as unknown as THREE.MOUSE;
    this.controls.addEventListener('change', this.invalidate);
    this.bindCanvas();

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = this.fogCanvas.height = 512;
    this.fogTex = new THREE.CanvasTexture(this.fogCanvas);
    U.uFogTex.value = this.fogTex;
    this.applyShadow();
    this.applyFx();
    this.setupPasses();

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.forgetRect = () => (this.canvasRect = null);
    addEventListener('scroll', this.forgetRect, true);
    addEventListener('resize', this.forgetRect);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.now = () => performance.now(); // overridable time source (frame-by-frame recording)
    this.alive = true;
    // the loop itself is nearly free when idle (see tick): it only polls the camera and the transient effects
    const loop = () => {
      if (!this.alive) return;
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    loop();
  }

  /** A WebGL renderer configured for the board. `antialias` (MSAA of the canvas itself) is a context attribute: it
   *  can only be chosen here, at creation (see recreateRenderer for a tier change across that boundary). */
  private makeRenderer(aa: boolean): THREE.WebGLRenderer {
    const P = this.params;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: aa, powerPreference: this.diorama ? 'low-power' : 'high-performance' }));
    this.canvasAA = aa;
    r.setPixelRatio(this.maxPR);
    // draw-call counts of a whole frame (masks + composer passes), reset by hand once per frame
    r.info.autoReset = false;
    r.shadowMap.enabled = true;
    r.shadowMap.type = P.shadow.type === 'pcf' ? THREE.PCFShadowMap : THREE.BasicShadowMap; // PCFSoft was removed in r186
    // the scene barely moves: shadows are redrawn only when something changes (see tick)
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.className = 'board-3d';
    return r;
  }

  /** the sky as image based lighting (PMREM), baked with the current renderer */
  private bakeEnvironment(): THREE.WebGLRenderTarget {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(this.envSky.clone());
    const rt = pm.fromScene(envScene, 0.02);
    this.scene.environment = rt.texture;
    pm.dispose();
    return rt;
  }

  private bindCanvas() {
    this.canvas.addEventListener('pointerdown', e => {
      if (e.button !== 1) return;
      e.preventDefault();
      const p = this.pickGround(e.clientX, e.clientY);
      if (p && this.onPing) this.onPing(p.x, p.z);
    });
    this.canvas.addEventListener('mousedown', e => e.button === 1 && e.preventDefault()); // no autoscroll
  }

  /** A tier change across the canvas-MSAA boundary (medium <-> the others): the context attribute can't change, so
   *  the renderer and its canvas are replaced. Materials and textures re-upload by themselves on the new context;
   *  what we own on the old one (masks, shadow map, environment, composer) is freed first. The passes are rebuilt
   *  by the applyTier that called this. */
  private recreateRenderer(aa: boolean) {
    const old = this.renderer, oldCanvas = this.canvas;
    if (this.composer) this.composer.dispose();
    this.composer = null;
    this.disposeOverlay();
    this.maskVis.dispose();
    this.maskAll.dispose();
    this.envRT.dispose();
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.controls.disconnect();
    old.dispose();
    old.forceContextLoss();
    const r = this.makeRenderer(aa);
    this.canvas = r.domElement;
    oldCanvas.replaceWith(this.canvas);
    this.controls.connect(this.canvas);
    this.bindCanvas();
    this.envRT = this.bakeEnvironment();
    this.canvasRect = null;
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
  }

  /** Ask for a frame (cheap, idempotent). Anything that changes what the board shows calls this. */
  invalidate = () => {
    this.needsRender = true;
  };

  private onVisibility = () => {
    this.renderedLastTick = false;
    this.perf.last = undefined;
    if (!document.hidden) this.invalidate();
  };

  // ---------- quality ----------
  /** wind / cloud shadows / sea foam are uniforms, so a tier change needs no shader recompile */
  private applyFx() {
    const P = this.params;
    U.uFx.value.set(P.wind ? 1 : 0, P.clouds ? 1 : 0, P.foam ? 1 : 0);
  }

  private applyShadow() {
    const s = this.params.shadow, r = this.renderer, sh = this.sun.shadow;
    const type = s.type === 'pcf' ? THREE.PCFShadowMap : THREE.BasicShadowMap;
    const typeChanged = r.shadowMap.type !== type, sizeChanged = sh.mapSize.x !== s.size;
    r.shadowMap.type = type;
    sh.mapSize.set(s.size, s.size);
    if (typeChanged || sizeChanged) {
      sh.map?.dispose();
      sh.map = null;
    }
    // the shadow filter is part of every material's program: rebuild them once
    if (typeChanged)
      this.scene.traverse(o => {
        const mt = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (mt) for (const m of ([] as THREE.Material[]).concat(mt)) m.needsUpdate = true;
      });
    this.shadowDirty = true;
  }

  /** (Re)builds the post-processing for the current tier + the player's chips. */
  setupPasses() {
    const P = this.params;
    const px = this.diorama ? 1 : SETTINGS.pixel | 0, tilt = !this.diorama && SETTINGS.tiltShift;
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    if (this.composer) this.composer.dispose();
    this.composer = null;
    this.aoPass = this.hts = this.vts = this.outlinePass = null;
    this.disposeOverlay();
    const outline = P.outline !== 'off';
    // the pixel filter and the tilt-shift need the composer whatever the tier; AO is an ultra pass
    const useComposer = P.composer || px > 1 || tilt;
    let vignettePass = false;
    if (useComposer) {
      const type = P.halfFloat || !P.composer ? THREE.HalfFloatType : THREE.UnsignedByteType;
      // MSAA only on 1x screens: on retina the resolution is enough and MSAA nearly halved the fps
      const samples = this.maxPR <= 1 ? P.samples : 0;
      const c = (this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type, samples })));
      if (px > 1) c.addPass(new RenderPixelatedPass(px, this.scene, this.camera, { normalEdgeStrength: 0.25, depthEdgeStrength: 0.35 }));
      else {
        c.addPass(new RenderPass(this.scene, this.camera));
        if (P.ao) {
          const ao = new GTAOPass(this.scene, this.camera, w, h);
          ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.0, scale: 1.2, samples: 8 });
          ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 8 });
          ao.blendIntensity = 0.9;
          c.addPass(ao);
          this.aoPass = ao;
        }
      }
      if (tilt) {
        this.hts = new ShaderPass(tiltShader('1.0, 0.0'));
        this.vts = new ShaderPass(tiltShader('0.0, 1.0'));
        this.hts.uniforms.tMask!.value = this.vts!.uniforms.tMask!.value = this.maskVis.texture;
        c.addPass(this.hts);
        c.addPass(this.vts);
        this.hts.enabled = this.vts!.enabled = !this.top;
      }
      c.addPass(new OutputPass());
      if (outline) {
        this.outlinePass = new ShaderPass(OutlineShader);
        this.outlinePass.uniforms.tVis!.value = this.maskVis.texture;
        this.outlinePass.uniforms.tAll!.value = this.maskAll.texture;
        c.addPass(this.outlinePass);
      }
      if (P.vignette) {
        const vig = new ShaderPass(VignetteShader);
        vig.uniforms.offset!.value = 0.95;
        vig.uniforms.darkness!.value = 1.05;
        c.addPass(vig);
        vignettePass = true;
      }
    } else if (outline) {
      // straight to the canvas: the outline is one blended quad over the tone-mapped frame
      const mat = new THREE.ShaderMaterial({ ...OutlineOverlayShader, uniforms: THREE.UniformsUtils.clone(OutlineOverlayShader.uniforms), transparent: true, depthTest: false, depthWrite: false });
      mat.uniforms.tVis!.value = this.maskVis.texture;
      mat.uniforms.tAll!.value = this.maskAll.texture;
      const geo = new THREE.PlaneGeometry(2, 2);
      const sc = new THREE.Scene();
      const quad = new THREE.Mesh(geo, mat);
      quad.frustumCulled = false;
      sc.add(quad);
      this.overlay = { scene: sc, cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), mat, geo };
    }
    this.vignetteEl.style.display = vignettePass || this.diorama ? 'none' : '';
    this.resize();
  }

  private disposeOverlay() {
    if (!this.overlay) return;
    this.overlay.mat.dispose();
    this.overlay.geo.dispose();
    this.overlay = null;
  }

  /** after a tier / chip change: re-read the parameters and rebuild whatever depends on them */
  applyTier() {
    this.params = this.diorama ? dioramaParams(effective()) : effective();
    this.perf.slow = this.perf.grace = 0;
    this.maxPR = Math.min(window.devicePixelRatio || 1, this.params.maxPR);
    if (this.params.canvasAA !== this.canvasAA) this.recreateRenderer(this.params.canvasAA);
    this.applyPixelRatio(this.maxPR);
    this.applyShadow();
    this.applyFx();
    this.setupPasses();
    // the island's own detail (terrain grid, grass, props, surface normals) changed: rebuild it (the camera stays).
    // Going up to high / ultra first needs the terrain normal layers (a one-off download + decode)
    const rebuild = () => {
      if (!this.alive) return;
      if (this.lastSt && (this.builtDetail !== this.detailSig() || this.builtLabels !== this.spriteLabels())) this.render(this.lastSt, this.lastView);
      this.invalidate();
    };
    this.invalidate();
    if (this.params.surfaceNormals && !this.tex.nrmLoaded) void ensureTerrainNormals(this.tex, this.params.lowTextures).then(rebuild);
    else rebuild();
  }

  /** number tokens and port signs as GPU quads (low / medium) instead of CSS2D labels; never on the menu diorama
   *  (its labels are hidden) nor with the pixel filter (its normal pass would draw the quads) */
  spriteLabels(): boolean {
    return !this.diorama && spriteLabels(SETTINGS.quality) && SETTINGS.pixel <= 1;
  }

  private detailSig() {
    return this.diorama ? 'diorama' : detailKey(SETTINGS.quality);
  }

  setGraphics(opts: Partial<Settings>) {
    Object.assign(SETTINGS, opts, { v: 3 });
    if (opts.quality) SETTINGS.chosen = true;
    saveSettings();
    applyLowFx();
    this.applyTier();
  }

  applyPixelRatio(pr: number) {
    if (Math.abs(pr - this.renderer.getPixelRatio()) < 0.01) return;
    this.renderer.setPixelRatio(pr);
    this.resize();
  }

  // ---------- adaptive quality ladder (see tick) ----------
  // Fed with the time between two frames drawn back to back. Two slow windows (1.5 s each) in a row
  // take the next cheaper step; one window is skipped after each step so the change can settle.
  // It only ever goes down: never above the tier the player chose.
  watchPerf(real: number, dt: number) {
    const p = this.perf;
    if (p.last != null && real - p.last > 1000) (p.t = real), (p.sum = p.n = 0); // idle gap: start a fresh window
    p.last = real;
    if (!p.t) p.t = real;
    if (dt < 250) (p.sum += dt), p.n++; // ignore pauses (tab switch, modal)
    if (real - p.t < 1500 || p.n < 20) return;
    const avg = p.sum / p.n;
    p.t = real;
    p.sum = p.n = 0;
    if (p.grace > 0) return void p.grace--;
    if (avg <= 22) return void (p.slow = 0);
    if (++p.slow < 2) return;
    p.slow = 0;
    if (this.degrade()) p.grace = 1;
  }

  /** the next cheaper step; false when none is left */
  private degrade(): boolean {
    const P = this.params;
    if (this.aoPass && this.aoPass.enabled) {
      this.aoPass.enabled = false; // the priciest pass
      P.ao = false;
      return true;
    }
    if (P.outline !== 'off') {
      P.outline = 'off';
      if (this.outlinePass) this.outlinePass.enabled = false;
      this.disposeOverlay();
      return true;
    }
    if (P.shadow.type === 'pcf') {
      P.shadow = { type: 'basic', size: P.shadow.size };
      this.applyShadow();
      return true;
    }
    if (P.ambientFps > 30) {
      P.ambientFps = 30;
      return true;
    }
    const pr = this.renderer.getPixelRatio();
    if (pr - 0.25 >= 0.75 - 0.01) {
      this.applyPixelRatio(Math.max(0.75, pr - 0.25));
      return true;
    }
    if (!this.suggested && SETTINGS.quality !== 'low' && !this.diorama) {
      this.suggested = true;
      if (this.onSlow) this.onSlow();
    }
    return false;
  }

  resize() {
    const w = this.container.clientWidth || 800, h = this.container.clientHeight || 600;
    const r = this.renderer;
    r.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(r.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.labels.setSize(w, h);
    this.viewH = h;
    this.canvasRect = null; // re-measured on the next toScreen()
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = r.getPixelRatio();
    // masks: half resolution on the `medium` tier (the outline is 1-2 px wide anyway)
    const ms = this.params.outline === 'half' ? 0.5 : 1;
    const mw = Math.max(1, Math.round(w * pr * ms)), mh = Math.max(1, Math.round(h * pr * ms));
    this.maskVis.setSize(mw, mh);
    this.maskAll.setSize(mw, mh);
    const u = this.outlinePass ? this.outlinePass.uniforms : this.overlay ? this.overlay.mat.uniforms : null;
    if (u) u.uTexel!.value.set(1 / w, 1 / h); // ~1-2 css px whatever the mask resolution
    if (this.hts) {
      this.hts.uniforms.h!.value = 2.4 / w;
      this.vts!.uniforms.h!.value = 2.4 / h;
      this.hts.uniforms.r!.value = this.vts!.uniforms.r!.value = 0.55;
    }
    this.invalidate();
  }

  // masks of the player pieces (see OutlineShader / tiltShader)
  // `fresh` = the camera, the pieces or the size changed since the last masks; otherwise they still hold
  renderMasks(fresh: boolean) {
    const r = this.renderer, cam = this.camera, sc = this.scene;
    const outline = this.params.outline !== 'off' && !!(this.outlinePass || this.overlay);
    const need = !!(this.hasPieces && (this.hts || outline));
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
    if (need && outline) {
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
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.controls.removeEventListener('change', this.invalidate);
    this.controls.dispose();
    if (this.composer) this.composer.dispose();
    this.disposeOverlay();
    this.maskVis.dispose();
    this.maskAll.dispose();
    this.envRT.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.vignetteEl.remove();
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

  /** Dev check (console: `__board3d.perfInfo()`): the tier, what it resolved to and how many frames were drawn
   *  in the last second. Standing still at the `low` tier this must say 0 frames. */
  perfInfo() {
    const nowT = performance.now();
    this.frameLog = this.frameLog.filter(t => nowT - t < 1000);
    const c = this.composer;
    const info = {
      tier: SETTINGS.quality,
      chosenByPlayer: SETTINGS.chosen,
      framesLastSecond: this.frameLog.length,
      drawCalls: this.lastDrawCalls,
      triangles: this.lastTriangles,
      pixelRatio: this.renderer.getPixelRatio(),
      composer: !!c,
      canvasAA: this.canvasAA,
      msaaSamples: this.renderer.getContext().getParameter(this.renderer.getContext().SAMPLES) as number,
      passes: c ? c.passes.filter(p => p.enabled).length : 1 + (this.overlay ? 1 : 0),
      outline: this.params.outline,
      ambientFps: this.params.ambientFps,
      shadow: this.params.shadow,
      params: { ...this.params },
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
    console.log('[board3d] perfInfo', info);
    return info;
  }

  // anything still moving by itself? (polled every tick; each one needs a frame per tick)
  private stepTransients(now: number): boolean {
    let active = false;
    if (this.spawns.length) {
      active = true;
      this.spawns = this.spawns.filter(sp => {
        const k = Math.min(1, (now - sp.t0) / 450);
        const e = 1 - Math.pow(1 - k, 3);
        sp.step(e);
        return k < 1;
      });
    }
    if (this.plates.length) (active = true), updatePlates(this, now);
    if (this.diceFx && this.diceFx.throw) (active = true), this.diceFx.update(now);
    else if (this.diceFx) this.diceFx.update(now);
    if (this.pings && this.pings.length) (active = true), updatePings(this, now);
    // the robber's red stain fades in on its new tile
    const rt = this.robberTile, ru = U.uRobber.value;
    if (rt && (rt.x !== ru.x || rt.y !== ru.y)) ru.set(rt.x, rt.y, 0);
    const target = rt ? 1 : 0;
    if (ru.z !== target) {
      active = true;
      ru.z += (target - ru.z) * 0.06;
      if (Math.abs(target - ru.z) < 0.004) ru.z = target;
    }
    if (this.tokenSprites && this.tokenSprites.busy(performance.now() / 1000)) active = true; // the green blink
    if (this.camAnim) (active = true), updateCamAnim(this, now);
    if (this.floaters.length) updateFloaters(this, now); // DOM only: no frame needed
    return active || this.controls.autoRotate;
  }

  tick() {
    if (document.hidden) {
      this.renderedLastTick = false;
      return;
    }
    const real = performance.now(), now = this.now();
    const active = this.stepTransients(now);
    this.controls.update();
    if (this.compiling) return;
    const moved = this.viewChanged() || this.movedPending;
    const afps = this.params.ambientFps;
    const ambientDue = afps > 0 && real - this.lastRender >= 1000 / afps - 1;
    if (!(this.needsRender || moved || active || ambientDue)) {
      this.renderedLastTick = false;
      return;
    }
    if (this.fpsCap && real - this.lastRender < 1000 / this.fpsCap - 2) {
      this.movedPending = moved; // keep wanting the frame, draw it a little later
      return;
    }
    this.movedPending = false;
    this.needsRender = false;
    // the frame-time watcher only samples frames drawn back to back (not the gaps between idle frames)
    if (this.renderedLastTick && !this.diorama) this.watchPerf(real, real - this.lastRender);
    this.renderedLastTick = true;
    this.lastRender = real;
    this.frameLog.push(real);
    if (this.frameLog.length > 240) this.frameLog.splice(0, this.frameLog.length - 240);

    // ambient animations advance only when a frame is drawn
    const t = (real - this.t0) / 1000;
    U.uTime.value = t;
    for (const b of this.bobbers) {
      b.obj.position.y = b.y + Math.sin(t * 1.4 + b.ph) * 0.025;
      b.obj.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.05;
    }
    if (moved || this.labelsDirty) scaleTokens(this);

    this.renderer.info.reset();
    const dicing = !!(this.diceFx && this.diceFx.throw);
    this.renderMasks(moved || this.masksStale || this.spawns.length > 0 || dicing);
    this.masksStale = false;
    // shadows only when something that casts them moved (set after the masks so they don't use it up)
    if (this.shadowDirty || this.spawns.length || this.plates.length || (this.pings && this.pings.length) || dicing) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    const nowSec = performance.now() / 1000;
    if (this.tokenSprites) this.tokenSprites.update(this.renderer, nowSec);
    if (this.portSprites) this.portSprites.update(this.renderer, nowSec);
    this.drawFrame();
    this.lastDrawCalls = this.renderer.info.render.calls;
    this.lastTriangles = this.renderer.info.render.triangles;
    // the labels only move with the camera: re-placing ~100 of them every frame cost a style recalc
    if ((moved || this.labelsDirty) && !this.diorama) {
      this.labelsDirty = false;
      this.labels.render(this.scene, this.camera);
      // snap the pixel labels to whole pixels: sub-pixel positions blur the pixel font
      for (const el of this.labels.domElement.children as HTMLCollectionOf<HTMLElement>) {
        const t = el.style.transform;
        if (t && t.indexOf('.') >= 0) el.style.transform = t.replace(/(-?\d+\.\d+)px/g, (_m: string, n: string) => Math.round(+n) + 'px');
      }
    }
  }

  private drawFrame() {
    if (this.composer) return this.composer.render();
    const r = this.renderer;
    r.render(this.scene, this.camera);
    const o = this.overlay;
    if (o && this.hasPieces) {
      const auto = r.autoClear;
      r.autoClear = false;
      r.render(o.scene, o.cam);
      r.autoClear = auto;
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
  // (each one changes what is on screen, so each asks for a frame)
  rollDice(values: number[], at: number, power = 0): number { this.invalidate(); return rollDice(this, values, at, power); }
  shake(px: number) { shake(this, px); }
  pickGround(cx: number, cy: number) { return pickGround(this, cx, cy); }
  ping(x: number, z: number, color: string) { this.invalidate(); ping(this, x, z, color); }
  toScreen(x: number, y: number, z: number) { return toScreen(this, x, y, z); }
  tilePoint(id: number) { return tilePoint(this, id); }
  playerPoints(pid: number) { return playerPoints(this, pid); }
  float(el: HTMLElement, point: THREE.Vector3, opts?: { rise?: number; life?: number; wobble?: number }) { float(this, el, point, opts); }
  setZoom(z: number) { setZoom(this, z); this.invalidate(); }
  resetView() { resetView(this); this.invalidate(); }
  framing(top: boolean) { return framing(this, top); }
  frame() { frame(this); this.invalidate(); }
  lens(fov: number) { lens(this, fov); this.invalidate(); }
  setTopView(on: boolean) { setTopView(this, on); this.invalidate(); }

  /** Terrain height at (x, z): looked up on the height grid of the island (the terrain mesh itself). Outside the
   *  grid (open sea) the exact field is used, as before. 0.3 until the first island has landed. */
  heightAt(x: number, z: number): number {
    const g = this.hgrid;
    if (!g) return 0.3;
    const sp = this.spots.get(spotKey(x, z));
    if (sp !== undefined) return sp;
    const h = gridHeight(g, x, z);
    if (h !== null) return h;
    return (this.exact ||= terrainOf({ board: { tiles: this.builtTiles } }, this.builtFaceDown)).sample(x, z);
  }

  // ---------- build ----------
  render(st: BState, view: BoardViewState = {}) {
    this.lastSt = st;
    this.lastView = view;
    // a state update may add pieces, labels or fog: redraw shadows, masks and labels once
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    this.invalidate();
    const bd = st.board;
    this.bounds = bd.bounds;
    const faceDown = !!view.faceDown;
    // terrain, props, grass and ports depend on the terrain key (+ the tier's detail); the numbers have
    // their own key, so a number-only change (changing-land mode, revealed numbers) rebuilds just the labels
    const detail = this.detailSig();
    const labelMode = this.spriteLabels();
    const key = terrainKey(bd, faceDown) + '|' + detail + '|' + (labelMode ? 's' : 'd');
    // the island is generated in a worker: while a build is in flight the old island stays on screen
    if (key !== (this.pendingKey ?? this.staticKey) || (this.staticKey === '' && this.pendingKey === null)) this.requestStatic(st, faceDown, key, detail);
    // nothing to hang pieces on before the first island has landed (swapStatic runs this again)
    if (this.field) this.applyDynamic(st, view);
  }

  private applyDynamic(st: BState, view: BoardViewState) {
    const bd = st.board;
    const faceDown = !!view.faceDown;
    const tk = tokenKey(bd);
    if (tk !== this.tokenKey) {
      this.tokenKey = tk;
      buildTokens(this, st, faceDown);
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
    this.invalidate();
    this.markReady();
  }

  // the winning numbers blink green for a few seconds (the CSS animation ends by itself).
  // Never animate `transform` on these labels: CSS2DRenderer positions them with it.
  markRolled(num: number | null | undefined, at: number | undefined) {
    const fresh = at && at !== this.rolledAt;
    if (fresh) this.rolledAt = at;
    if (this.tokenSprites) this.tokenSprites.markRolled(num, !!fresh, performance.now() / 1000);
    for (const tk of this.tokens || []) {
      const on = num != null && tk.userData.num === num, el = tk.element.firstChild as HTMLElement;
      if (fresh && on) {
        el.classList.remove('rolled');
        void el.offsetWidth; // same number twice in a row: restart the blink
      }
      el.classList.toggle('rolled', on);
    }
  }

  /** Asks the worker for the island of this state; the latest request wins (older results are dropped). */
  private requestStatic(st: BState, faceDown: boolean, key: string, detail: string) {
    const bd = st.board;
    const p = this.params;
    const input: GenInput = {
      tiles: bd.tiles.map(t => ({ id: t.id, q: t.q, r: t.r, x: t.x, y: t.y, res: t.res, revealed: !!t.revealed })),
      vertices: bd.vertices.map(v => ({ x: v.x, y: v.y })),
      edges: bd.edges.map(e => ({ a: e.a, b: e.b })),
      bounds: { minX: bd.bounds.minX, maxX: bd.bounds.maxX, minY: bd.bounds.minY, maxY: bd.bounds.maxY },
      faceDown,
      step: p.terrainStep,
      grass: p.grass,
      props: p.props,
    };
    const seq = ++this.buildSeq;
    this.pendingKey = key;
    generateIsland(input).then(
      res => {
        if (!this.alive || seq !== this.buildSeq) return; // stale: a newer build was asked for (or the board is gone)
        this.swapStatic(st, input, res, key, detail);
      },
      e => {
        console.error('island build failed', e);
        if (seq === this.buildSeq) this.pendingKey = null;
        this.markReady(); // never keep the loader up
      },
    );
  }

  /** The island is ready: replace the old one in one go (no blank frame) and bring the dynamic parts up to date. */
  private swapStatic(st: BState, input: GenInput, res: GenResult, key: string, detail: string) {
    const bd = st.board;
    const first = !this.field;
    disposeChildren(this.staticGroup);
    this.tokenGroup = null;
    this.bobbers = [];
    this.tokens = [];
    this.tokenSprites = this.portSprites = null;
    this.labelRev++;
    this.hgrid = { nx: res.nx, nz: res.nz, x0: res.x0, z0: res.z0, step: res.step, heights: res.heights };
    this.builtTiles = input.tiles;
    this.builtFaceDown = input.faceDown;
    this.exact = undefined;
    this.spots.clear();
    for (let i = 0; i < res.exact.length; i += 3) this.spots.set(spotKey(res.exact[i]!, res.exact[i + 1]!), res.exact[i + 2]!);
    this.field ||= { sample: (x, z) => this.heightAt(x, z) };
    const b = bd.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minY + b.maxY) / 2;
    this.placeSun(cx, cz);
    this.staticGroup.add(buildTerrainMesh(this, res));
    this.water = buildWater(this, st, res);
    this.staticGroup.add(this.water);
    this.staticGroup.add(buildHexGrid(res));
    placeProps(this, res.props);
    placeGrass(this, res.grassLists);
    buildPorts(this, st);
    this.tokenKey = ''; // the tokens belong to the old static group: applyDynamic builds them again
    this.staticKey = key;
    this.pendingKey = null;
    this.builtDetail = detail;
    this.builtLabels = key.endsWith('|s');
    if (first) this.frame();
    this.shadowDirty = this.masksStale = this.labelsDirty = true;
    this.invalidate();
    if (this.lastSt) this.applyDynamic(this.lastSt, this.lastView);
  }
}
