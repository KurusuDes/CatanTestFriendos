// SVG board renderer with pan & zoom. Pure view: it receives the state plus a
// "view" object describing what the local viewer may see and click.
import { TILE_INFO, pips } from '../engine/constants.js';
import { s as S, clear } from './dom.js';

const U = 100; // svg units per hex radius
const hexPoints = (cx, cy, r) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

const HOUSE = 'M-13,10 L-13,-3 L0,-15 L13,-3 L13,10 Z';
const CITY = 'M-20,12 L-20,-5 L-9,-5 L-9,-13 L1,-23 L11,-13 L11,-2 L20,-2 L20,12 Z';

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(x => Math.max(0, Math.min(255, Math.round(x * f))));
  return '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
}

export class BoardView {
  constructor(container, { interactive = true } = {}) {
    this.container = container;
    this.interactive = interactive;
    this.svg = S('svg', { class: 'board-svg', xmlns: 'http://www.w3.org/2000/svg' });
    container.append(this.svg);
    this.zoom = 1;
    this.cx = null;
    this.cy = null;
    this.prevPieces = new Set();
    this.boundsKey = '';
    if (interactive) this.initPanZoom();
  }

  initPanZoom() {
    const svg = this.svg;
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      this.setZoom(this.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
    }, { passive: false });
    const pts = new Map();
    let start = null;
    svg.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy, zoom: this.zoom, dist: null, moved: false };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        start.dist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    svg.addEventListener('pointermove', e => {
      if (!start || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = svg.getBoundingClientRect();
      const scale = this.vbW / rect.width;
      if (pts.size === 2 && start.dist) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.setZoom((start.zoom * d) / start.dist);
        return;
      }
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) < 6) return;
      start.moved = true;
      this.dragging = true;
      this.cx = start.cx - dx * scale;
      this.cy = start.cy - dy * scale;
      this.applyViewBox();
    });
    const end = e => {
      pts.delete(e.pointerId);
      if (!pts.size) {
        start = null;
        setTimeout(() => (this.dragging = false), 0);
      }
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', end);
  }

  setZoom(z) {
    this.zoom = Math.max(0.6, Math.min(4, z));
    this.applyViewBox();
  }

  resetView() {
    this.zoom = 1;
    this.cx = this.bx;
    this.cy = this.by;
    this.applyViewBox();
  }

  applyViewBox() {
    if (this.cx == null) return;
    this.vbW = this.baseW / this.zoom;
    this.vbH = this.baseH / this.zoom;
    this.svg.setAttribute('viewBox', `${this.cx - this.vbW / 2} ${this.cy - this.vbH / 2} ${this.vbW} ${this.vbH}`);
  }

  // view = { viewer, interaction: {kind, legal:Set, onPick}, rolled, blindOwn:[], showAll }
  render(st, view = {}) {
    const bd = st.board;
    const b = bd.bounds;
    const key = `${b.minX},${b.maxX},${b.minY},${b.maxY}`;
    if (key !== this.boundsKey) {
      this.boundsKey = key;
      this.baseW = (b.maxX - b.minX) * U;
      this.baseH = (b.maxY - b.minY) * U;
      this.bx = ((b.minX + b.maxX) / 2) * U;
      this.by = ((b.minY + b.maxY) / 2) * U;
      this.cx = this.bx;
      this.cy = this.by;
      this.zoom = 1;
    }
    this.applyViewBox();
    const svg = clear(this.svg);
    const inter = view.interaction || null;
    const legal = inter ? inter.legal : new Set();
    const pick = (id, e) => {
      if (this.dragging) return;
      e.stopPropagation();
      inter && inter.onPick(id);
    };

    svg.append(
      S('defs', null,
        S('radialGradient', { id: 'seaG', cx: '50%', cy: '50%', r: '70%' },
          S('stop', { offset: '0%', 'stop-color': '#2f8fd0' }),
          S('stop', { offset: '100%', 'stop-color': '#12507f' })),
        S('radialGradient', { id: 'tokenG', cx: '40%', cy: '35%', r: '70%' },
          S('stop', { offset: '0%', 'stop-color': '#fffaf0' }),
          S('stop', { offset: '100%', 'stop-color': '#eadcbc' })),
        S('filter', { id: 'shadow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
          S('feDropShadow', { dx: 0, dy: 3, stdDeviation: 3, 'flood-opacity': 0.45 })),
        S('pattern', { id: 'fogP', width: 24, height: 24, patternUnits: 'userSpaceOnUse' },
          S('rect', { width: 24, height: 24, fill: '#56607a' }),
          S('circle', { cx: 6, cy: 6, r: 5, fill: '#6a7592' }),
          S('circle', { cx: 18, cy: 16, r: 6, fill: '#626d88' })))
    );

    // sea
    const gSea = S('g', { class: 'sea' });
    for (const t of bd.sea) gSea.append(S('polygon', { points: hexPoints(t.x * U, t.y * U, U * 1.02), class: 'sea-hex' }));
    svg.append(gSea);

    // land tiles
    const gLand = S('g', { class: 'land' });
    const rolled = view.rolled;
    for (const t of bd.tiles) {
      const cx = t.x * U, cy = t.y * U;
      const info = TILE_INFO[t.res] || TILE_INFO.desert;
      const hidden = !t.revealed;
      const g = S('g', { class: 'tile' + (hidden ? ' fog' : '') + (rolled && t.num === rolled && t.revealed ? ' rolled' : '') + (view.pulseTiles && view.pulseTiles.has(t.id) ? ' pulse' : ''), 'data-tile': t.id });
      g.append(S('polygon', { points: hexPoints(cx, cy, U * 0.97), fill: hidden ? 'url(#fogP)' : info.color, stroke: hidden ? '#3e465a' : shade(info.color, 0.62), 'stroke-width': 5, class: 'hex' }));
      g.append(S('polygon', { points: hexPoints(cx, cy, U * 0.8), fill: 'none', stroke: hidden ? '#6d7894' : shade(info.color, 1.18), 'stroke-width': 3, opacity: 0.55 }));
      if (hidden) {
        g.append(S('text', { x: cx, y: cy + 16, class: 'tile-icon fog-icon', 'font-size': 58 }, '☁️'));
        g.append(S('text', { x: cx, y: cy + 8, class: 'fog-q' }, '?'));
      } else {
        g.append(S('text', { x: cx, y: cy - (t.num || !t.numRevealed ? 36 : 0) + (t.num || !t.numRevealed ? 0 : 18), class: 'tile-icon', 'font-size': t.num || !t.numRevealed ? 38 : 56 }, info.icon));
        if (t.res !== 'desert') {
          const tk = S('g', { class: 'token' + (t.numRevealed && (t.num === 6 || t.num === 8) ? ' red' : '') });
          tk.append(S('circle', { cx, cy: cy + 18, r: 27, fill: 'url(#tokenG)', stroke: '#9c8a60', 'stroke-width': 2, filter: 'url(#shadow)' }));
          if (t.numRevealed) {
            tk.append(S('text', { x: cx, y: cy + 24, class: 'token-num' }, t.num));
            const p = pips(t.num);
            for (let i = 0; i < p; i++) tk.append(S('circle', { cx: cx + (i - (p - 1) / 2) * 6, cy: cy + 36, r: 2.3, class: 'pip' }));
          } else tk.append(S('text', { x: cx, y: cy + 27, class: 'token-num q' }, '?'));
          g.append(tk);
        }
      }
      gLand.append(g);
    }
    svg.append(gLand);

    // ports
    const gPorts = S('g', { class: 'ports' });
    for (const p of bd.ports) {
      const E = bd.edges[p.edge];
      const px = p.x * U, py = p.y * U;
      for (const v of [E.a, E.b]) {
        const V = bd.vertices[v];
        gPorts.append(S('line', { x1: px, y1: py, x2: V.x * U, y2: V.y * U, class: 'dock' }));
      }
      const label = p.type === 'any' ? '3:1' : '2:1';
      gPorts.append(S('circle', { cx: px, cy: py, r: 25, class: 'port ' + p.type, filter: 'url(#shadow)' }));
      if (p.type !== 'any') gPorts.append(S('text', { x: px, y: py - 1, class: 'port-icon' }, TILE_INFO[p.type].icon));
      gPorts.append(S('text', { x: px, y: py + (p.type === 'any' ? 7 : 18), class: 'port-label' + (p.type === 'any' ? ' big' : '') }, label));
    }
    svg.append(gPorts);

    // robber highlight tiles (under pieces)
    if (inter && inter.kind === 'robber') {
      const gR = S('g', { class: 'hot-tiles' });
      for (const id of legal) {
        const t = bd.tiles[id];
        gR.append(S('polygon', { points: hexPoints(t.x * U, t.y * U, U * 0.9), class: 'hot-tile', onclick: e => pick(id, e) }));
      }
      svg.append(gR);
    }

    // roads
    const pieces = new Set();
    const gRoads = S('g', { class: 'roads' });
    const drawRoad = (eid, color, extra = '') => {
      const E = bd.edges[eid];
      const a = bd.vertices[E.a], c = bd.vertices[E.b];
      const k = 0.17;
      const x1 = (a.x + (c.x - a.x) * k) * U, y1 = (a.y + (c.y - a.y) * k) * U;
      const x2 = (c.x + (a.x - c.x) * k) * U, y2 = (c.y + (a.y - c.y) * k) * U;
      const key = 'r' + eid + extra;
      const isNew = this.prevPieces.size && !this.prevPieces.has(key);
      pieces.add(key);
      const g = S('g', { class: 'road' + extra + (isNew ? ' new' : '') });
      g.append(S('line', { x1, y1, x2, y2, class: 'road-out' }));
      g.append(S('line', { x1, y1, x2, y2, class: 'road-in', stroke: color }));
      gRoads.append(g);
    };
    for (const k in st.roads) drawRoad(+k, st.players[st.roads[k]].color);
    for (const b of view.blindOwn || []) if (b.eid != null) drawRoad(b.eid, st.players[b.pid].color, ' ghost');
    svg.append(gRoads);

    // buildings
    const gB = S('g', { class: 'buildings' });
    const drawBuilding = (vid, owner, type, extra = '') => {
      const V = bd.vertices[vid];
      const key = 'b' + vid + type + extra;
      const isNew = this.prevPieces.size && !this.prevPieces.has(key);
      pieces.add(key);
      const color = st.players[owner].color;
      const g = S('g', { class: 'piece ' + type + extra + (isNew ? ' new' : ''), transform: `translate(${V.x * U},${V.y * U}) scale(1.55)` });
      g.append(S('path', { d: type === 'city' ? CITY : HOUSE, fill: color, stroke: shade(color, 0.45), 'stroke-width': 2.2, 'stroke-linejoin': 'round', filter: 'url(#shadow)' }));
      if (type === 'city') g.append(S('rect', { x: -4, y: 1, width: 7, height: 11, fill: shade(color, 0.5) }));
      else g.append(S('rect', { x: -3.5, y: 1, width: 7, height: 9, fill: shade(color, 0.5) }));
      gB.append(g);
    };
    for (const k in st.buildings) drawBuilding(+k, st.buildings[k].owner, st.buildings[k].type);
    for (const b of view.blindOwn || []) drawBuilding(b.vid, b.pid, b.type, ' ghost');
    svg.append(gB);

    // robber
    if (bd.robber >= 0 && !st.config.rules.noRobber) {
      const t = bd.tiles[bd.robber];
      const g = S('g', { class: 'robber', transform: `translate(${t.x * U - 40},${t.y * U + 6})` });
      g.append(S('ellipse', { cx: 0, cy: 22, rx: 15, ry: 5, fill: 'rgba(0,0,0,.35)' }));
      g.append(S('path', { d: 'M-12,22 C-14,4 -8,-4 0,-4 C8,-4 14,4 12,22 Z', class: 'robber-body' }));
      g.append(S('circle', { cx: 0, cy: -12, r: 10, class: 'robber-body' }));
      g.append(S('rect', { x: -7, y: -15, width: 14, height: 4, rx: 2, fill: '#e53935' }));
      svg.append(g);
    }

    // hotspots
    if (inter && (inter.kind === 'settlement' || inter.kind === 'city')) {
      const g = S('g', { class: 'hot' });
      for (const v of legal) {
        const V = bd.vertices[v];
        g.append(S('circle', { cx: V.x * U, cy: V.y * U, r: 14, class: 'hot-v', style: `--pc:${inter.color || '#fff'}` }));
        g.append(S('circle', { cx: V.x * U, cy: V.y * U, r: 24, class: 'hit', onclick: e => pick(v, e) }));
      }
      svg.append(g);
    }
    if (inter && inter.kind === 'road') {
      const g = S('g', { class: 'hot' });
      for (const e of legal) {
        const E = bd.edges[e];
        const a = bd.vertices[E.a], c = bd.vertices[E.b];
        const x1 = (a.x + (c.x - a.x) * 0.24) * U, y1 = (a.y + (c.y - a.y) * 0.24) * U;
        const x2 = (c.x + (a.x - c.x) * 0.24) * U, y2 = (c.y + (a.y - c.y) * 0.24) * U;
        g.append(S('line', { x1, y1, x2, y2, class: 'hot-e-bg' }));
        g.append(S('line', { x1, y1, x2, y2, class: 'hot-e', style: `--pc:${inter.color || '#fff'}` }));
        g.append(S('line', { x1, y1, x2, y2, class: 'hit-e', onclick: ev => pick(e, ev) }));
      }
      svg.append(g);
    }
    this.prevPieces = pieces;
  }
}
