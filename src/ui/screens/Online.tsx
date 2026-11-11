// "Chơi với bạn bè": identity, create a room or join one, and the guest's waiting room.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { App } from '@app/index';
import { Net, GUEST_SESSION, type LobbyInfo } from '@net/index';
import { storage, toast } from '@ui/dom.js';
import { Button } from '@ui/components/Button';
import { FlagPole } from '@ui/components/FlagImg';
import { Jit } from '@ui/components/Jit';
import { px } from '@ui/components/PixelIcon';
import { openFlagEditor } from '@ui/flag/FlagEditor';
import { saveMyKingdom } from '@ui/flag/flag';
import { Diorama } from './Diorama';
import { NAME_KEY, myOrDefaultKingdom } from './kingdom';

const RECENT_KEY = 'katanittes.recentRooms';
interface Recent { code: string; at: number }
function rememberRoom(code: string): void {
  const list = ((storage(RECENT_KEY) as Recent[] | null) || []).filter(r => r.code !== code);
  list.unshift({ code, at: Date.now() });
  storage(RECENT_KEY, list.slice(0, 4));
}

const CLEAN = /[^A-Z0-9]/g;

function Header(): JSX.Element {
  return (
    <div class="hub-head">
      <Button onClick={() => { if (App.net) { App.net.close(); App.net = null; } App.go('menu'); }}>← Menu</Button>
      <div>
        <Jit as="h2" size={46} text="🌐 Chơi với bạn bè" />
        <div class="hub-sub">Tối đa 8 vương quốc · không cần tài khoản · không cần cài đặt</div>
      </div>
    </div>
  );
}

function Waiting({ net, lobby }: { net: Net; lobby: LobbyInfo }): JSX.Element {
  const L = lobby;
  const seats = [{ ...L.host, host: true }, ...L.players.map(p => ({ ...p, host: false }))];
  const me = storage(NAME_KEY) as string | null;
  return (
    <div class="card hub-card waiting-card">
      <h3>{px('🏰 Phòng ', 22)}<span class="room-code inline">{L.code || net.code}</span><span class={'room-state ' + (L.open ? 'on' : 'off')}>{L.open ? 'đang mở' : 'đã đóng'}</span></h3>
      <Jit as="p" class="waiting-msg" size={20} text="⏳ Đang chờ chủ phòng bắt đầu ván..." />
      <div class="section-label">{`Vương quốc trong phòng ${seats.length} / ${L.capacity}`}</div>
      <div class="seat-grid">
        {seats.map((p, i) => (
          <div key={i} class={'seat' + (p.host ? ' host' : '') + (p.name === me ? ' me' : '')}>
            <FlagPole flag={p.flag} size={40} class="hub-flag small" />
            <b>{p.name}</b>
            <small>{p.host ? px('👑 chủ phòng', 15) : p.name === me ? 'bạn' : 'sẵn sàng'}</small>
          </div>
        ))}
        {Array.from({ length: Math.max(0, L.capacity - seats.length) }, (_, i) => (
          <div key={'e' + i} class="seat empty"><div class="seat-q">?</div><small>trống</small></div>
        ))}
      </div>
      <div class="row">
        <Button variant="ghost" onClick={() => { net.close(); App.net = null; storage(GUEST_SESSION, null); App.go('online'); }}>{px('🚪 Rời phòng', 20)}</Button>
      </div>
    </div>
  );
}

export function Online(): JSX.Element {
  const [, setTick] = useState(0);
  const force = () => setTick(n => n + 1);
  const preCode = (new URLSearchParams(location.search).get('sala') || '').toUpperCase().replace(CLEAN, '').slice(0, 5);
  const [k, setK] = useState(myOrDefaultKingdom);
  const [name, setName] = useState(k.name || (storage(NAME_KEY) as string | null) || '');
  const [capacity, setCapacity] = useState(4);
  const [status, setStatus] = useState('');
  const [code, setCode] = useState<string[]>(() => Array.from({ length: 5 }, (_, i) => preCode[i] || ''));
  const busy = useRef(false);
  const pins = useRef<Array<HTMLInputElement | null>>([]);
  const nameRef = useRef<HTMLInputElement>(null);

  // lobby updates from the host (App.onLobby) re-render: the waiting room reads App.net.lobby
  useEffect(() => {
    App.onLobby = force;
    if (preCode && preCode.length < 5) pins.current[preCode.length]?.focus();
    return () => { App.onLobby = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const net = App.net;
  if (net && net.role === 'client' && net.lobby) {
    return (
      <div class="online-hub screen">
        <Diorama />
        <div class="hub-inner"><Header /><Waiting net={net} lobby={net.lobby} /></div>
      </div>
    );
  }

  const kingdom = () => ({ ...myOrDefaultKingdom() });
  const saveName = (): string => {
    const n = name.trim();
    storage(NAME_KEY, n);
    saveMyKingdom({ ...kingdom(), name: n });
    return n;
  };

  async function host(): Promise<void> {
    if (busy.current) return;
    const n = saveName() || 'Chủ phòng';
    busy.current = true;
    setStatus('⏳ Đang mở phòng của bạn...');
    try {
      App.net = new Net();
      await App.net.host();
      const cfg = storage('katanittes.lastConfig') as { players?: Array<Record<string, unknown>> } | null;
      if (cfg && cfg.players) {
        const mine = kingdom();
        cfg.players[0] = { ...cfg.players[0], name: n, kind: 'human', color: mine.color, flag: mine.flag };
        storage('katanittes.lastConfig', cfg);
      }
      App.go('lobby', { online: 'host', capacity });
    } catch (e) {
      App.net = null;
      setStatus('❌ ' + (e as Error).message);
    }
    busy.current = false;
  }

  async function join(codeArg?: string): Promise<void> {
    if (busy.current) return;
    const n = saveName();
    const c = (codeArg || code.join('')).toUpperCase();
    if (!n) {
      nameRef.current?.focus();
      return toast('Nhập tên trước đã', 'error');
    }
    if (c.length < 5) return toast('Mã gồm 5 chữ cái', 'error');
    busy.current = true;
    setStatus(`⏳ Đang tìm phòng ${c}...`);
    try {
      App.net = new Net();
      await App.net.join(c, n, kingdom(), st => {
        if (st === 'waiting') {
          rememberRoom(c);
          setStatus('✅ Đã vào!');
        }
        if (st === 'closed' && App.screen !== 'game') setStatus('🔌 Kết nối đã đóng.');
      });
    } catch (e) {
      App.net = null;
      setStatus('❌ ' + (e as Error).message);
    }
    busy.current = false;
  }

  const setPin = (i: number, v: string) => setCode(cs => cs.map((c, j) => (j === i ? v : c)));
  const onPaste = (e: ClipboardEvent) => {
    const t = (e.clipboardData?.getData('text') || '').toUpperCase().replace(CLEAN, '').slice(0, 5);
    if (!t) return;
    e.preventDefault();
    setCode(cs => cs.map((c, j) => j < t.length ? t[j]! : c));
    pins.current[Math.min(4, t.length)]?.focus();
  };
  const recent = ((storage(RECENT_KEY) as Recent[] | null) || []).filter(r => Date.now() - r.at < 7 * 864e5);
  const paint = () => openFlagEditor({
    flag: k.flag, color: k.color, name: name.trim(),
    onSave: ({ flag, color }) => {
      saveMyKingdom({ ...kingdom(), name: name.trim(), flag, color });
      setK(myOrDefaultKingdom());
    },
  });

  return (
    <div class="online-hub screen">
      <Diorama />
      <div class="hub-inner">
        <Header />
        <div class="hub-grid">
          <div class="card hub-card kingdom-card">
            <h3>{px('🏰 Vương quốc của bạn', 22)}</h3>
            <div class="kingdom-hero">
              <FlagPole flag={k.flag} size={72} />
              <div class="kingdom-info">
                <label class="section-label">Tên</label>
                <input ref={nameRef} type="text" class="hub-name" placeholder="Tên của bạn" value={name} maxLength={16}
                  onInput={e => setName(e.currentTarget.value)} onBlur={saveName} />
                <div class="castle-line"><span class="swatch" style={{ background: k.color }} /><span>Màu lâu đài của bạn</span></div>
              </div>
            </div>
            <Button onClick={paint}>{px('🎨 Vẽ cờ và lâu đài', 20)}</Button>
          </div>
          <div class="card hub-card create-card">
            <h3>{px('👑 Tạo phòng', 22)}</h3>
            <p>Bạn chọn bản đồ và chế độ. Trình duyệt của bạn đóng vai máy chủ: hãy để nó mở trong lúc chơi.</p>
            <div class="section-label">Bao nhiêu người chơi?</div>
            <div class="cap-row">
              {[2, 3, 4, 5, 6, 7, 8].map(n => <button key={n} class={'cap' + (n === capacity ? ' on' : '')} onClick={() => setCapacity(n)}>{n}</button>)}
            </div>
            <div class="cap-people">
              {Array.from({ length: capacity }, (_, i) => <span key={i} class={i === 0 ? 'me' : ''}>{px(i === 0 ? '👑' : '🧑', 23)}</span>)}
            </div>
            <Button variant="primary" big onClick={() => void host()}>{px('✨ Tạo phòng', 25)}</Button>
          </div>
          <div class="card hub-card join-card">
            <h3>{px('🚪 Tham gia', 22)}</h3>
            <p>Xin chủ phòng mã 5 chữ cái (hoặc vào bằng link của họ).</p>
            <div class="pins">
              {code.map((c, i) => (
                <input key={i} ref={el => { pins.current[i] = el; }} type="text" maxLength={1} class="pin" inputMode="text" autoComplete="off"
                  aria-label={`Chữ thứ ${i + 1} của mã`} value={c}
                  onInput={e => {
                    const v = e.currentTarget.value.toUpperCase().replace(CLEAN, '');
                    e.currentTarget.value = v;
                    setPin(i, v);
                    if (v && i < 4) pins.current[i + 1]?.focus();
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Backspace' && !c && i > 0) pins.current[i - 1]?.focus();
                    if (e.key === 'Enter') void join();
                  }}
                  onPaste={onPaste} />
              ))}
            </div>
            <Button variant="pink" big onClick={() => void join()}>{px('🚀 Vào phòng', 25)}</Button>
            {recent.length > 0 && (
              <div>
                <div class="section-label">Phòng gần đây</div>
                <div class="chips">{recent.map(r => <button key={r.code} class="chip" onClick={() => void join(r.code)}>{'↩ ' + r.code}</button>)}</div>
              </div>
            )}
          </div>
        </div>
        <div class="hub-status">{px(status, 20)}</div>
        <div class="hub-tips">
          <span>{px('📡 Kết nối trực tiếp giữa các trình duyệt', 16)}</span>
          <span>{px('🔁 Lỡ rớt mạng, bạn vẫn quay về đúng ghế', 16)}</span>
          <span>{px('🗳️ Nếu có người rời đi, cả bàn bỏ phiếu', 16)}</span>
        </div>
      </div>
    </div>
  );
}
