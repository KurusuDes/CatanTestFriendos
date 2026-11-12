// Kingdom banners (pure helpers, no UI). Players draw their flag in a tiny Gartic-Phone-like paint
// editor (see FlagEditor.tsx) and pick the colour of their castle. A flag is stored as a small PNG
// data URL (120x80); the old 12x12 pixel format (144 hex digits) is still understood.
import { storage } from '@ui/dom';

const FLAG_PAL = ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'];
const FLAG_N = 12;
export const FLAG_W = 120, FLAG_H = 80; // stored flag size (3:2)
const MY_KEY = 'katanittes.myKingdom';

export interface MyKingdom {
  name?: string;
  color: string;
  flag: string | null;
}

export const hexToRgb = (c: string): number[] => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
export function nearestPal(color: string): number {
  const [r = 0, g = 0, b = 0] = hexToRgb(color);
  let best = 0, bd = Infinity;
  FLAG_PAL.forEach((p, i) => {
    const [pr = 0, pg = 0, pb = 0] = hexToRgb(p);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

type Pattern = (x: number, y: number, a: number, b: number) => number;
const PATTERNS: Pattern[] = [
  (x, y, a, b) => (y < 6 ? a : b),
  (x, y, a, b) => (x === 5 || x === 6 || y === 5 || y === 6 ? b : a),
  (x, y, a, b) => (Math.abs(x - y) < 2 || Math.abs(x + y - 11) < 2 ? b : a),
  (x, y, a, b) => ((x - 5.5) ** 2 + (y - 5.5) ** 2 < 10 ? b : a),
  (x, y, a, b) => (x < 4 ? b : a),
  (x, y, a, b) => ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? b : a),
  (x, y, a, b) => (y > x ? b : a),
  (x, y, a, b) => (Math.abs(x - 5.5) + Math.abs(y - 5.5) < 5 ? b : a),
];

// simple starting design in the legacy 12x12 format
export function patternFlag(color: string, seed = 0, accent = 12): string {
  const a = nearestPal(color);
  const b = a === accent ? 0 : accent;
  const f = PATTERNS[((seed % PATTERNS.length) + PATTERNS.length) % PATTERNS.length]!;
  let out = '';
  for (let y = 0; y < FLAG_N; y++) for (let x = 0; x < FLAG_N; x++) out += f(x, y, a, b).toString(16);
  return out;
}

export const isGrid = (f: unknown): f is string => typeof f === 'string' && f.length === FLAG_N * FLAG_N && /^[0-9a-f]+$/.test(f);
const isImage = (f: unknown): f is string => typeof f === 'string' && f.startsWith('data:image/') && f.length < 60000;
export const validFlag = (f: unknown): f is string => isGrid(f) || isImage(f);

export function drawGrid(g: CanvasRenderingContext2D, flag: string, w: number, h: number): void {
  const cw = w / FLAG_N, ch = h / FLAG_N;
  for (let i = 0; i < flag.length; i++) {
    g.fillStyle = FLAG_PAL[parseInt(flag[i]!, 16)]!;
    g.fillRect(Math.floor((i % FLAG_N) * cw), Math.floor(Math.floor(i / FLAG_N) * ch), Math.ceil(cw), Math.ceil(ch));
  }
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(src);
  if (!p) {
    p = new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
    imgCache.set(src, p);
  }
  return p;
}

type FlagCanvas = HTMLCanvasElement & { ready: Promise<FlagCanvas>; pixel?: boolean };

// Canvas with the flag drawn on it. For image flags the drawing happens when the image
// has loaded; `canvas.ready` is a promise for that moment (used by the 3D textures).
export function flagCanvas(flag: unknown, scale = 1): FlagCanvas {
  const c = document.createElement('canvas') as FlagCanvas;
  c.width = FLAG_W * scale;
  c.height = FLAG_H * scale;
  const g = c.getContext('2d')!;
  const f = validFlag(flag) ? flag : patternFlag('#94b0c2', 0);
  if (isGrid(f)) {
    drawGrid(g, f, c.width, c.height);
    c.ready = Promise.resolve(c);
    c.pixel = true;
  } else {
    c.ready = loadImage(f).then(im => {
      if (im) g.drawImage(im, 0, 0, c.width, c.height);
      return c;
    });
  }
  return c;
}

const urlCache = new Map<string, string>();
export function flagURL(flag: unknown): string {
  if (isImage(flag)) return flag;
  const k = typeof flag === 'string' ? flag : '';
  let u = urlCache.get(k);
  if (u === undefined) {
    u = flagCanvas(flag, 1).toDataURL();
    urlCache.set(k, u);
  }
  return u;
}

export function myKingdom(): MyKingdom | null {
  return (storage(MY_KEY) as MyKingdom | null) || null;
}
export function saveMyKingdom(k: MyKingdom): void {
  storage(MY_KEY, k);
}
