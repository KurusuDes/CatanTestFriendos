import { App } from '../app.js';
import { h, s as S, clear, storage, toast } from './dom.js';
import { BoardView } from './boardView.js';
import { defaultConfig, MODES, PRESETS, PLAYER_COLORS, BOT_NAMES } from '../engine/config.js';
import { SHAPES, generateBoard } from '../engine/board.js';
import { DEV_DECKS, TILE_INFO } from '../engine/constants.js';
import { createGame } from '../engine/game.js';
import { newSeed } from '../engine/rng.js';
import { openFlagEditor, flagImg, patternFlag, validFlag, myKingdom, saveMyKingdom } from './flag.js';

const CFG_KEY = 'kchudites.lastConfig';
export const MAPS_KEY = 'kchudites.maps';

const miniCache = new Map();
function miniMap(key, custom) {
  const ck = custom ? 'c:' + custom.name + custom.tiles.length : key;
  if (miniCache.has(ck)) return miniCache.get(ck).cloneNode(true);
  const cfg = defaultConfig();
  cfg.map.shape = key;
  cfg.map.custom = custom || null;
  cfg.map.size = 24;
  const bd = generateBoard(cfg, { s: 7 });
  const b = bd.bounds;
  const svg = S('svg', { viewBox: `${b.minX * 10} ${b.minY * 10} ${(b.maxX - b.minX) * 10} ${(b.maxY - b.minY) * 10}` });
  for (const t of bd.tiles) {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${t.x * 10 + 9.6 * Math.cos(a)},${t.y * 10 + 9.6 * Math.sin(a)}`;
    }).join(' ');
    svg.append(S('polygon', { points: pts, fill: (TILE_INFO[t.res] || TILE_INFO.desert).color }));
  }
  miniCache.set(ck, svg);
  return svg.cloneNode(true);
}

function loadConfig() {
  const saved = storage(CFG_KEY);
  const base = defaultConfig();
  if (!saved) return base;
  // merge so new options always exist
  return { ...base, ...saved, map: { ...base.map, ...saved.map }, rules: { ...base.rules, ...saved.rules }, modes: { ...base.modes, ...saved.modes }, seed: newSeed() };
}

export function lobbyScreen(root, opts = {}) {
  const online = opts.online === 'host';
  let cfg = loadConfig();
  if (online) {
    cfg.players[0] = { ...cfg.players[0], kind: 'human' };
    cfg.players.forEach((p, i) => { if (i > 0 && p.kind === 'human') p.kind = 'remote'; });
  } else cfg.players.forEach(p => { if (p.kind === 'remote') p.kind = 'human'; });
  // every kingdom has a banner; seat 0 uses the one this device remembers
  const mine = myKingdom();
  if (mine && cfg.players[0] && cfg.players[0].kind === 'human') Object.assign(cfg.players[0], { name: mine.name || cfg.players[0].name, color: mine.color || cfg.players[0].color, flag: mine.flag });
  cfg.players.forEach((p, i) => { if (!validFlag(p.flag)) p.flag = patternFlag(p.color, i); });

  const left = h('div');
  const previewBox = h('div', { class: 'preview' });
  const previewMeta = h('div', { class: 'preview-meta' });
  const onlineBox = h('div');
  const view = new BoardView(previewBox, { interactive: false });

  root.append(h('div', { class: 'lobby screen' },
    h('div', { class: 'lobby-head' },
      h('button', { class: 'btn', onclick: () => { if (online && App.net) App.net.close(); App.net = null; App.go('menu'); } }, '← Menú'),
      h('h2', null, online ? '🌐 Sala online' : '🎮 Nueva partida'),
      h('button', { class: 'btn sm', onclick: () => { cfg = defaultConfig(); if (online) cfg.players.forEach((p, i) => { if (i && p.kind === 'human') p.kind = 'remote'; }); refresh(); } }, '↺ Restablecer')),
    h('div', { class: 'lobby-grid' }, left,
      h('div', { class: 'preview-card' }, onlineBox, h('div', { class: 'card' },
        h('h3', null, '🗺️ Vista previa ', h('small', null, 'así será tu mapa')),
        previewBox, previewMeta)))),
    h('div', { class: 'start-bar' }, h('button', { class: 'btn primary big', id: 'startBtn', onclick: start }, online ? '🚀 Empezar partida online' : '🚀 ¡A jugar!')));

  function save() {
    storage(CFG_KEY, cfg);
  }

  function refresh() {
    save();
    renderLeft();
    renderPreview();
    renderOnline();
  }

  function renderPreview() {
    let st;
    try {
      st = createGame(cfg.players.length >= 2 ? cfg : { ...cfg, players: [...cfg.players, ...cfg.players] });
    } catch (e) {
      console.error(e);
      return;
    }
    view.render(st, {});
    const land = st.board.tiles.length;
    const counts = {};
    for (const t of st.board.tiles) counts[t.res] = (counts[t.res] || 0) + 1;
    clear(previewMeta).append(
      h('span', { class: 'pill' }, `${land} hexágonos`),
      h('span', { class: 'pill' }, `${st.board.ports.length} puertos`),
      ...Object.entries(counts).map(([r, n]) => h('span', { class: 'pill' }, `${TILE_INFO[r].icon}${n}`)),
      h('button', { class: 'btn sm', onclick: () => { cfg.seed = newSeed(); renderPreview(); } }, '🎲 Otro mapa'));
  }

  function renderOnline() {
    clear(onlineBox);
    if (!online || !App.net) return;
    const net = App.net;
    onlineBox.append(h('div', { class: 'card' },
      h('h3', null, '🌐 Código de la sala'),
      net.code ? h('div', { class: 'room-code' }, net.code) : h('p', null, 'Creando sala...'),
      h('p', { style: { color: 'var(--muted)', fontSize: '13px' } }, 'Tus amigos entran con "Unirse a sala" y este código. Asigna asientos "Amigo online" en la lista de jugadores.'),
      h('div', { class: 'section-label' }, `Conectados (${net.guests.length})`),
      net.guests.length ? h('div', { class: 'chips' }, net.guests.map(g => h('span', { class: 'chip on' }, g.conn ? '🟢 ' : '🔌 ', flagImg(g.flag, 18), ' ' + g.name))) : h('p', null, 'Nadie aún...')));
  }

  function playerRows() {
    const kinds = online
      ? [['remote', '🌐 Amigo online'], ['bot:easy', '🤖 Bot fácil'], ['bot:normal', '🤖 Bot normal'], ['bot:hard', '🤖 Bot difícil']]
      : [['human', '🧑 Humano'], ['bot:easy', '🤖 Bot fácil'], ['bot:normal', '🤖 Bot normal'], ['bot:hard', '🤖 Bot difícil']];
    return cfg.players.map((p, i) => {
      const val = p.kind === 'bot' ? `bot:${p.level || 'normal'}` : p.kind;
      const hostSeat = online && i === 0;
      return h('div', { class: 'player-row' },
        h('div', {
          class: 'swatch', style: { background: p.color }, title: 'Cambiar color',
          onclick: () => {
            const used = new Set(cfg.players.map(x => x.color));
            let k = PLAYER_COLORS.indexOf(p.color);
            for (let j = 0; j < PLAYER_COLORS.length; j++) {
              k = (k + 1) % PLAYER_COLORS.length;
              if (!used.has(PLAYER_COLORS[k])) break;
            }
            p.color = PLAYER_COLORS[k];
            refresh();
          },
        }),
        p.kind === 'remote'
          ? h('div', { class: 'btn sm flag-btn', title: 'Cada amigo pinta su propia bandera' }, '🌐')
          : h('button', {
            class: 'btn sm flag-btn', title: 'Bandera y color del castillo',
            onclick: () => openFlagEditor({
              flag: p.flag, color: p.color, name: p.name,
              onSave: ({ flag, color }) => {
                p.flag = flag;
                p.color = color;
                if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag, color });
                refresh();
              },
            }),
          }, flagImg(p.flag, 26)),
        h('input', { type: 'text', value: p.name, maxlength: 16, onchange: e => { p.name = e.target.value.trim() || `Jugador ${i + 1}`; if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag: p.flag, color: p.color }); save(); } }),
        hostSeat ? h('div', { class: 'pill' }, '👑 Tú (anfitrión)') : h('select', {
          onchange: e => {
            const [k, l] = e.target.value.split(':');
            p.kind = k;
            if (l) p.level = l;
            if (k === 'bot' && !BOT_NAMES.includes(p.name)) p.name = BOT_NAMES.find(n => !cfg.players.some(x => x.name === n)) || p.name;
            if (k !== 'bot' && BOT_NAMES.includes(p.name)) p.name = k === 'remote' ? `Amigo ${i}` : `Jugador ${i + 1}`;
            refresh();
          },
        }, kinds.map(([k, l]) => h('option', { value: k, selected: k === val ? true : null }, l))),
        h('button', { class: 'btn sm ghost', disabled: cfg.players.length <= 2 || hostSeat, title: 'Quitar', onclick: () => { cfg.players.splice(i, 1); refresh(); } }, '✕'));
    });
  }

  function renderLeft() {
    clear(left);
    // players
    left.append(h('div', { class: 'card' },
      h('h3', null, '👥 Jugadores ', h('small', null, `${cfg.players.length}/8`)),
      playerRows(),
      h('button', {
        class: 'btn sm', disabled: cfg.players.length >= 8,
        onclick: () => {
          const color = PLAYER_COLORS.find(c => !cfg.players.some(p => p.color === c)) || PLAYER_COLORS[cfg.players.length % PLAYER_COLORS.length];
          const name = BOT_NAMES.find(n => !cfg.players.some(p => p.name === n)) || 'Bot';
          cfg.players.push({ name, kind: online ? 'remote' : 'bot', level: 'normal', color, flag: patternFlag(color, cfg.players.length) });
          if (cfg.players.length > 4 && ['classic', 'mini'].includes(cfg.map.shape)) cfg.map.shape = 'extended';
          if (cfg.players.length > 6 && ['classic', 'mini', 'extended', 'ring', 'star'].includes(cfg.map.shape)) {
            cfg.map.shape = 'big';
            toast('🗺️ Con 7-8 jugadores cambio al mapa Grande');
          }
          refresh();
        },
      }, '+ Añadir jugador')));

    // presets
    left.append(h('div', { class: 'card' },
      h('h3', null, '⚡ Modos rápidos ', h('small', null, 'aplica una combinación')),
      h('div', { class: 'chips' }, PRESETS.map(p => h('button', {
        class: 'chip', title: p.desc,
        onclick: () => {
          const players = cfg.players;
          cfg = defaultConfig();
          cfg.players = players;
          p.apply(cfg);
          refresh();
          toast(`${p.icon} ${p.name}: ${p.desc}`);
        },
      }, `${p.icon} ${p.name}`)))));

    // map
    const customs = storage(MAPS_KEY) || [];
    const m = cfg.map;
    const sel = (k, v) => h('select', { onchange: e => { m[k] = isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value; refresh(); } },
      v.map(([val, label]) => h('option', { value: val, selected: String(m[k]) === String(val) ? true : null }, label)));
    left.append(h('div', { class: 'card' },
      h('h3', null, '🗺️ Mapa'),
      h('div', { class: 'maps' },
        Object.entries(SHAPES).filter(([k]) => k !== 'custom').map(([k, sh]) => h('div', {
          class: 'map-card' + (m.shape === k ? ' on' : ''), title: sh.desc,
          onclick: () => { m.shape = k; m.custom = null; cfg.seed = newSeed(); refresh(); },
        }, h('div', { class: 'mini' }, miniMap(k)), h('b', null, sh.name))),
        customs.map((c, i) => h('div', {
          class: 'map-card' + (m.shape === 'custom' && m.custom && m.custom.name === c.name ? ' on' : ''), title: 'Mapa personalizado',
          onclick: () => { m.shape = 'custom'; m.custom = c; refresh(); },
        }, h('div', { class: 'mini' }, miniMap('custom', c)), h('b', null, '✏️ ' + c.name))),
        h('div', { class: 'map-card', onclick: () => App.go('editor') }, h('div', { class: 'mini', style: { display: 'grid', placeItems: 'center', fontSize: '38px' } }, '➕'), h('b', null, 'Crear mapa'))),
      h('p', { style: { color: 'var(--muted)', fontSize: '13px', margin: '10px 0 0' } }, (SHAPES[m.shape] || SHAPES.custom).desc),
      h('div', { class: 'opt-grid' },
        (SHAPES[m.shape] || {}).random ? h('div', null, h('label', null, `Tamaño: ${m.size} hexágonos`), h('input', { type: 'range', min: 12, max: 60, value: m.size, onchange: e => { m.size = +e.target.value; refresh(); } })) : null,
        h('div', null, h('label', null, 'Recursos'), sel('resources', [['balanced', 'Equilibrados'], ['chaos', 'Caóticos']])),
        h('div', null, h('label', null, 'Números'), sel('numbers', [['balanced', 'Sin 6/8 juntos'], ['random', 'Totalmente al azar']])),
        h('div', null, h('label', null, 'Desiertos'), sel('deserts', [['auto', 'Automático'], [0, '0'], [1, '1'], [2, '2'], [3, '3']])),
        h('div', null, h('label', null, 'Casillas de oro 💰'), sel('gold', [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']])),
        h('div', null, h('label', null, 'Puertos'), sel('ports', [['none', 'Ninguno'], ['few', 'Pocos'], ['normal', 'Normal'], ['many', 'Muchos']]))),
      m.gold ? h('p', { style: { color: 'var(--muted)', fontSize: '12px' } }, '💰 El oro te da el recurso que menos tienes.') : null));

    // modes
    left.append(h('div', { class: 'card' },
      h('h3', null, '🎭 Modos de juego ', h('small', null, 'combínalos como quieras')),
      h('div', { class: 'modes' }, MODES.map(md => {
        const on = md.get(cfg);
        return h('div', { class: 'mode' + (on ? ' on' : '') + (md.flagship ? ' flag' : ''), onclick: () => { md.set(cfg, !on); refresh(); } },
          h('div', { class: 'mi' }, md.icon), h('div', null, md.flagship ? h('span', { class: 'flagship' }, '★ MODO INSIGNIA') : null, h('b', null, md.name), h('small', null, md.desc)), h('div', { class: 'switch' }));
      })),
      cfg.modes.chaosEvery ? h('div', { class: 'opt-grid' },
        h('div', null, h('label', null, 'Tierra viva: qué se baraja'), h('select', { onchange: e => { cfg.modes.chaosWhat = e.target.value; refresh(); } },
          [['numbers', 'Números'], ['resources', 'Recursos'], ['both', 'Ambos']].map(([v, l]) => h('option', { value: v, selected: cfg.modes.chaosWhat === v ? true : null }, l)))),
        h('div', null, h('label', null, `Cada ${cfg.modes.chaosEvery} rondas`), h('input', { type: 'range', min: 1, max: 6, value: cfg.modes.chaosEvery, onchange: e => { cfg.modes.chaosEvery = +e.target.value; refresh(); } }))) : null,
      !online ? h('div', { class: 'opt-grid' },
        h('div', null, h('label', null, 'Pantalla de pase (varios humanos)'), h('select', { onchange: e => { cfg.modes.privacy = e.target.value; save(); } },
          [['auto', 'Solo en Blindfold'], ['on', 'Siempre'], ['off', 'Nunca']].map(([v, l]) => h('option', { value: v, selected: cfg.modes.privacy === v ? true : null }, l))))) : null));

    // rules
    const R = cfg.rules;
    const slider = (key, label, min, max, fmt = x => x) => h('div', { class: 'rule' },
      h('label', null, label, h('span', null, fmt(R[key]))),
      h('input', { type: 'range', min, max, value: R[key], oninput: e => { R[key] = +e.target.value; e.target.previousSibling.lastChild.textContent = fmt(R[key]); }, onchange: () => refresh() }));
    left.append(h('div', { class: 'card' },
      h('h3', null, '📜 Reglas'),
      h('div', { class: 'rules' },
        slider('vpTarget', 'Puntos para ganar', 4, 20),
        slider('handLimit', 'Límite de mano con 7', 4, 15),
        slider('setupRounds', 'Colocaciones iniciales', 1, 3),
        slider('startBonus', 'Bonus inicial (de cada recurso)', 0, 3),
        slider('robberGrace', 'Rondas sin ladrón', 0, 5),
        slider('maxRoads', 'Caminos por jugador', 8, 25),
        slider('maxSettlements', 'Poblados por jugador', 3, 9),
        slider('maxCities', 'Ciudades por jugador', 2, 8),
        h('div', { class: 'rule' }, h('label', null, 'Mazo de desarrollo'), h('select', { onchange: e => { R.devDeck = e.target.value; refresh(); } },
          Object.entries(DEV_DECKS).map(([k, d]) => h('option', { value: k, selected: R.devDeck === k ? true : null }, d.name)))),
        h('div', { class: 'rule' }, h('label', null, 'Primer jugador'), h('select', { onchange: e => { R.randomStart = e.target.value === '1'; refresh(); } },
          h('option', { value: '1', selected: R.randomStart ? true : null }, 'Al azar'), h('option', { value: '0', selected: !R.randomStart ? true : null }, 'El primero de la lista'))))));
  }

  function start() {
    if (cfg.players.length < 2) return toast('Necesitas al menos 2 jugadores', 'error');
    save();
    const game = JSON.parse(JSON.stringify(cfg));
    if (online) {
      const remotes = game.players.filter(p => p.kind === 'remote');
      if (remotes.length > App.net.guests.length) return toast(`Faltan amigos: hay ${remotes.length} asientos online y ${App.net.guests.length} conectados`, 'error');
      App.net.startGame(game);
      return;
    }
    App.startGame(game);
  }

  if (online && App.net) App.net.onChange = () => renderOnline();
  refresh();
}
