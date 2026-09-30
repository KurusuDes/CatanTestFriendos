// "Katan x Amiguites" satirical trailer. Like the showcase, every frame is a pure function of the
// clock T (the 3D view included), so it plays live or is recorded frame by frame (?rec).
import { h, s as S } from '../js/ui/dom.js';
import { createGame, victoryPoints, viewFor } from '../js/engine/game.js';
import { pixelize, pxIcon } from '../js/ui/pixel.js';
import { clamp, P, eOut, eIn, eInOut, eBack, lerp, step, tf, botConfig, step1, clone, makeTitle, clearLabels } from './motion.js';

const stage = document.getElementById('stage');
const REC = new URLSearchParams(location.search).has('rec');
if (REC) document.body.classList.add('rec');
const URL_TEXT = 'kurusudes.github.io/CatanTestFriendos';

// every text of the trailer, per language (?lang=en for English)
const LANG = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es';
const STR = {
  es: {
    cold: ['En un mundo...', '...donde tus amigos te roban ovejas...', '...solo uno tendrá el camino más largo.'],
    logoSub: 'El juego que destruye amistades. Ahora gratis en tu navegador.',
    mapKicker: 'Gráficos next-gen', mapTitle: 'Maqueta 3D™', mapSub: 'Tan bonita que no notarás que te están robando las ovejas.', mapStamp: '24 variantes de casillas',
    mode: 'Modo insignia', flipSub: 'Construye a ciegas. Como con tus decisiones financieras.', flipFlash: '¡SORPRESA!',
    fogTitle: 'Niebla de guerra 🌑', fogSub: 'No ves nada. Tus rivales tampoco. Todos fingen tener un plan.',
    tradeKicker: 'Comercio', tradeTitle: '¿4 por 1? Trato justo.', tradeSub: 'El banco: el único que nunca te va a mentir. Te va a robar, pero de frente.',
    you: 'Tú', cards: '6 cartas', bank: '🏦 Banco', smiles: 'sonríe', deal: '¡TRATO HECHO!',
    hook: '¿ABURRIDO ESPERANDO TU TURNO?', try: '¡PRUEBA EL ADHD!', trySub: 'Minijuegos de apuestas* mientras los demás piensan su jugada', fake: '*con dinero 100% falso',
    slots: 'TRAGAMONEDAS', coin: 'MONEDA', rocket: 'COHETE', jackpot: '¡JACKPOT!', coinAsk: '¿CARA O CRUZ?', coinWin: '¡CARA! x2', heads: 'C', tails: 'X',
    quotes: [['«Perdí 1.600 monedas que no existen. Lo volvería a hacer.»', '— Kchudo, bot normal'], ['«Ya no sé en qué turno estamos, pero voy ganando.»', '— Tu primo, 3 horas en el Plinko']],
    prize: 'Llega a $1600 y gana... ¡fuegos artificiales! 🎆',
    legal: 'Dinero 100% falso. No se puede retirar nada. No hay premios. No hay nada. Los fuegos artificiales tampoco son reales. ' +
      'No afecta a la partida. Se minimiza solo cuando te toca. Ningún bot fue dañado en la producción de este Plinko. ' +
      'Las probabilidades del cohete no las entiende nadie, ni el cohete. Consulte a su médico si el Plinko le habla.',
    resp: 'APUESTA RESPONSABLEMENTE*', resp2: '*o sea: no apuestes. Juega al Katan.',
    botsTitle: '3 niveles de odio', botsSub: 'Fácil, normal y «me bloqueó el único puerto que tenía».', vp: 'PV', wins: n => `🏆 ${n} gana. Nadie la invita más.`,
    press: 'LA CRÍTICA OPINA', madeUp: 'Reseñas 100% inventadas',
    reviews: [
      ['★★★★★', '«Ya no me hablo con mi primo.»', '— Un jugador satisfecho'],
      ['10/10', '«Tiene ovejas.»', '— Revista Que No Existe'],
      ['★☆☆☆☆', '«Me robaron tres turnos seguidos.»', '— Don Trigo, bot'],
      ['★★★★★', '«¿Alguien tiene piedra?»', '— Todos, siempre'],
      ['GOTY', '«Juego del año en mi grupo de WhatsApp.»', '— Los Amiguites'],
    ],
    features: ['🙈 Blindfold', '🌑 Niebla', '🧠 ADHD', '🎲 Eventos', '🌀 Tierra viva', '🗺️ 10 mapas', '✏️ Editor', '🤖 Bots', '🌐 Online', '🏔️ Maqueta 3D', '📱 Móvil'],
    cta: 'Gratis · Sin anuncios · Sin micropagos', cta2: '(solo microapuestas imaginarias)',
    disclaimer: 'Proyecto de fans no oficial. No afiliado a Catan GmbH, CATAN Studio, Kosmos ni a ningún casino.',
  },
  en: {
    cold: ['In a world...', '...where your friends steal your sheep...', '...only one will get the longest road.'],
    logoSub: 'The game that ruins friendships. Now free in your browser.',
    mapKicker: 'Next-gen graphics', mapTitle: '3D Diorama™', mapSub: 'So pretty you won\'t notice they\'re stealing your sheep.', mapStamp: '24 tile variants',
    mode: 'Signature mode', flipSub: 'Build blind. Just like your financial decisions.', flipFlash: 'SURPRISE!',
    fogTitle: 'Fog of war 🌑', fogSub: 'You see nothing. Neither do they. Everyone pretends to have a plan.',
    tradeKicker: 'Trading', tradeTitle: '4 for 1? Fair deal.', tradeSub: 'The bank: the only one who will never lie to you. It robs you to your face.',
    you: 'You', cards: '6 cards', bank: '🏦 Bank', smiles: 'smiling', deal: 'DEAL!',
    hook: 'BORED WAITING FOR YOUR TURN?', try: 'TRY THE ADHD!', trySub: 'Gambling* minigames while everyone else thinks', fake: '*with 100% fake money',
    slots: 'SLOTS', coin: 'COIN FLIP', rocket: 'ROCKET', jackpot: 'JACKPOT!', coinAsk: 'HEADS OR TAILS?', coinWin: 'HEADS! x2', heads: 'H', tails: 'T',
    quotes: [['"I lost 1,600 coins that don\'t exist. Would do it again."', '— Kchudo, normal bot'], ['"No idea whose turn it is, but I\'m winning."', '— Your cousin, 3 hours into Plinko']],
    prize: 'Reach $1600 and win... fireworks! 🎆',
    legal: 'Money is 100% fake. Nothing can be withdrawn. There are no prizes. There is nothing. The fireworks aren\'t real either. ' +
      'It doesn\'t affect the game. It minimizes itself when it\'s your turn. No bots were harmed in the making of this Plinko. ' +
      'Nobody understands the rocket odds, not even the rocket. Ask your doctor if Plinko starts talking to you.',
    resp: 'GAMBLE RESPONSIBLY*', resp2: '*meaning: don\'t. Play Katan.',
    botsTitle: '3 levels of hatred', botsSub: 'Easy, normal and "it blocked the only port I had".', vp: 'VP', wins: n => `🏆 ${n} wins. Never invited again.`,
    press: 'WHAT CRITICS SAY', madeUp: '100% made-up reviews',
    reviews: [
      ['★★★★★', '"I no longer speak to my cousin."', '— A satisfied player'],
      ['10/10', '"It has sheep."', '— A Magazine That Doesn\'t Exist'],
      ['★☆☆☆☆', '"Robbed three turns in a row."', '— Don Trigo, bot'],
      ['★★★★★', '"Anyone got ore?"', '— Everyone, always'],
      ['GOTY', '"Game of the year in our group chat."', '— The Amiguites'],
    ],
    features: ['🙈 Blindfold', '🌑 Fog', '🧠 ADHD', '🎲 Events', '🌀 Living land', '🗺️ 10 maps', '✏️ Editor', '🤖 Bots', '🌐 Online', '🏔️ 3D diorama', '📱 Mobile'],
    cta: 'Free · No ads · No microtransactions', cta2: '(only imaginary micro-bets)',
    disclaimer: 'Unofficial fan project. Not affiliated with Catan GmbH, CATAN Studio, Kosmos or any casino.',
  },
};
const X = STR[LANG];
document.documentElement.lang = LANG;
if (LANG === 'en') {
  document.title = 'Katan x Amiguites — Trailer';
  const mp4 = document.getElementById('mp4'), lang = document.getElementById('lang');
  mp4.href = 'katan-x-amiguites-trailer-en.mp4';
  mp4.textContent = '⬇️ Trailer MP4';
  lang.href = '?';
  lang.textContent = '🌐 Español';
  document.getElementById('replay').textContent = '↺ Replay';
  document.querySelector('#controls .primary').textContent = '🎮 Play';
}

function fit() {
  const k = REC ? 1 : Math.min(innerWidth / 1280, innerHeight / 720);
  stage.style.transform = `scale(${k})`;
}
addEventListener('resize', fit);
fit();

// deterministic noise for flicker, sparkles and plinko paths
const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const boil = (lt, i) => [0, 1, -1, 0][Math.floor(lt / 110 + i) % 4];

// ---------- persistent 3D layer ----------
let B = null;
// its own stacking context: the map's number labels (z-index 1) must never cover the titles on top
const layer3d = h('div', { class: 'layer', style: { opacity: 0, zIndex: 0 } });
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
const LEFT_SHADE = 'linear-gradient(90deg, rgba(26,28,44,.9) 0%, rgba(26,28,44,.4) 42%, transparent 64%)';

// a pixel "stamp" that slams onto the screen
function stamp(root, text, cls = '') {
  const el = h('div', { class: 'tr-stamp ' + cls }, text);
  root.append(el);
  return (lt, t0, x, y, rot = -8, out = 1e9) => {
    const p = P(lt, t0, 260);
    tf(el, x + (p < 1 ? boil(lt, 1) * 3 : 0), y, lerp(2.6, 1, eOut(p)), rot, P(lt, t0, 60) * (1 - P(lt, out, 200)));
  };
}

// ---------- scenes ----------
const scenes = [];
const scene = (name, dur, opts) => scenes.push({ name, dur, ...opts });
let botFrames = null;

// 0 · COLD OPEN: epic-trailer voice, in text
scene('cold', 5200, {
  enter(root, sc) {
    root.style.background = '#07080f';
    sc.lines = X.cold.map(t => {
      const el = h('div', { class: 'tr-epic' }, t);
      root.append(el);
      return el;
    });
  },
  update(lt, sc) {
    sc.lines.forEach((el, i) => {
      const t0 = i * 1650;
      const on = P(lt, t0, 500) * (1 - P(lt, t0 + 1450, 200));
      tf(el, 0, lerp(14, 0, eOut(P(lt, t0, 900))), lerp(1.08, 1, eOut(P(lt, t0, 1500))), 0, i === 2 ? P(lt, t0, 500) * (1 - P(lt, 4900, 300)) : on);
    });
  },
});

// 1 · LOGO over a 3D flyover
scene('logo', 5200, {
  use3d: true,
  enter(root, sc) {
    sc.st = sc.st || createGame(botConfig('pangea', 4242, c => ((c.map.size = 32), (c.map.gold = 1))));
    show3d(sc.st, {});
    B.labels.domElement.style.visibility = 'hidden';
    sc.t1 = h('div', { class: 'logo-t1' }, 'KATAN');
    sc.x = h('div', { class: 'logo-x' }, 'x');
    sc.t2 = h('div', { class: 'logo-t2' }, 'AMIGUITES');
    sc.sub = h('div', { class: 'logo-sub' }, X.logoSub);
    root.append(sc.t1, sc.x, sc.t2, sc.sub);
  },
  update(lt, sc) {
    orbit(sc.st.board.bounds, -0.6 + lt / 9000, 11 - lt / 1500, 9 - lt / 1400);
    const out = eIn(P(lt, 4700, 450));
    tf(sc.t1, boil(lt, 0), (1 - eBack(P(lt, 200, 650))) * -220 + boil(lt, 1), 1, 0, P(lt, 200, 150) * (1 - out));
    tf(sc.x, 0, 0, eBack(P(lt, 800, 400)), 0, P(lt, 800, 100) * (1 - out));
    tf(sc.t2, (1 - eOut(P(lt, 1050, 550))) * 800 + boil(lt, 2), boil(lt, 3), 1, 0, P(lt, 1050, 200) * (1 - out));
    tf(sc.sub, 0, (1 - eOut(P(lt, 1900, 500))) * 20, 1, 0, P(lt, 1900, 400) * (1 - out));
    shade.style.background = `rgba(26,28,44,${0.5 - P(lt, 3500, 1000) * 0.2})`;
  },
  exit() {
    B.labels.domElement.style.visibility = '';
  },
});

// 2 · THE MAP
scene('map', 6000, {
  use3d: true,
  enter(root, sc) {
    sc.st = JSON.parse(botFrames[Math.floor(botFrames.length * 0.55)]);
    show3d(sc.st, {});
    sc.title = makeTitle(root, X.mapKicker, X.mapTitle, X.mapSub);
    sc.badge = stamp(root, X.mapStamp, 'gold');
  },
  update(lt, sc) {
    sc.title(lt, 6000);
    const b = sc.st.board.bounds;
    orbit(b, 0.9 - lt / 5000, lerp(7.5, 4.6, eInOut(P(lt, 0, 6000))), lerp(6.5, 3.4, eInOut(P(lt, 0, 6000))), 0.8, 0.3);
    sc.badge(lt, 2200, 90, 470, -6, 5600);
    shade.style.background = LEFT_SHADE;
  },
});

// 3 · BLINDFOLD
scene('flip', 6800, {
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
    sc.title = makeTitle(root, X.mode, 'Blindfold 🙈', X.flipSub);
    sc.flash = h('div', { class: 'big-flash' }, X.flipFlash);
    root.append(sc.flash);
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 6800);
    const b = sc.final.board.bounds;
    const FLIP = 4100;
    const i = lt < FLIP ? clamp(Math.floor(((lt - 500) / (FLIP - 700)) * sc.frames.length), 0, sc.frames.length - 1) : -2;
    if (i !== sc.idx) {
      sc.idx = i;
      if (i >= 0) show3d(sc.frames[i], { faceDown: true });
      else show3d(sc.final, { faceDown: true, flipAt: T3 });
    }
    orbit(b, 0.3 + lt / 14000, lerp(8.5, 7.2, P(lt, 0, 6800)), lerp(8.5, 6.8, P(lt, 0, 6800)), 1.2);
    shade.style.background = LEFT_SHADE;
    const shake = lt > FLIP && lt < FLIP + 600 ? [0, 6, -6, 3][Math.floor(lt / 40) % 4] : 0;
    tf(sc.flash, shake, 0, lerp(0.3, 1, eBack(P(lt, FLIP, 350))), 0, P(lt, FLIP, 80) * (1 - P(lt, FLIP + 1500, 400)));
  },
});

// 4 · FOG OF WAR
scene('fog', 6000, {
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
    sc.title = makeTitle(root, X.mode, X.fogTitle, X.fogSub);
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 6000);
    const i = clamp(Math.floor((lt / 5400) * sc.frames.length), 0, sc.frames.length - 1);
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
    shade.style.background = 'linear-gradient(90deg, rgba(10,12,24,.85) 0%, rgba(10,12,24,.25) 42%, transparent 62%)';
  },
});

// 5 · TRADING: cards fly between two players and the bank
const RES = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
scene('trade', 5600, {
  enter(root, sc) {
    root.classList.add('tr-felt');
    sc.title = makeTitle(root, X.tradeKicker, X.tradeTitle, X.tradeSub);
    const who = (name, color, x) => h('div', { class: 'tr-seat', style: { left: x + 'px', '--pc': color } }, h('b', null, name), h('span', null, X.cards));
    sc.you = who(X.you, '#e53935', 150);
    sc.bank = h('div', { class: 'tr-seat bank', style: { left: '530px', '--pc': '#ffcd75' } }, h('b', null, X.bank), h('span', null, X.smiles));
    sc.pal = who('La Kchuda', '#41a6f6', 910);
    root.append(sc.you, sc.bank, sc.pal);
    // the flights: [resource, from, to, start ms]
    sc.flights = [
      ...[0, 1, 2, 3].map(i => ['wood', 'you', 'bank', 900 + i * 110]),
      ['ore', 'bank', 'you', 1750],
      ['wheat', 'you', 'pal', 2700], ['wheat', 'you', 'pal', 2810],
      ['sheep', 'pal', 'you', 3050],
    ].map(([res, a, b, t0]) => {
      const el = h('div', { class: 'tr-fly' }, pxIcon(res, 32));
      root.append(el);
      return { el, a, b, t0 };
    });
    sc.deal = stamp(root, X.deal, 'green');
    pixelize(root);
  },
  update(lt, sc) {
    sc.title(lt, 5600);
    const pos = { you: { x: 245, y: 385 }, bank: { x: 625, y: 385 }, pal: { x: 1005, y: 385 } };
    const out = eIn(P(lt, 5200, 380));
    [sc.you, sc.bank, sc.pal].forEach((el, i) => tf(el, 0, (1 - eOut(P(lt, 200 + i * 120, 450))) * 80, 1, 0, P(lt, 200 + i * 120, 200) * (1 - out)));
    for (const f of sc.flights) {
      const p = P(lt, f.t0, 800);
      const a = pos[f.a], b = pos[f.b];
      const mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - 170;
      const q = eInOut(p);
      const x = (1 - q) * (1 - q) * a.x + 2 * (1 - q) * q * mx + q * q * b.x;
      const y = (1 - q) * (1 - q) * a.y + 2 * (1 - q) * q * my + q * q * b.y;
      // the card shrinks and fades as it lands, so it never covers the seat's name
      tf(f.el, x - 22, y - 22, p < 0.5 ? lerp(0.6, 1.3, p * 2) : lerp(1.3, 0.4, (p - 0.5) * 2), 0, p > 0 && p < 1 ? 1 - P(p, 0.7, 0.3) : 0);
    }
    sc.deal(lt, 3900, 470, 250, -7, 5200);
  },
});

// 6 · THE CASINO: the ADHD arcade, sold like a gambling ad
scene('casino', 16500, {
  enter(root, sc) {
    root.classList.add('tr-casino');
    sc.bulbs = h('div', { class: 'tr-bulbs' });
    root.append(sc.bulbs);
    sc.q = h('div', { class: 'tr-neon small' }, X.hook);
    sc.big = h('div', { class: 'tr-neon' }, X.try);
    sc.bigSub = h('div', { class: 'tr-neon-sub' }, X.trySub);
    sc.star = h('div', { class: 'tr-fine' }, X.fake);
    sc.brain = h('div', { class: 'tr-brain' }, '🧠');
    root.append(sc.q, sc.brain, sc.big, sc.bigSub, sc.star);

    // four machines
    const panel = (title, x, y, body) => {
      const el = h('div', { class: 'tr-machine', style: { left: x + 'px', top: y + 'px' } }, h('div', { class: 'tr-mtitle' }, title), body);
      root.append(el);
      return el;
    };
    // plinko
    const svg = S('svg', { viewBox: '0 0 240 200', class: 'tr-plinko' });
    for (let r = 0; r < 7; r++) for (let c = 0; c <= r; c++) svg.append(S('circle', { cx: 120 + (c - r / 2) * 26, cy: 22 + r * 21, r: 3.5, fill: '#94b0c2' }));
    const MULT = ['x25', 'x2', 'x1', 'x0.4', 'x0.4', 'x1', 'x2', 'x25'];
    MULT.forEach((m, i) => svg.append(S('text', { x: 16 + i * 29.7, y: 194, 'text-anchor': 'middle', 'font-size': 11, fill: i === 0 || i === 7 ? '#ffcd75' : '#f4f4f4', 'font-family': 'Silkscreen' }, m)));
    sc.balls = Array.from({ length: 12 }, (_, i) => {
      const c = S('circle', { r: 5, fill: '#ef7d57', stroke: '#1a1c2c', 'stroke-width': 2 });
      svg.append(c);
      return { c, t0: 3900 + i * 260, path: Array.from({ length: 7 }, (_, k) => (hash(i * 13 + k) > 0.5 ? 1 : 0)) };
    });
    sc.plinko = panel('PLINKO', 55, 240, svg);
    // slots
    const SYM = ['🐑', '🌾', '🧱', '🌲', '💰'];
    sc.reels = [0, 1, 2].map(i => {
      const strip = h('div', { class: 'tr-strip' }, Array.from({ length: 30 }, (_, k) => h('div', { class: 'tr-sym' }, SYM[(k * (i + 2)) % 5])));
      return { strip, stop: 5000 + i * 450, win: 29 };
    });
    // the last symbol of every strip is the jackpot
    sc.reels.forEach(r => (r.strip.lastChild.textContent = '💰'));
    sc.slots = panel(X.slots, 365, 240, h('div', { class: 'tr-reels' }, sc.reels.map(r => h('div', { class: 'tr-reel' }, r.strip))));
    sc.jackpot = h('div', { class: 'tr-jackpot' }, X.jackpot);
    sc.slots.append(sc.jackpot);
    // coin
    sc.coin = h('div', { class: 'tr-coin' }, h('span', null, X.heads));
    sc.coinLabel = h('div', { class: 'tr-coin-label' }, X.coinAsk);
    sc.coinP = panel(X.coin, 675, 240, h('div', { class: 'tr-coin-wrap' }, sc.coin, sc.coinLabel));
    // rocket
    sc.graph = S('svg', { viewBox: '0 0 240 170', class: 'tr-graph' });
    sc.line = S('polyline', { fill: 'none', stroke: '#a7f070', 'stroke-width': 4, points: '' });
    sc.graph.append(S('line', { x1: 10, y1: 160, x2: 235, y2: 160, stroke: '#566c86', 'stroke-width': 2 }), sc.line);
    sc.mult = h('div', { class: 'tr-mult' }, 'x0.00');
    sc.boom = h('div', { class: 'tr-boom' }, '💥');
    sc.rocket = panel(X.rocket, 985, 240, h('div', { class: 'tr-rocket' }, sc.graph, sc.mult, sc.boom));
    sc.machines = [sc.plinko, sc.slots, sc.coinP, sc.rocket];

    // testimonials
    const quote = (text, who, x, y) => {
      const el = h('div', { class: 'tr-quote', style: { left: x + 'px', top: y + 'px' } }, h('div', { class: 'stars' }, '★★★★★'), h('p', null, text), h('small', null, who));
      root.append(el);
      return el;
    };
    sc.quotes = [quote(...X.quotes[0], 120, 200), quote(...X.quotes[1], 660, 330)];
    // the climb to $1600
    sc.ladder = ['$100', '$200', '$400', '$800', '$1600'].map((v, i) => {
      const el = h('div', { class: 'tr-step' + (i === 4 ? ' top' : '') }, v);
      root.append(el);
      return el;
    });
    sc.prize = h('div', { class: 'tr-neon-sub prize' }, X.prize);
    root.append(sc.prize);
    sc.sparks = Array.from({ length: 40 }, (_, i) => {
      const el = h('i', { class: 'tr-spark', style: { background: ['#ffcd75', '#ef7d57', '#73eff7', '#a7f070', '#f4f4f4'][i % 5] } });
      root.append(el);
      return el;
    });
    // radio-ad small print
    sc.legal = h('div', { class: 'tr-legal' }, X.legal);
    sc.resp = h('div', { class: 'tr-neon mid' }, X.resp);
    sc.resp2 = h('div', { class: 'tr-fine big' }, X.resp2);
    root.append(sc.legal, sc.resp, sc.resp2);
    pixelize(root);
  },
  update(lt, sc) {
    // marquee bulbs chase around the frame
    sc.bulbs.style.backgroundPosition = `${Math.floor(lt / 120) * 18}px 0, 0 ${Math.floor(lt / 120) * 18}px`;
    const flick = hash(Math.floor(lt / 70)) > 0.93 ? 0.55 : 1;
    // 1 · the hook
    tf(sc.q, boil(lt, 0), (1 - eBack(P(lt, 100, 450))) * -120, 1, 0, P(lt, 100, 100) * (1 - P(lt, 1500, 200)));
    const bigIn = eBack(P(lt, 1500, 420));
    const pulse = 1 + Math.sin(lt / 90) * 0.02;
    tf(sc.big, boil(lt, 1), 0, lerp(3, 1, bigIn) * pulse, lerp(-12, -3, bigIn), P(lt, 1500, 80) * (1 - P(lt, 3500, 250)) * flick);
    tf(sc.brain, 0, [0, -6, 0, 6][Math.floor(lt / 150) % 4], eBack(P(lt, 1650, 400)), 0, P(lt, 1650, 80) * (1 - P(lt, 3500, 250)));
    tf(sc.bigSub, 0, (1 - eOut(P(lt, 2000, 400))) * 30, 1, 0, P(lt, 2000, 250) * (1 - P(lt, 3500, 250)));
    tf(sc.star, 0, 0, 1, 0, P(lt, 2600, 150) * (1 - P(lt, 3500, 250)));

    // 2 · the machines (3.6 s .. 8 s)
    const mOut = P(lt, 7900, 250);
    sc.machines.forEach((m, i) => tf(m, 0, (1 - eBack(P(lt, 3600 + i * 140, 380))) * 120, step(eBack(P(lt, 3600 + i * 140, 380)), 6), 0, P(lt, 3600 + i * 140, 80) * (1 - mOut)));
    // plinko balls drop row by row
    sc.balls.forEach(b => {
      const p = clamp((lt - b.t0) / 1500);
      if (p <= 0 || p >= 1) return b.c.setAttribute('opacity', 0);
      const rows = p * 8;
      const r = Math.min(7, Math.floor(rows));
      let col = 0;
      for (let k = 0; k < r; k++) col += b.path[k];
      const f = rows - r;
      const nextCol = col + (r < 7 ? b.path[r] : 0);
      const x0 = 120 + (col - r / 2) * 26, x1 = 120 + (nextCol - (r + 1) / 2) * 26;
      const x = r < 7 ? lerp(x0, x1, f) : 16 + (col / 7) * 7 * 29.7;
      const y = 10 + rows * 21 - Math.sin(f * Math.PI) * 8;
      b.c.setAttribute('cx', x.toFixed(1));
      b.c.setAttribute('cy', Math.min(182, y).toFixed(1));
      b.c.setAttribute('opacity', 1);
    });
    // slot reels spin, then stop one by one on the jackpot
    sc.reels.forEach(r => {
      const H = 58, spin = lt < r.stop ? ((lt - 3700) / 1000) * 28 : r.win;
      const land = lt < r.stop ? 0 : Math.sin(clamp((lt - r.stop) / 200) * Math.PI) * 6;
      const k = lt < r.stop ? spin % (r.win - 1) : r.win;
      r.strip.style.transform = `translateY(${Math.round(-k * H + land)}px)`;
    });
    tf(sc.jackpot, 0, 0, eBack(P(lt, 6000, 300)) * (1 + Math.sin(lt / 80) * 0.05), -6, P(lt, 6000, 60));
    // coin flips and lands heads
    const cp = clamp((lt - 4200) / 2200);
    const ang = cp < 1 ? cp * Math.PI * 14 : 0;
    sc.coin.style.transform = `translateY(${Math.round(-Math.sin(cp * Math.PI) * 26)}px) scaleX(${Math.cos(ang).toFixed(3)})`;
    sc.coin.firstChild.textContent = Math.cos(ang) >= 0 ? X.heads : X.tails;
    sc.coinLabel.textContent = cp < 1 ? X.coinAsk : X.coinWin;
    // rocket climbs and blows up at x4.87
    const rp = clamp((lt - 3900) / 3100);
    const m = Math.min(4.87, 5 * (Math.pow(1.9, rp * 2.6) - 1) / 4);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const q = (i / 40) * rp;
      const mm = 5 * (Math.pow(1.9, q * 2.6) - 1) / 4;
      pts.push(`${(10 + (i / 40) * rp * 220).toFixed(1)},${(160 - Math.min(mm, 4.87) * 30).toFixed(1)}`);
    }
    sc.line.setAttribute('points', pts.join(' '));
    const boom = lt > 7000;
    sc.line.setAttribute('stroke', boom ? '#b13e53' : '#a7f070');
    sc.mult.textContent = boom ? 'x4.87 💥' : 'x' + m.toFixed(2);
    sc.mult.classList.toggle('dead', boom);
    tf(sc.boom, 0, 0, eBack(P(lt, 7000, 250)) * 1.4, 0, P(lt, 7000, 50) * (1 - P(lt, 7600, 250)));

    // 3 · testimonials (8.1 s .. 10.9 s)
    sc.quotes.forEach((q, i) => tf(q, (1 - eOut(P(lt, 8100 + i * 700, 400))) * (i ? 300 : -300), 0, 1, i ? 2 : -2, P(lt, 8100 + i * 700, 150) * (1 - P(lt, 10700, 250))));

    // 4 · the ladder and the fireworks (11 s .. 13.6 s)
    sc.ladder.forEach((el, i) => {
      const t0 = 11000 + i * 260;
      tf(el, 170 + i * 200, 470 - i * 60, step(eBack(P(lt, t0, 300)), 5), 0, P(lt, t0, 60) * (1 - P(lt, 13500, 200)));
    });
    tf(sc.prize, 0, (1 - eOut(P(lt, 12300, 400))) * 30, 1, 0, P(lt, 12300, 200) * (1 - P(lt, 13500, 200)));
    sc.sparks.forEach((el, i) => {
      const t0 = 12300 + (i % 4) * 180, p = clamp((lt - t0) / 1100);
      const a = hash(i) * Math.PI * 2, sp = 120 + hash(i + 50) * 160;
      const cx = [1010, 860, 1150, 960][i % 4], cy = [140, 190, 170, 110][i % 4];
      tf(el, cx + Math.cos(a) * sp * eOut(p), cy + Math.sin(a) * sp * eOut(p) + p * p * 60, 1, 0, p > 0 && p < 1 ? 1 - p * p : 0);
    });

    // 5 · the small print, read way too fast (13.7 s ..)
    const lp = clamp((lt - 13700) / 2600);
    sc.legal.style.transform = `translateX(${Math.round(lerp(1280, -sc.legal.scrollWidth + 200, lp))}px)`;
    sc.legal.style.opacity = lt > 13700 && lt < 16400 ? 1 : 0;
    tf(sc.resp, boil(lt, 2), 0, eBack(P(lt, 13900, 350)), -4, P(lt, 13900, 80) * flick);
    tf(sc.resp2, 0, 0, 1, 0, P(lt, 14500, 200));
  },
});

// 7 · BOTS
scene('bots', 5600, {
  use3d: true,
  enter(root, sc) {
    sc.title = makeTitle(root, 'Bots', X.botsTitle, X.botsSub);
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
    sc.title(lt, 5600);
    const n = botFrames.length - 1;
    const idx = Math.round(eInOut(P(lt, 300, 4500)) * n);
    if (idx !== sc.idx) {
      sc.idx = idx;
      const st = JSON.parse(botFrames[idx]);
      show3d(st, { rolled: st.dice ? st.dice[0] + st.dice[1] : null });
      sc.bars.forEach((b, i) => {
        const vp = victoryPoints(st, i);
        b.fill.style.width = (vp / st.config.rules.vpTarget) * 100 + '%';
        b.label.textContent = `${vp} ${X.vp}`;
      });
      if (st.phase === 'gameOver') {
        sc.win.textContent = X.wins(st.players[st.winner].name);
        pixelize(sc.win);
      }
    }
    orbit(JSON.parse(botFrames[0]).board.bounds, -0.4 + lt / 9000, 6.8, 6.4, 1.3);
    const out = eIn(P(lt, 5200, 380));
    sc.bars.forEach((bb, i) => tf(bb.row, (1 - eOut(P(lt, 300 + i * 80, 350))) * -60, 0, 1, 0, P(lt, 300 + i * 80, 200) * (1 - out)));
    tf(sc.win, 0, 0, eBack(P(lt, 4900, 300)), 0, P(lt, 4900, 80) * (1 - out));
    shade.style.background = LEFT_SHADE;
  },
});

// 8 · REVIEWS (obviously invented)
scene('reviews', 5600, {
  enter(root, sc) {
    root.classList.add('tr-press');
    sc.head = h('div', { class: 'tr-press-head' }, X.press);
    sc.note = h('div', { class: 'tr-fine' }, X.madeUp);
    root.append(sc.head, sc.note);
    sc.cards = X.reviews.map(([score, text, who], i) => {
      const el = h('div', { class: 'tr-review' }, h('b', null, score), h('p', null, text), h('small', null, who));
      root.append(el);
      return el;
    });
    pixelize(root);
  },
  update(lt, sc) {
    const out = eIn(P(lt, 5200, 380));
    tf(sc.head, 0, (1 - eOut(P(lt, 0, 400))) * -60, 1, 0, P(lt, 0, 200) * (1 - out));
    tf(sc.note, 0, 0, 1, 0, P(lt, 3800, 300) * (1 - out));
    const spots = [[70, 128, -2], [690, 128, 2], [70, 300, 2], [690, 300, -2], [380, 470, -1]];
    sc.cards.forEach((el, i) => {
      const t0 = 300 + i * 520, [x, y, r] = spots[i];
      tf(el, x, y + (1 - eBack(P(lt, t0, 380))) * 40, step(eBack(P(lt, t0, 380)), 6), r, P(lt, t0, 80) * (1 - out));
    });
  },
});

// 9 · OUTRO
scene('outro', 6800, {
  use3d: true,
  enter(root, sc) {
    sc.st = createGame(botConfig('star', 99, c => (c.map.gold = 2)));
    show3d(sc.st, {});
    B.labels.domElement.style.visibility = 'hidden';
    sc.t1 = h('div', { class: 'logo-t1', style: { top: '40px', fontSize: '130px' } }, 'KATAN');
    sc.x = h('div', { class: 'logo-x', style: { top: '180px', fontSize: '54px' } }, 'x');
    sc.t2 = h('div', { class: 'logo-t2', style: { top: '240px', fontSize: '96px' } }, 'AMIGUITES');
    sc.cta = h('div', { class: 'logo-sub', style: { top: '385px', fontSize: '30px' } }, X.cta);
    sc.cta2 = h('div', { class: 'tr-fine center', style: { top: '430px' } }, X.cta2);
    sc.feats = X.features.map(f => h('span', null, f));
    sc.grid = h('div', { class: 'feature-grid', style: { top: '480px' } }, sc.feats);
    sc.url = h('div', { class: 'url' }, '▶ ' + URL_TEXT);
    sc.legal = h('div', { class: 'tr-disclaimer' }, X.disclaimer);
    root.append(sc.t1, sc.x, sc.t2, sc.cta, sc.cta2, sc.grid, sc.url, sc.legal);
    pixelize(root);
  },
  update(lt, sc) {
    orbit(sc.st.board.bounds, lt / 7000, 9, 7.5);
    shade.style.background = 'rgba(26,28,44,.66)';
    const out = eIn(P(lt, 6400, 400));
    tf(sc.t1, boil(lt, 0), (1 - eBack(P(lt, 100, 550))) * -200 + boil(lt, 1), 1, 0, P(lt, 100, 150) * (1 - out));
    tf(sc.x, 0, 0, eBack(P(lt, 450, 400)), 0, P(lt, 450, 100) * (1 - out));
    tf(sc.t2, (1 - eOut(P(lt, 650, 500))) * -800 + boil(lt, 2), boil(lt, 3), 1, 0, P(lt, 650, 200) * (1 - out));
    tf(sc.cta, 0, (1 - eOut(P(lt, 1200, 450))) * 20, 1, 0, P(lt, 1200, 350) * (1 - out));
    tf(sc.cta2, 0, 0, 1, 0, P(lt, 1900, 300) * (1 - out));
    sc.feats.forEach((f, i) => tf(f, 0, 0, step(eOut(P(lt, 2200 + i * 80, 320)), 6), 0, P(lt, 2200 + i * 80, 80) * (1 - out)));
    tf(sc.url, 0, 0, 1, 0, P(lt, 3300, 350) * (1 - out));
    tf(sc.legal, 0, 0, 1, 0, P(lt, 3600, 350) * (1 - out));
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
      const fade = P(lt, 0, 180) * (1 - P(lt, sc.dur - 180, 180));
      sc.root.style.opacity = sc.name === 'cold' ? 1 : fade;
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
    // the video always wins: labels hide under titles, stamps and cards, and in the left column
    if (B.labels.domElement.style.visibility !== 'hidden') clearLabels(B.labels.domElement, scenes.filter(sc => sc.root).map(sc => sc.root));
  }
  document.getElementById('barFill').style.width = (T / TOTAL) * 100 + '%';
}

async function init() {
  await document.fonts.ready;
  // fonts load on first use: warm them up so the very first frames already use them
  await Promise.all(['700 44px Silkscreen', '500 20px "Pixelify Sans"', '600 20px "Pixelify Sans"'].map(f => document.fonts.load(f)));
  const { Board3D } = await import('../js/ui/board3d.js');
  B = await Board3D.create(layer3d);
  B.alive = false; // the trailer drives the render loop itself
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
  window.__scenes = scenes.map(s => ({ name: s.name, start: s.start, dur: s.dur }));
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
