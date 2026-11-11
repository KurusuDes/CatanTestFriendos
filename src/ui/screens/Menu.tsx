import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { App, SAVE_KEY } from '@app/index';
import { Net, HOST_SESSION, GUEST_SESSION } from '@net/index';
import { storage, toast } from '@ui/dom';
import { Button } from '@ui/components/Button';
import { FlagPole } from '@ui/components/FlagImg';
import { Jit } from '@ui/components/Jit';
import { PixelIcon, px, spriteSize } from '@ui/components/PixelIcon';
import { openFlagEditor } from '@ui/flag/FlagEditor';
import { saveMyKingdom } from '@ui/flag/flag';
import { Diorama } from './Diorama';
import { CreditLine, showHelp } from './Help';
import { NAME_KEY, myOrDefaultKingdom } from './kingdom';

interface SaveInfo { round?: number }
interface HostSess { code: string; at?: number; state: { round: number } }
interface GuestSess { code: string; name: string; at?: number }

const BG_ICONS = ['🌲', '🧱', '🐑', '🌾', '⛰️', '🏠', '🏰', '🎲', '⚔️', '💰', '🛤️', '🙈'];

async function reopenRoom(): Promise<void> {
  try {
    await Net.reopen();
    toast('🔁 Đã mở lại phòng: bạn bè sẽ tự kết nối lại', 'good', 4000);
  } catch (e) {
    App.net = null;
    toast(`Không mở lại được: ${(e as Error).message}`, 'error', 5000);
    App.go('menu');
  }
}

async function backToRoom(sess: GuestSess): Promise<void> {
  toast(`📡 Đang quay lại phòng ${sess.code}...`);
  try {
    App.net = new Net();
    await App.net.join(sess.code, sess.name, myOrDefaultKingdom());
  } catch (e) {
    App.net = null;
    toast('❌ ' + (e as Error).message, 'error', 5000);
  }
}

/** "Vương quốc của bạn": name + banner are set before any game (local, host or join) */
function KingdomPanel(): JSX.Element {
  const [k, setK] = useState(myOrDefaultKingdom);
  const [name, setName] = useState(k.name || '');
  const paint = () => openFlagEditor({
    flag: k.flag, color: k.color, name: name.trim(),
    onSave: ({ flag, color }) => {
      saveMyKingdom({ ...myOrDefaultKingdom(), name: name.trim(), flag, color });
      setK(myOrDefaultKingdom());
    },
  });
  const onName = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    setName(v);
    const n = v.trim();
    storage(NAME_KEY, n);
    saveMyKingdom({ ...myOrDefaultKingdom(), name: n });
  };
  return (
    <div class="menu-kingdom">
      <FlagPole flag={k.flag} size={36} class="hub-flag small mk-flag" title="Vẽ cờ và chọn màu lâu đài" onClick={paint} />
      <div class="mk-info">
        <label class="section-label"><span class="swatch" style={{ background: k.color }} />Vương quốc của bạn</label>
        <input type="text" class="hub-name" placeholder="Tên của bạn" value={name} maxLength={16} aria-label="Tên của bạn" onInput={onName} />
      </div>
      <Button sm title="Vẽ cờ và chọn màu lâu đài" onClick={paint}><PixelIcon emoji="🎨" size={23} /></Button>
    </div>
  );
}

export function Menu(): JSX.Element {
  const fresh = (x: { at?: number } | null, hours: number) => !!x && Date.now() - (x.at || 0) < hours * 3600e3;
  const save = storage(SAVE_KEY) as SaveInfo | null;
  const [hostSess, setHostSess] = useState<HostSess | null>(() => {
    const s = storage(HOST_SESSION) as HostSess | null;
    return fresh(s, 24) ? s : null;
  });
  // both can exist (hosted yesterday, joined a friend today): offer both
  const [guestSess] = useState<GuestSess | null>(() => {
    const s = storage(GUEST_SESSION) as GuestSess | null;
    return fresh(s, 6) ? s : null;
  });
  const [reopening, setReopening] = useState(false);
  const B = (t: string) => px(t, 23);
  return (
    <div class="menu screen">
      <div class="menu-bg">
        {Array.from({ length: 26 }, (_, i) => {
          const fs = 26 + ((i * 7) % 30);
          return (
            <div key={i} class="fhex" style={{ left: ((i * 37) % 100) + '%', top: ((i * 53) % 100) + '%', animationDelay: -(i * 0.7) + 's', fontSize: fs + 'px' }}>
              <PixelIcon emoji={BG_ICONS[i % BG_ICONS.length]!} size={spriteSize(fs)} />
            </div>
          );
        })}
      </div>
      <Diorama />
      <div class="logo">
        <Jit class="t1" text={['KATAN', { cls: 't1b', text: 'ITTES' }]} />
        <div class="sub">Khai hoang, hỗn loạn và những chế độ không có trong hộp.</div>
      </div>
      <KingdomPanel />
      <div class="menu-buttons">
        {save && <Button variant="green" onClick={() => App.resume()}>{B(`▶️ Chơi tiếp (vòng ${save.round || 0})`)}</Button>}
        {hostSess && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <Button variant="green" style={{ flex: 1 }} disabled={reopening}
              onClick={() => { setReopening(true); void reopenRoom().finally(() => setReopening(false)); }}>
              {reopening ? B('⏳ Đang mở lại phòng (có thể mất vài giây)...') : B(`🔁 Mở lại phòng ${hostSess.code} (vòng ${hostSess.state.round})`)}
            </Button>
            <Button variant="ghost" title="Đóng hẳn phòng đó" onClick={() => { storage(HOST_SESSION, null); setHostSess(null); }}>✕</Button>
          </div>
        )}
        {guestSess && <Button variant="green" onClick={() => void backToRoom(guestSess)}>{B(`📡 Quay lại phòng ${guestSess.code}`)}</Button>}
        <Button variant="primary" onClick={() => App.go('lobby')}>{B('🎮 Chơi trên một máy (chuyền máy + bot)')}</Button>
        <Button variant="pink" onClick={() => App.go('online')}>{B('🌐 Chơi online với bạn bè')}</Button>
        <Button onClick={() => App.go('editor')}>{B('✏️ Tạo bản đồ')}</Button>
        <Button onClick={() => showHelp()}>{B('📖 Cách chơi')}</Button>
      </div>
      <div class="menu-foot">Làm ra để chơi cùng bạn bè · chạy trên máy tính và điện thoại · không cần cài đặt<CreditLine /></div>
    </div>
  );
}
