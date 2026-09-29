// "Catan x Kchudites" motion graphics. Every frame is a pure function of the clock T
// (the 3D view included), so the video can be recorded frame by frame (?rec) or played live.
import { h, s as S } from '../js/ui/dom.js';
import { createGame, applyAction, pendingActors, victoryPoints, viewFor } from '../js/engine/game.js';
import { botAct } from '../js/engine/bot.js';
import { defaultConfig, PLAYER_COLORS, BOT_NAMES } from '../js/engine/config.js';
import { SHAPES, hexagon, hexCenter } from '../js/engine/board.js';
import { TILE_INFO } from '../js/engine/constants.js';
import { pixelize, pxIcon } from '../js/ui/pixel.js';

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
const step = (x, n) => Math.round(x * n) / n; // chunky, pixel-like motion
const tf = (el, x = 0, y = 0, s = 1, r = 0, o) => {
  el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) scale(${s}) rotate(${r}deg)`;
  if (o !== undefined) el.style.opacity = o;
};

function fit() {
  const k = REC ? 1 : Math.min(innerWidth / 1280, innerHeight / 720);
  stage.style.transform = `scale(${k})`;
}
addEventListener('resize', fit);
fit();

function botConfig(shape, seed, extra) {
  const c = defaultConfig();
  c.seed = seed;
  c.rules.randomStart = false;
  c.players = [0, 1, 2, 3].map(i => ({ name: BOT_NAMES[i], kind: 'bot', level: ['hard', 'normal', 'normal', 'easy'][i], color: PLAYER_COLORS[i] }));
  c.map.shape = shape;
  c.map.size = 26;
  if (extra) extra(c);
  return c;
}
const step1 = st => {
  const a = pendingActors(st).map(p => botAct(st, p)).find(Boolean);
  if (a) applyAction(st, a);
  return a;
};
const clone = st => JSON.parse(JSON.stringify(st));

function makeTitle(root, kicker, text, sub) {
  const k = h('div', { class: 'sc-kicker' }, kicker);
  const t = h('div', { class: 'sc-title' }, [...text].map(ch => h('span', null, ch === ' ' ? ' ' : ch)));
  const sb = sub ? h('div', { class: 'sc-sub' }, sub) : null;
  root.append(k, t, sb || '');
  return (lt, dur) => {
    const out = eIn(P(lt, dur - 420, 380));
    [...t.children].forEach((sp, i) => {
      const p = eBack(P(lt, 60 + i * 24, 420));
      const j = Math.floor(lt / 120 + i * 3) % 4; // pixel "boil"
      const jx = [0, 1, -1, 0][j], jy = [0, -1, 0, 1][j];
      sp.style.transform = `translate(${jx}px,${Math.round((1 - p) * 70 - out * 40) + jy}px)`;
      sp.style.opacity = P(lt, 60 + i * 24, 120) * (1 - out);
    });
    k.style.opacity = P(lt, 0, 250) * (1 - out);
    tf(k, (1 - eOut(P(lt, 0, 400))) * -50);
    if (sb) tf(sb, 0, (1 - eOut(P(lt, 400, 450))) * 20, 1, 0, P(lt, 400, 350) * (1 - out));
  };
}

// ---------- persistent 3D layer ----------
let B = null;
const layer3d = h('div', { class: 'layer', style: { opacity: 0 } });
const shade = h('div', { class: 'layer shade' });
stage.append(layer3d, shade);
let T3 = 0;
const show3d = (st, view) => B.render(st, view || {});
function cam(x, y, z, tx, ty, tz) {
  B.camera.position.set(x, y, z);
  B.controls.target.set(tx, ty, tz);
  B.camera.lookAt(tx, ty, tz);
}
function orbit(bounds, ang, dist, height, ox = 0, oz = 0) {
  const cx = (bounds.minX + bounds.maxX) / 2 + ox, cz = (bounds.minY + bounds.maxY) / 2 + oz;
  cam(cx + Math.sin(ang) * dist, height, cz + Math.cos(ang) * dist, cx, 0.2, cz);
}
const LEFT_SHADE = 'linear-gradient(90deg, rgba(26,28,44,.88) 0%, rgba(26,28,44,.35) 40%, transparent 62%)';

// ---------- scenes ----------
const scenes = [];
const scene = (name, dur, opts) => scenes.push({ name, dur, ...opts });

// 0 · INTRO over a slow 3D flyover
scene('intro', 5000, {
  use3d: true,
  enter(root, sc) {
    sc.st = sc.st || createGame(botConfig('pangea', 4242, c => ((c.map.size = 32), (c.map.gold = 1))));
    show3d(sc.st, {});
    B.labels.domElement.style.visibility = 'hidden';
    sc.t1 = h('div', { class: 'logo-t1' }, 'CATAN');
    sc.x = h('div', { class: 'logo-x' }, 'x');
    sc.t2 = h('div', { class: 'logo-t2' }, 'KCHUDITES');
    sc.sub = h('div', { class: 'logo-sub' }, 'Colonos, caos y modos que no existen en la caja');
    root.append(sc.t1, sc.x, sc.t2, sc.sub);
  },
  update(lt, sc) {
    orbit(sc.st.board.bounds, -0.6 + lt / 9000, 11 - lt / 1500, 9 - lt / 1400);
    const out = eIn(P(lt, 4450, 500));
    const boil = i => [0, 1, -1, 0][Math.floor(lt / 110 + i) % 4];
    tf(sc.t1, boil(0), (1 - eBack(P(lt, 300, 650))) * -220 + boil(1), 1, 0, P(lt, 300, 150) * (1 - out));
    tf(sc.x, 0, 0, eBack(P(lt, 900, 400)), 0, P(lt, 900, 100) * (1 - out));
    tf(sc.t2, (1 - eOut(P(lt, 1150, 550))) * 800 + boil(2), boil(3), 1, 0, P(lt, 1150, 200) * (1 - out));
    tf(sc.sub, 0, (1 - eOut(P(lt, 2000, 500))) * 20, 1, 0, P(lt, 2000, 400) * (1 - out));
    shade.style.background = `rgba(26,28,44,${0.45 - P(lt, 3500, 1000) * 0.2})`;
  },
  exit() {
    B.labels.domElement.style.visibility = '';
  },
});

// 1 · CIV-LIKE MAP
let botFrames = null;
scene('civ', 7000, {
  use3d: true,
  enter(root, sc) {
    sc.st = JSON.parse(botFrames[Math.floor(botFrames.length * 0.7)]);
    show3d(sc.st, {});
    sc.title = makeTitle(root, '01 · Un mapa vivo', 'Una maqueta viva', 'Terreno texturizado, trigo y hierba al viento, agua con espuma y sombras de nubes. Modelos hechos en Blender.');
  },
  update(lt, sc) {
    sc.title(lt, 7000);
    const b = sc.st.board.bounds;
    orbit(b, 0.9 - lt / 5000, lerp(7.5, 4.8, eInOut(P(lt, 0, 7000))), lerp(6.5, 3.6, eInOut(P(lt, 0, 7000))), 0.8, 0.3);
    shade.style.background = LEFT_SHADE;
  },
});

// 2 · BLINDFOLD: face-down board, visible houses, big flip
scene('flip', 8600, {
  use3d: true,
  enter(root, sc) {
    const st = createGame(botConfig('classic', 515, c => (c.modes.flipped = true)));
    sc.frames = [clone(st)];
    let guard = 0;
    while (st.phase === 'setup' && guard++ < 200) {
      if (!step1(st)) break;
      sc.frames.push(clone(st));
    }
    sc.final = sc.frames.pop();
    sc.idx = -1;
    sc.title = makeTitle(root, '02 · Modo insignia', 'Blindfold 🙈', 'Tablero boca abajo: pones tus casas a ciegas (los demás sí las ven) y al final... ¡se voltea todo!');
    sc.flash = h('div', { class: 'big-flash' }, '¡SE VOLTEA!');
    root.append(sc.flash);
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 8600);
    const b = sc.final.board.bounds;
    const FLIP = 5300;
    const i = lt < FLIP ? clamp(Math.floor(((lt - 700) / (FLIP - 900)) * sc.frames.length), 0, sc.frames.length - 1) : -2;
    if (i !== sc.idx) {
      sc.idx = i;
      if (i >= 0) show3d(sc.frames[i], { faceDown: true });
      else show3d(sc.final, { faceDown: true, flipAt: (sc.flipT = T3) });
    }
    orbit(b, 0.3 + lt / 14000, lerp(8.5, 7.2, P(lt, 0, 8600)), lerp(8.5, 6.8, P(lt, 0, 8600)), 1.2);
    shade.style.background = LEFT_SHADE;
    const shake = lt > FLIP && lt < FLIP + 600 ? [0, 6, -6, 3][Math.floor(lt / 40) % 4] : 0;
    tf(sc.flash, shake, 0, lerp(0.3, 1, eBack(P(lt, FLIP, 350))), 0, P(lt, FLIP, 80) * (1 - P(lt, FLIP + 1400, 400)));
  },
});

// 3 · FOG OF WAR with per-player vision
scene('fog', 7600, {
  use3d: true,
  enter(root, sc) {
    const st = createGame(botConfig('big', 818, c => (c.modes.fog = true)));
    sc.frames = [];
    let guard = 0, lastKey = '';
    while (st.round < 9 && guard++ < 3000) {
      if (!step1(st)) break;
      const key = String(Object.values(st.roads).filter(o => o === 0).length + Object.values(st.buildings).filter(b => b.owner === 0).length);
      if (key !== lastKey) {
        lastKey = key;
        sc.frames.push(clone(st));
      }
    }
    sc.idx = -1;
    sc.cx = sc.cz = null;
    sc.title = makeTitle(root, '03 · Modo insignia', 'Niebla de guerra 🌑', 'Solo ves alrededor de tus casas y medio hexágono junto a tus caminos. Si chocas con alguien oculto... ¡te desvías!');
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 7600);
    const i = clamp(Math.floor((lt / 6800) * sc.frames.length), 0, sc.frames.length - 1);
    const st = sc.frames[i];
    if (i !== sc.idx) {
      sc.idx = i;
      const v = viewFor(st, 0);
      show3d(v, { vision: v.vision });
    }
    const mine = Object.keys(st.buildings).filter(k => st.buildings[k].owner === 0).map(k => st.board.vertices[k]);
    const cx = mine.length ? mine.reduce((a, v) => a + v.x, 0) / mine.length : 0;
    const cz = mine.length ? mine.reduce((a, v) => a + v.y, 0) / mine.length : 0;
    sc.cx = sc.cx == null ? cx : lerp(sc.cx, cx, 0.08);
    sc.cz = sc.cz == null ? cz : lerp(sc.cz, cz, 0.08);
    const a = 0.2 + lt / 12000;
    cam(sc.cx + Math.sin(a) * 6 - 1.8, 6.2, sc.cz + Math.cos(a) * 6, sc.cx - 1.8, 0.2, sc.cz);
    shade.style.background = 'linear-gradient(90deg, rgba(10,12,24,.8) 0%, rgba(10,12,24,.2) 40%, transparent 60%)';
  },
});

// 4 · MAPS
const MAPS = ['classic', 'star', 'ring', 'islands', 'kingdoms', 'huge'];
scene('maps', 6600, {
  use3d: true,
  enter(root, sc) {
    sc.title = makeTitle(root, '04 · Mapas', 'Mapas a tu gusto', '10 formas + editor. Recursos equilibrados o caóticos, oro, puertos y desiertos a elección.');
    sc.states = MAPS.map((k, i) => createGame(botConfig(k, 300 + i * 17, c => (c.map.gold = i % 2))));
    sc.chip = h('div', { class: 'chip-big', style: { left: '74px', top: '560px' } });
    root.append(sc.chip);
    sc.idx = -1;
  },
  update(lt, sc) {
    sc.title(lt, 6600);
    const stepMs = 1050;
    const idx = clamp(Math.floor((lt - 300) / stepMs), 0, MAPS.length - 1);
    if (idx !== sc.idx) {
      sc.idx = idx;
      show3d(sc.states[idx], {});
      sc.chip.textContent = `🗺️ ${SHAPES[MAPS[idx]].name} · ${sc.states[idx].board.tiles.length} hexágonos`;
      pixelize(sc.chip);
    }
    const p = clamp((lt - 300 - idx * stepMs) / stepMs);
    const b = sc.states[idx].board.bounds;
    const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    orbit(b, 0.5 + p * 0.5, size * 0.75 + 2 - p * 0.8, size * 0.8 + 1.5 - p * 0.6, size * 0.12);
    tf(sc.chip, 0, 0, 1 + (1 - eOut(clamp(p * 4))) * 0.15, 0, P(lt, 300, 200) * (1 - eIn(P(lt, 6200, 350))));
    shade.style.background = LEFT_SHADE;
  },
});

// 5 · EVENTS (pixel cards)
const EV = [
  ['🌟', 'Cosecha abundante', 'Producción doble'], ['🌋', 'Terremoto', 'Los números cambian'], ['🕶️', 'Mercado negro', 'Un recurso 2:1'],
  ['🌪️', 'Tormenta', 'El ladrón sale volando'], ['🦠', 'Plaga', 'Pierdes una carta'], ['🌀', 'Tierra viva', 'El mapa se baraja'],
];
scene('events', 5400, {
  enter(root, sc) {
    root.style.perspective = '1400px';
    sc.title = makeTitle(root, '05 · Caos', 'Eventos cada ronda', 'Sequías, terremotos, mercado negro, tormentas, rebeliones y tierra viva.');
    sc.cards = EV.map(([icon, name, desc]) => {
      const c = h('div', { class: 'card-ev' },
        h('div', { class: 'face front' }, h('div', { class: 'ic' }, icon), h('b', null, name), h('small', null, desc)),
        h('div', { class: 'face back' }, '🎲'));
      root.append(c);
      return c;
    });
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 5400);
    const out = eIn(P(lt, 4950, 420));
    sc.cards.forEach((c, i) => {
      const t0 = 700 + i * 230;
      const p = eOut(P(lt, t0, 480));
      const flip = step(eInOut(P(lt, t0 + 300, 420)), 6);
      const fx = 120 + i * 180, fy = 330 + Math.abs(i - 2.5) * 16;
      const hover = lt > t0 + 800 ? [0, -3, 0, 3][Math.floor((lt - t0) / 160) % 4] : 0;
      c.style.transform = `translate(${Math.round(lerp(1100, fx, p))}px,${Math.round(lerp(760, fy, p) + out * 500 + hover)}px) rotate(${lerp(30, (i - 2.5) * 4, p)}deg) rotateY(${180 - flip * 180}deg)`;
      c.style.opacity = P(lt, t0, 80) * (1 - out);
    });
  },
});

// 6 · BOTS
scene('bots', 6800, {
  use3d: true,
  enter(root, sc) {
    sc.title = makeTitle(root, '06 · Bots', 'Bots con carácter', 'Fácil, normal y difícil. Comercian, roban y bloquean. Juega solo, en hotseat u online.');
    const players = JSON.parse(botFrames[0]).players;
    sc.bars = players.map(p => {
      const fill = h('div', { class: 'fill', style: { background: p.color } });
      const label = h('span');
      const row = h('div', { class: 'row' }, h('div', null, `🤖 ${p.name} `, label), h('div', { class: 'track' }, fill));
      return { row, fill, label };
    });
    root.append(h('div', { class: 'vpbars' }, sc.bars.map(b => b.row)));
    sc.win = h('div', { class: 'chip-big win', style: { left: '74px', top: '560px' } });
    root.append(sc.win);
    pixelize(root);
    sc.idx = -1;
  },
  update(lt, sc) {
    sc.title(lt, 6800);
    const n = botFrames.length - 1;
    const idx = Math.round(eInOut(P(lt, 300, 5500)) * n);
    if (idx !== sc.idx) {
      sc.idx = idx;
      const st = JSON.parse(botFrames[idx]);
      show3d(st, { rolled: st.dice ? st.dice[0] + st.dice[1] : null });
      sc.bars.forEach((b, i) => {
        const vp = victoryPoints(st, i);
        b.fill.style.width = (vp / st.config.rules.vpTarget) * 100 + '%';
        b.label.textContent = `${vp} PV`;
      });
      if (st.phase === 'gameOver') {
        sc.win.textContent = `🏆 ${st.players[st.winner].name} gana`;
        pixelize(sc.win);
      }
    }
    orbit(JSON.parse(botFrames[0]).board.bounds, -0.4 + lt / 9000, 6.8, 6.4, 1.3);
    const out = eIn(P(lt, 6400, 400));
    sc.bars.forEach((bb, i) => tf(bb.row, (1 - eOut(P(lt, 300 + i * 80, 350))) * -60, 0, 1, 0, P(lt, 300 + i * 80, 200) * (1 - out)));
    tf(sc.win, 0, 0, eBack(P(lt, 5900, 350)), 0, P(lt, 5900, 80) * (1 - out));
    shade.style.background = LEFT_SHADE;
  },
});

// 7 · ONLINE + EDITOR
scene('online', 5600, {
  enter(root, sc) {
    root.append(h('div', { class: 'divider' }));
    const left = h('div', { class: 'layer' }), right = h('div', { class: 'layer' });
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
    const t2 = h('div', { class: 'layer', style: { left: '640px' } });
    right.append(t2);
    sc.t2 = makeTitle(t2, '08 · Editor', 'Crea tus mapas', null);
    const svg = S('svg', { viewBox: '-560 -480 1120 960', style: 'position:absolute;left:700px;top:170px;width:520px;height:450px' });
    right.append(svg);
    let seed = 42;
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const RES7 = ['wood', 'brick', 'sheep', 'wheat', 'ore', 'gold', 'desert'];
    const dist = c => Math.hypot(hexCenter(...c).x, hexCenter(...c).y);
    const cells = hexagon(3).sort((a, b) => dist(a) - dist(b));
    sc.cells = cells.map(([q, rr]) => {
      const c = hexCenter(q, rr);
      const res = RES7[Math.floor(r() * 7)];
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 180) * (60 * i - 30);
        return `${96 * Math.cos(a)},${96 * Math.sin(a)}`;
      }).join(' ');
      svg.append(S('polygon', { points: pts, transform: `translate(${c.x * 100},${c.y * 100})`, fill: 'rgba(255,255,255,.04)', stroke: 'rgba(255,255,255,.2)', 'stroke-width': 4, 'stroke-dasharray': '8 8' }));
      const g = S('g', null, S('polygon', { points: pts, fill: TILE_INFO[res].color, stroke: '#1a1c2c', 'stroke-width': 8 }), S('image', { href: pxIcon(res).src, x: -30, y: -30, width: 60, height: 60, style: 'image-rendering:pixelated' }));
      svg.append(g);
      return { g, x: c.x * 100, y: c.y * 100 };
    });
    pixelize(root);
  },
  update(lt, sc) {
    sc.t1(lt, 5600);
    sc.t2(lt - 200, 5400);
    const out = eIn(P(lt, 5150, 420));
    sc.code.forEach((el, i) => tf(el, 0, (1 - eBack(P(lt, 500 + i * 150, 350))) * 60, 1, 0, P(lt, 500 + i * 150, 80) * (1 - out)));
    sc.devs.forEach((d, i) => tf(d, 0, [0, -3, 0, 3][Math.floor(lt / 180 + i * 2) % 4] + (1 - eOut(P(lt, 1300 + i * 150, 450))) * 120, 1, 0, P(lt, 1300 + i * 150, 250) * (1 - out)));
    sc.link.style.backgroundPosition = `${Math.round(lt / 32) * 4}px 0`;
    sc.link.style.opacity = P(lt, 2000, 300) * (1 - out);
    sc.cells.forEach((c, i) => {
      const t0 = 900 + i * 90;
      c.g.setAttribute('transform', `translate(${c.x},${c.y}) scale(${step(eBack(P(lt, t0, 280)), 5)})`);
      c.g.setAttribute('opacity', P(lt, t0, 60) * (1 - out));
    });
  },
});

// 8 · OUTRO
const FEATURES = ['🙈 Blindfold', '🌑 Niebla', '🤫 Casas secretas', '❓ Números secretos', '🎲 Eventos', '🌀 Tierra viva', '💰 Oro', '🗺️ 10 mapas', '✏️ Editor', '🤖 Bots', '🌐 Online', '🏔️ Maqueta 3D', '📱 Móvil'];
scene('outro', 6200, {
  use3d: true,
  enter(root, sc) {
    sc.st = createGame(botConfig('star', 99, c => (c.map.gold = 2)));
    show3d(sc.st, {});
    B.labels.domElement.style.visibility = 'hidden';
    sc.t1 = h('div', { class: 'logo-t1', style: { top: '60px', fontSize: '130px' } }, 'CATAN');
    sc.x = h('div', { class: 'logo-x', style: { top: '200px', fontSize: '54px' } }, 'x');
    sc.t2 = h('div', { class: 'logo-t2', style: { top: '262px', fontSize: '96px' } }, 'KCHUDITES');
    sc.cta = h('div', { class: 'logo-sub', style: { top: '410px', fontSize: '30px' } }, '¡Arma tu mapa, elige tu caos y juega!');
    sc.feats = FEATURES.map(f => h('span', null, f));
    sc.grid = h('div', { class: 'feature-grid' }, sc.feats);
    sc.url = h('div', { class: 'url' }, '▶ ' + URL_TEXT);
    root.append(sc.t1, sc.x, sc.t2, sc.cta, sc.grid, sc.url);
    pixelize(root);
  },
  update(lt, sc) {
    orbit(sc.st.board.bounds, lt / 7000, 9, 7.5);
    shade.style.background = 'rgba(26,28,44,.62)';
    const out = eIn(P(lt, 5750, 450));
    const boil = i => [0, 1, -1, 0][Math.floor(lt / 110 + i) % 4];
    tf(sc.t1, boil(0), (1 - eBack(P(lt, 100, 550))) * -200 + boil(1), 1, 0, P(lt, 100, 150) * (1 - out));
    tf(sc.x, 0, 0, eBack(P(lt, 450, 400)), 0, P(lt, 450, 100) * (1 - out));
    tf(sc.t2, (1 - eOut(P(lt, 650, 500))) * -800 + boil(2), boil(3), 1, 0, P(lt, 650, 200) * (1 - out));
    tf(sc.cta, 0, (1 - eOut(P(lt, 1200, 450))) * 20, 1, 0, P(lt, 1200, 350) * (1 - out));
    sc.feats.forEach((f, i) => tf(f, 0, 0, step(eBack(P(lt, 1600 + i * 80, 320)), 6), 0, P(lt, 1600 + i * 80, 80) * (1 - out)));
    tf(sc.url, 0, 0, 1, 0, P(lt, 2900, 350) * (1 - out));
  },
  exit() {
    B.labels.domElement.style.visibility = '';
  },
});

// ---------- timeline ----------
let t = 0;
for (const sc of scenes) {
  sc.start = t;
  t += sc.dur;
}
const TOTAL = t;

function frame(T) {
  T3 = T;
  let any3d = false;
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
      const fade = P(lt, 0, 220) * (1 - P(lt, sc.dur - 200, 200));
      sc.root.style.opacity = fade;
      if (sc.use3d) {
        any3d = true;
        layer3d.style.opacity = step(fade, 8);
      }
      sc.update(lt, sc);
    }
  }
  shade.style.opacity = any3d ? 1 : 0;
  if (!any3d) layer3d.style.opacity = 0;
  if (B && any3d) {
    B.clock = { getElapsedTime: () => T / 1000 };
    B.now = () => T;
    B.tick();
    // keep the left text column clean
    for (const el of B.labels.domElement.children) {
      const m = /translate\((-?[\d.]+)px/.exec(el.style.transform.split('translate(-50%,-50%)').pop() || '');
      const x = m ? parseFloat(m[1]) : 9999;
      el.style.visibility = x < 600 ? 'hidden' : '';
    }
  }
  document.getElementById('barFill').style.width = (T / TOTAL) * 100 + '%';
}

async function init() {
  await document.fonts.ready;
  const { Board3D } = await import('../js/ui/board3d.js');
  B = await Board3D.create(layer3d);
  B.alive = false; // the showcase drives the render loop itself
  B.controls.enabled = false;
  B.controls.update = () => {};
  B.resize();
  for (let seed = 900; ; seed++) {
    const st = createGame(botConfig('classic', seed));
    const frames = [JSON.stringify(st)];
    for (let i = 0; i < 5000 && st.phase !== 'gameOver'; i++) {
      const a = step1(st);
      if (!a) break;
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
    if (T >= TOTAL + 1200) {
      t0 = performance.now();
      T = 0;
    }
    frame(Math.min(T, TOTAL - 1));
    requestAnimationFrame(loop);
  };
  loop();
}
init();
