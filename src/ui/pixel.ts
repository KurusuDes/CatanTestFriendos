// Pixel-art helpers for the UI: hand-made 16x16 sprites (Sweetie-16 palette) for the
// resources, plus an automatic "pixelizer" that turns any emoji into a crunchy sprite
// so every icon in the interface shares the same retro look.
import { iconSetSignal } from './iconset';

type Palette = Record<string, string>;

const PAL: Palette = {
  k: '#1a1c2c', p: '#5d275d', r: '#b13e53', R: '#ef7d57', y: '#ffcd75', Y: '#d69a3a', G: '#a7f070', g: '#38b764',
  d: '#257179', n: '#29366f', b: '#3b5dc9', B: '#41a6f6', c: '#73eff7', w: '#f4f4f4', s: '#94b0c2', S: '#566c86',
  t: '#8a5a3c', T: '#5e3a28', o: '#333c57', W: '#c9d6df',
};

const SPRITES: Record<string, string[]> = {
  wood: [
    '.......k........',
    '......kgk.......',
    '.....kgGgk......',
    '....kgGgggk.....',
    '.....kgggk......',
    '....kgGgggdk....',
    '...kgGgggggdk...',
    '....kkgggdkk....',
    '...kgGggggddk...',
    '..kgGgggggggdk..',
    '.kgGggggggggddk.',
    '.kkkkkkttkkkkkk.',
    '.......tTk......',
    '......ktTTk.....',
    '......kkkkk.....',
    '................',
  ],
  brick: [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kRRRRRkRRRRRRk.',
    '.kRrrrrkRrrrrrk.',
    '.kkkkkkkkkkkkkk.',
    '.kRRRkRRRRRRkRk.',
    '.kRrrkRrrrrrkrk.',
    '.kkkkkkkkkkkkkk.',
    '.kRRRRRkRRRRRRk.',
    '.kRrrrrkRrrrrrk.',
    '.kkkkkkkkkkkkkk.',
    '.kRRkRRRRRRkRRk.',
    '.krrkRrrrrrkrrk.',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  sheep: [
    '................',
    '................',
    '....kkkkkk......',
    '..kkwwwwwwkk....',
    '.kwwwWwwwwwwkkk.',
    'kwwWwwwwwwwkoook',
    'kwwwwwwwwwwkowok',
    'kwWwwwwwwwwkoook',
    'kwwwwwwwwwwwkkk.',
    '.kwwwwwwwwwwk...',
    '..kkwwwwwwkk....',
    '...kokkkokk.....',
    '...kok..kok.....',
    '...kkk..kkk.....',
    '................',
    '................',
  ],
  wheat: [
    '....k..k..k.....',
    '...kyk.kyk.kyk..',
    '...kYykYyykYyk..',
    '...kyYkyYkkyYk..',
    '....kykyYkkyk...',
    '.....kykYyky....',
    '......kyYyk.....',
    '......kYyYk.....',
    '.....krrrrrk....',
    '......kyYyk.....',
    '......kYyYk.....',
    '.....kyYkYyk....',
    '....kyYk.kYyk...',
    '...kyYk...kYyk..',
    '...kkk.....kkk..',
    '................',
  ],
  ore: [
    '................',
    '................',
    '......kkkk......',
    '....kksSsskk....',
    '...ksSwSsssSk...',
    '...kSwSssssSSk..',
    '..ksSSssssSSSk..',
    '..kssssccsSSSk..',
    '.kssssscwcSSSSk.',
    '.kSsssssccSSSSk.',
    '.kSSsssssSSSoSk.',
    '.kSSSSsSSSSoooSk',
    '..kkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
  ],
  desert: [
    '................',
    '......kgk.......',
    '.....kgGgk......',
    '.kk..kgggk......',
    'kGgk.kgggk.kk...',
    'kgGk.kgGgk.kgk..',
    'kggkkkgggk.kGgk.',
    '.kggggggggkkggk.',
    '..kkkkgGggggggk.',
    '.....kgggkkkkk..',
    '.....kgGgk......',
    '..yyykgggkyyyy..',
    '.yYyyyyyyyyyyYy.',
    'yYYyyyYYyyyYYyyy',
    '................',
    '................',
  ],
  gold: [
    '................',
    '.......kk.......',
    '......kyyk......',
    '.....kywyYk.....',
    '....kyyyyYYk....',
    '...kyywyyYYYk...',
    '..kyyyyyyYYYYk..',
    '..kYYYYYYRRRRk..',
    '...kYYYYRRRRk...',
    '....kYYYRRRk....',
    '.....kYYRRk.....',
    '......kYRk......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ],
};

// "PICO" icon set: PICO-8-like palette (punchier, higher contrast) + a light sticker border
// added at draw time so each icon reads on any card colour.
const PAL_PICO: Palette = {
  k: '#140c1c', w: '#fff1e8', G: '#00e436', g: '#008751', d: '#0b4d2c', t: '#ab5236', T: '#5f3024',
  b: '#e8643a', B: '#9e2f22', f: '#ffccaa', y: '#ffec27', o: '#ffa300', O: '#c25e00', r: '#ff004d',
  s: '#c2c3c7', z: '#5f574f', c: '#29adff', C: '#a9e7ff', n: '#1d2b53',
};

const SPRITES_PICO: Record<string, string[]> = {
  wood: [
    '.......kk.......',
    '......kGgk......',
    '.....kGGggk.....',
    '....kGGgggdk....',
    '...kkkGgggkkk...',
    '....kGGgggdk....',
    '...kGGggggddk...',
    '..kGGgggggggdk..',
    '..kkkGGgggdkkk..',
    '...kGGggggddk...',
    '..kGGgggggggdk..',
    '.kGGgggggggggdk.',
    '.kkkkkkttkkkkkk.',
    '......kttk......',
    '......kTTk......',
    '......kkkk......',
  ],
  brick: [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kfbbbbkfbbbbbk.',
    '.kbbbbBkbbbbbBk.',
    '.kkkkkkkkkkkkkk.',
    '.kfbbkfbbbbbkfk.',
    '.kbbBkbbbbbBkBk.',
    '.kkkkkkkkkkkkkk.',
    '.kfbbbbkfbbbbbk.',
    '.kbbbbBkbbbbbBk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
  ],
  sheep: [
    '................',
    '................',
    '...kk.kk.kk.....',
    '..kwwkwwkwwk....',
    '.kwwwwwwwwwwkkk.',
    'kwwwwwwwwwwkzzzk',
    'kwwwwwwwwwwkzwzk',
    'kswwwwwwwwwkzzzk',
    'kswwwwwwwwwwkkk.',
    '.ksswwwwwwssk...',
    '..kkskkkkskk....',
    '...kzk..kzk.....',
    '...kzk..kzk.....',
    '...kkk..kkk.....',
    '................',
    '................',
  ],
  wheat: [
    '..kk...kk...kk..',
    '.kyyk.kyyk.kyyk.',
    '.kyok.koyk.kyok.',
    '.koyk.kyok.koyk.',
    '.kyok.koyk.kyok.',
    '..kyk.kyyk.kyk..',
    '...ktkkttkktk...',
    '....ktkttktk....',
    '.....krrrrk.....',
    '.....kttttk.....',
    '....ktkttktk....',
    '...ktk.kk.ktk...',
    '..ktk......ktk..',
    '..kk........kk..',
    '................',
    '................',
  ],
  ore: [
    '................',
    '................',
    '......kkkk......',
    '....kkswssk.....',
    '...kswsssszk....',
    '..kswssssszzk...',
    '..kssssccszzzk..',
    '.kssssccCcszzzk.',
    '.ksssssccszzzzk.',
    '.kzsssssszzzzzk.',
    '.kzzzsszzzzzzzk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
  ],
  gold: [
    '................',
    '.......kk.......',
    '......kyyk......',
    '.....kywyok.....',
    '....kyyyyook....',
    '...kywyyyoook...',
    '..kyyyyyyooook..',
    '..koooooooOOOk..',
    '...koooooOOOk...',
    '....koooOOOk....',
    '.....kooOOk.....',
    '......koOk......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ],
  desert: [
    '................',
    '......kkk.......',
    '.....kGgdk......',
    '.kk..kGgdk......',
    'kGdk.kGgdk.kk...',
    'kGdk.kGgdk.kGdk.',
    'kGggggGgdkkkGdk.',
    '.kkkkkGgdGGGgdk.',
    '.....kGgdkkkkk..',
    '.....kGgdk......',
    '.....kGgdk......',
    '..ookkGgdkkoooo.',
    '.offffffffffffo.',
    'ooffffffffffffoo',
    '................',
    '................',
  ],
};

// which icon set the interface uses (menu toggle):
//   'render'  3D models rendered by Blender with a pixel camera (tools/blender/make_icons.py), default
//   'pico'    hand-drawn, PICO-8-like palette with a sticker border
//   'classic' the original hand-drawn Sweetie-16 sprites
export const ICON_SETS = ['render', 'pico', 'classic'] as const;
type IconSet = (typeof ICON_SETS)[number];
const SET_KEY = 'katanittes.icons';
const pickSet = (n: string | null): IconSet => (ICON_SETS.find(x => x === n) ?? 'render');
let iconSetName: IconSet = (() => {
  try {
    return pickSet(localStorage.getItem(SET_KEY));
  } catch {
    return 'render';
  }
})();
iconSetSignal.value = iconSetName;
export function setIconSet(name: string): void {
  iconSetName = pickSet(name);
  iconSetSignal.value = iconSetName;
  try {
    localStorage.setItem(SET_KEY, iconSetName);
  } catch {}
  cache.clear();
}

const cache = new Map<string, string>();

function spriteURL(rows: string[], pal: Palette = PAL, sticker = false): string {
  // the sticker border needs one extra pixel on each side
  const pad = sticker ? 1 : 0, N = 16 + pad * 2;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      g.fillStyle = pal[ch] || '#f0f';
      g.fillRect(x + pad, y + pad, 1, 1);
    }
  });
  if (sticker) {
    const img = g.getImageData(0, 0, N, N), d = img.data;
    const solid = (i: number) => (d[i * 4 + 3] ?? 0) > 0;
    const ring: number[] = [];
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (solid(y * N + x)) continue;
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => {
          const xx = x + dx!, yy = y + dy!;
          return xx >= 0 && yy >= 0 && xx < N && yy < N && solid(yy * N + xx);
        });
        if (near) ring.push(y * N + x);
      }
    for (const i of ring) d.set([255, 241, 232, 255], i * 4);
    g.putImageData(img, 0, 0);
  }
  return c.toDataURL();
}

// emoji -> 16x16 posterized sprite with a dark outline
function emojiURL(ch: string): string {
  const N = 18;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${N - 3}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.fillText(ch, N / 2, N / 2 + 1);
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  const solid = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const a = d[i * 4 + 3]!;
    if (a < 110) {
      d[i * 4 + 3] = 0;
      continue;
    }
    solid[i] = 1;
    d[i * 4 + 3] = 255;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round(d[i * 4 + k]! / 48) * 48; // posterize
  }
  // 1px dark outline around the silhouette
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (solid[i]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const xx = x + dx!, yy = y + dy!;
        return xx >= 0 && yy >= 0 && xx < N && yy < N && solid[yy * N + xx];
      });
      if (near) {
        d[i * 4] = 26;
        d[i * 4 + 1] = 28;
        d[i * 4 + 2] = 44;
        d[i * 4 + 3] = 255;
      }
    }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

// resource emojis map to the hand-made sprites
const ALIAS: Record<string, string> = { '🌲': 'wood', '🧱': 'brick', '🐑': 'sheep', '🌾': 'wheat', '⛰': 'ore', '🌵': 'desert', '💰': 'gold' };

// rendered icons exist at 16 and 32 px: small uses get the 16 px render (drawn at that size,
// not downscaled), so they stay crisp
export function pxURL(name: string, size = 20): string {
  name = ALIAS[name] || name;
  const render = iconSetName === 'render' && SPRITES[name];
  const key = render ? `${name}@${size > 22 ? 32 : 16}` : name;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url: string;
  if (render) url = `${import.meta.env.BASE_URL}assets/icons/${name}_${size > 22 ? 32 : 16}.png`;
  else if (SPRITES[name]) url = iconSetName === 'pico' ? spriteURL(SPRITES_PICO[name] ?? SPRITES[name]!, PAL_PICO, true) : spriteURL(SPRITES[name]!);
  else url = emojiURL(name);
  cache.set(key, url);
  return url;
}

// <img> sprite: pxIcon('wood') or pxIcon('🎲')
export function pxIcon(name: string, size = 20, title?: string): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'px';
  img.src = pxURL(name, size);
  img.width = img.height = size;
  img.alt = title || name;
  img.draggable = false;
  if (title) img.title = title;
  return img;
}

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[⭐✨])/gu;
const EMOJI_TEST = /\p{Extended_Pictographic}/u;

const SKIP = 'input,textarea,select,option,.nopx,.labels-3d';
const JIT_SEL = '.jit:not([data-jit])';

// Split .jit elements into letters that wobble (hand-drawn "boil" effect).
function jitterEl(el: HTMLElement): void {
  if (el.dataset.jit) return;
  el.dataset.jit = '1';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  let i = 0;
  for (const t of texts) {
    const frag = document.createDocumentFragment();
    // letters are grouped per word so line breaks never split a word
    let word: HTMLSpanElement | null = null;
    for (const ch of t.nodeValue ?? '') {
      if (ch === ' ') {
        frag.append(' ');
        word = null;
        continue;
      }
      if (!word) {
        word = document.createElement('span');
        word.className = 'jw';
        frag.append(word);
      }
      const s = document.createElement('span');
      s.className = 'jl';
      s.style.animationDelay = `-${((i++ * 137) % 600) / 1000}s`;
      s.textContent = ch;
      word.append(s);
    }
    t.parentNode?.replaceChild(frag, t);
  }
}

// collect the .jit elements affected by `node` (itself, an ancestor, or a descendant)
function collectJit(node: Node, out: Set<HTMLElement>): void {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!el) return;
  if (el.closest('.nopx')) return; // Preact-owned subtree: <Jit> renders the letters itself
  const up = el.closest<HTMLElement>(JIT_SEL);
  if (up) out.add(up);
  if (node.nodeType === 1) for (const e of (node as Element).querySelectorAll<HTMLElement>(JIT_SEL)) if (!e.closest('.nopx')) out.add(e);
}

function acceptText(n: Node): boolean {
  const p = n.parentNode as Element | null;
  return !!(p && p.closest && !p.closest(SKIP) && EMOJI_TEST.test(n.nodeValue ?? ''));
}

function collectText(node: Node, out: Set<Text>): void {
  if (node.nodeType === 3) {
    if (acceptText(node)) out.add(node as Text);
    return;
  }
  if (node.nodeType !== 1 || (node as Element).tagName === 'CANVAS') return;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (acceptText(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  while (walker.nextNode()) out.add(walker.currentNode as Text);
}

// Process a batch of roots: all reads first, then all writes.
function processRoots(roots: Node[]): void {
  const jits = new Set<HTMLElement>();
  for (const r of roots) collectJit(r, jits);
  for (const el of jits) jitterEl(el);
  const texts = new Set<Text>();
  for (const r of roots) if (r.isConnected !== false) collectText(r, texts);
  if (!texts.size) return;
  // read pass: one font-size read per parent element (no DOM writes in between)
  const sizes = new Map<Node, number>();
  for (const t of texts) {
    const par = t.parentNode;
    if (par && !sizes.has(par)) sizes.set(par, Math.round(parseFloat(getComputedStyle(par as Element).fontSize) * 1.15) || 18);
  }
  // write pass
  for (const node of texts) {
    const par = node.parentNode;
    if (!par) continue;
    const parts = (node.nodeValue ?? '').split(EMOJI);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    const size = sizes.get(par);
    parts.forEach((p, i) => {
      if (!p) return;
      if (i % 2 === 1) frag.append(pxIcon(p.replace(/️/g, ''), size, p));
      else frag.append(p);
    });
    par.replaceChild(frag, node);
  }
}

// Replace every emoji inside `root` by its pixel-art sprite (and wobble its .jit elements). There is no
// body-wide observer any more: Preact components render sprites themselves (PixelIcon / px) and
// imperative DOM (toast, balloons, flying cards...) calls this once on the element it creates.
export function pixelize(root?: Node | null): void {
  if (root) processRoots([root]);
}
