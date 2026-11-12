// New game setup: players, map, modes and rules, with a live 2D preview. Also the host's room
// (online). `cfg` is a mutable object (like the imperative version); every change bumps `tick`.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { App } from '@app/index';
import { BoardView } from '@board/BoardView';
import { defaultConfig, MODES, PRESETS, PLAYER_COLORS, BOT_NAMES } from '@engine/config';
import { SHAPES, generateBoard } from '@engine/board';
import { DEV_DECKS, TILE_INFO } from '@engine/constants';
import { createGame } from '@engine/game';
import { newSeed } from '@engine/rng';
import type { BotLevel, Config, CustomMap, DevDeckId, GameState, PlayerConfig, ShapeId, TileKind } from '@engine/types';
import { h, storage, toast } from '@ui/dom';
import { Button } from '@ui/components/Button';
import { FlagImg } from '@ui/components/FlagImg';
import { PixelIcon, px } from '@ui/components/PixelIcon';
import { openFlagEditor } from '@ui/flag/FlagEditor';
import { myKingdom, patternFlag, saveMyKingdom, validFlag } from '@ui/flag/flag';

const CFG_KEY = 'katanittes.lastConfig';
export const MAPS_KEY = 'katanittes.maps';

type SeatKind = 'human' | 'bot' | 'remote';
type LPlayer = Omit<PlayerConfig, 'kind'> & { kind: SeatKind };
type LCfg = Omit<Config, 'players'> & { players: LPlayer[] };
interface LobbyArg { online?: 'host'; capacity?: number }

// ---------- mini map thumbnails ----------
interface Mini { viewBox: string; polys: Array<{ points: string; fill: string }> }
const miniCache = new Map<string, Mini>();
function miniMap(key: ShapeId, custom?: CustomMap): Mini {
  const ck = custom ? 'c:' + custom.name + custom.tiles.length : key;
  const hit = miniCache.get(ck);
  if (hit) return hit;
  const cfg = defaultConfig();
  cfg.map.shape = key;
  cfg.map.custom = custom || null;
  cfg.map.size = 24;
  const bd = generateBoard(cfg, { s: 7 });
  const b = bd.bounds;
  const polys = bd.tiles.map(t => ({
    points: Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${t.x * 10 + 9.6 * Math.cos(a)},${t.y * 10 + 9.6 * Math.sin(a)}`;
    }).join(' '),
    fill: (TILE_INFO[t.res as TileKind] || TILE_INFO.desert).color,
  }));
  const mini = { viewBox: `${b.minX * 10} ${b.minY * 10} ${(b.maxX - b.minX) * 10} ${(b.maxY - b.minY) * 10}`, polys };
  miniCache.set(ck, mini);
  return mini;
}

function loadConfig(): LCfg {
  const saved = storage(CFG_KEY) as Partial<LCfg> | null;
  const base = defaultConfig() as unknown as LCfg;
  if (!saved) return base;
  // merge so new options always exist
  return { ...base, ...saved, map: { ...base.map, ...saved.map }, rules: { ...base.rules, ...saved.rules }, modes: { ...base.modes, ...saved.modes }, seed: newSeed() } as LCfg;
}

function initCfg(opts: LobbyArg): LCfg {
  const online = opts.online === 'host';
  const cfg = loadConfig();
  if (online) {
    cfg.players[0] = { ...cfg.players[0]!, kind: 'human' };
    cfg.players.forEach((p, i) => { if (i > 0 && p.kind === 'human') p.kind = 'remote'; });
  } else cfg.players.forEach(p => { if (p.kind === 'remote') p.kind = 'human'; });
  // every kingdom has a banner; seat 0 uses the one this device remembers
  const mine = myKingdom();
  const p0 = cfg.players[0];
  if (mine && p0 && p0.kind === 'human') Object.assign(p0, { name: mine.name || p0.name, color: mine.color || p0.color, flag: mine.flag });
  cfg.players.forEach((p, i) => { if (!validFlag(p.flag)) p.flag = patternFlag(p.color, i); });
  if (online && opts.capacity) {
    // a fresh room: every seat but the host's is for a friend (the host can still switch some to bots)
    cfg.players.forEach((p, i) => {
      if (i === 0) return;
      p.kind = 'remote';
      if (BOT_NAMES.includes(p.name)) p.name = `Khách ${i}`;
    });
    applyCapacity(cfg, opts.capacity);
  }
  return cfg;
}

function applyCapacity(cfg: LCfg, n0: number): void {
  const n = Math.max(2, Math.min(8, n0));
  while (cfg.players.length < n) {
    const k = cfg.players.length;
    const color = PLAYER_COLORS.find(c => !cfg.players.some(p => p.color === c)) || PLAYER_COLORS[k % PLAYER_COLORS.length]!;
    cfg.players.push({ name: `Bạn ${k}`, kind: 'remote', level: 'normal', color, flag: patternFlag(color, k) });
  }
  while (cfg.players.length > n) cfg.players.pop();
  if (n > 4 && ['classic', 'mini'].includes(cfg.map.shape)) cfg.map.shape = 'extended';
  if (n > 6 && ['classic', 'mini', 'extended', 'ring', 'star'].includes(cfg.map.shape)) cfg.map.shape = 'big';
}

const MiniSvg = ({ mini }: { mini: Mini }): JSX.Element => <svg viewBox={mini.viewBox}>{mini.polys.map((q, i) => <polygon key={i} points={q.points} fill={q.fill} />)}</svg>;

// ---------- small controls ----------
/** a slider whose label follows the thumb; the change is committed on release */
function Range({ label, min, max, value, onCommit, fmt = (x: number) => String(x), rule }: {
  label: (v: number) => ComponentChildren; min: number; max: number; value: number; onCommit: (v: number) => void; fmt?: (v: number) => string; rule?: boolean;
}): JSX.Element {
  const [live, setLive] = useState(value);
  useEffect(() => { setLive(value); }, [value]);
  // Preact 11 maps onChange to the `input` event: the release-commit needs the native `change`
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current!;
    const fn = () => commit.current(+el.value);
    el.addEventListener('change', fn);
    return () => el.removeEventListener('change', fn);
  }, []);
  const input = <input ref={ref} type="range" min={min} max={max} value={live} onInput={e => setLive(+e.currentTarget.value)} />;
  if (rule) return <div class="rule"><label>{label(live)}<span>{fmt(live)}</span></label>{input}</div>;
  return <div><label>{label(live)}</label>{input}</div>;
}

const Select = ({ value, options, onChange }: { value: string; options: Array<[string | number, string]>; onChange: (v: string) => void }): JSX.Element => (
  <select value={value} onChange={e => onChange(e.currentTarget.value)}>
    {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
  </select>
);

export function Lobby({ arg }: { arg?: LobbyArg }): JSX.Element {
  const opts = arg || {};
  const online = opts.online === 'host';
  const cfgRef = useRef<LCfg | null>(null);
  if (!cfgRef.current) cfgRef.current = initCfg(opts);
  const cfg = cfgRef.current;
  const [, setTick] = useState(0);
  const [fillBots, setFillBots] = useState(true);
  const bump = () => setTick(n => n + 1);
  const save = () => { storage(CFG_KEY, cfg); };
  const refresh = () => { save(); bump(); };
  const setCfg = (c: LCfg) => { cfgRef.current = c; refresh(); };

  const previewBox = useRef<HTMLDivElement>(null);
  const viewRef = useRef<BoardView | null>(null);

  // ----- preview (the 2D board): re-generated only when something that shapes the board changes
  const previewKey = JSON.stringify({ m: cfg.map, r: cfg.rules, o: cfg.modes, s: cfg.seed, p: cfg.players.map(p => p.color) });
  const st = useMemo<GameState | null>(() => {
    try {
      return createGame((cfg.players.length >= 2 ? cfg : { ...cfg, players: [...cfg.players, ...cfg.players] }) as unknown as Config);
    } catch (e) {
      console.error(e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  useEffect(() => {
    const view = new BoardView(previewBox.current!, { interactive: false });
    viewRef.current = view;
    return () => { view.dispose(); viewRef.current = null; };
  }, []);
  useEffect(() => {
    if (st && viewRef.current) viewRef.current.render(st as never, {});
  }, [st]);

  useEffect(() => { save(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- online (host): keep the guests' waiting room in sync, react to guests coming and going
  const connectedGuests = () => (App.net ? App.net.guests.filter(g => g.connected) : []);
  const api = useRef({ bump, setCapacity: (_n: number) => {} });
  api.current.bump = bump;
  api.current.setCapacity = (n: number) => { applyCapacity(cfg, n); refresh(); };
  useEffect(() => {
    if (!online || !App.net) return;
    const net = App.net;
    let alive = true;
    net.onChange = () => { if (alive) api.current.bump(); };
    // a friend could not get in: say who and why, with a one-tap fix
    net.onRefused = (why, name) => {
      const n = cfg.players.length;
      if (why === 'full' && n < 8)
        toast(h('span', null, `🚪 ${name} muốn vào nhưng phòng đã đầy (${n}/${n}). `,
          h('button', { class: 'btn sm', onclick: () => api.current.setCapacity(n + 1) }, `➕ Thêm chỗ (${n + 1})`)), 'error', 10000);
      else if (why === 'closed')
        toast(h('span', null, `🔒 ${name} muốn vào nhưng phòng đã đóng. `,
          h('button', { class: 'btn sm', onclick: () => { net.open = true; api.current.bump(); } }, '🟢 Mở phòng')), 'error', 10000);
      else toast(why === 'full' ? `🚪 ${name} không vào được: phòng đã đủ tối đa 8 người.` : `🚪 ${name} không vào được: ván đã bắt đầu.`, 'error', 6000);
    };
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!online || !App.net) return;
    const net = App.net;
    net.capacity = cfg.players.length;
    net.hostInfo = { name: cfg.players[0]!.name, flag: cfg.players[0]!.flag ?? null, color: cfg.players[0]!.color };
    net.pushLobby();
  });

  async function copy(text: string, msg: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg, 'good');
    } catch {
      prompt('Sao chép từ đây:', text);
    }
  }

  function guestFor(i: number) {
    if (!online) return null;
    const order = cfg.players.map((p, k) => (p.kind === 'remote' ? k : -1)).filter(k => k >= 0).indexOf(i);
    return order >= 0 ? connectedGuests()[order] || null : null;
  }

  function start(): void {
    if (cfg.players.length < 2) return void toast('Cần ít nhất 2 người chơi', 'error');
    save();
    const game = JSON.parse(JSON.stringify(cfg)) as LCfg;
    if (online) {
      const guests = connectedGuests().length;
      const remotes = game.players.filter(p => p.kind === 'remote');
      if (remotes.length > guests) {
        if (!fillBots) return void toast(`Còn thiếu người: có ${remotes.length} ghế online nhưng mới ${guests} người vào`, 'error');
        // empty online seats are taken by bots
        remotes.slice(guests).forEach(p => {
          p.kind = 'bot';
          p.level = 'normal';
          p.name = BOT_NAMES.find(n => !game.players.some(x => x.name === n)) || p.name;
        });
      }
      App.net!.startGame(game as unknown as Config);
      return;
    }
    App.startGame(game as unknown as Config);
  }

  const leave = () => {
    if (online && App.net) {
      if (App.net.guests.some(g => g.connected) && !confirm('Thoát? Phòng sẽ đóng với bạn bè của bạn.')) return;
      App.net.closeRoom();
    }
    App.net = null;
    App.go('menu');
  };
  const reset = () => {
    const c = defaultConfig() as unknown as LCfg;
    if (online) c.players.forEach((p, i) => { if (i && p.kind === 'human') p.kind = 'remote'; });
    setCfg(c);
  };

  // ---------- sections ----------
  const net = App.net;
  const guests = connectedGuests();
  const remoteSeats = cfg.players.filter(p => p.kind === 'remote').length;

  const roomCard = online && net ? (() => {
    const link = location.origin + location.pathname + '?sala=' + net.code;
    const p0 = cfg.players[0]!;
    return (
      <div class="card room-card">
        <h3>{px('🌐 Phòng của bạn ', 22)}<span class={'room-state ' + (net.open ? 'on' : 'off')}>{net.open ? 'đang mở' : 'đã đóng'}</span></h3>
        {net.code ? <div class="room-code">{net.code}</div> : <p>Đang tạo phòng...</p>}
        <div class="chips room-share">
          <Button sm onClick={() => void copy(link, '🔗 Đã sao chép link: gửi cho bạn bè đi')}>{px('🔗 Sao chép link', 15)}</Button>
          <Button sm onClick={() => void copy(net.code || '', '📋 Đã sao chép mã')}>{px('📋 Mã', 15)}</Button>
          {typeof navigator.share === 'function' && <Button sm onClick={() => void navigator.share({ title: 'Katanittes', text: 'Vào phòng Katanittes của mình chơi nhé!', url: link }).catch(() => {})}>{px('📤 Chia sẻ', 15)}</Button>}
        </div>
        <div class="section-label">Sức chứa phòng</div>
        <div class="cap-row">
          {[2, 3, 4, 5, 6, 7, 8].map(n => <button key={n} class={'cap' + (cfg.players.length === n ? ' on' : '')} title={`${n} người chơi`} onClick={() => api.current.setCapacity(n)}>{n}</button>)}
        </div>
        <div class="gfx-row room-toggles">
          <button class={'chip' + (net.open ? ' on' : '')} onClick={() => { net.open = !net.open; bump(); }}>{px(net.open ? '🟢 Đang nhận người' : '🔒 Không nhận thêm ai', 16)}</button>
          <button class={'chip' + (fillBots ? ' on' : '')} onClick={() => setFillBots(!fillBots)}>{px('🤖 Ghế trống: bot chơi', 16)}</button>
        </div>
        <div class="section-label">{`Trong phòng ${guests.length + 1} / ${cfg.players.length}`}</div>
        <div class="guest-list">
          <div class="guest host"><FlagImg flag={p0.flag} size={20} /><b>{p0.name}</b><span class="tag ok">{px('👑 bạn', 15)}</span></div>
          {guests.map(g => (
            <div class="guest" key={g.token}>
              <FlagImg flag={g.flag} size={20} /><b>{g.name}</b><span class="tag ok">đã kết nối</span>
              <button class="btn sm ghost kick" title="Đuổi" onClick={() => { if (confirm(`Đuổi ${g.name} khỏi phòng?`)) net.kick(g.token); }}>{px('👢', 15)}</button>
            </div>
          ))}
          {Array.from({ length: Math.max(0, remoteSeats - guests.length) }, (_, i) => (
            <div class="guest empty" key={'e' + i}><span class="dots">{px('⏳', 15)}</span>{fillBots ? 'trống (nếu không ai vào, bot sẽ chơi)' : 'đang chờ bạn bè'}</div>
          ))}
        </div>
        <Button variant="pink" sm class="close-room" onClick={() => { if (confirm('Đóng phòng? Bạn bè của bạn sẽ bị đưa ra ngoài.')) { net.closeRoom(); App.net = null; App.go('menu'); } }}>{px('✖ Đóng phòng', 15)}</Button>
      </div>
    );
  })() : null;

  const kinds: Array<[string, string]> = online
    ? [['remote', '🌐 Bạn bè'], ['bot:easy', '🤖 Bot dễ'], ['bot:normal', '🤖 Bot thường'], ['bot:hard', '🤖 Bot khó']]
    : [['human', '🧑 Người'], ['bot:easy', '🤖 Bot dễ'], ['bot:normal', '🤖 Bot thường'], ['bot:hard', '🤖 Bot khó']];

  const playerRows = cfg.players.map((p, i) => {
    const val = p.kind === 'bot' ? `bot:${p.level || 'normal'}` : p.kind;
    const hostSeat = online && i === 0;
    const gf = p.kind === 'remote' ? guestFor(i) : null;
    return (
      <div class="player-row" key={i}>
        <div class="swatch" style={{ background: p.color }} title="Đổi màu" onClick={() => {
          const used = new Set(cfg.players.map(x => x.color));
          let k = PLAYER_COLORS.indexOf(p.color);
          for (let j = 0; j < PLAYER_COLORS.length; j++) {
            k = (k + 1) % PLAYER_COLORS.length;
            if (!used.has(PLAYER_COLORS[k]!)) break;
          }
          p.color = PLAYER_COLORS[k]!;
          refresh();
        }} />
        {p.kind === 'remote'
          ? <div class="btn sm flag-btn" title="Mỗi người tự vẽ lá cờ của mình">{gf ? <FlagImg flag={gf.flag} size={26} /> : <PixelIcon emoji="🌐" size={15} />}</div>
          : (
            <button class="btn sm flag-btn" title="Cờ và màu lâu đài" onClick={() => openFlagEditor({
              flag: p.flag, color: p.color, name: p.name,
              onSave: ({ flag, color }) => {
                p.flag = flag;
                p.color = color;
                const twin = cfg.players.find(o => o !== p && o.color.toLowerCase() === color.toLowerCase());
                if (twin) toast(`⚠️ ${twin.name} đã dùng màu lâu đài này: đổi một người để dễ phân biệt`, 'error', 4000);
                if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag, color });
                refresh();
              },
            })}><FlagImg flag={p.flag} size={26} /></button>
          )}
        {p.kind === 'remote'
          ? <div class={'seat-name' + (gf ? ' taken' : '')}>{gf ? gf.name : 'Ghế trống chờ bạn bè'}</div>
          : <input type="text" value={p.name} maxLength={16} onBlur={e => {
            p.name = e.currentTarget.value.trim() || `Người chơi ${i + 1}`;
            if (p.kind === 'human' && i === 0) saveMyKingdom({ name: p.name, flag: p.flag ?? null, color: p.color });
            refresh();
          }} />}
        {hostSeat
          ? <div class="pill">{px('👑 Bạn (chủ phòng)', 15)}</div>
          : <Select value={val} options={kinds} onChange={v => {
            const [k, l] = v.split(':');
            p.kind = k as SeatKind;
            if (l) p.level = l as BotLevel;
            if (k === 'bot' && !BOT_NAMES.includes(p.name)) p.name = BOT_NAMES.find(n => !cfg.players.some(x => x.name === n)) || p.name;
            if (k !== 'bot' && BOT_NAMES.includes(p.name)) p.name = k === 'remote' ? `Khách ${i}` : `Người chơi ${i + 1}`;
            refresh();
          }} />}
        <Button sm variant="ghost" disabled={cfg.players.length <= 2 || hostSeat} title="Bỏ" onClick={() => { cfg.players.splice(i, 1); refresh(); }}>✕</Button>
      </div>
    );
  });

  const m = cfg.map;
  const mm = m as unknown as Record<string, string | number | null>;
  const setMap = (k: string, v: string) => {
    mm[k] = isNaN(+v) || v === '' ? v : +v;
    refresh();
  };
  const customs = (storage(MAPS_KEY) as CustomMap[] | null) || [];
  const shapeDef = SHAPES[m.shape] || SHAPES.custom;
  const mapOpt = (label: ComponentChildren, k: string, options: Array<[string | number, string]>) => (
    <div><label>{label}</label><Select value={String(mm[k])} options={options} onChange={v => setMap(k, v)} /></div>
  );

  const counts: Record<string, number> = {};
  if (st) for (const t of st.board.tiles) counts[t.res] = (counts[t.res] || 0) + 1;

  const R = cfg.rules as unknown as Record<string, number>;
  const rule = (key: string, label: string, min: number, max: number) => (
    <Range rule label={() => label} min={min} max={max} value={R[key]!} onCommit={v => { R[key] = v; refresh(); }} />
  );

  return (
    <>
      <div class="lobby screen">
        <div class="lobby-head">
          <Button onClick={leave}>← Menu</Button>
          <h2>{px(online ? '🌐 Phòng online' : '🎮 Ván mới', 32)}</h2>
          <Button sm onClick={reset}>↺ Đặt lại</Button>
        </div>
        <div class="lobby-grid">
          <div>
            <div class="card">
              <h3>{px('👥 Người chơi ', 22)}<small>{`${cfg.players.length}/8`}</small></h3>
              {playerRows}
              <Button sm disabled={cfg.players.length >= 8} onClick={() => {
                const color = PLAYER_COLORS.find(c => !cfg.players.some(p => p.color === c)) || PLAYER_COLORS[cfg.players.length % PLAYER_COLORS.length]!;
                const name = BOT_NAMES.find(n => !cfg.players.some(p => p.name === n)) || 'Bot';
                cfg.players.push({ name, kind: online ? 'remote' : 'bot', level: 'normal', color, flag: patternFlag(color, cfg.players.length) });
                if (cfg.players.length > 4 && ['classic', 'mini'].includes(cfg.map.shape)) cfg.map.shape = 'extended';
                if (cfg.players.length > 6 && ['classic', 'mini', 'extended', 'ring', 'star'].includes(cfg.map.shape)) {
                  cfg.map.shape = 'big';
                  toast('🗺️ Có 7-8 người thì đổi sang bản đồ Lớn');
                }
                refresh();
              }}>+ Thêm người chơi</Button>
            </div>

            <div class="card">
              <h3>{px('⚡ Chơi nhanh ', 22)}<small>áp dụng một bộ cài sẵn</small></h3>
              <div class="chips">
                {PRESETS.map(p => (
                  <button key={p.id} class="chip" title={p.desc} onClick={() => {
                    const c = defaultConfig() as unknown as LCfg;
                    c.players = cfg.players;
                    p.apply(c as unknown as Config);
                    setCfg(c);
                    toast(`${p.icon} ${p.name}: ${p.desc}`);
                  }}>{px(`${p.icon} ${p.name}`, 16)}</button>
                ))}
              </div>
            </div>

            <div class="card">
              <h3>{px('🗺️ Bản đồ', 22)}</h3>
              <div class="maps">
                {(Object.entries(SHAPES) as Array<[ShapeId, (typeof SHAPES)[ShapeId]]>).filter(([k]) => k !== 'custom').map(([k, sh]) => (
                  <div key={k} class={'map-card' + (m.shape === k ? ' on' : '')} title={sh.desc} onClick={() => { m.shape = k; m.custom = null; cfg.seed = newSeed(); refresh(); }}>
                    <div class="mini"><MiniSvg mini={miniMap(k)} /></div><b>{sh.name}</b>
                  </div>
                ))}
                {customs.map((c, i) => (
                  <div key={'c' + i} class={'map-card' + (m.shape === 'custom' && m.custom && m.custom.name === c.name ? ' on' : '')} title="Bản đồ tự tạo" onClick={() => { m.shape = 'custom'; m.custom = c; refresh(); }}>
                    <div class="mini"><MiniSvg mini={miniMap('custom', c)} /></div><b>{px('✏️ ' + c.name, 20)}</b>
                  </div>
                ))}
                <div class="map-card" onClick={() => App.go('editor')}>
                  <div class="mini" style={{ display: 'grid', placeItems: 'center', fontSize: '38px' }}><PixelIcon emoji="➕" size={44} /></div><b>Tạo bản đồ</b>
                </div>
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '13px', margin: '10px 0 0' }}>{shapeDef.desc}</p>
              <div class="opt-grid">
                {shapeDef.random && <Range label={v => `Kích thước: ${v} ô`} min={12} max={60} value={m.size} onCommit={v => { m.size = v; refresh(); }} />}
                {mapOpt('Tài nguyên', 'resources', [['balanced', 'Cân bằng'], ['chaos', 'Hỗn loạn']])}
                {mapOpt('Số', 'numbers', [['balanced', 'Không để 6 và 8 cạnh nhau'], ['random', 'Hoàn toàn ngẫu nhiên']])}
                {mapOpt('Sa mạc', 'deserts', [['auto', 'Tự động'], [0, '0'], [1, '1'], [2, '2'], [3, '3']])}
                {mapOpt(px('Ô vàng 💰', 15), 'gold', [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']])}
                {mapOpt('Cảng', 'ports', [['none', 'Không có'], ['few', 'Ít'], ['normal', 'Bình thường'], ['many', 'Nhiều']])}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '12px', display: m.gold ? '' : 'none' }}>{px('💰 Ô vàng cho bạn loại tài nguyên bạn đang ít nhất.', 14)}</p>
            </div>

            <div class="card">
              <h3>{px('🎭 Chế độ chơi ', 22)}<small>kết hợp tùy thích</small></h3>
              <div class="modes">
                {MODES.map(md => {
                  const on = md.get(cfg as unknown as Config);
                  return (
                    <div key={md.id} class={'mode' + (on ? ' on' : '') + (md.flagship ? ' flag' : '')} role="switch" aria-checked={!!on}
                      onClick={() => { md.set(cfg as unknown as Config, !on); refresh(); }}>
                      <div class="mi">{px(md.icon, 30)}</div>
                      <div>{md.flagship && <span class="flagship">★ CHẾ ĐỘ ĐẶC SẮC</span>}<b>{md.name}</b><small>{md.desc}</small></div>
                      <div class="switch" />
                    </div>
                  );
                })}
              </div>
              {cfg.modes.chaosEvery > 0 && (
                <div class="opt-grid">
                  <div>
                    <label>Đất chuyển mình: xáo trộn gì</label>
                    <Select value={cfg.modes.chaosWhat} options={[['numbers', 'Số'], ['resources', 'Tài nguyên'], ['both', 'Cả hai']]} onChange={v => { cfg.modes.chaosWhat = v as typeof cfg.modes.chaosWhat; refresh(); }} />
                  </div>
                  <Range label={v => `Mỗi ${v} vòng`} min={1} max={6} value={cfg.modes.chaosEvery} onCommit={v => { cfg.modes.chaosEvery = v; refresh(); }} />
                </div>
              )}
              {!online && (
                <div class="opt-grid">
                  <div>
                    <label>Màn hình chuyền máy (nhiều người chơi)</label>
                    <Select value={cfg.modes.privacy} options={[['auto', 'Chỉ khi Bịt mắt'], ['on', 'Luôn luôn'], ['off', 'Không bao giờ']]} onChange={v => { cfg.modes.privacy = v; refresh(); }} />
                  </div>
                </div>
              )}
            </div>

            <div class="card">
              <h3>{px('📜 Luật chơi', 22)}</h3>
              <div class="rules">
                {rule('vpTarget', 'Điểm để thắng', 4, 20)}
                {rule('handLimit', 'Giới hạn thẻ khi ra 7', 4, 15)}
                {rule('setupRounds', 'Lượt đặt đầu ván', 1, 3)}
                {rule('startBonus', 'Quà khởi đầu (mỗi loại tài nguyên)', 0, 3)}
                {rule('robberGrace', 'Số vòng không có kẻ trộm', 0, 5)}
                {rule('maxRoads', 'Số đường mỗi người', 8, 25)}
                {rule('maxSettlements', 'Số nhà mỗi người', 3, 9)}
                {rule('maxCities', 'Số thành phố mỗi người', 2, 8)}
                <div class="rule">
                  <label>Bộ thẻ phát triển</label>
                  <Select value={cfg.rules.devDeck} options={(Object.entries(DEV_DECKS) as Array<[string, { name: string }]>).map(([k, d]) => [k, d.name])} onChange={v => { cfg.rules.devDeck = v as DevDeckId; refresh(); }} />
                </div>
                <div class="rule">
                  <label>Người đi đầu</label>
                  <Select value={cfg.rules.randomStart ? '1' : '0'} options={[['1', 'Ngẫu nhiên'], ['0', 'Người đầu danh sách']]} onChange={v => { cfg.rules.randomStart = v === '1'; refresh(); }} />
                </div>
              </div>
            </div>
          </div>
          <div class="preview-card">
            {roomCard}
            <div class="card">
              <h3>{px('🗺️ Xem trước ', 22)}<small>bản đồ của bạn sẽ trông thế này</small></h3>
              <div class="preview" ref={previewBox} />
              <div class="preview-meta">
                {st && (
                  <>
                    <span class="pill">{`${st.board.tiles.length} ô`}</span>
                    <span class="pill">{`${st.board.ports.length} cảng`}</span>
                    {Object.entries(counts).map(([r, n]) => <span class="pill" key={r}><PixelIcon emoji={TILE_INFO[r as TileKind].icon} size={15} />{n}</span>)}
                    <Button sm onClick={() => { cfg.seed = newSeed(); bump(); }}>{px('🎲 Bản đồ khác', 15)}</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="start-bar"><Button variant="primary" big id="startBtn" onClick={start}>{px(online ? '🚀 Bắt đầu ván online' : '🚀 Chơi thôi!', 25)}</Button></div>
    </>
  );
}
