// Kingdom banners. Players draw their flag in a tiny Gartic-Phone-like paint editor
// (pencil, eraser, bucket, line, rectangle, ellipse, sizes, palette, undo/redo) and pick
// the colour of their castle. A flag is stored as a small PNG data URL (120x80); the
// old 12x12 pixel format (144 hex digits) is still understood.
import { h, clear, storage } from './dom.js';

export const FLAG_PAL = ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'];
export const FLAG_N = 12;
export const FLAG_W = 120, FLAG_H = 80; // stored flag size (3:2)
const EDIT_W = 300, EDIT_H = 200; // drawing resolution
const MY_KEY = 'kchudites.myKingdom';
// Gartic-like palette
const PAINT = ['#000000', '#666666', '#b2b2b2', '#ffffff', '#7a1f1f', '#e53935', '#ff7a00', '#ffd400', '#fff3a3', '#1b5e20',
  '#43a047', '#9be15d', '#0d2c6c', '#1e88e5', '#4fc3f7', '#6a1b9a', '#ba68c8', '#ff80ab', '#6d4c41', '#f1c8a0'];
const SIZES = [2, 5, 10, 20, 36];

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

const PATTERNS = [
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
export function patternFlag(color, seed = 0, accent = 12) {
  const a = nearestPal(color);
  const b = a === accent ? 0 : accent;
  const f = PATTERNS[((seed % PATTERNS.length) + PATTERNS.length) % PATTERNS.length];
  let out = '';
  for (let y = 0; y < FLAG_N; y++) for (let x = 0; x < FLAG_N; x++) out += f(x, y, a, b).toString(16);
  return out;
}

const isGrid = f => typeof f === 'string' && f.length === FLAG_N * FLAG_N && /^[0-9a-f]+$/.test(f);
const isImage = f => typeof f === 'string' && f.startsWith('data:image/') && f.length < 60000;
export const validFlag = f => isGrid(f) || isImage(f);

function drawGrid(g, flag, w, h) {
  const cw = w / FLAG_N, ch = h / FLAG_N;
  for (let i = 0; i < flag.length; i++) {
    g.fillStyle = FLAG_PAL[parseInt(flag[i], 16)];
    g.fillRect(Math.floor((i % FLAG_N) * cw), Math.floor(Math.floor(i / FLAG_N) * ch), Math.ceil(cw), Math.ceil(ch));
  }
}

const imgCache = new Map();
function loadImage(src) {
  if (!imgCache.has(src))
    imgCache.set(src, new Promise(res => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    }));
  return imgCache.get(src);
}

// Canvas with the flag drawn on it. For image flags the drawing happens when the image
// has loaded; `canvas.ready` is a promise for that moment (used by the 3D textures).
export function flagCanvas(flag, scale = 1) {
  const c = document.createElement('canvas');
  c.width = FLAG_W * scale;
  c.height = FLAG_H * scale;
  const g = c.getContext('2d');
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

const urlCache = new Map();
export function flagURL(flag) {
  if (isImage(flag)) return flag;
  const k = flag || '';
  if (!urlCache.has(k)) urlCache.set(k, flagCanvas(flag, 1).toDataURL());
  return urlCache.get(k);
}
export function flagImg(flag, size = 24, cls = 'flag-img') {
  return h('img', { src: flagURL(flag), width: Math.round(size * 1.5), height: size, class: cls + (isGrid(flag) ? ' pixel' : ''), alt: 'bandera', draggable: 'false' });
}

export function myKingdom() {
  return storage(MY_KEY) || null;
}
export function saveMyKingdom(k) {
  storage(MY_KEY, k);
}

// ---------------- the paint editor ----------------
export function openFlagEditor({ flag, color, name, title = 'Tu reino', onSave }) {
  let col = color || '#e53935';
  let ink = '#000000';
  let size = SIZES[2];
  let tool = 'pen';
  let seed = 0;
  const undo = [], redo = [];
  const preview = h('div', { class: 'flag-preview' });

  const canvas = h('canvas', { width: EDIT_W, height: EDIT_H, class: 'paint-canvas' });
  const ghost = h('canvas', { width: EDIT_W, height: EDIT_H, class: 'paint-ghost' });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const gg = ghost.getContext('2d');
  g.lineCap = g.lineJoin = gg.lineCap = gg.lineJoin = 'round';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, EDIT_W, EDIT_H);

  const snapshot = () => {
    undo.push(g.getImageData(0, 0, EDIT_W, EDIT_H));
    if (undo.length > 40) undo.shift();
    redo.length = 0;
  };
  const load = f => {
    if (!validFlag(f)) return;
    if (isGrid(f)) {
      drawGrid(g, f, EDIT_W, EDIT_H);
      drawPreview();
    } else loadImage(f).then(im => {
      if (!im) return;
      g.drawImage(im, 0, 0, EDIT_W, EDIT_H);
      drawPreview();
    });
  };
  load(flag || patternFlag(col, 0));

  const pos = e => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * EDIT_W, ((e.clientY - r.top) / r.height) * EDIT_H];
  };
  let drag = null;
  const strokeStyle = () => (tool === 'eraser' ? '#ffffff' : ink);

  function fill(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= EDIT_W || y >= EDIT_H) return;
    const img = g.getImageData(0, 0, EDIT_W, EDIT_H);
    const d = img.data;
    const at = (x + y * EDIT_W) * 4;
    const [tr, tg, tb] = [d[at], d[at + 1], d[at + 2]];
    const [nr, ng, nb] = hexToRgb(ink);
    if (Math.abs(tr - nr) + Math.abs(tg - ng) + Math.abs(tb - nb) < 6) return;
    const same = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) < 90;
    const stack = [x + y * EDIT_W];
    const seen = new Uint8Array(EDIT_W * EDIT_H);
    while (stack.length) {
      const p = stack.pop();
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!same(i)) continue;
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
      d[i + 3] = 255;
      const px = p % EDIT_W;
      if (px > 0) stack.push(p - 1);
      if (px < EDIT_W - 1) stack.push(p + 1);
      if (p >= EDIT_W) stack.push(p - EDIT_W);
      if (p < EDIT_W * (EDIT_H - 1)) stack.push(p + EDIT_W);
    }
    g.putImageData(img, 0, 0);
  }

  function shape(ctx, [x0, y0], [x1, y1]) {
    ctx.strokeStyle = ctx.fillStyle = ink;
    ctx.lineWidth = size;
    ctx.beginPath();
    if (tool === 'line') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (tool === 'rect') {
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (tool === 'ellipse') {
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    snapshot();
    if (tool === 'fill') {
      fill(...p);
      drawPreview();
      return;
    }
    drag = { start: p, last: p };
    if (tool === 'pen' || tool === 'eraser') {
      g.strokeStyle = g.fillStyle = strokeStyle();
      g.lineWidth = size;
      g.beginPath();
      g.arc(p[0], p[1], size / 2, 0, Math.PI * 2);
      g.fill();
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = pos(e);
    if (tool === 'pen' || tool === 'eraser') {
      g.strokeStyle = strokeStyle();
      g.lineWidth = size;
      g.beginPath();
      g.moveTo(...drag.last);
      g.lineTo(...p);
      g.stroke();
      drag.last = p;
    } else {
      gg.clearRect(0, 0, EDIT_W, EDIT_H);
      shape(gg, drag.start, p);
    }
  });
  const end = e => {
    if (!drag) return;
    if (!['pen', 'eraser'].includes(tool)) {
      gg.clearRect(0, 0, EDIT_W, EDIT_H);
      shape(g, drag.start, pos(e));
    }
    drag = null;
    drawPreview();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  const exportFlag = () => {
    const c = document.createElement('canvas');
    c.width = FLAG_W;
    c.height = FLAG_H;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvas, 0, 0, FLAG_W, FLAG_H);
    return c.toDataURL('image/png');
  };

  function drawPreview() {
    const url = canvas.toDataURL();
    preview.innerHTML = `<svg viewBox="0 0 130 118" width="168" height="152">
      <rect x="18" y="62" width="84" height="42" fill="#b7ae9c" stroke="#1a1c2c" stroke-width="3"/>
      <rect x="40" y="40" width="40" height="64" fill="#c9c0ae" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="36,42 60,18 84,42" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="14,64 30,48 46,64" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <polygon points="74,64 90,48 106,64" fill="${col}" stroke="#1a1c2c" stroke-width="3"/>
      <rect x="52" y="84" width="16" height="20" fill="#5b3e2b"/>
      <line x1="60" y1="18" x2="60" y2="0" stroke="#5b3e2b" stroke-width="3"/>
      <rect x="61" y="0" width="45" height="30" fill="#fff" stroke="#1a1c2c" stroke-width="2"/>
      <image href="${url}" x="61" y="0" width="45" height="30" preserveAspectRatio="none"/>
    </svg>`;
  }

  // ----- UI (Gartic-like: tools left, canvas centre, palette right, sizes below)
  const toolsBox = h('div', { class: 'paint-tools' });
  const palBox = h('div', { class: 'paint-pal' });
  const sizeBox = h('div', { class: 'paint-sizes' });
  const custom = h('input', { type: 'color', value: ink, class: 'paint-custom', title: 'Otro color' });
  custom.addEventListener('input', () => {
    ink = custom.value;
    drawUI();
  });
  const TOOLS = [['pen', '✏️', 'Lápiz'], ['eraser', '🧽', 'Borrador'], ['fill', '🪣', 'Balde'], ['line', '📏', 'Línea'], ['rect', '⬛', 'Rectángulo'], ['ellipse', '⚫', 'Círculo']];
  function drawUI() {
    clear(toolsBox).append(
      ...TOOLS.map(([k, ic, label]) => h('button', { class: 'ptool' + (tool === k ? ' on' : ''), title: label, onclick: () => { tool = k; drawUI(); } }, ic)),
      h('div', { class: 'psep' }),
      h('button', { class: 'ptool', title: 'Deshacer', disabled: !undo.length, onclick: () => { redo.push(g.getImageData(0, 0, EDIT_W, EDIT_H)); g.putImageData(undo.pop(), 0, 0); drawPreview(); drawUI(); } }, '↶'),
      h('button', { class: 'ptool', title: 'Rehacer', disabled: !redo.length, onclick: () => { undo.push(g.getImageData(0, 0, EDIT_W, EDIT_H)); g.putImageData(redo.pop(), 0, 0); drawPreview(); drawUI(); } }, '↷'));
    clear(palBox).append(
      h('div', { class: 'pcur', style: { background: ink }, title: 'Color actual' }),
      h('div', { class: 'pgrid' }, PAINT.map(c => h('button', { class: 'pcol' + (c === ink ? ' on' : ''), style: { background: c }, onclick: () => { ink = c; if (tool === 'eraser') tool = 'pen'; drawUI(); } }))),
      custom);
    clear(sizeBox).append(
      ...SIZES.map(s => h('button', { class: 'psize' + (s === size ? ' on' : ''), title: s + 'px', onclick: () => { size = s; drawUI(); } }, h('i', { style: { width: Math.max(4, s * 0.8) + 'px', height: Math.max(4, s * 0.8) + 'px', background: tool === 'eraser' ? '#fff' : ink } }))),
      h('div', { class: 'psep' }),
      h('button', { class: 'btn sm', onclick: () => { snapshot(); g.fillStyle = '#ffffff'; g.fillRect(0, 0, EDIT_W, EDIT_H); drawPreview(); drawUI(); } }, '🗑️ Limpiar'),
      h('button', { class: 'btn sm', onclick: () => { snapshot(); seed++; drawGrid(g, patternFlag(col, seed, nearestPal(ink) === nearestPal(col) ? 12 : nearestPal(ink)), EDIT_W, EDIT_H); drawPreview(); drawUI(); } }, '🎲 Plantilla'));
    canvas.style.cursor = tool === 'fill' ? 'cell' : 'crosshair';
  }

  const close = () => ov.remove();
  const presets = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548', '#fdd835', '#ec407a', '#26a69a', '#5d4037'];
  const castleIn = h('input', { type: 'color', value: col, class: 'castle-color', title: 'Otro color' });
  castleIn.addEventListener('input', () => {
    col = castleIn.value;
    drawPreview();
  });
  const ov = h('div', { class: 'overlay', onclick: e => e.target === ov && close() },
    h('div', { class: 'modal flag-modal' },
      h('h2', null, `🏰 ${title}${name ? ': ' + name : ''}`),
      h('div', { class: 'paint' }, toolsBox, h('div', { class: 'paint-stage' }, canvas, ghost), palBox),
      sizeBox,
      h('div', { class: 'flag-bottom' },
        h('div', null, h('div', { class: 'section-label' }, 'Color de tu castillo'),
          h('div', { class: 'chips' }, presets.map(p => h('button', { class: 'sw big', style: { background: p }, onclick: () => { col = p; castleIn.value = p; drawPreview(); } })), castleIn)),
        h('div', null, h('div', { class: 'section-label' }, 'Así se verá'), preview)),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: close }, 'Cancelar'),
        h('button', { class: 'btn primary', onclick: () => { const res = { flag: exportFlag(), color: col }; close(); onSave && onSave(res); } }, '✅ Guardar reino'))));
  document.body.append(ov);
  drawUI();
  drawPreview();
}
