import { App, SAVE_KEY } from './app.js';
import { h, storage, toast } from './ui/dom.js';
import { lobbyScreen } from './ui/lobby.js';
import { gameScreen } from './ui/gameView.js';
import { editorScreen, decodeMap } from './ui/editor.js';
import { showHelp } from './ui/help.js';
import { Net } from './net.js';

function menuScreen(root) {
  const save = storage(SAVE_KEY);
  const icons = ['🌲', '🧱', '🐑', '🌾', '⛰️', '🏠', '🏰', '🎲', '⚔️', '💰', '🛤️', '🙈'];
  const bg = h('div', { class: 'menu-bg' }, Array.from({ length: 26 }, (_, i) => h('div', {
    class: 'fhex', style: { left: ((i * 37) % 100) + '%', top: ((i * 53) % 100) + '%', animationDelay: -(i * 0.7) + 's', fontSize: 26 + ((i * 7) % 30) + 'px' },
  }, icons[i % icons.length])));
  root.append(h('div', { class: 'menu screen' }, bg,
    h('div', { class: 'logo' },
      h('div', { class: 't1' }, 'CATAN'),
      h('span', { class: 'x' }, '✕'),
      h('div', { class: 't2' }, 'KCHUDITES'),
      h('div', { class: 'sub' }, 'Colonos, caos y modos que no existen en la caja.')),
    h('div', { class: 'menu-buttons' },
      save ? h('button', { class: 'btn green', onclick: () => App.resume() }, `▶️ Continuar partida (ronda ${save.round || 0})`) : null,
      h('button', { class: 'btn primary', onclick: () => App.go('lobby') }, '🎮 Jugar local (hotseat + bots)'),
      h('button', { class: 'btn pink', onclick: () => App.go('online') }, '🌐 Jugar online con amigos'),
      h('button', { class: 'btn', onclick: () => App.go('editor') }, '✏️ Editor de mapas'),
      h('button', { class: 'btn', onclick: () => quickBots() }, '👀 Ver una partida de bots'),
      h('button', { class: 'btn', onclick: () => showHelp() }, '📖 Cómo se juega'),
      h('a', { class: 'btn', href: 'showcase/', style: { textDecoration: 'none' } }, '🎬 Showcase')),
    h('div', { class: 'menu-foot' }, 'Hecho para los Kchudites · funciona en PC y móvil · sin instalar nada')));
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

  async function host() {
    const n = nameIn.value.trim() || 'Anfitrión';
    storage('kchudites.name', n);
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
    status.textContent = '⏳ Conectando...';
    try {
      App.net = new Net();
      await App.net.join(code, n, st => {
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
    h('div', { class: 'card' }, h('h3', null, '🙋 Tu nombre'), nameIn),
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
