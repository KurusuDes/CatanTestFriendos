// Kingdom banners: a tiny 12x12 pixel flag each player paints (Paint-style), plus the
// colour of their castle. Flags are stored as 144 hex digits (Sweetie-16 palette).
import { h, clear, storage } from './dom.js';

export const FLAG_PAL = ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'];
export const FLAG_N = 12;
const MY_KEY = 'kchudites.myKingdom';

const hexToRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
function nearestPal(color) {
  const [r, g, b] = hexToRgb(color);
  let best = 0, bd = Infinity;
  FLAG_PAL.forEach((p, i) => {
    const [pr, pg, pb] = hexToRgb(p);
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

// A few starting designs; `seed` picks one, `color` tints the field.
const PATTERNS = [
  (x, y, a, b) => (y < 6 ? a : b), // two bands
  (x, y, a, b) => (x === 5 || x === 6 || y === 5 || y === 6 ? b : a), // cross
  (x, y, a, b) => (Math.abs(x - y) < 2 || Math.abs(x + y - 11) < 2 ? b : a), // saltire
  (x, y, a, b) => ((x - 5.5) ** 2 + (y - 5.5) ** 2 < 10 ? b : a), // disc
  (x, y, a, b) => (x < 4 ? b : a), // hoist band
  (x, y, a, b) => ((Math.floor(x / 3) + Math.floor(y / 3)) % 2 ? b : a), // checks
  (x, y, a, b) => (y > x ? b : a), // diagonal
  (x, y, a, b) => (Math.abs(x - 5.5) + Math.abs(y - 5.5) < 5 ? b : a), // diamond
];

export function patternFlag(color, seed = 0, accent = 12) {
  const a = nearestPal(color);
  const b = a === accent ? 0 : accent;
  const f = PATTERNS[((seed % PATTERNS.length) + PATTERNS.length) % PATTERNS.length];
  let out = '';
  for (let y = 0; y < FLAG_N; y++) for (let x = 0; x < FLAG_N; x++) out += f(x, y, a, b).toString(16);
  return out;
}

export function validFlag(f) {
  return typeof f === 'string' && f.length === FLAG_N * FLAG_N && /^[0-9a-f]+$/.test(f);
}

const urlCache = new Map();
export function flagCanvas(flag, scale = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = FLAG_N * scale;
  const g = c.getContext('2d');
  const f = validFlag(flag) ? flag : patternFlag('#94b0c2', 0);
  for (let i = 0; i < f.length; i++) {
    g.fillStyle = FLAG_PAL[parseInt(f[i], 16)];
    g.fillRect((i % FLAG_N) * scale, Math.floor(i / FLAG_N) * scale, scale, scale);
  }
  return c;
}
export function flagURL(flag) {
  const k = flag || '';
  if (!urlCache.has(k)) urlCache.set(k, flagCanvas(flag, 1).toDataURL());
  return urlCache.get(k);
}
export function flagImg(flag, size = 24, cls = 'flag-img') {
  return h('img', { src: flagURL(flag), width: size, height: size, class: cls, alt: 'bandera', draggable: 'false' });
}

// Remember the kingdom this device likes to use.
export function myKingdom() {
  return storage(MY_KEY) || null;
}
export function saveMyKingdom(k) {
  storage(MY_KEY, k);
}

// ---------- the editor ----------
export function openFlagEditor({ flag, color, name, title = 'Tu reino', onSave }) {
  let f = validFlag(flag) ? flag.split('') : patternFlag(color || '#e53935', 0).split('');
  let col = color || '#e53935';
  let brush = 12;
  let tool = 'pen';
  let seed = 0;
  let painting = false;
  const cells = [];
  const grid = h('div', { class: 'flag-grid' });
  for (let i = 0; i < FLAG_N * FLAG_N; i++) {
    const c = h('div', { class: 'fc' });
    c.addEventListener('pointerdown', e => {
      e.preventDefault();
      painting = true;
      paint(i);
    });
    c.addEventListener('pointerenter', () => painting && tool === 'pen' && paint(i));
    cells.push(c);
    grid.append(c);
  }
  const stop = () => (painting = false);
  window.addEventListener('pointerup', stop);

  const preview = h('div', { class: 'flag-preview' });
  const palette = h('div', { class: 'flag-pal' });
  const tools = h('div', { class: 'chips' });
  const colorIn = h('input', { type: 'color', value: col, class: 'castle-color' });
  colorIn.addEventListener('input', () => {
    col = colorIn.value;
    drawPreview();
  });

  function paint(i) {
    if (tool === 'fill') {
      const from = f[i], to = brush.toString(16);
      if (from === to) return;
      const stack = [i];
      while (stack.length) {
        const k = stack.pop();
        if (f[k] !== from) continue;
        f[k] = to;
        const x = k % FLAG_N, y = Math.floor(k / FLAG_N);
        if (x > 0) stack.push(k - 1);
        if (x < FLAG_N - 1) stack.push(k + 1);
        if (y > 0) stack.push(k - FLAG_N);
        if (y < FLAG_N - 1) stack.push(k + FLAG_N);
      }
    } else f[i] = brush.toString(16);
    drawGrid();
  }

  function drawGrid() {
    cells.forEach((c, i) => (c.style.background = FLAG_PAL[parseInt(f[i], 16)]));
    drawPreview();
  }

  function drawPreview() {
    const url = flagCanvas(f.join(''), 1).toDataURL();
    preview.innerHTML = `<svg viewBox="0 0 120 110" width="150" height="138" style="image-rendering:pixelated">
      <rect x="18" y="58" width="84" height="42" fill="#b7ae9c" stroke="#1a1c2c" stroke-width="3"/>
      <rect x="40" y="36" width="40" height="64" fill="#c9c0ae" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="36,38 60,14 84,38" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="14,60 30,44 46,60" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="74,60 90,44 106,60" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <rect x="52" y="80" width="16" height="20" fill="#5b3e2b"/>
      <line x1="60" y1="14" x2="60" y2="-2" stroke="#5b3e2b" stroke-width="3"/>
      <image href="${url}" x="61" y="-6" width="26" height="26" preserveAspectRatio="none" style="image-rendering:pixelated"/>
    </svg>`;
  }

  function drawPalette() {
    clear(palette).append(...FLAG_PAL.map((c, i) => h('button', {
      class: 'sw' + (i === brush ? ' on' : ''), style: { background: c }, title: c,
      onclick: () => { brush = i; drawPalette(); },
    })));
    clear(tools).append(
      h('button', { class: 'chip' + (tool === 'pen' ? ' on' : ''), onclick: () => { tool = 'pen'; drawPalette(); } }, '✏️ Pincel'),
      h('button', { class: 'chip' + (tool === 'fill' ? ' on' : ''), onclick: () => { tool = 'fill'; drawPalette(); } }, '🪣 Cubo'),
      h('button', { class: 'chip', onclick: () => { seed++; f = patternFlag(col, seed, brush === nearestPal(col) ? 12 : brush).split(''); drawGrid(); } }, '🎲 Plantilla'),
      h('button', { class: 'chip', onclick: () => { f = Array(FLAG_N * FLAG_N).fill(brush.toString(16)); drawGrid(); } }, '🧹 Rellenar todo'));
  }

  const close = () => {
    window.removeEventListener('pointerup', stop);
    ov.remove();
  };
  const presets = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548', '#fdd835', '#ec407a', '#26a69a', '#5d4037'];
  const ov = h('div', { class: 'overlay', onclick: e => e.target === ov && close() },
    h('div', { class: 'modal flag-modal' },
      h('h2', null, `🏰 ${title}${name ? ': ' + name : ''}`),
      h('div', { class: 'flag-layout' },
        h('div', null, h('div', { class: 'section-label' }, 'Pinta tu bandera'), grid, h('div', { class: 'section-label' }, 'Paleta'), palette, tools),
        h('div', { class: 'flag-side' },
          h('div', { class: 'section-label' }, 'Color de tu castillo'),
          h('div', { class: 'chips' }, presets.map(p => h('button', { class: 'sw big', style: { background: p }, onclick: () => { col = p; colorIn.value = p; drawPreview(); } })), colorIn),
          h('div', { class: 'section-label' }, 'Así se verá'), preview)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: () => { const res = { flag: f.join(''), color: col }; close(); onSave && onSave(res); } }, '✅ Guardar reino'))));
  document.body.append(ov);
  drawPalette();
  drawGrid();
}
