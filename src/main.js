import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-800.css';
import '@fontsource/be-vietnam-pro/latin-800.css';
import '@fontsource/baloo-2/vietnamese-500.css';
import '@fontsource/baloo-2/latin-500.css';
import '@fontsource/baloo-2/vietnamese-600.css';
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/vietnamese-700.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/vietnamese-800.css';
import '@fontsource/baloo-2/latin-800.css';
import './styles/style.css';
import './styles/pixel.css';
import { App, SAVE_KEY } from './app.js';
import { h, storage, toast } from './ui/dom.js';
import { lobbyScreen } from './ui/lobby.js';
import { gameScreen } from './ui/gameView.js';
import { editorScreen, decodeMap } from './ui/editor.js';
import { showHelp, creditLine } from './ui/help.js';
import { Net, HOST_SESSION, GUEST_SESSION } from './net.js';
import { openFlagEditor, flagImg, myKingdom, saveMyKingdom, patternFlag } from './ui/flag.js';
import { autoPixelize } from './ui/pixel.js';
import { SETTINGS } from '@board/settings';

// live 3D island slowly orbiting behind the title
// (not built at all on the `low` tier: a static CSS gradient instead, so the GPU stays idle on the menu)
async function menuDiorama(el) {
  if (SETTINGS.quality === 'low') return el.classList.add('static');
  try {
    const [{ Board3D }, { createGame }, { defaultConfig }] = await Promise.all([import('@board/Board3D'), import('@engine/game'), import('@engine/config')]);
    if (!el.isConnected) return;
    const c = defaultConfig();
    c.map.shape = ['pangea', 'big', 'star', 'ring'][Math.floor(Math.random() * 4)];
    c.map.size = 30;
    c.map.gold = 1;
    const st = createGame(c);
    const b = await Board3D.create(el, { diorama: true });
    if (!el.isConnected) return b.dispose();
    b.render(st, {});
    b.labels.domElement.style.display = 'none';
    b.controls.enabled = false;
    b.controls.autoRotate = true;
    b.controls.autoRotateSpeed = 0.35;
    b.fpsCap = 30; // the background never needs more
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
  btn.textContent = '⏳ Đang mở lại phòng (có thể mất vài giây)...';
  try {
    await Net.reopen();
    toast('🔁 Đã mở lại phòng: bạn bè sẽ tự kết nối lại', 'good', 4000);
  } catch (e) {
    App.net = null;
    toast(`Không mở lại được: ${e.message}`, 'error', 5000);
    App.go('menu');
  }
}

async function backToRoom(sess) {
  toast(`📡 Đang quay lại phòng ${sess.code}...`);
  try {
    App.net = new Net();
    await App.net.join(sess.code, sess.name, myKingdom() || {});
  } catch (e) {
    App.net = null;
    toast('❌ ' + e.message, 'error', 5000);
  }
}

const myOrDefaultKingdom = () => myKingdom() || { name: storage('katanittes.name') || '', color: '#e53935', flag: patternFlag('#e53935', 1) };

// "Tu reino" on the main menu: name + banner are set before any game (local, host or join)
function kingdomPanel() {
  const box = h('div', { class: 'menu-kingdom' });
  const draw = () => {
    const k = myOrDefaultKingdom();
    const nameIn = h('input', { type: 'text', class: 'hub-name', placeholder: 'Tên của bạn', value: k.name || '', maxlength: 16, 'aria-label': 'Tên của bạn' });
    nameIn.addEventListener('input', () => {
      const n = nameIn.value.trim();
      storage('katanittes.name', n);
      saveMyKingdom({ ...myOrDefaultKingdom(), name: n });
    });
    box.replaceChildren(
      h('button', { class: 'hub-flag small mk-flag', title: 'Vẽ cờ và chọn màu lâu đài', onclick: paint }, h('div', { class: 'pole' }), flagImg(k.flag, 36, 'flag-img wave')),
      h('div', { class: 'mk-info' },
        h('label', { class: 'section-label' }, h('span', { class: 'swatch', style: { background: k.color } }), 'Vương quốc của bạn'),
        nameIn),
      h('button', { class: 'btn sm', title: 'Vẽ cờ và chọn màu lâu đài', onclick: paint }, '🎨'));
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
  // both can exist (hosted yesterday, joined a friend today): offer both
  const guestSess = fresh(storage(GUEST_SESSION), 6) ? storage(GUEST_SESSION) : null;
  const icons = ['🌲', '🧱', '🐑', '🌾', '⛰️', '🏠', '🏰', '🎲', '⚔️', '💰', '🛤️', '🙈'];
  const bg = h('div', { class: 'menu-bg' }, Array.from({ length: 26 }, (_, i) => h('div', {
    class: 'fhex', style: { left: ((i * 37) % 100) + '%', top: ((i * 53) % 100) + '%', animationDelay: -(i * 0.7) + 's', fontSize: 26 + ((i * 7) % 30) + 'px' },
  }, icons[i % icons.length])));
  const dio = h('div', { class: 'menu-bg3d' });
  root.append(h('div', { class: 'menu screen' }, bg, dio,
    h('div', { class: 'logo' },
      h('div', { class: 't1 jit' }, 'KATAN', h('span', { class: 't1b' }, 'ITTES')),
      h('div', { class: 'sub' }, 'Khai hoang, hỗn loạn và những chế độ không có trong hộp.')),
    kingdomPanel(),
    h('div', { class: 'menu-buttons' },
      save ? h('button', { class: 'btn green', onclick: () => App.resume() }, `▶️ Chơi tiếp (vòng ${save.round || 0})`) : null,
      hostSess ? h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn green', style: { flex: 1 }, onclick: e => reopenRoom(e.currentTarget) }, `🔁 Mở lại phòng ${hostSess.code} (vòng ${hostSess.state.round})`),
        h('button', { class: 'btn ghost', title: 'Đóng hẳn phòng đó', onclick: () => { storage(HOST_SESSION, null); App.go('menu'); } }, '✕')) : null,
      guestSess ? h('button', { class: 'btn green', onclick: () => backToRoom(guestSess) }, `📡 Quay lại phòng ${guestSess.code}`) : null,
      h('button', { class: 'btn primary', onclick: () => App.go('lobby') }, '🎮 Chơi trên một máy (chuyền máy + bot)'),
      h('button', { class: 'btn pink', onclick: () => App.go('online') }, '🌐 Chơi online với bạn bè'),
      h('button', { class: 'btn', onclick: () => App.go('editor') }, '✏️ Tạo bản đồ'),
      h('button', { class: 'btn', onclick: () => showHelp() }, '📖 Cách chơi')),
    h('div', { class: 'menu-foot' }, 'Làm ra để chơi cùng bạn bè · chạy trên máy tính và điện thoại · không cần cài đặt', creditLine())));
  menuDiorama(dio);
}

const RECENT_KEY = 'katanittes.recentRooms';
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
    h('button', { class: 'btn', onclick: () => { if (App.net) { App.net.close(); App.net = null; } App.go('menu'); } }, '← Menu'),
    h('div', null, h('h2', { class: 'jit' }, '🌐 Chơi với bạn bè'), h('div', { class: 'hub-sub' }, 'Tối đa 8 vương quốc · không cần tài khoản · không cần cài đặt')));

  function draw() {
    App.onLobby = draw;
    const net = App.net;
    if (net && net.role === 'client' && net.lobby) return drawWaiting(net);
    const k = kingdom();
    const nameIn = h('input', { type: 'text', class: 'hub-name', placeholder: 'Tên của bạn', value: k.name || storage('katanittes.name') || '', maxlength: 16 });
    const saveName = () => {
      const n = nameIn.value.trim();
      storage('katanittes.name', n);
      saveMyKingdom({ ...kingdom(), name: n });
      return n;
    };
    nameIn.addEventListener('change', saveName);

    // code as 5 PIN-like boxes
    const boxes = Array.from({ length: 5 }, (_, i) => {
      const b = h('input', { type: 'text', maxlength: 1, class: 'pin', inputmode: 'text', autocomplete: 'off', 'aria-label': `Chữ thứ ${i + 1} của mã` });
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
      const n = saveName() || 'Chủ phòng';
      busy = true;
      status.textContent = '⏳ Đang mở phòng của bạn...';
      try {
        App.net = new Net();
        await App.net.host();
        const cfg = storage('katanittes.lastConfig');
        if (cfg && cfg.players) {
          cfg.players[0] = { ...cfg.players[0], name: n, kind: 'human', color: kingdom().color, flag: kingdom().flag };
          storage('katanittes.lastConfig', cfg);
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
        return toast('Nhập tên trước đã', 'error');
      }
      if (code.length < 5) return toast('Mã gồm 5 chữ cái', 'error');
      busy = true;
      status.textContent = `⏳ Đang tìm phòng ${code}...`;
      try {
        App.net = new Net();
        await App.net.join(code, n, kingdom(), st => {
          if (st === 'waiting') {
            rememberRoom(code);
            status.textContent = '✅ Đã vào!';
          }
          if (st === 'closed' && App.screen !== 'game') status.textContent = '🔌 Kết nối đã đóng.';
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
          h('h3', null, '🏰 Vương quốc của bạn'),
          h('div', { class: 'kingdom-hero' }, flagPole,
            h('div', { class: 'kingdom-info' },
              h('label', { class: 'section-label' }, 'Tên'), nameIn,
              h('div', { class: 'castle-line' }, h('span', { class: 'swatch', style: { background: k.color } }), h('span', null, 'Màu lâu đài của bạn')))),
          h('button', { class: 'btn', onclick: () => openFlagEditor({ flag: k.flag, color: k.color, name: nameIn.value.trim(), onSave: ({ flag, color }) => { saveMyKingdom({ ...kingdom(), name: nameIn.value.trim(), flag, color }); draw(); } }) }, '🎨 Vẽ cờ và lâu đài')),
        h('div', { class: 'card hub-card create-card' },
          h('h3', null, '👑 Tạo phòng'),
          h('p', null, 'Bạn chọn bản đồ và chế độ. Trình duyệt của bạn đóng vai máy chủ: hãy để nó mở trong lúc chơi.'),
          h('div', { class: 'section-label' }, 'Bao nhiêu người chơi?'),
          h('div', { class: 'cap-row' }, [2, 3, 4, 5, 6, 7, 8].map(n => h('button', { class: 'cap' + (n === capacity ? ' on' : ''), onclick: () => { capacity = n; draw(); } }, n))),
          h('div', { class: 'cap-people' }, Array.from({ length: capacity }, (_, i) => h('span', { class: i === 0 ? 'me' : '' }, i === 0 ? '👑' : '🧑'))),
          h('button', { class: 'btn primary big', onclick: host }, '✨ Tạo phòng')),
        h('div', { class: 'card hub-card join-card' },
          h('h3', null, '🚪 Tham gia'),
          h('p', null, 'Xin chủ phòng mã 5 chữ cái (hoặc vào bằng link của họ).'),
          h('div', { class: 'pins' }, boxes),
          h('button', { class: 'btn pink big', onclick: () => join() }, '🚀 Vào phòng'),
          recent.length ? h('div', null, h('div', { class: 'section-label' }, 'Phòng gần đây'), h('div', { class: 'chips' }, recent.map(r => h('button', { class: 'chip', onclick: () => join(r.code) }, '↩ ' + r.code)))) : null)),
      status,
      h('div', { class: 'hub-tips' },
        h('span', null, '📡 Kết nối trực tiếp giữa các trình duyệt'),
        h('span', null, '🔁 Lỡ rớt mạng, bạn vẫn quay về đúng ghế'),
        h('span', null, '🗳️ Nếu có người rời đi, cả bàn bỏ phiếu')));
    if (pre && !boxes[4].value) boxes[pre.length] && boxes[pre.length].focus();
  }

  function drawWaiting(net) {
    const L = net.lobby;
    const seats = [{ ...L.host, host: true }, ...L.players];
    const me = storage('katanittes.name');
    inner.replaceChildren(header(),
      h('div', { class: 'card hub-card waiting-card' },
        h('h3', null, '🏰 Phòng ', h('span', { class: 'room-code inline' }, L.code || net.code), h('span', { class: 'room-state ' + (L.open ? 'on' : 'off') }, L.open ? 'đang mở' : 'đã đóng')),
        h('p', { class: 'waiting-msg jit' }, '⏳ Đang chờ chủ phòng bắt đầu ván...'),
        h('div', { class: 'section-label' }, `Vương quốc trong phòng ${seats.length} / ${L.capacity}`),
        h('div', { class: 'seat-grid' },
          seats.map(p => h('div', { class: 'seat' + (p.host ? ' host' : '') + (p.name === me ? ' me' : '') },
            h('div', { class: 'hub-flag small' }, h('div', { class: 'pole' }), flagImg(p.flag, 40, 'flag-img wave')),
            h('b', null, p.name), h('small', null, p.host ? '👑 chủ phòng' : p.name === me ? 'bạn' : 'sẵn sàng'))),
          Array.from({ length: Math.max(0, L.capacity - seats.length) }, () => h('div', { class: 'seat empty' }, h('div', { class: 'seat-q' }, '?'), h('small', null, 'trống')))),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => { net.close(); App.net = null; storage(GUEST_SESSION, null); App.go('online'); } }, '🚪 Rời phòng'))));
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

// dev-only perf overlay: open with ?perf
if (import.meta.env.DEV && new URLSearchParams(location.search).has('perf')) {
  import('stats-gl').then(({ default: Stats }) => {
    const stats = new Stats({ trackGPU: true });
    document.body.append(stats.dom);
    let patched = null;
    const tick = () => {
      const b = window.__board3d;
      if (b && b.renderer && patched !== b.renderer) {
        patched = b.renderer;
        stats.init(b.renderer);
      }
      if (patched) stats.update();
      requestAnimationFrame(tick);
    };
    tick();
  });
}
