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
    App.onLeave = () => b.dispose();
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

function onlineScreen(root) {
  const name = storage('kchudites.name') || '';
  const codeIn = h('input', { type: 'text', placeholder: 'CÓDIGO', maxlength: 5, style: { textTransform: 'uppercase', fontSize: '22px', letterSpacing: '6px', textAlign: 'center' } });
  const nameIn = h('input', { type: 'text', placeholder: 'Tu nombre', value: name, maxlength: 16 });
  const status = h('p', { style: { minHeight: '22px', fontWeight: 700 } });
  const params = new URLSearchParams(location.search);
  if (params.get('sala')) codeIn.value = params.get('sala');

  const kingdom = () => myKingdom() || { color: '#e53935', flag: patternFlag('#e53935', 1) };
  const kBox = h('div', { class: 'kingdom-row' });
  const drawKingdom = () => {
    const k = kingdom();
    kBox.replaceChildren(flagImg(k.flag, 44), h('span', { class: 'swatch', style: { background: k.color, display: 'inline-block' } }),
      h('button', { class: 'btn', onclick: () => openFlagEditor({ flag: k.flag, color: k.color, name: nameIn.value.trim(), onSave: ({ flag, color }) => { saveMyKingdom({ ...k, flag, color, name: nameIn.value.trim() }); drawKingdom(); } }) }, '🎨 Personalizar bandera y castillo'));
  };
  drawKingdom();
  const remember = n => saveMyKingdom({ ...kingdom(), name: n });

  async function host() {
    const n = nameIn.value.trim() || 'Anfitrión';
    storage('kchudites.name', n);
    remember(n);
    status.textContent = '⏳ Creando sala...';
    try {
      App.net = new Net();
      await App.net.host();
      const cfg = storage('kchudites.lastConfig');
      if (cfg && cfg.players) {
        cfg.players[0].name = n;
        storage('kchudites.lastConfig', cfg);
      }
      App.go('lobby', { online: 'host' });
    } catch (e) {
      App.net = null;
      status.textContent = '❌ ' + e.message;
    }
  }

  async function join() {
    const n = nameIn.value.trim();
    const code = codeIn.value.trim().toUpperCase();
    if (!n) return toast('Pon tu nombre', 'error');
    if (code.length < 5) return toast('El código tiene 5 letras', 'error');
    storage('kchudites.name', n);
    remember(n);
    status.textContent = '⏳ Conectando...';
    try {
      App.net = new Net();
      await App.net.join(code, n, kingdom(), st => {
        if (st === 'waiting') status.textContent = '✅ ¡Dentro! Esperando a que el anfitrión empiece la partida...';
        if (st === 'closed' && App.screen !== 'game') status.textContent = '🔌 Conexión cerrada.';
      });
    } catch (e) {
      App.net = null;
      status.textContent = '❌ ' + e.message;
    }
  }

  root.append(h('div', { class: 'lobby screen', style: { maxWidth: '760px' } },
    h('div', { class: 'lobby-head' }, h('button', { class: 'btn', onclick: () => { App.net && App.net.close(); App.net = null; App.go('menu'); } }, '← Menú'), h('h2', null, '🌐 Jugar online')),
    h('div', { class: 'card' }, h('h3', null, '🙋 Tu nombre'), nameIn, h('div', { class: 'section-label' }, 'Tu reino'), kBox),
    h('div', { class: 'card' },
      h('h3', null, '👑 Crear sala'),
      h('p', { style: { color: 'var(--muted)' } }, 'Tú configuras la partida y tu navegador hace de servidor (déjalo abierto). Los bots también corren en tu equipo.'),
      h('button', { class: 'btn primary', onclick: host }, 'Crear sala')),
    h('div', { class: 'card' },
      h('h3', null, '🚪 Unirse a una sala'),
      codeIn,
      h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn pink', onclick: join }, 'Unirse'))),
    status,
    h('p', { style: { color: 'var(--muted)', fontSize: '13px' } }, 'Conexión directa entre navegadores (WebRTC). En algunas redes muy cerradas puede no funcionar.')));
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
