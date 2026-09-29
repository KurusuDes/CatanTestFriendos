// "Catan x Kchudites" motion graphics. Every frame is a pure function of the clock T,
// so the video can be recorded frame by frame (?rec) or played live.
import { h, s as S } from '../js/ui/dom.js';
import { BoardView } from '../js/ui/boardView.js';
import { createGame, applyAction, pendingActors, victoryPoints } from '../js/engine/game.js';
import { botAct } from '../js/engine/bot.js';
import { defaultConfig, PLAYER_COLORS, BOT_NAMES } from '../js/engine/config.js';
import { SHAPES, hexagon, hexCenter } from '../js/engine/board.js';
import { TILE_INFO } from '../js/engine/constants.js';

const stage = document.getElementById('stage');
const REC = new URLSearchParams(location.search).has('rec');
if (REC) document.body.classList.add('rec');
const URL_TEXT = 'kurusudes.github.io/CatanTestFriendos';

// ---------- easing ----------
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const P = (t, s, d) => clamp((t - s) / d);
const eOut = x => 1 - Math.pow(1 - x, 3);
const eIn = x => x * x * x;
const eInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eBack = x => { const c1 = 1.9, c3 = c1 + 1; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const lerp = (a, b, x) => a + (b - a) * x;
const tf = (el, x = 0, y = 0, s = 1, r = 0, o) => {
  el.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg)`;
  if (o !== undefined) el.style.opacity = o;
};
const rnd = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function fit() {
  const k = REC ? 1 : Math.min(innerWidth / 1280, innerHeight / 720);
  stage.style.transform = `scale(${k})`;
}
addEventListener('resize', fit);
fit();

// ---------- shared helpers ----------
const RESCOL = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert'];

function botConfig(shape, seed, extra) {
  const c = defaultConfig();
  c.seed = seed;
  c.players = [0, 1, 2, 3].map(i => ({ name: BOT_NAMES[i], kind: 'bot', level: ['hard', 'normal', 'normal', 'easy'][i], color: PLAYER_COLORS[i] }));
  c.map.shape = shape;
  c.map.size = 26;
  if (extra) extra(c);
  return c;
}

function makeTitle(root, kicker, text, sub, color = '#fff') {
  const k = h('div', { class: 'sc-kicker' }, kicker);
  const t = h('div', { class: 'sc-title', style: { color } }, [...text].map(ch => h('span', null, ch === ' ' ? ' ' : ch)));
  const sb = sub ? h('div', { class: 'sc-sub' }, sub) : null;
  root.append(k, t, sb || '');
  return (lt, dur) => {
    const out = eIn(P(lt, dur - 480, 420));
    [...t.children].forEach((sp, i) => {
      const p = eBack(P(lt, 60 + i * 26, 480));
      sp.style.transform = `translateY(${(1 - p) * 80 - out * 50}px) rotate(${(1 - p) * 12}deg)`;
      sp.style.opacity = P(lt, 60 + i * 26, 200) * (1 - out);
    });
    k.style.opacity = P(lt, 0, 300) * (1 - out);
    k.style.transform = `translateX(${(1 - eOut(P(lt, 0, 450))) * -50}px)`;
    if (sb) tf(sb, 0, (1 - eOut(P(lt, 450, 500))) * 24, 1, 0, P(lt, 450, 400) * (1 - out));
  };
}

function makeBoard(root, st, x, y, w, hgt, view) {
  const el = h('div', { class: 'sc-board', style: { left: x + 'px', top: y + 'px', width: w + 'px', height: hgt + 'px' } });
  root.append(el);
  const bv = new BoardView(el, { interactive: false });
  bv.render(st, view || {});
  return { el, bv };
}

const U = 100;
const HOUSE = 'M-13,10 L-13,-3 L0,-15 L13,-3 L13,10 Z';
function housePiece(color) {
  const g = S('g', null);
  const inner = S('g', null, S('path', { d: HOUSE, fill: color, stroke: '#222', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
  g.append(inner);
  return { g, inner };
}
function roadPiece(bd, eid, color) {
  const E = bd.edges[eid];
  const a = bd.vertices[E.a], c = bd.vertices[E.b];
  const k = 0.17;
  const x1 = (a.x + (c.x - a.x) * k) * U, y1 = (a.y + (c.y - a.y) * k) * U;
  const x2 = (c.x + (a.x - c.x) * k) * U, y2 = (c.y + (a.y - c.y) * k) * U;
  return S('g', null, S('line', { x1, y1, x2, y2, stroke: 'rgba(0,0,0,.7)', 'stroke-width': 21, 'stroke-linecap': 'round' }), S('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 14, 'stroke-linecap': 'round' }));
}
const emptied = st => {
  const c = JSON.parse(JSON.stringify(st));
  c.buildings = {};
  c.roads = {};
  return c;
};

function runBots(st, until, max = 4000) {
  for (let i = 0; i < max && !until(st); i++) {
    const a = pendingActors(st).map(p => botAct(st, p)).find(Boolean);
    if (!a) break;
    applyAction(st, a);
  }
  return st;
}

// ---------- background ----------
const bg = h('div', { class: 'layer bg' });
stage.append(bg);
const floaters = Array.from({ length: 16 }, (_, i) => {
  const r = RESCOL[i % 5];
  const el = h('div', { class: 'fx-hex', style: { background: TILE_INFO[r].color, opacity: 0.1, width: '70px', height: '80px', fontSize: '30px' } }, TILE_INFO[r].icon);
  bg.append(el);
  return { el, x: (i * 263) % 1280, y: (i * 157) % 720, sp: 0.4 + (i % 5) * 0.15, ph: i };
});
function bgUpdate(T) {
  for (const f of floaters) {
    const y = ((f.y - T * 0.02 * f.sp) % 820 + 820) % 820 - 100;
    tf(f.el, f.x + Math.sin(T / 1500 + f.ph) * 30, y, 1, Math.sin(T / 2000 + f.ph) * 20);
  }
}

// ---------- scenes ----------
const scenes = [];
const scene = (name, dur, enter, update) => scenes.push({ name, dur, enter, update });

// 0 · INTRO
scene('intro', 5200, (root, sc) => {
  const ring = RESCOL.concat(RESCOL).slice(0, 12).map((r, i) => {
    const el = h('div', { class: 'fx-hex', style: { background: `linear-gradient(160deg, ${TILE_INFO[r].color}, ${TILE_INFO[r].dark})` } }, TILE_INFO[r].icon);
    root.append(el);
    return el;
  });
  const t1 = h('div', { class: 'logo-t1' }, 'CATAN');
  const x = h('div', { class: 'logo-x' }, '✕');
  const t2 = h('div', { class: 'logo-t2' }, 'KCHUDITES');
  const sub = h('div', { class: 'logo-sub' }, 'Colonos, caos y modos que no existen en la caja');
  root.append(t1, x, t2, sub);
  Object.assign(sc, { ring, t1, x, t2, sub });
}, (lt, sc) => {
  const out = eIn(P(lt, 4500, 600));
  sc.ring.forEach((el, i) => {
    const p = eOut(P(lt, i * 70, 1200));
    const a = (i / 12) * Math.PI * 2 + lt / 3000;
    const R = lerp(900, 470, p) + out * 500;
    tf(el, 640 - 45 + Math.cos(a) * R * 1.15, 360 - 52 + Math.sin(a) * R * 0.62, lerp(0.4, 1, p), lerp(-180, 0, p) + lt / 40, p * 0.95 * (1 - out));
  });
  const p1 = eBack(P(lt, 650, 700));
  tf(sc.t1, 0, 0, lerp(2.6, 1, p1) * (1 + out * 0.3), 0, P(lt, 650, 250) * (1 - out));
  const px = eBack(P(lt, 1250, 550));
  tf(sc.x, 0, 0, px * (1 + out * 0.3), (1 - px) * -360, P(lt, 1250, 200) * (1 - out));
  const p2 = eOut(P(lt, 1550, 650));
  tf(sc.t2, (1 - p2) * 700, 0, 1 + out * 0.3, 0, P(lt, 1550, 300) * (1 - out));
  tf(sc.sub, 0, (1 - eOut(P(lt, 2400, 600))) * 30, 1, 0, P(lt, 2400, 500) * (1 - out));
});

// 1 · MAPS
const MAPS = ['classic', 'star', 'ring', 'islands', 'kingdoms', 'huge', 'pangea'];
scene('maps', 8400, (root, sc) => {
  sc.title = makeTitle(root, '01 · Mapas', 'Mapas a tu gusto', '10 formas + editor propio. Recursos equilibrados o caóticos, oro, puertos y desiertos a elección.');
  sc.list = h('div', { class: 'maplist', style: { top: '300px' } }, MAPS.map(k => h('div', null, SHAPES[k].name)));
  root.append(sc.list);
  sc.states = MAPS.map((k, i) => createGame(botConfig(k, 300 + i * 17, c => (c.map.gold = k === 'pangea' ? 2 : 0))));
  sc.board = makeBoard(root, sc.states[0], 540, 30, 700, 620);
  sc.chip = h('div', { class: 'chip-big', style: { left: '770px', top: '640px' } });
  root.append(sc.chip);
  sc.idx = -1;
}, (lt, sc) => {
  sc.title(lt, 8400);
  const step = 1050;
  const t = lt - 700;
  const idx = clamp(Math.floor(t / step), 0, MAPS.length - 1);
  const p = t - idx * step;
  if (idx !== sc.idx && t >= 0) {
    sc.idx = idx;
    sc.board.bv.render(sc.states[idx], {});
    [...sc.list.children].forEach((d, i) => d.classList.toggle('on', i === idx));
    sc.chip.textContent = `${SHAPES[MAPS[idx]].name} · ${sc.states[idx].board.tiles.length} hexágonos`;
  }
  const last = idx === MAPS.length - 1;
  const inP = eBack(P(p, 0, 420));
  const outP = last ? eIn(P(lt, 7900, 450)) : eIn(P(p, step - 180, 180));
  tf(sc.board.el, 0, 0, lerp(0.55, 1, inP) * (1 - outP * 0.4), (1 - inP) * -14 + outP * 10, t < 0 ? 0 : P(p, 0, 150) * (1 - outP));
  tf(sc.chip, 0, (1 - eOut(P(p, 100, 300))) * 20, 1, 0, t < 0 ? 0 : P(p, 100, 200) * (1 - outP));
  [...sc.list.children].forEach((d, i) => tf(d, i === idx ? 14 : 0, 0, 1, 0, P(lt, 300 + i * 70, 300) * (1 - eIn(P(lt, 7900, 400)))));
});

// 2 · BLINDFOLD
scene('blind', 8400, (root, sc) => {
  sc.title = makeTitle(root, '02 · Modo Blindfold', 'A ciegas 🙈', 'Nadie ve dónde ponen los demás sus casas iniciales... hasta la revelación.');
  // find a seed with at least one collision for a juicy reveal
  let st, blind, conflicts, best = null;
  for (let seed = 11; seed < 600; seed++) {
    st = createGame(botConfig('classic', seed, c => { c.modes.blindfold = true; c.rules.randomStart = false; }));
    runBots(st, s => s.setup.idx === s.setup.queue.length - 1 && s.setup.step === 'road');
    const a = botAct(st, st.setup.queue[st.setup.idx].pid);
    blind = st.blind.map(b => ({ ...b }));
    blind[blind.length - 1].eid = a.eid;
    applyAction(st, a);
    conflicts = blind.filter(b => !(st.buildings[b.vid] && st.buildings[b.vid].owner === b.pid));
    if (conflicts.length >= 1 && (!best || conflicts.length < best.conflicts.length)) best = { st, blind, conflicts };
    if (conflicts.length === 1) break;
  }
  ({ st, blind, conflicts } = best);
  const before = new Set(Object.keys(st.buildings));
  runBots(st, s => s.phase !== 'setup');
  sc.st = st;
  sc.blind = blind.slice(0, 8);
  sc.conflicts = new Set(conflicts.map(c => c.pid + ':' + c.vid));
  sc.fixes = Object.keys(st.buildings).filter(k => !before.has(k)).map(Number);
  sc.board = makeBoard(root, emptied(st), 520, 50, 740, 640);
  const svg = sc.board.bv.svg;
  const layer = S('g', null);
  svg.append(layer);
  const bd = st.board;
  sc.pieces = sc.blind.map(b => {
    const V = bd.vertices[b.vid];
    const road = b.eid != null ? roadPiece(bd, b.eid, st.players[b.pid].color) : S('g');
    const hp = housePiece(st.players[b.pid].color);
    const q = S('text', { x: 0, y: -40, 'text-anchor': 'middle', 'font-size': 34 }, '🙈');
    hp.g.append(q);
    const boom = S('text', { x: 0, y: 12, 'text-anchor': 'middle', 'font-size': 70, opacity: 0 }, '💥');
    hp.g.append(boom);
    layer.append(road, hp.g);
    return { ...b, road, hp, q, boom, x: V.x * U, y: V.y * U, bad: sc.conflicts.has(b.pid + ':' + b.vid) };
  });
  sc.fixPieces = sc.fixes.map(v => {
    const b = st.buildings[v];
    const V = bd.vertices[v];
    const hp = housePiece(st.players[b.owner].color);
    const e = bd.vertices[v].edges.find(e => st.roads[e] === b.owner);
    const road = e != null ? roadPiece(bd, e, st.players[b.owner].color) : S('g');
    layer.append(road, hp.g);
    return { hp, road, x: V.x * U, y: V.y * U };
  });
  sc.cards = h('div', { class: 'pcards' }, st.players.map(p => h('div', { class: 'pc' }, h('div', { class: 'dot', style: { background: p.color } }), p.name, h('span', { class: 'st' }, '🙈'))));
  root.append(sc.cards);
  sc.flash = h('div', { class: 'big-flash' }, '¡REVELACIÓN!');
  root.append(sc.flash);
}, (lt, sc) => {
  sc.title(lt, 8400);
  const PL = 800, GAP = 420, REVEAL = PL + sc.pieces.length * GAP + 250;
  sc.pieces.forEach((pc, i) => {
    const t0 = PL + i * GAP;
    // secret placement: visible to its owner for a moment, then hidden
    const secret = eBack(P(lt, t0, 260)) * (1 - P(lt, t0 + 330, 160));
    const drop = eOut(P(lt, REVEAL + 450 + i * 70, 380));
    let s = Math.max(secret, drop);
    let y = pc.y - (1 - drop) * (lt > REVEAL ? 90 : 0);
    let o = lt < REVEAL ? secret : P(lt, REVEAL + 450 + i * 70, 120);
    let x = pc.x;
    if (pc.bad) {
      const k = eIn(P(lt, REVEAL + 1700, 600));
      y -= k * 260;
      x += k * 120 * (i % 2 ? 1 : -1);
      o *= 1 - k;
      pc.boom.setAttribute('opacity', P(lt, REVEAL + 1300, 150) * (1 - P(lt, REVEAL + 1900, 300)));
    }
    pc.hp.g.setAttribute('transform', `translate(${x},${y})`);
    pc.hp.inner.setAttribute('transform', `scale(${1.55 * s})`);
    pc.hp.g.setAttribute('opacity', o);
    pc.q.setAttribute('opacity', lt < REVEAL ? 1 : 0);
    pc.road.setAttribute('opacity', lt < REVEAL ? secret * 0.9 : pc.bad ? o : P(lt, REVEAL + 500 + i * 70, 150));
  });
  sc.fixPieces.forEach((f, i) => {
    const p = eOut(P(lt, REVEAL + 2400 + i * 150, 400));
    f.hp.g.setAttribute('transform', `translate(${f.x},${f.y - (1 - p) * 90})`);
    f.hp.inner.setAttribute('transform', `scale(${1.55})`);
    f.hp.g.setAttribute('opacity', P(lt, REVEAL + 2400 + i * 150, 100));
    f.road.setAttribute('opacity', P(lt, REVEAL + 2500 + i * 150, 150));
  });
  // player cards: tick when each placed
  [...sc.cards.children].forEach((c, pid) => {
    const placed = sc.pieces.filter((pc, i) => pc.pid === pid && lt > PL + i * GAP + 200).length;
    c.lastChild.textContent = lt > REVEAL ? (sc.pieces.some(pc => pc.pid === pid && pc.bad) ? '💥' : '✅') : placed ? '🙈'.repeat(placed) : '⏳';
    tf(c, (1 - eOut(P(lt, 300 + pid * 90, 400))) * -60, 0, 1, 0, P(lt, 300 + pid * 90, 300) * (1 - eIn(P(lt, 7900, 400))));
  });
  const f = P(lt, REVEAL, 1000);
  const shake = lt > REVEAL && lt < REVEAL + 700 ? Math.sin(lt / 18) * 8 * (1 - f) : 0;
  tf(sc.flash, shake, 0, lerp(0.3, 1, eBack(P(lt, REVEAL, 380))), 0, P(lt, REVEAL, 120) * (1 - P(lt, REVEAL + 900, 400)));
  tf(sc.board.el, 0, 0, 1 + (lt > REVEAL ? Math.max(0, 1 - (lt - REVEAL) / 300) * 0.04 : 0), 0, eOut(P(lt, 100, 500)) * (1 - eIn(P(lt, 7900, 450))));
});

// 3 · FOG
scene('fog', 6600, (root, sc) => {
  sc.title = makeTitle(root, '03 · Niebla de guerra', 'Explora el mapa', 'El mapa se revela a medida que construyes. Combínalo con Números secretos.');
  const st = createGame(botConfig('big', 77));
  sc.board = makeBoard(root, emptied(st), 560, 50, 700, 640);
  const bd = st.board;
  const svg = sc.board.bv.svg;
  // road path heading right from the leftmost interior vertex
  let v = bd.vertices.filter(x => x.hexes.length === 3).sort((a, b) => a.x - b.x)[0].id;
  const edges = [];
  const seen = new Set([v]);
  for (let i = 0; i < 9; i++) {
    const opts = bd.vertices[v].edges.map(e => {
      const E = bd.edges[e];
      return { e, u: E.a === v ? E.b : E.a };
    }).filter(o => !seen.has(o.u));
    if (!opts.length) break;
    opts.sort((a, b) => bd.vertices[b.u].x - bd.vertices[a.u].x + (i % 2 ? 0.4 : -0.4) * (bd.vertices[b.u].y - bd.vertices[a.u].y));
    const o = opts[0];
    edges.push({ e: o.e, from: v, to: o.u });
    seen.add(o.u);
    v = o.u;
  }
  sc.revealAt = {};
  const start = edges[0].from;
  for (const h0 of bd.vertices[start].hexes) sc.revealAt[h0] = 700;
  edges.forEach((ed, i) => {
    for (const h0 of bd.vertices[ed.to].hexes) if (sc.revealAt[h0] == null) sc.revealAt[h0] = 1000 + i * 380 + 200;
  });
  const layer = S('g', null);
  const pieces = S('g', null);
  svg.append(layer, pieces);
  sc.fog = bd.tiles.map(t => {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${t.x * U + 99 * Math.cos(a)},${t.y * U + 99 * Math.sin(a)}`;
    }).join(' ');
    const g = S('g', null, S('polygon', { points: pts, fill: '#56607a', stroke: '#3e465a', 'stroke-width': 5 }), S('text', { x: t.x * U, y: t.y * U + 18, 'text-anchor': 'middle', 'font-size': 58 }, '☁️'));
    layer.append(g);
    return { g, t };
  });
  const color = st.players[0].color;
  const V0 = bd.vertices[start];
  const hp = housePiece(color);
  hp.g.setAttribute('transform', `translate(${V0.x * U},${V0.y * U})`);
  sc.house = hp;
  sc.roads = edges.map(ed => {
    const r = roadPiece(bd, ed.e, color);
    pieces.append(r);
    return r;
  });
  pieces.append(hp.g);
}, (lt, sc) => {
  sc.title(lt, 6600);
  tf(sc.board.el, 0, 0, 1, 0, eOut(P(lt, 100, 500)) * (1 - eIn(P(lt, 6150, 450))));
  sc.house.inner.setAttribute('transform', `scale(${1.55 * eBack(P(lt, 500, 400))})`);
  sc.roads.forEach((r, i) => {
    const p = eOut(P(lt, 1000 + i * 380, 260));
    r.setAttribute('opacity', p);
  });
  for (const f of sc.fog) {
    const at = sc.revealAt[f.t.id];
    const p = at == null ? 0 : eOut(P(lt, at, 450));
    const cx = f.t.x * U, cy = f.t.y * U;
    f.g.setAttribute('transform', `translate(${cx},${cy}) scale(${1 + p * 0.35}) translate(${-cx},${-cy})`);
    f.g.setAttribute('opacity', 1 - p);
  }
});

// 4 · EVENTS
const EV = [
  { icon: '🌟', name: 'Cosecha abundante', desc: 'Producción doble' },
  { icon: '🌋', name: 'Terremoto', desc: 'Los números cambian' },
  { icon: '🕶️', name: 'Mercado negro', desc: 'Un recurso 2:1' },
  { icon: '🌪️', name: 'Tormenta', desc: 'El ladrón sale volando' },
  { icon: '🦠', name: 'Plaga', desc: 'Pierdes una carta' },
  { icon: '🌀', name: 'Tierra viva', desc: 'El mapa se baraja' },
];
scene('events', 6200, (root, sc) => {
  root.style.perspective = '1400px';
  sc.title = makeTitle(root, '04 · Eventos y caos', 'Cada ronda, una sorpresa', 'Sequías, terremotos, mercado negro, tormentas, rebeliones y tierra viva.');
  sc.cards = EV.map(ev => {
    const c = h('div', { class: 'card-ev' },
      h('div', { class: 'face front' }, h('div', { class: 'ic' }, ev.icon), h('b', null, ev.name), h('small', null, ev.desc)),
      h('div', { class: 'face back' }, '🎲'));
    root.append(c);
    return c;
  });
}, (lt, sc) => {
  sc.title(lt, 6200);
  const out = eIn(P(lt, 5700, 450));
  sc.cards.forEach((c, i) => {
    const t0 = 800 + i * 260;
    const p = eOut(P(lt, t0, 520));
    const flip = eInOut(P(lt, t0 + 350, 450));
    const fx = 130 + i * 175, fy = 330 + Math.abs(i - 2.5) * 18;
    const x = lerp(1100, fx, p), y = lerp(760, fy, p) + out * 500;
    const rot = lerp(30, (i - 2.5) * 5, p);
    const hover = lt > t0 + 900 ? Math.sin((lt - t0) / 300) * 6 : 0;
    c.style.transform = `translate(${x}px,${y + hover}px) rotate(${rot}deg) rotateY(${180 - flip * 180}deg) scale(${lerp(0.7, 1, p)})`;
    c.style.opacity = P(lt, t0, 100) * (1 - out);
  });
});

// 5 · BOTS
let botFrames = null;
scene('bots', 7000, (root, sc) => {
  sc.title = makeTitle(root, '05 · Bots', 'Bots con carácter', 'Tres niveles: fácil, normal y difícil. Juega solo, en hotseat o míralos pelear.');
  sc.board = makeBoard(root, JSON.parse(botFrames[0]), 560, 60, 690, 640);
  const players = JSON.parse(botFrames[0]).players;
  sc.bars = players.map(p => {
    const fill = h('div', { class: 'fill', style: { background: p.color, width: '0%' } });
    const label = h('span');
    const row = h('div', { class: 'row' }, h('div', null, `${p.kind === 'bot' ? '🤖 ' : ''}${p.name} `, label), h('div', { class: 'track' }, fill));
    return { row, fill, label };
  });
  root.append(h('div', { class: 'vpbars' }, sc.bars.map(b => b.row)));
  sc.lvls = h('div', { class: 'lvl' },
    h('span', { style: { background: '#1d4d38' } }, '🙂 Fácil'), h('span', { style: { background: '#4d4a1d' } }, '😎 Normal'), h('span', { style: { background: '#5c2230' } }, '😈 Difícil'));
  root.append(sc.lvls);
  sc.win = h('div', { class: 'chip-big', style: { left: '690px', top: '600px', borderColor: '#3ddc84' } });
  root.append(sc.win);
  sc.idx = -1;
}, (lt, sc) => {
  sc.title(lt, 7000);
  const n = botFrames.length - 1;
  const idx = Math.round(eInOut(P(lt, 500, 5300)) * n);
  if (idx !== sc.idx) {
    sc.idx = idx;
    const st = JSON.parse(botFrames[idx]);
    sc.st = st;
    sc.board.bv.render(st, { rolled: st.dice ? st.dice[0] + st.dice[1] : null });
    const target = st.config.rules.vpTarget;
    sc.bars.forEach((b, i) => {
      const vp = victoryPoints(st, i);
      b.fill.style.width = (vp / target) * 100 + '%';
      b.label.textContent = `${vp} PV`;
    });
    if (st.phase === 'gameOver') sc.win.textContent = `🏆 ${st.players[st.winner].name} gana`;
  }
  const out = eIn(P(lt, 6550, 450));
  tf(sc.board.el, 0, 0, 1, 0, eOut(P(lt, 100, 500)) * (1 - out));
  sc.bars.forEach((b, i) => tf(b.row, (1 - eOut(P(lt, 400 + i * 90, 400))) * -60, 0, 1, 0, P(lt, 400 + i * 90, 300) * (1 - out)));
  tf(sc.lvls, 0, (1 - eOut(P(lt, 900, 400))) * 30, 1, 0, P(lt, 900, 300) * (1 - out));
  tf(sc.win, 0, 0, eBack(P(lt, 5900, 400)), 0, P(lt, 5900, 100) * (1 - out));
});

// 6 · 3D
let Board3D = null;
scene('3d', 7000, (root, sc) => {
  const holder = h('div', { style: { position: 'absolute', inset: 0 } });
  root.append(holder);
  sc.b3d = new Board3D(holder);
  sc.b3d.alive = false;
  sc.b3d.resize();
  const st = JSON.parse(botFrames[botFrames.length - 1]);
  sc.b3d.render(st, {});
  sc.b3d.controls.enabled = false;
  sc.b3d.controls.enableDamping = false;
  const shade = h('div', { class: 'layer', style: { background: 'linear-gradient(90deg, rgba(8,14,28,.85) 0%, rgba(8,14,28,.4) 38%, transparent 60%)' } });
  root.append(shade);
  sc.title = makeTitle(root, '06 · Vista 3D', 'Tablero en 3D', 'Three.js low-poly: bosques, montañas nevadas, ovejas, agua animada y sombras.');
  sc.center = sc.b3d.controls.target.clone();
}, (lt, sc) => {
  sc.title(lt, 7000);
  const b = sc.b3d;
  const a = -0.9 + lt / 7000 * 1.5;
  const d = lerp(12, 9, eInOut(P(lt, 0, 7000)));
  const c = sc.center;
  b.camera.position.set(c.x + Math.sin(a) * d * 0.75 - 1.5, lerp(9.5, 6.5, eInOut(P(lt, 0, 7000))), c.z + Math.cos(a) * d * 0.75);
  b.camera.lookAt(c.x - 1.2, 0, c.z);
  b.controls.target.set(c.x - 1.2, 0, c.z);
  b.clock = { getElapsedTime: () => lt / 1000 };
  b.controls.update = () => {};
  b.tick();
}, );
scenes[scenes.length - 1].exit = sc => sc.b3d && sc.b3d.dispose();

// 7 · ONLINE + EDITOR
scene('online', 5800, (root, sc) => {
  root.append(h('div', { class: 'divider' }));
  const left = h('div', { class: 'layer' });
  const right = h('div', { class: 'layer' });
  root.append(left, right);
  sc.t1 = makeTitle(left, '07 · Online', 'Con amigos', null);
  sc.code = [...'HW36W'].map((ch, i) => {
    const el = h('div', { class: 'room', style: { left: 80 + i * 96 + 'px', top: '200px', width: '84px', padding: '6px 0', letterSpacing: 0, textAlign: 'center' } }, ch);
    left.append(el);
    return el;
  });
  sc.devs = [h('div', { class: 'device', style: { left: '80px', top: '360px' } }, '🧑'), h('div', { class: 'device', style: { left: '400px', top: '360px' } }, '👩')];
  sc.link = h('div', { class: 'link-line', style: { left: '255px', top: '505px', width: '150px' } });
  left.append(...sc.devs, sc.link);
  // editor
  const t2 = h('div', { class: 'layer', style: { left: '640px' } });
  right.append(t2);
  sc.t2 = makeTitle(t2, '08 · Editor', 'Crea tus mapas', null);
  const svg = S('svg', { viewBox: '-560 -480 1120 960', style: 'position:absolute;left:700px;top:170px;width:520px;height:450px' });
  right.append(svg);
  const r = rnd(42);
  const cells = hexagon(3).sort((a, b) => Math.hypot(...Object.values(hexCenter(...a))) - Math.hypot(...Object.values(hexCenter(...b))));
  sc.cells = cells.map(([q, rr]) => {
    const c = hexCenter(q, rr);
    const res = RESCOL[Math.floor(r() * 7)];
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${96 * Math.cos(a)},${96 * Math.sin(a)}`;
    }).join(' ');
    svg.append(S('polygon', { points: pts, transform: `translate(${c.x * 100},${c.y * 100})`, fill: 'rgba(255,255,255,.05)', stroke: 'rgba(255,255,255,.2)', 'stroke-width': 3, 'stroke-dasharray': '8 8' }));
    const g = S('g', null, S('polygon', { points: pts, fill: TILE_INFO[res].color, stroke: 'rgba(0,0,0,.35)', 'stroke-width': 6 }), S('text', { y: 14, 'text-anchor': 'middle', 'font-size': 52 }, TILE_INFO[res].icon));
    svg.append(g);
    return { g, x: c.x * 100, y: c.y * 100 };
  });
  sc.cursor = S('text', { 'font-size': 70 }, '🖌️');
  svg.append(sc.cursor);
}, (lt, sc) => {
  sc.t1(lt, 5800);
  sc.t2(lt - 200, 5600);
  const out = eIn(P(lt, 5350, 450));
  sc.code.forEach((el, i) => tf(el, 0, (1 - eBack(P(lt, 500 + i * 160, 380))) * 60, 1, 0, P(lt, 500 + i * 160, 120) * (1 - out)));
  sc.devs.forEach((d, i) => tf(d, 0, Math.sin(lt / 300 + i * 2) * 6 + (1 - eOut(P(lt, 1300 + i * 150, 500))) * 120, 1, 0, P(lt, 1300 + i * 150, 300) * (1 - out)));
  sc.link.style.backgroundPosition = `${lt / 8}px 0`;
  sc.link.style.opacity = P(lt, 2000, 300) * (1 - out);
  let cur = null;
  sc.cells.forEach((c, i) => {
    const t0 = 900 + i * 95;
    const p = eBack(P(lt, t0, 300));
    c.g.setAttribute('transform', `translate(${c.x},${c.y}) scale(${p})`);
    c.g.setAttribute('opacity', P(lt, t0, 80) * (1 - out));
    if (lt >= t0) cur = c;
  });
  if (cur) sc.cursor.setAttribute('transform', `translate(${cur.x + 10},${cur.y - 10})`);
  sc.cursor.setAttribute('opacity', (lt > 900 ? 1 : 0) * (1 - out));
});

// 8 · OUTRO
const FEATURES = ['🙈 Blindfold', '🌫️ Niebla', '❓ Números secretos', '🎲 Eventos', '🌀 Tierra viva', '💰 Oro', '🗺️ 10 mapas', '✏️ Editor', '🤖 Bots', '🌐 Online', '🧊 3D', '📱 Móvil'];
scene('outro', 6400, (root, sc) => {
  sc.t1 = h('div', { class: 'logo-t1', style: { top: '70px', fontSize: '140px' } }, 'CATAN');
  sc.x = h('div', { class: 'logo-x', style: { top: '220px', fontSize: '60px' } }, '✕');
  sc.t2 = h('div', { class: 'logo-t2', style: { top: '290px', fontSize: '100px' } }, 'KCHUDITES');
  sc.cta = h('div', { class: 'logo-sub', style: { top: '430px', fontSize: '34px', color: '#fff' } }, '¡Arma tu mapa, elige tu caos y juega!');
  sc.feats = FEATURES.map(f => h('span', null, f));
  sc.grid = h('div', { class: 'feature-grid' }, sc.feats);
  sc.url = h('div', { class: 'url' }, '▶ ' + URL_TEXT);
  root.append(sc.t1, sc.x, sc.t2, sc.cta, sc.grid, sc.url);
}, (lt, sc) => {
  const out = eIn(P(lt, 5900, 500));
  tf(sc.t1, 0, (1 - eBack(P(lt, 100, 600))) * -200, 1, 0, P(lt, 100, 200) * (1 - out));
  tf(sc.x, 0, 0, eBack(P(lt, 500, 450)), (1 - eOut(P(lt, 500, 450))) * 360, P(lt, 500, 150) * (1 - out));
  tf(sc.t2, (1 - eOut(P(lt, 700, 550))) * -700, 0, 1, 0, P(lt, 700, 250) * (1 - out));
  tf(sc.cta, 0, (1 - eOut(P(lt, 1300, 500))) * 20, 1, 0, P(lt, 1300, 400) * (1 - out));
  sc.feats.forEach((f, i) => tf(f, 0, 0, eBack(P(lt, 1700 + i * 90, 350)), 0, P(lt, 1700 + i * 90, 100) * (1 - out)));
  tf(sc.url, 0, 0, 1 + Math.sin(lt / 250) * 0.03 * P(lt, 3200, 300), 0, P(lt, 3000, 400) * (1 - out));
});

// ---------- timeline ----------
let t = 0;
for (const sc of scenes) {
  sc.start = t;
  t += sc.dur;
}
const TOTAL = t;

function frame(T) {
  bgUpdate(T);
  for (const sc of scenes) {
    const active = T >= sc.start && T < sc.start + sc.dur;
    if (active && !sc.root) {
      sc.root = h('div', { class: 'layer' });
      stage.append(sc.root);
      sc.enter(sc.root, sc);
    }
    if (!active && sc.root) {
      if (sc.exit) sc.exit(sc);
      sc.root.remove();
      sc.root = null;
    }
    if (active) {
      const lt = T - sc.start;
      sc.root.style.opacity = P(lt, 0, 250) * (1 - P(lt, sc.dur - 200, 200));
      sc.update(lt, sc);
    }
  }
  document.getElementById('barFill').style.width = (T / TOTAL) * 100 + '%';
}

async function init() {
  await document.fonts.ready;
  ({ Board3D } = await import('../js/ui/board3d.js'));
  // precompute a full bot game for the bots + 3D scenes
  let st;
  for (let seed = 900; ; seed++) {
    st = createGame(botConfig('classic', seed, c => (c.rules.randomStart = false)));
    const frames = [JSON.stringify(st)];
    for (let i = 0; i < 5000 && st.phase !== 'gameOver'; i++) {
      const a = pendingActors(st).map(p => botAct(st, p)).find(Boolean);
      if (!a) break;
      applyAction(st, a);
      if (a.type !== 'respondTrade') frames.push(JSON.stringify(st));
    }
    if (st.phase === 'gameOver' && frames.length < 700) {
      botFrames = frames;
      break;
    }
  }
  window.__total = TOTAL;
  window.__seek = T => frame(T);
  window.__ready = true;
  if (REC) return;
  let t0 = performance.now();
  document.getElementById('replay').onclick = () => (t0 = performance.now());
  const loop = () => {
    let T = performance.now() - t0;
    if (T >= TOTAL + 1500) {
      t0 = performance.now();
      T = 0;
    }
    frame(Math.min(T, TOTAL - 1));
    requestAnimationFrame(loop);
  };
  loop();
}
init();
