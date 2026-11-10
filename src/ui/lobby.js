import { App } from '../app.js';
import { h, s as S, clear, storage, toast } from './dom.js';
import { BoardView } from '@board/BoardView';
import { defaultConfig, MODES, PRESETS, PLAYER_COLORS, BOT_NAMES } from '@engine/config';
import { SHAPES, generateBoard } from '@engine/board';
import { DEV_DECKS, TILE_INFO } from '@engine/constants';
import { createGame } from '@engine/game';
import { newSeed } from '@engine/rng';
import { openFlagEditor, flagImg, patternFlag, validFlag, myKingdom, saveMyKingdom } from './flag.js';
import { pixelize } from './pixel.js';

const CFG_KEY = 'katanittes.lastConfig';
export const MAPS_KEY = 'katanittes.maps';

const miniCache = new Map();
function miniMap(key, custom) {
  const ck = custom ? 'c:' + custom.name + custom.tiles.length : key;
  if (miniCache.has(ck)) return miniCache.get(ck).cloneNode(true);
  const cfg = localConfig();
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
  const base = localConfig();
  if (!saved) return base;
  // merge so new options always exist
  return { ...base, ...saved, map: { ...base.map, ...saved.map }, rules: { ...base.rules, ...saved.rules }, modes: { ...base.modes, ...saved.modes }, seed: newSeed() };
}

const localConfig = defaultConfig;

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
      h('button', { class: 'btn', onclick: () => { if (online && App.net) { if (App.net.guests.some(g => g.connected) && !confirm('Thoát? Phòng sẽ đóng với bạn bè của bạn.')) return; App.net.closeRoom(); } App.net = null; App.go('menu'); } }, '← Menu'),
      h('h2', null, online ? '🌐 Phòng online' : '🎮 Ván mới'),
      h('button', { class: 'btn sm', onclick: () => { cfg = localConfig(); if (online) cfg.players.forEach((p, i) => { if (i && p.kind === 'human') p.kind = 'remote'; }); refresh(); } }, '↺ Đặt lại')),
    h('div', { class: 'lobby-grid' }, left,
      h('div', { class: 'preview-card' }, onlineBox, h('div', { class: 'card' },
        h('h3', null, '🗺️ Xem trước ', h('small', null, 'bản đồ của bạn sẽ trông thế này')),
        previewBox, previewMeta)))),
    h('div', { class: 'start-bar' }, h('button', { class: 'btn primary big', id: 'startBtn', onclick: start }, online ? '🚀 Bắt đầu ván online' : '🚀 Chơi thôi!')));

  function save() {
    storage(CFG_KEY, cfg);
  }

  function refresh() {
    save();
    renderLeft();
    renderPreview();
    renderOnline();
  }

  // small changes (a switch, a select, a slider) only touch the preview: rebuilding the whole
  // column made the page jump and the switches lose their slide
  function light() {
    save();
    renderPreview();
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
      h('span', { class: 'pill' }, `${land} ô`),
      h('span', { class: 'pill' }, `${st.board.ports.length} cảng`),
      ...Object.entries(counts).map(([r, n]) => h('span', { class: 'pill' }, `${TILE_INFO[r].icon}${n}`)),
      h('button', { class: 'btn sm', onclick: () => { cfg.seed = newSeed(); renderPreview(); } }, '🎲 Bản đồ khác'));
    // swap emojis for sprites now, not a frame later (the pills would change width and jump)
    pixelize(previewMeta);
  }

  // ---------- the online room (host) ----------
  let fillBots = true;
  const connectedGuests = () => (App.net ? App.net.guests.filter(g => g.connected) : []);
  function setCapacity(n) {
    n = Math.max(2, Math.min(8, n));
    while (cfg.players.length < n) {
      const k = cfg.players.length;
      const color = PLAYER_COLORS.find(c => !cfg.players.some(p => p.color === c)) || PLAYER_COLORS[k % PLAYER_COLORS.length];
      cfg.players.push({ name: `Bạn ${k}`, kind: 'remote', level: 'normal', color, flag: patternFlag(color, k) });
    }
    while (cfg.players.length > n) cfg.players.pop();
    if (n > 4 && ['classic', 'mini'].includes(cfg.map.shape)) cfg.map.shape = 'extended';
    if (n > 6 && ['classic', 'mini', 'extended', 'ring', 'star'].includes(cfg.map.shape)) cfg.map.shape = 'big';
    refresh();
  }
  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg, 'good');
    } catch {
      prompt('Sao chép từ đây:', text);
    }
  }
  function renderOnline() {
    clear(onlineBox);
    if (!online || !App.net) return;
    const net = App.net;
    // keep what the guests' waiting room shows in sync with this lobby
    net.capacity = cfg.players.length;
    net.hostInfo = { name: cfg.players[0].name, flag: cfg.players[0].flag, color: cfg.players[0].color };
    net.pushLobby();
    const guests = connectedGuests();
    const remoteSeats = cfg.players.filter(p => p.kind === 'remote').length;
    const link = location.origin + location.pathname + '?sala=' + net.code;
    onlineBox.append(h('div', { class: 'card room-card' },
      h('h3', null, '🌐 Phòng của bạn ', h('span', { class: 'room-state ' + (net.open ? 'on' : 'off') }, net.open ? 'đang mở' : 'đã đóng')),
      net.code ? h('div', { class: 'room-code' }, net.code) : h('p', null, 'Đang tạo phòng...'),
      h('div', { class: 'chips room-share' },
        h('button', { class: 'btn sm', onclick: () => copy(link, '🔗 Đã sao chép link: gửi cho bạn bè đi') }, '🔗 Sao chép link'),
        h('button', { class: 'btn sm', onclick: () => copy(net.code, '📋 Đã sao chép mã') }, '📋 Mã'),
        navigator.share ? h('button', { class: 'btn sm', onclick: () => navigator.share({ title: 'Katanittes', text: 'Vào phòng Katanittes của mình chơi nhé!', url: link }).catch(() => {}) }, '📤 Chia sẻ') : null),
      h('div', { class: 'section-label' }, 'Sức chứa phòng'),
      h('div', { class: 'cap-row' }, [2, 3, 4, 5, 6, 7, 8].map(n => h('button', { class: 'cap' + (cfg.players.length === n ? ' on' : ''), title: `${n} người chơi`, onclick: () => setCapacity(n) }, n))),
      h('div', { class: 'gfx-row room-toggles' },
        h('button', { class: 'chip' + (net.open ? ' on' : ''), onclick: () => { net.open = !net.open; renderOnline(); } }, net.open ? '🟢 Đang nhận người' : '🔒 Không nhận thêm ai'),
        h('button', { class: 'chip' + (fillBots ? ' on' : ''), onclick: () => { fillBots = !fillBots; renderOnline(); } }, '🤖 Ghế trống: bot chơi')),
      h('div', { class: 'section-label' }, `Trong phòng ${guests.length + 1} / ${cfg.players.length}`),
      h('div', { class: 'guest-list' },
        h('div', { class: 'guest host' }, flagImg(cfg.players[0].flag, 20), h('b', null, cfg.players[0].name), h('span', { class: 'tag ok' }, '👑 bạn')),
        guests.map(g => h('div', { class: 'guest' }, flagImg(g.flag, 20), h('b', null, g.name), h('span', { class: 'tag ok' }, 'đã kết nối'),
          h('button', { class: 'btn sm ghost kick', title: 'Đuổi', onclick: () => { if (confirm(`Đuổi ${g.name} khỏi phòng?`)) net.kick(g.token); } }, '👢'))),
        Array.from({ length: Math.max(0, remoteSeats - guests.length) }, () => h('div', { class: 'guest empty' }, h('span', { class: 'dots' }, '⏳'), fillBots ? 'trống (nếu không ai vào, bot sẽ chơi)' : 'đang chờ bạn bè'))),
      h('button', { class: 'btn pink sm close-room', onclick: () => { if (confirm('Đóng phòng? Bạn bè của bạn sẽ bị đưa ra ngoài.')) { net.closeRoom(); App.net = null; App.go('menu'); } } }, '✖ Đóng phòng')));
  }

  function guestFor(i) {
    if (!online) return null;
    const order = cfg.players.map((p, k) => (p.kind === 'remote' ? k : -1)).filter(k => k >= 0).indexOf(i);
    return order >= 0 ? connectedGuests()[order] || null : null;
  }

  function playerRows() {
    const kinds = online
      ? [['remote', '🌐 Bạn bè'], ['bot:easy', '🤖 Bot dễ'], ['bot:normal', '🤖 Bot thường'], ['bot:hard', '🤖 Bot khó']]
      : [['human', '🧑 Người'], ['bot:easy', '🤖 Bot dễ'], ['bot:normal', '🤖 Bot thường'], ['bot:hard', '🤖 Bot khó']];
    return cfg.players.map((p, i) => {
      const val = p.kind === 'bot' ? `bot:${p.level || 'normal'}` : p.kind;
      const hostSeat = online && i === 0;
      return h('div', { class: 'player-row' },
        h('div', {
          class: 'swatch', style: { background: p.color }, title: 'Đổi màu',
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
          ? h('div', { class: 'btn sm flag-btn', title: 'Mỗi người tự vẽ lá cờ của mình' }, guestFor(i) ? flagImg(guestFor(i).flag, 26) : '🌐')
          : h('button', {
            class: 'btn sm flag-btn', title: 'Cờ và màu lâu đài',
            onclick: () => openFlagEditor({
              flag: p.flag, color: p.color, name: p.name,
              onSave: ({ flag, color }) => {
                p.flag = flag;
                p.color = color;
                const twin = cfg.players.find(o => o !== p && o.color.toLowerCase() === color.toLowerCase());
                if (twin) toast(`⚠️ ${twin.name} đã dùng màu lâu đài này: đổi một người để dễ phân biệt`, 'error', 4000);
                if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag, color });
                refresh();
              },
            }),
          }, flagImg(p.flag, 26)),
        p.kind === 'remote' ? h('div', { class: 'seat-name' + (guestFor(i) ? ' taken' : '') }, guestFor(i) ? guestFor(i).name : 'Ghế trống chờ bạn bè') : h('input', { type: 'text', value: p.name, maxlength: 16, onchange: e => { p.name = e.target.value.trim() || `Người chơi ${i + 1}`; if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag: p.flag, color: p.color }); save(); } }),
        hostSeat ? h('div', { class: 'pill' }, '👑 Bạn (chủ phòng)') : h('select', {
          onchange: e => {
            const [k, l] = e.target.value.split(':');
            p.kind = k;
            if (l) p.level = l;
            if (k === 'bot' && !BOT_NAMES.includes(p.name)) p.name = BOT_NAMES.find(n => !cfg.players.some(x => x.name === n)) || p.name;
            if (k !== 'bot' && BOT_NAMES.includes(p.name)) p.name = k === 'remote' ? `Khách ${i}` : `Người chơi ${i + 1}`;
            refresh();
          },
        }, kinds.map(([k, l]) => h('option', { value: k, selected: k === val ? true : null }, l))),
        h('button', { class: 'btn sm ghost', disabled: cfg.players.length <= 2 || hostSeat, title: 'Bỏ', onclick: () => { cfg.players.splice(i, 1); refresh(); } }, '✕'));
    });
  }

  function renderLeft() {
    clear(left);
    // players
    left.append(h('div', { class: 'card' },
      h('h3', null, '👥 Người chơi ', h('small', null, `${cfg.players.length}/8`)),
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
            toast('🗺️ Có 7-8 người thì đổi sang bản đồ Lớn');
          }
          refresh();
        },
      }, '+ Thêm người chơi')));

    // presets
    left.append(h('div', { class: 'card' },
      h('h3', null, '⚡ Chơi nhanh ', h('small', null, 'áp dụng một bộ cài sẵn')),
      h('div', { class: 'chips' }, PRESETS.map(p => h('button', {
        class: 'chip', title: p.desc,
        onclick: () => {
          const players = cfg.players;
          cfg = localConfig();
          cfg.players = players;
          p.apply(cfg);
          refresh();
          toast(`${p.icon} ${p.name}: ${p.desc}`);
        },
      }, `${p.icon} ${p.name}`)))));

    // map
    const customs = storage(MAPS_KEY) || [];
    const m = cfg.map;
    const goldNote = h('p', { style: { color: 'var(--muted)', fontSize: '12px', display: m.gold ? '' : 'none' } }, '💰 Ô vàng cho bạn loại tài nguyên bạn đang ít nhất.');
    const sel = (k, v) => h('select', { onchange: e => { m[k] = isNaN(+e.target.value) || e.target.value === '' ? e.target.value : +e.target.value; goldNote.style.display = m.gold ? '' : 'none'; light(); } },
      v.map(([val, label]) => h('option', { value: val, selected: String(m[k]) === String(val) ? true : null }, label)));
    left.append(h('div', { class: 'card' },
      h('h3', null, '🗺️ Bản đồ'),
      h('div', { class: 'maps' },
        Object.entries(SHAPES).filter(([k]) => k !== 'custom').map(([k, sh]) => h('div', {
          class: 'map-card' + (m.shape === k ? ' on' : ''), title: sh.desc,
          onclick: () => { m.shape = k; m.custom = null; cfg.seed = newSeed(); refresh(); },
        }, h('div', { class: 'mini' }, miniMap(k)), h('b', null, sh.name))),
        customs.map((c, i) => h('div', {
          class: 'map-card' + (m.shape === 'custom' && m.custom && m.custom.name === c.name ? ' on' : ''), title: 'Bản đồ tự tạo',
          onclick: () => { m.shape = 'custom'; m.custom = c; refresh(); },
        }, h('div', { class: 'mini' }, miniMap('custom', c)), h('b', null, '✏️ ' + c.name))),
        h('div', { class: 'map-card', onclick: () => App.go('editor') }, h('div', { class: 'mini', style: { display: 'grid', placeItems: 'center', fontSize: '38px' } }, '➕'), h('b', null, 'Tạo bản đồ'))),
      h('p', { style: { color: 'var(--muted)', fontSize: '13px', margin: '10px 0 0' } }, (SHAPES[m.shape] || SHAPES.custom).desc),
      h('div', { class: 'opt-grid' },
        (SHAPES[m.shape] || {}).random ? h('div', null, h('label', null, `Kích thước: ${m.size} ô`), h('input', { type: 'range', min: 12, max: 60, value: m.size, oninput: e => { e.target.previousSibling.textContent = `Kích thước: ${e.target.value} ô`; }, onchange: e => { m.size = +e.target.value; light(); } })) : null,
        h('div', null, h('label', null, 'Tài nguyên'), sel('resources', [['balanced', 'Cân bằng'], ['chaos', 'Hỗn loạn']])),
        h('div', null, h('label', null, 'Số'), sel('numbers', [['balanced', 'Không để 6 và 8 cạnh nhau'], ['random', 'Hoàn toàn ngẫu nhiên']])),
        h('div', null, h('label', null, 'Sa mạc'), sel('deserts', [['auto', 'Tự động'], [0, '0'], [1, '1'], [2, '2'], [3, '3']])),
        h('div', null, h('label', null, 'Ô vàng 💰'), sel('gold', [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']])),
        h('div', null, h('label', null, 'Cảng'), sel('ports', [['none', 'Không có'], ['few', 'Ít'], ['normal', 'Bình thường'], ['many', 'Nhiều']]))),
      goldNote));

    // modes: toggled in place, so the switch slides and nothing around it moves
    const chaosBox = h('div');
    const renderChaos = () => {
      clear(chaosBox);
      if (!cfg.modes.chaosEvery) return;
      chaosBox.append(h('div', { class: 'opt-grid' },
        h('div', null, h('label', null, 'Đất chuyển mình: xáo trộn gì'), h('select', { onchange: e => { cfg.modes.chaosWhat = e.target.value; save(); } },
          [['numbers', 'Số'], ['resources', 'Tài nguyên'], ['both', 'Cả hai']].map(([v, l]) => h('option', { value: v, selected: cfg.modes.chaosWhat === v ? true : null }, l)))),
        h('div', null, h('label', null, `Mỗi ${cfg.modes.chaosEvery} vòng`), h('input', { type: 'range', min: 1, max: 6, value: cfg.modes.chaosEvery, oninput: e => { e.target.previousSibling.textContent = `Mỗi ${e.target.value} vòng`; }, onchange: e => { cfg.modes.chaosEvery = +e.target.value; save(); } }))));
    };
    renderChaos();
    left.append(h('div', { class: 'card' },
      h('h3', null, '🎭 Chế độ chơi ', h('small', null, 'kết hợp tùy thích')),
      h('div', { class: 'modes' }, MODES.map(md => h('div', {
        class: 'mode' + (md.get(cfg) ? ' on' : '') + (md.flagship ? ' flag' : ''), role: 'switch', 'aria-checked': String(!!md.get(cfg)),
        onclick: e => {
          const on = !md.get(cfg);
          md.set(cfg, on);
          e.currentTarget.classList.toggle('on', on);
          e.currentTarget.setAttribute('aria-checked', String(on));
          if (md.id === 'chaos') renderChaos();
          light();
        },
      }, h('div', { class: 'mi' }, md.icon), h('div', null, md.flagship ? h('span', { class: 'flagship' }, '★ CHẾ ĐỘ ĐẶC SẮC') : null, h('b', null, md.name), h('small', null, md.desc)), h('div', { class: 'switch' })))),
      chaosBox,
      !online ? h('div', { class: 'opt-grid' },
        h('div', null, h('label', null, 'Màn hình chuyền máy (nhiều người chơi)'), h('select', { onchange: e => { cfg.modes.privacy = e.target.value; save(); } },
          [['auto', 'Chỉ khi Bịt mắt'], ['on', 'Luôn luôn'], ['off', 'Không bao giờ']].map(([v, l]) => h('option', { value: v, selected: cfg.modes.privacy === v ? true : null }, l))))) : null));

    // rules
    const R = cfg.rules;
    const slider = (key, label, min, max, fmt = x => x) => h('div', { class: 'rule' },
      h('label', null, label, h('span', null, fmt(R[key]))),
      h('input', { type: 'range', min, max, value: R[key], oninput: e => { R[key] = +e.target.value; e.target.previousSibling.lastChild.textContent = fmt(R[key]); }, onchange: () => save() }));
    left.append(h('div', { class: 'card' },
      h('h3', null, '📜 Luật chơi'),
      h('div', { class: 'rules' },
        slider('vpTarget', 'Điểm để thắng', 4, 20),
        slider('handLimit', 'Giới hạn thẻ khi ra 7', 4, 15),
        slider('setupRounds', 'Lượt đặt đầu ván', 1, 3),
        slider('startBonus', 'Quà khởi đầu (mỗi loại tài nguyên)', 0, 3),
        slider('robberGrace', 'Số vòng không có kẻ trộm', 0, 5),
        slider('maxRoads', 'Số đường mỗi người', 8, 25),
        slider('maxSettlements', 'Số nhà mỗi người', 3, 9),
        slider('maxCities', 'Số thành phố mỗi người', 2, 8),
        h('div', { class: 'rule' }, h('label', null, 'Bộ thẻ phát triển'), h('select', { onchange: e => { R.devDeck = e.target.value; save(); } },
          Object.entries(DEV_DECKS).map(([k, d]) => h('option', { value: k, selected: R.devDeck === k ? true : null }, d.name)))),
        h('div', { class: 'rule' }, h('label', null, 'Người đi đầu'), h('select', { onchange: e => { R.randomStart = e.target.value === '1'; save(); } },
          h('option', { value: '1', selected: R.randomStart ? true : null }, 'Ngẫu nhiên'), h('option', { value: '0', selected: !R.randomStart ? true : null }, 'Người đầu danh sách'))))));
    // sprites in now: waiting for the observer's next frame showed raw emojis that then resized
    pixelize(left);
  }

  function start() {
    if (cfg.players.length < 2) return toast('Cần ít nhất 2 người chơi', 'error');
    save();
    const game = JSON.parse(JSON.stringify(cfg));
    if (online) {
      const guests = connectedGuests().length;
      const remotes = game.players.filter(p => p.kind === 'remote');
      if (remotes.length > guests) {
        if (!fillBots) return toast(`Còn thiếu người: có ${remotes.length} ghế online nhưng mới ${guests} người vào`, 'error');
        // empty online seats are taken by bots
        remotes.slice(guests).forEach(p => {
          p.kind = 'bot';
          p.level = 'normal';
          p.name = BOT_NAMES.find(n => !game.players.some(x => x.name === n)) || p.name;
        });
      }
      App.net.startGame(game);
      return;
    }
    App.startGame(game);
  }

  if (online && App.net) {
    App.net.onChange = () => renderLeft() || renderOnline();
    // a friend could not get in: say who and why, with a one-tap fix
    App.net.onRefused = (why, name) => {
      const n = cfg.players.length;
      if (why === 'full' && n < 8)
        toast(h('span', null, `🚪 ${name} muốn vào nhưng phòng đã đầy (${n}/${n}). `,
          h('button', { class: 'btn sm', onclick: () => setCapacity(n + 1) }, `➕ Thêm chỗ (${n + 1})`)), 'error', 10000);
      else if (why === 'closed')
        toast(h('span', null, `🔒 ${name} muốn vào nhưng phòng đã đóng. `,
          h('button', { class: 'btn sm', onclick: () => { App.net.open = true; renderOnline(); } }, '🟢 Mở phòng')), 'error', 10000);
      else toast(why === 'full' ? `🚪 ${name} không vào được: phòng đã đủ tối đa 8 người.` : `🚪 ${name} không vào được: ván đã bắt đầu.`, 'error', 6000);
    };
  }
  if (online && opts.capacity) {
    // a fresh room: every seat but the host's is for a friend (the host can still switch some to bots)
    cfg.players.forEach((p, i) => {
      if (i === 0) return;
      p.kind = 'remote';
      if (BOT_NAMES.includes(p.name)) p.name = `Khách ${i}`;
    });
    setCapacity(opts.capacity);
  }
  refresh();
}
