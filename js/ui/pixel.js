// Pixel-art helpers for the UI: hand-made 16x16 sprites (Sweetie-16 palette) for the
// resources, plus an automatic "pixelizer" that turns any emoji into a crunchy sprite
// so every icon in the interface shares the same retro look.

const PAL = {
  k: '#1a1c2c', p: '#5d275d', r: '#b13e53', R: '#ef7d57', y: '#ffcd75', Y: '#d69a3a', G: '#a7f070', g: '#38b764',
  d: '#257179', n: '#29366f', b: '#3b5dc9', B: '#41a6f6', c: '#73eff7', w: '#f4f4f4', s: '#94b0c2', S: '#566c86',
  t: '#8a5a3c', T: '#5e3a28', o: '#333c57',
};

const SPRITES = {
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
    'kwWwwwwwwwwkooook',
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

const cache = new Map();

function spriteURL(rows) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      g.fillStyle = PAL[ch] || '#f0f';
      g.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

// emoji -> 16x16 posterized sprite with a dark outline
function emojiURL(ch) {
  const N = 18;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `${N - 3}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.fillText(ch, N / 2, N / 2 + 1);
  const img = g.getImageData(0, 0, N, N);
  const d = img.data;
  const solid = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const a = d[i * 4 + 3];
    if (a < 110) {
      d[i * 4 + 3] = 0;
      continue;
    }
    solid[i] = 1;
    d[i * 4 + 3] = 255;
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.round(d[i * 4 + k] / 48) * 48; // posterize
  }
  // 1px dark outline around the silhouette
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (solid[i]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const xx = x + dx, yy = y + dy;
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
const ALIAS = { '🌲': 'wood', '🧱': 'brick', '🐑': 'sheep', '🌾': 'wheat', '⛰': 'ore', '🌵': 'desert', '💰': 'gold' };

export function pxURL(name) {
  name = ALIAS[name] || name;
  if (cache.has(name)) return cache.get(name);
  const url = SPRITES[name] ? spriteURL(SPRITES[name]) : emojiURL(name);
  cache.set(name, url);
  return url;
}

// <img> sprite: pxIcon('wood') or pxIcon('🎲')
export function pxIcon(name, size = 20, title) {
  const img = document.createElement('img');
  img.className = 'px';
  img.src = pxURL(name);
  img.width = img.height = size;
  img.alt = title || name;
  img.draggable = false;
  if (title) img.title = title;
  return img;
}

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[⭐✨])/gu;
const EMOJI_TEST = /\p{Extended_Pictographic}/u;

// Split .jit elements into letters that wobble (hand-drawn "boil" effect).
function jitterize(root) {
  for (const el of root.querySelectorAll('.jit:not([data-jit])')) {
    el.dataset.jit = '1';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    let i = 0;
    for (const t of texts) {
      const frag = document.createDocumentFragment();
      // letters are grouped per word so line breaks never split a word
      let word = null;
      for (const ch of t.nodeValue) {
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
      t.parentNode.replaceChild(frag, t);
    }
  }
}

// Replace every emoji inside `root` by its pixel-art sprite.
export function pixelize(root) {
  if (!root) return;
  if (root.querySelectorAll) jitterize(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && n.parentNode.closest && !n.parentNode.closest('input,textarea,select,option,.nopx') && EMOJI_TEST.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.nodeValue.split(EMOJI);
    if (parts.length < 2) continue;
    const frag = document.createDocumentFragment();
    const size = Math.round(parseFloat(getComputedStyle(node.parentNode).fontSize) * 1.15) || 18;
    parts.forEach((p, i) => {
      if (!p) return;
      if (i % 2 === 1) frag.append(pxIcon(p.replace(/️/g, ''), size, p));
      else frag.append(p);
    });
    node.parentNode.replaceChild(frag, node);
  }
}

// Watch a subtree and keep it pixelized as it re-renders.
export function autoPixelize(root) {
  pixelize(root);
  let pending = false;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      mo.disconnect();
      pixelize(root);
      mo.observe(root, { childList: true, subtree: true, characterData: true });
    });
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  return mo;
}
