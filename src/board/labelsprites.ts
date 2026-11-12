// Number tokens, face-down runes and port signs as GPU quads (3D-10) for the `low` / `medium` tiers: one canvas
// atlas drawn in the same pixel style as the CSS2D labels, one draw call per set, no DOM nodes, no style recalcs
// on camera moves. The quads face the camera, keep a screen-space size (x the zoom factor `tk`, like the
// `--tk` CSS variable), snap to whole pixels and are drawn on top of everything (like the DOM labels were).
import * as THREE from 'three';
import { probLook } from '@engine/constants';
import { pxURL } from '@ui/pixel';
import { shared } from './dispose';

// ---------- atlas layout (pure: unit-tested) ----------
const S = 2; // atlas pixels per CSS pixel
export const ATLAS_W = 1024, ATLAS_H = 512;
const TOKEN_PX = 60, PORT_W = 72, PORT_H = 36, RUNE_PX = 36; // logical size of a cell
export const NUMS = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
export const PORT_TYPES = ['any', 'wood', 'brick', 'sheep', 'wheat', 'ore'];
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}
const PER_ROW = Math.floor(ATLAS_W / (TOKEN_PX * S));
const tokenSlot = (i: number): Cell => ({ x: (i % PER_ROW) * TOKEN_PX * S, y: Math.floor(i / PER_ROW) * TOKEN_PX * S, w: TOKEN_PX * S, h: TOKEN_PX * S });
/** cell of a number token (2..12 except 7), the '?' token (num null) or the green "rolled" variant of a number */
export function tokenCell(num: number | null, green = false): Cell {
  if (num == null) return tokenSlot(NUMS.length);
  const i = NUMS.indexOf(num);
  return tokenSlot((i < 0 ? 0 : i) + (green ? NUMS.length + 1 : 0));
}
const portY = Math.ceil((NUMS.length * 2 + 1) / PER_ROW) * TOKEN_PX * S;
export function portCell(type: string): Cell {
  const i = Math.max(0, PORT_TYPES.indexOf(type));
  return { x: i * PORT_W * S, y: portY, w: PORT_W * S, h: PORT_H * S };
}
export const runeCell = (): Cell => ({ x: PORT_TYPES.length * PORT_W * S, y: portY, w: RUNE_PX * S, h: RUNE_PX * S });

// ---------- the atlas texture (one per page) ----------
const INK = '#1a1c2c', WINE = '#b13e53', FONT = '"Baloo 2", "Be Vietnam Pro", system-ui, sans-serif';
let atlas: { tex: THREE.CanvasTexture; cv: HTMLCanvasElement; icons: Map<string, HTMLImageElement> } | null = null;

function drawToken(g: CanvasRenderingContext2D, num: number | null, green: boolean) {
  // the box is 40x40 at (10,10) of the 60x60 cell: border 3px, inset shade, drop shadow (4,5) +1
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(13, 14, 42, 42);
  if (green) {
    g.fillStyle = INK;
    g.fillRect(1, 1, 58, 58);
    g.fillStyle = '#38b764';
    g.fillRect(4, 4, 52, 52);
  }
  g.fillStyle = INK;
  g.fillRect(7, 7, 46, 46);
  g.fillStyle = green ? '#7ee2a0' : '#f7ecd0';
  g.fillRect(10, 10, 40, 40);
  g.fillStyle = green ? '#3fae68' : '#d7c49b';
  g.fillRect(10, 47, 40, 3);
  g.fillRect(47, 10, 3, 40);
  g.fillStyle = !green && (num === 6 || num === 8) ? WINE : INK;
  g.font = '800 19px ' + FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (num == null) return void g.fillText('?', 30, 10 + 12.5 + 9 + 1);
  g.fillText(String(num), 30, 10 + 8 + 9 + 1);
  const pl = probLook(num);
  const total = pl.p * 4 + (pl.p - 1) * 2;
  for (let i = 0; i < pl.p; i++) {
    const x = 30 - total / 2 + i * 6, y = 10 + 29 + (6 - pl.h) / 2;
    g.fillStyle = 'rgba(26,28,44,.6)';
    g.fillRect(x - 1, y - 1, 6, pl.h + 2);
    g.fillStyle = pl.c;
    g.fillRect(x, y, 4, pl.h);
  }
}

function drawPort(g: CanvasRenderingContext2D, type: string, icon: HTMLImageElement | undefined) {
  const any = type === 'any', label = any ? '3:1' : '2:1';
  g.font = '700 14px ' + FONT;
  const tw = Math.ceil(g.measureText(label).width), iw = any ? 0 : 16 + 3;
  const w = 12 + iw + tw, h = 22, x = (PORT_W - w) / 2, y = (PORT_H - h) / 2;
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.fillRect(x + 3 - 0, y + 4, w, h);
  g.fillStyle = INK;
  g.fillRect(x - 3, y - 3, w + 6, h + 6);
  g.fillStyle = '#f4f4f4';
  g.fillRect(x, y, w, h);
  if (icon && icon.complete && icon.naturalWidth) {
    g.imageSmoothingEnabled = false;
    g.drawImage(icon, x + 6, y + (h - 16) / 2, 16, 16);
  }
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(label, x + 6 + iw, y + h / 2 + 1);
}

function drawAtlas(a: NonNullable<typeof atlas>) {
  const g = a.cv.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ATLAS_W, ATLAS_H);
  const at = (c: Cell, fn: () => void) => {
    g.save();
    g.beginPath();
    g.rect(c.x, c.y, c.w, c.h);
    g.clip();
    g.translate(c.x, c.y);
    g.scale(S, S);
    fn();
    g.restore();
  };
  for (const n of [...NUMS, null]) at(tokenCell(n), () => drawToken(g, n, false));
  for (const n of NUMS) at(tokenCell(n, true), () => drawToken(g, n, true));
  for (const t of PORT_TYPES) at(portCell(t), () => drawPort(g, t, a.icons.get(t)));
  at(runeCell(), () => {
    g.font = '26px ' + FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = INK;
    g.fillText('✦', RUNE_PX / 2 + 2, RUNE_PX / 2 + 2);
    g.fillStyle = '#f3d9a4';
    g.fillText('✦', RUNE_PX / 2, RUNE_PX / 2);
  });
  a.tex.needsUpdate = true;
}

/** The shared atlas; drawn now, and again once the font and the port icons have loaded. */
function getAtlas(onChange?: () => void): THREE.Texture {
  if (!atlas) {
    const cv = document.createElement('canvas');
    cv.width = ATLAS_W;
    cv.height = ATLAS_H;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace; // authored sRGB values go to the canvas as they are
    tex.premultiplyAlpha = true;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 1;
    shared(tex);
    const icons = new Map<string, HTMLImageElement>();
    const a = (atlas = { tex, cv, icons });
    drawAtlas(a);
    const loads: Promise<unknown>[] = [];
    for (const t of PORT_TYPES) {
      if (t === 'any') continue;
      const img = new Image();
      img.src = pxURL(t, 16);
      icons.set(t, img);
      loads.push(img.decode().catch(() => {}));
    }
    if (document.fonts) loads.push(document.fonts.load('800 19px "Baloo 2"'), document.fonts.load('700 14px "Baloo 2"'));
    Promise.all(loads).then(() => {
      drawAtlas(a);
      for (const f of listeners) f();
    });
  }
  if (onChange) listeners.add(onChange);
  return atlas.tex;
}
const listeners = new Set<() => void>();

// ---------- the quads ----------
export interface LabelItem {
  x: number;
  y: number;
  z: number;
  cell: Cell;
  /** green "rolled" variant (numbers only) */
  green?: Cell;
  /** number shown (null = '?' / not a number token): matched by markRolled */
  num?: number | null;
  /** scaled by the zoom factor like the tokens and port signs (false for the runes) */
  zoomScaled: boolean;
}

const VS = `attribute vec3 aPos; attribute vec4 aUv; attribute vec4 aUvG; attribute vec4 aInfo; attribute float aTk;
uniform vec2 uView; uniform float uPr; uniform float uTk; uniform float uNow;
varying vec2 vUv; varying vec2 vUvG; varying float vK;
void main() {
  vec4 c = projectionMatrix * viewMatrix * vec4(aPos, 1.0);
  float k = 0.0;
  if (aInfo.z >= 0.0) { float ph = (uNow - aInfo.z) / 0.65; if (ph < 4.0) k = 1.0 - abs(2.0 * fract(ph) - 1.0); }
  vK = k;
  vUv = aUv.xy + uv * aUv.zw;
  vUvG = aUvG.xy + uv * aUvG.zw;
  if (aInfo.w < 0.5 || c.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float sc = uPr * mix(1.0, uTk, aTk);
  vec2 px = floor((c.xy / c.w * 0.5 + 0.5) * uView + 0.5); // whole pixels: the pixel font never blurs
  px.y += 3.0 * k * sc; // the rolled blink lifts the token 3 px
  px += position.xy * aInfo.xy * sc;
  gl_Position = vec4((px / uView * 2.0 - 1.0) * c.w, c.z, c.w);
}`;
const FS = `uniform sampler2D uAtlas; varying vec2 vUv; varying vec2 vUvG; varying float vK;
void main() {
  vec4 a = texture2D(uAtlas, vUv);
  if (vK > 0.001) a = mix(a, texture2D(uAtlas, vUvG), vK);
  gl_FragColor = a;
}`;

const quad = (() => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
})();

export class LabelSet {
  mesh: THREE.Mesh;
  private info: THREE.InstancedBufferAttribute;
  private mat: THREE.ShaderMaterial;
  private on: boolean[];
  private _v = new THREE.Vector2();
  private blinkEnd = 0;
  constructor(private items: LabelItem[], tk: number, invalidate: () => void) {
    const n = items.length;
    const pos = new Float32Array(n * 3), uv = new Float32Array(n * 4), uvg = new Float32Array(n * 4), inf = new Float32Array(n * 4), tkf = new Float32Array(n);
    const rect = (c: Cell) => [c.x / ATLAS_W, 1 - (c.y + c.h) / ATLAS_H, c.w / ATLAS_W, c.h / ATLAS_H];
    items.forEach((it, i) => {
      pos.set([it.x, it.y, it.z], i * 3);
      uv.set(rect(it.cell), i * 4);
      uvg.set(rect(it.green || it.cell), i * 4);
      inf.set([it.cell.w / S, it.cell.h / S, -1, 1], i * 4);
      tkf[i] = it.zoomScaled ? 1 : 0;
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4));
    geo.setAttribute('aUvG', new THREE.InstancedBufferAttribute(uvg, 4));
    this.info = new THREE.InstancedBufferAttribute(inf, 4);
    this.info.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInfo', this.info);
    geo.setAttribute('aTk', new THREE.InstancedBufferAttribute(tkf, 1));
    geo.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: getAtlas(invalidate) }, uView: { value: new THREE.Vector2(1, 1) }, uPr: { value: 1 }, uTk: { value: tk }, uNow: { value: 0 } },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false, // always on top, like the DOM labels
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 100;
    this.mesh.userData.labelSet = this;
    this.on = items.map(() => false);
  }
  get count() {
    return this.items.length;
  }
  setTk(tk: number) {
    this.mat.uniforms.uTk!.value = tk;
  }
  /** per frame: drawing-buffer size, pixel ratio and the clock of the blink */
  update(r: THREE.WebGLRenderer, nowSec: number) {
    r.getDrawingBufferSize(this._v);
    const u = this.mat.uniforms;
    u.uView!.value.copy(this._v);
    u.uPr!.value = r.getPixelRatio();
    u.uNow!.value = nowSec;
  }
  /** fog of war: show only the labels `vis(x, z)` says are lit */
  applyVisibility(vis: (x: number, z: number) => boolean) {
    const a = this.info.array as Float32Array;
    this.items.forEach((it, i) => (a[i * 4 + 3] = vis(it.x, it.z) ? 1 : 0));
    this.info.needsUpdate = true;
  }
  showAll() {
    this.applyVisibility(() => true);
  }
  /** the winning number blinks green for 4 x 0.65 s (restarts on `fresh`, or when it newly lights up) */
  markRolled(num: number | null | undefined, fresh: boolean, nowSec: number) {
    const a = this.info.array as Float32Array;
    let any = false;
    this.items.forEach((it, i) => {
      const on = num != null && it.num != null && it.num === num;
      if (on && (fresh || !this.on[i])) (a[i * 4 + 2] = nowSec), (any = true);
      else if (!on) a[i * 4 + 2] = -1;
      this.on[i] = on;
    });
    if (any) this.blinkEnd = nowSec + 2.7;
    this.info.needsUpdate = true;
  }
  /** still blinking (the board keeps drawing frames while it is) */
  busy(nowSec: number) {
    return nowSec < this.blinkEnd;
  }
}
