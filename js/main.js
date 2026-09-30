import { App, SAVE_KEY } from './app.js';
import { h, storage, toast } from './ui/dom.js';
import { lobbyScreen } from './ui/lobby.js';
import { gameScreen } from './ui/gameView.js';
import { editorScreen, decodeMap } from './ui/editor.js';
import { showHelp } from './ui/help.js';
import { Net, HOST_SESSION, GUEST_SESSION } from './net.js';
import { openFlagEditor, flagImg, myKingdom, saveMyKingdom, patternFlag } from './ui/flag.js';
import { autoPixelize } from './ui/pixel.js';

// live 3D island slowly orbiting behind the title
async function menuDiorama(el) {
  try {
    const [{ Board3D }, { createGame }, { defaultConfig }] = await Promise.all([import('./ui/board3d.js'), import('./engine/game.js'), import('./engine/config.js')]);
    if (!el.isConnected) return;
    const c = defaultConfig();
    c.map.shape = ['pangea', 'big', 'star', 'ring'][Math.floor(Math.random() * 4)];
    c.map.size = 30;
    c.map.gold = 1;
    const st = createGame(c);
    const b = await Board3D.create(el);
    if (!el.isConnected) return b.dispose();
    b.render(st, {});
    b.labels.domElement.style.display = 'none';
    b.controls.enabled = false;
    b.controls.autoRotate = true;
    b.controls.autoRotateSpeed = 0.35;
    b.setZoom(1.15);
    const prev = App.onLeave;
    App.onLeave = () => {
      if (prev) prev();
      b.dispose();
    };
  } catch (e) {
    console.warn('diorama', e);
  }
}

async function reopenRoom(btn) {
  btn.disabled = true;
  btn.textContent = '⏳ Reabriendo la sala (puede tardar unos segundos)...';
  try {
    await Net.reopen();
    toast('🔁 Sala reabierta: tus amigos se reconectan solos', 'good', 4000);
  } catch (e) {
    App.net = null;
    toast('No se pudo reabrir: ' + e.message, 'error', 5000);
    App.go('menu');
  }
}

async function backToRoom(sess) {
  toast('📡 Volviendo a la sala ' + sess.code + '...');
  try {
    App.net = new Net();
    await App.net.join(sess.code, sess.name, myKingdom() || {});
  } catch (e) {
    App.net = null;
    toast('❌ ' + e.message, 'error', 5000);
  }
}

const myOrDefaultKingdom = () => myKingdom() || { name: storage('kchudites.name') || '', color: '#e53935', flag: patternFlag('#e53935', 1) };

// "Tu reino" on the main menu: name + banner are set before any game (local, host or join)
function kingdomPanel() {
  const box = h('div', { class: 'menu-kingdom' });
  const draw = () => {
    const k = myOrDefaultKingdom();
    const nameIn = h('input', { type: 'text', class: 'hub-name', placeholder: 'Tu nombre', value: k.name || '', maxlength: 16, 'aria-label': 'Tu nombre' });
    nameIn.addEventListener('input', () => {
      const n = nameIn.value.trim();
      storage('kchudites.name', n);
      saveMyKingdom({ ...myOrDefaultKingdom(), name: n });
    });
    box.replaceChildren(
      h('button', { class: 'hub-flag small mk-flag', title: 'Pintar bandera y color del castillo', onclick: paint }, h('div', { class: 'pole' }), flagImg(k.flag, 36, 'flag-img wave')),
      h('div', { class: 'mk-info' },
        h('label', { class: 'section-label' }, h('span', { class: 'swatch', style: { background: k.color } }), 'Tu reino'),
        nameIn),
      h('button', { class: 'btn sm', title: 'Pintar bandera y color del castillo', onclick: paint }, '🎨'));
    function paint() {
      openFlagEditor({ flag: k.flag, color: k.color, name: nameIn.value.trim(), onSave: ({ flag, color }) => { saveMyKingdom({ ...myOrDefaultKingdom(), name: nameIn.value.trim(), flag, color }); draw(); } });
    }
  };
  draw();
  return box;
}

function menuScreen(root) {
  const save = storage(SAVE_KEY);
  const fresh = (x, hours) => x && Date.now() - (x.at || 0) < hours * 3600e3;
  const hostSess = fresh(storage(HOST_SESSION), 24) ? storage(HOST_SESSION) : null;
  const guestSess = !hostSess && fresh(storage(GUEST_SESSION), 6) ? storage(GUEST_SESSION) : null;
  const icons = ['🌲', '🧱', '🐑', '🌾', '⛰️', '🏠', '🏰', '🎲', '⚔️', '💰', '🛤️', '🙈'];
  const bg = h('div', { class: 'menu-bg' }, Array.from({ length: 26 }, (_, i) => h('div', {
    class: 'fhex', style: { left: ((i * 37) % 100) + '%', top: ((i * 53) % 100) + '%', animationDelay: -(i * 0.7) + 's', fontSize: 26 + ((i * 7) % 30) + 'px' },
  }, icons[i % icons.length])));
  const dio = h('div', { class: 'menu-bg3d' });
  root.append(h('div', { class: 'menu screen' }, bg, dio,
    h('div', { class: 'logo' },
      h('div', { class: 't1 jit' }, 'CATAN'),
      h('span', { class: 'x jit' }, 'x'),
      h('div', { class: 't2 jit' }, 'KCHUDITES'),
      h('div', { class: 'sub' }, 'Colonos, caos y modos que no existen en la caja.')),
    kingdomPanel(),
    h('div', { class: 'menu-buttons' },
      save ? h('button', { class: 'btn green', onclick: () => App.resume() }, `▶️ Continuar partida (ronda ${save.round || 0})`) : null,
      hostSess ? h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn green', style: { flex: 1 }, onclick: e => reopenRoom(e.currentTarget) }, `🔁 Reabrir sala ${hostSess.code} (ronda ${hostSess.state.round})`),
        h('button', { class: 'btn ghost', title: 'Cerrar esa sala para siempre', onclick: () => { storage(HOST_SESSION, null); App.go('menu'); } }, '✕')) : null,
      guestSess ? h('button', { class: 'btn green', onclick: () => backToRoom(guestSess) }, `📡 Volver a la sala ${guestSess.code}`) : null,
      h('button', { class: 'btn primary', onclick: () => App.go('lobby') }, '🎮 Jugar local (hotseat + bots)'),
      h('button', { class: 'btn pink', onclick: () => App.go('online') }, '🌐 Jugar online con amigos'),
      h('button', { class: 'btn', onclick: () => App.go('editor') }, '✏️ Editor de mapas'),
      h('button', { class: 'btn', onclick: () => quickBots() }, '👀 Ver una partida de bots'),
      h('button', { class: 'btn', onclick: () => showHelp() }, '📖 Cómo se juega'),
      h('a', { class: 'btn', href: 'showcase/', style: { textDecoration: 'none' } }, '🎬 Showcase')),
    h('div', { class: 'menu-foot' }, 'Hecho para los Kchudites · funciona en PC y móvil · sin instalar nada')));
  menuDiorama(dio);
}

async function quickBots() {
  const { defaultConfig, PLAYER_COLORS, BOT_NAMES } = await import('./engine/config.js');
  const c = defaultConfig();
  c.players = [0, 1, 2, 3].map(i => ({ name: BOT_NAMES[i], kind: 'bot', level: ['hard', 'normal', 'hard', 'easy'][i], color: PLAYER_COLORS[i] }));
  c.modes.events = true;
  c.map.shape = ['classic', 'star', 'ring', 'pangea'][Math.floor(Math.random() * 4)];
  App.setSpeed(250);
  App.startGame(c);
}

const RECENT_KEY = 'kchudites.recentRooms';
function rememberRoom(code) {
  const list = (storage(RECENT_KEY) || []).filter(r => r.code !== code);
  list.unshift({ code, at: Date.now() });
  storage(RECENT_KEY, list.slice(0, 4));
}

// "Jugar con amigos": identity, create a room or join one — and the guest's waiting room
function onlineScreen(root) {
  const params = new URLSearchParams(location.search);
  const dio = h('div', { class: 'menu-bg3d' });
  const inner = h('div', { class: 'hub-inner' });
  root.append(h('div', { class: 'online-hub screen' }, dio, inner));
  menuDiorama(dio);
  const kingdom = myOrDefaultKingdom;
  let capacity = 4;
  let busy = false;

  const header = () => h('div', { class: 'hub-head' },
    h('button', { class: 'btn', onclick: () => { if (App.net) { App.net.close(); App.net = null; } App.go('menu'); } }, '← Menú'),
    h('div', null, h('h2', { class: 'jit' }, '🌐 Jugar con amigos'), h('div', { class: 'hub-sub' }, 'Hasta 8 reinos · sin cuentas · sin instalar nada')));

  function draw() {
    App.onLobby = draw;
    const net = App.net;
    if (net && net.role === 'client' && net.lobby) return drawWaiting(net);
    const k = kingdom();
    const nameIn = h('input', { type: 'text', class: 'hub-name', placeholder: 'Tu nombre', value: k.name || storage('kchudites.name') || '', maxlength: 16 });
    const saveName = () => {
      const n = nameIn.value.trim();
      storage('kchudites.name', n);
      saveMyKingdom({ ...kingdom(), name: n });
      return n;
    };
    nameIn.addEventListener('change', saveName);

    // code as 5 PIN-like boxes
    const boxes = Array.from({ length: 5 }, (_, i) => {
      const b = h('input', { type: 'text', maxlength: 1, class: 'pin', inputmode: 'text', autocomplete: 'off', 'aria-label': `Letra ${i + 1} del código` });
      b.addEventListener('input', () => {
        b.value = b.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (b.value && i < 4) boxes[i + 1].focus();
      });
      b.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !b.value && i > 0) boxes[i - 1].focus();
        if (e.key === 'Enter') join();
      });
      b.addEventListener('paste', e => {
        const t = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        if (!t) return;
        e.preventDefault();
        [...t].forEach((c, j) => (boxes[j].value = c));
        boxes[Math.min(4, t.length)].focus();
      });
      return b;
    });
    const pre = (params.get('sala') || '').toUpperCase();
    [...pre.slice(0, 5)].forEach((c, j) => (boxes[j].value = c));
    const status = h('div', { class: 'hub-status' });
    const recent = (storage(RECENT_KEY) || []).filter(r => Date.now() - r.at < 7 * 864e5);

    async function host() {
      if (busy) return;
      const n = saveName() || 'Anfitrión';
      busy = true;
      status.textContent = '⏳ Abriendo tu sala...';
      try {
        App.net = new Net();
        await App.net.host();
        const cfg = storage('kchudites.lastConfig');
        if (cfg && cfg.players) {
          cfg.players[0] = { ...cfg.players[0], name: n, kind: 'human', color: kingdom().color, flag: kingdom().flag };
          storage('kchudites.lastConfig', cfg);
        }
        App.go('lobby', { online: 'host', capacity });
      } catch (e) {
        App.net = null;
        status.textContent = '❌ ' + e.message;
      }
      busy = false;
    }

    async function join(codeArg) {
      if (busy) return;
      const n = saveName();
      const code = (codeArg || boxes.map(b => b.value).join('')).toUpperCase();
      if (!n) {
        nameIn.focus();
        return toast('Primero pon tu nombre', 'error');
      }
      if (code.length < 5) return toast('El código tiene 5 letras', 'error');
      busy = true;
      status.textContent = '⏳ Buscando la sala ' + code + '...';
      try {
        App.net = new Net();
        await App.net.join(code, n, kingdom(), st => {
          if (st === 'waiting') {
            rememberRoom(code);
            status.textContent = '✅ ¡Dentro!';
          }
          if (st === 'closed' && App.screen !== 'game') status.textContent = '🔌 Conexión cerrada.';
        });
      } catch (e) {
        App.net = null;
        status.textContent = '❌ ' + e.message;
      }
      busy = false;
    }

    const flagPole = h('div', { class: 'hub-flag' }, h('div', { class: 'pole' }), flagImg(k.flag, 72, 'flag-img wave'));
    inner.replaceChildren(header(),
      h('div', { class: 'hub-grid' },
        h('div', { class: 'card hub-card kingdom-card' },
          h('h3', null, '🏰 Tu reino'),
          h('div', { class: 'kingdom-hero' }, flagPole,
            h('div', { class: 'kingdom-info' },
              h('label', { class: 'section-label' }, 'Nombre'), nameIn,
              h('div', { class: 'castle-line' }, h('span', { class: 'swatch', style: { background: k.color } }), h('span', null, 'Color de tu castillo')))),
          h('button', { class: 'btn', onclick: () => openFlagEditor({ flag: k.flag, color: k.color, name: nameIn.value.trim(), onSave: ({ flag, color }) => { saveMyKingdom({ ...kingdom(), name: nameIn.value.trim(), flag, color }); draw(); } }) }, '🎨 Pintar bandera y castillo')),
        h('div', { class: 'card hub-card create-card' },
          h('h3', null, '👑 Crear sala'),
          h('p', null, 'Tú eliges el mapa y los modos. Tu navegador hace de servidor: déjalo abierto mientras juegan.'),
          h('div', { class: 'section-label' }, '¿Cuántos jugadores?'),
          h('div', { class: 'cap-row' }, [2, 3, 4, 5, 6, 7, 8].map(n => h('button', { class: 'cap' + (n === capacity ? ' on' : ''), onclick: () => { capacity = n; draw(); } }, n))),
          h('div', { class: 'cap-people' }, Array.from({ length: capacity }, (_, i) => h('span', { class: i === 0 ? 'me' : '' }, i === 0 ? '👑' : '🧑'))),
          h('button', { class: 'btn primary big', onclick: host }, '✨ Crear sala')),
        h('div', { class: 'card hub-card join-card' },
          h('h3', null, '🚪 Unirse'),
          h('p', null, 'Pide el código de 5 letras al anfitrión (o entra con su enlace).'),
          h('div', { class: 'pins' }, boxes),
          h('button', { class: 'btn pink big', onclick: () => join() }, '🚀 Entrar'),
          recent.length ? h('div', null, h('div', { class: 'section-label' }, 'Salas recientes'), h('div', { class: 'chips' }, recent.map(r => h('button', { class: 'chip', onclick: () => join(r.code) }, '↩ ' + r.code)))) : null)),
      status,
      h('div', { class: 'hub-tips' },
        h('span', null, '📡 Conexión directa entre navegadores'),
        h('span', null, '🔁 Si se te cae la señal, vuelves a tu asiento'),
        h('span', null, '🗳️ Si alguien se va, la mesa vota')));
    if (pre && !boxes[4].value) boxes[pre.length] && boxes[pre.length].focus();
  }

  function drawWaiting(net) {
    const L = net.lobby;
    const seats = [{ ...L.host, host: true }, ...L.players];
    const me = storage('kchudites.name');
    inner.replaceChildren(header(),
      h('div', { class: 'card hub-card waiting-card' },
        h('h3', null, '🏰 Sala ', h('span', { class: 'room-code inline' }, L.code || net.code), h('span', { class: 'room-state ' + (L.open ? 'on' : 'off') }, L.open ? 'abierta' : 'cerrada')),
        h('p', { class: 'waiting-msg jit' }, '⏳ Esperando a que el anfitrión empiece la partida...'),
        h('div', { class: 'section-label' }, `Reinos en la sala ${seats.length} / ${L.capacity}`),
        h('div', { class: 'seat-grid' },
          seats.map(p => h('div', { class: 'seat' + (p.host ? ' host' : '') + (p.name === me ? ' me' : '') },
            h('div', { class: 'hub-flag small' }, h('div', { class: 'pole' }), flagImg(p.flag, 40, 'flag-img wave')),
            h('b', null, p.name), h('small', null, p.host ? '👑 anfitrión' : p.name === me ? 'tú' : 'listo'))),
          Array.from({ length: Math.max(0, L.capacity - seats.length) }, () => h('div', { class: 'seat empty' }, h('div', { class: 'seat-q' }, '?'), h('small', null, 'libre')))),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => { net.close(); App.net = null; storage(GUEST_SESSION, null); App.go('online'); } }, '🚪 Salir de la sala'))));
  }

  App.onLeave = () => {
    App.onLobby = null;
  };
  draw();
}

autoPixelize(document.body);
App.screens = { menu: menuScreen, lobby: lobbyScreen, game: gameScreen, editor: editorScreen, online: onlineScreen };

// shared map link: ?mapa=<code>
const params = new URLSearchParams(location.search);
if (params.get('mapa')) {
  try {
    App.go('editor', decodeMap(params.get('mapa')));
  } catch {
    App.go('menu');
  }
} else if (params.get('sala')) App.go('online');
else App.go('menu');
