import { App } from '../app.js';
import { h, s as S, clear, storage, toast } from './dom.js';
import { TILE_INFO } from '../engine/constants.js';
import { hexagon, hexCenter, hk, SHAPES } from '../engine/board.js';
import { MAPS_KEY } from './lobby.js';

const U = 100;
const R = 5;
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
}).join(' ');

const BRUSHES = [
  ['random', '🎲', 'Ngẫu nhiên'], ['wood', TILE_INFO.wood.icon, 'Gỗ'], ['brick', TILE_INFO.brick.icon, 'Gạch'], ['sheep', TILE_INFO.sheep.icon, 'Cừu'],
  ['wheat', TILE_INFO.wheat.icon, 'Lúa'], ['ore', TILE_INFO.ore.icon, 'Đá'], ['desert', TILE_INFO.desert.icon, 'Sa mạc'], ['gold', TILE_INFO.gold.icon, 'Vàng'],
  ['erase', '🌊', 'Biển'],
];
const NUMS = [0, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

export const encodeMap = m => btoa(unescape(encodeURIComponent(JSON.stringify(m))));
export const decodeMap = c => JSON.parse(decodeURIComponent(escape(atob(c.trim()))));

export function editorScreen(root, initial) {
  let tiles = new Map();
  let brush = 'random';
  let numBrush = null;
  let name = 'Mi mapa';
  const load = m => {
    tiles = new Map(m.tiles.map(t => [hk(t.q, t.r), { q: t.q, r: t.r, res: t.res || 'random', num: t.num || 0 }]));
    name = m.name || name;
  };
  if (initial) load(initial);
  else load({ tiles: SHAPES.classic.gen().map(([q, r]) => ({ q, r })) });

  const svg = S('svg', { class: 'board-svg', viewBox: `${-9.3 * U} ${-8.3 * U} ${18.6 * U} ${16.6 * U}` });
  const side = h('div', { class: 'editor-side' });
  const wrap = h('section', { class: 'board-wrap' }, svg);
  root.append(h('div', { class: 'editor screen' }, side, wrap));

  let painting = false;
  const stopPaint = () => (painting = false);
  window.addEventListener('pointerup', stopPaint);
  App.onLeave = () => window.removeEventListener('pointerup', stopPaint); // the router clears it after calling it

  function apply(q, r) {
    const k = hk(q, r);
    if (numBrush !== null) {
      const t = tiles.get(k);
      if (!t) return;
      t.num = t.res === 'desert' ? 0 : numBrush;
    } else if (brush === 'erase') tiles.delete(k);
    else {
      const t = tiles.get(k) || { q, r, num: 0 };
      t.res = brush;
      if (brush === 'desert') t.num = 0;
      tiles.set(k, t);
    }
    paintCell(q, r); // only the touched hex changes
  }

  // one <g> per hex, created once (with its listeners); painting only rewrites that group's children
  const cells = new Map();
  function paintCell(q, r) {
    const g = cells.get(hk(q, r));
    const c = hexCenter(q, r);
    const t = tiles.get(hk(q, r));
    clear(g);
    if (!t) g.append(S('polygon', { points: hexPts(c.x * U, c.y * U, U * 0.95), class: 'slot' }));
    else {
      const info = t.res === 'random' ? { color: '#6b7aa6', icon: '🎲' } : TILE_INFO[t.res];
      g.append(S('polygon', { points: hexPts(c.x * U, c.y * U, U * 0.96), fill: info.color, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 5, style: 'cursor:pointer' }));
      g.append(S('text', { x: c.x * U, y: c.y * U - 22, class: 'tile-icon', 'font-size': 40 }, info.icon));
      if (t.res !== 'desert') {
        g.append(S('circle', { cx: c.x * U, cy: c.y * U + 26, r: 24, fill: '#f6ecd2', stroke: '#9c8a60', 'stroke-width': 2 }));
        g.append(S('text', { x: c.x * U, y: c.y * U + 34, class: 'token-num' + (t.num ? '' : ' q'), style: t.num === 6 || t.num === 8 ? 'fill:#d32f2f' : '' }, t.num || '?'));
      }
    }
  }

  function drawBoard() {
    if (!cells.size) {
      for (const [q, r] of hexagon(R)) {
        const g = S('g', {
          onpointerdown: e => { e.preventDefault(); painting = true; apply(q, r); },
          onpointerenter: () => painting && apply(q, r),
        });
        cells.set(hk(q, r), g);
        svg.append(g);
      }
    }
    for (const [q, r] of hexagon(R)) paintCell(q, r); // whole-board changes (load, clear, shapes)
  }

  function current() {
    return { name, tiles: [...tiles.values()].map(t => ({ q: t.q, r: t.r, res: t.res, num: t.num || null })) };
  }

  function drawSide() {
    clear(side);
    const saved = storage(MAPS_KEY) || [];
    side.append(
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' } },
        h('button', { class: 'btn sm', onclick: () => App.go('menu') }, '← Menu'),
        h('h2', { style: { fontSize: '22px' } }, '✏️ Tạo bản đồ')),
      h('p', { style: { color: 'var(--muted)', fontSize: '13px', marginTop: 0 } }, 'Tô các ô (có thể kéo chuột). Ô "Ngẫu nhiên" sẽ được điền cân bằng khi vào ván. Số "?" cũng vậy.'),
      h('div', { class: 'section-label' }, 'Địa hình'),
      h('div', { class: 'brushes' }, BRUSHES.map(([k, ic, label]) => h('button', {
        class: 'brush' + (numBrush === null && brush === k ? ' on' : ''), onclick: () => { brush = k; numBrush = null; drawSide(); },
      }, ic, h('small', null, label)))),
      h('div', { class: 'section-label' }, 'Số'),
      h('div', { class: 'brushes' }, NUMS.map(n => h('button', {
        class: 'brush' + (numBrush === n ? ' on' : ''), style: { fontSize: '18px', fontWeight: 900, color: n === 6 || n === 8 ? '#ff6b6b' : '' },
        onclick: () => { numBrush = n; drawSide(); },
      }, n || '?', h('small', null, n ? '' : 'tự động')))),
      h('div', { class: 'section-label' }, `Số ô: ${tiles.size}`),
      h('div', { class: 'chips' },
        h('button', { class: 'btn sm', onclick: () => { tiles.clear(); drawBoard(); drawSide(); } }, '🧹 Xóa trắng'),
        ...['classic', 'extended', 'ring', 'star'].map(k => h('button', { class: 'btn sm', onclick: () => { load({ name, tiles: SHAPES[k].gen().map(([q, r]) => ({ q, r })) }); drawBoard(); drawSide(); } }, SHAPES[k].name))),
      h('div', { class: 'section-label' }, 'Tên'),
      h('input', { type: 'text', value: name, maxlength: 24, onchange: e => { name = e.target.value.trim() || 'Mi mapa'; } }),
      h('div', { style: { display: 'grid', gap: '8px', marginTop: '12px' } },
        h('button', { class: 'btn primary', onclick: () => saveMap(true) }, '▶️ Lưu và chơi'),
        h('button', { class: 'btn', onclick: () => saveMap(false) }, '💾 Lưu'),
        h('button', {
          class: 'btn', onclick: async () => {
            const code = encodeMap(current());
            try {
              await navigator.clipboard.writeText(code);
              toast('📋 Đã sao chép mã. Gửi cho bạn bè đi!', 'good');
            } catch {
              prompt('Sao chép mã này:', code);
            }
          },
        }, '📤 Xuất mã'),
        h('button', {
          class: 'btn', onclick: () => {
            const code = prompt('Dán mã bản đồ:');
            if (!code) return;
            try {
              load(decodeMap(code));
              drawBoard();
              drawSide();
              toast('✅ Đã nhập bản đồ', 'good');
            } catch {
              toast('Mã không hợp lệ', 'error');
            }
          },
        }, '📥 Nhập mã')),
      saved.length ? h('div', null, h('div', { class: 'section-label' }, 'Bản đồ của tôi'),
        saved.map((m, i) => h('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
          h('button', { class: 'btn sm', style: { flex: 1, justifyContent: 'flex-start' }, onclick: () => { load(m); drawBoard(); drawSide(); } }, `✏️ ${m.name} (${m.tiles.length})`),
          h('button', { class: 'btn sm ghost', title: 'Xóa', onclick: () => { if (!confirm(`Xóa "${m.name}"?`)) return; saved.splice(i, 1); storage(MAPS_KEY, saved); drawSide(); } }, '🗑️')))) : null);
  }

  function saveMap(play) {
    const m = current();
    if (m.tiles.length < 7) return toast('Bản đồ cần ít nhất 7 ô', 'error');
    const saved = (storage(MAPS_KEY) || []).filter(x => x.name !== m.name);
    saved.push(m);
    storage(MAPS_KEY, saved);
    toast(`💾 Đã lưu "${m.name}"`, 'good');
    if (play) {
      const cfg = storage('katanittes.lastConfig');
      if (cfg) {
        cfg.map.shape = 'custom';
        cfg.map.custom = m;
        storage('katanittes.lastConfig', cfg);
      } else storage('katanittes.lastConfig', { map: { shape: 'custom', custom: m } });
      App.go('lobby');
    } else drawSide();
  }

  drawBoard();
  drawSide();
}
