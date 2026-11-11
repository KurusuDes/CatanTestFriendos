// Every window of the game screen. The frame (`Modal`: backdrop + window) is kept while the same modal
// stays open and Preact only patches its content, so clicking inside never replays the pop-in.
import type { ComponentChildren, JSX } from 'preact';
import { useState } from 'preact/hooks';
import * as G from '@engine/game';
import { RES, TILE_INFO } from '@engine/constants';
import type { Hand, Res } from '@engine/types';
import { TIERS, TIER_LABEL } from '@board/quality';
import { SETTINGS } from '@board/settings';
import { App } from '@app/index';
import { Button } from '@ui/components/Button';
import { Jit } from '@ui/components/Jit';
import { Modal } from '@ui/components/Modal';
import { PixelIcon, px } from '@ui/components/PixelIcon';
import { iconSetSignal } from '@ui/iconset';
import { showHelp } from '@ui/screens/Help';
import { ICON_SETS, setIconSet } from '@ui/pixel';
import { toast } from '@ui/dom';
import { boards, cur, countRender, jsonEq, localHumans, locked, metaTick, modal, seat, select } from './signals';
import { closeModal } from './actions';
import { redrawBoard } from './fx';
import { SpeedControl } from './ActionBar';

const noop = (): void => {};
const zeroHand = (): Hand => G.zeroRes();
const T = 18; // sprite size inside buttons

// ---------------- forced windows (online reconnect / vote, your discard) ----------------
type Forced =
  | { kind: 'reconnect' }
  | { kind: 'vote'; id: string; name: string; left: number; voters: number; cast: number; mine: string | null; counts: Record<string, number> }
  | { kind: 'discard'; v: number; need: number };

const forced = select<Forced | null>(() => {
  const st = cur();
  if (!st) return null;
  void metaTick.value;
  if (App.isOnline() && App.net) {
    const net = App.net;
    if (net.role === 'client' && net.reconnecting) return { kind: 'reconnect' };
    const vote = net.currentVote();
    if (vote && vote.voters.includes(App.mySeat!)) {
      const votes = Object.values(vote.votes);
      return {
        kind: 'vote', id: vote.id, name: vote.name, left: vote.left, voters: vote.voters.length, cast: votes.length, mine: vote.votes[App.mySeat!] || null,
        counts: { wait: votes.filter(x => x === 'wait').length, bot: votes.filter(x => x === 'bot').length, remove: votes.filter(x => x === 'remove').length },
      };
    }
  }
  const v = seat.value;
  const need = st.pendingDiscards[v];
  if (st.phase === 'discard' && need && localHumans(st).includes(v)) return { kind: 'discard', v, need };
  return null;
}, jsonEq);

function ReconnectModal(): JSX.Element {
  return (
    <Modal onClose={noop} style={{ textAlign: 'center' }}>
      <Jit as="h2" text="📡 Đang kết nối lại..." size={28} />
      <p>Mất tín hiệu với chủ phòng. Ghế của bạn vẫn được giữ: đang thử vào lại phòng.</p>
      <div class="row" style={{ justifyContent: 'center' }}><Button variant="ghost" onClick={() => App.leaveGame()}>Về menu</Button></div>
    </Modal>
  );
}

function VoteModal({ f }: { f: Extract<Forced, { kind: 'vote' }> }): JSX.Element {
  const opt = (k: 'wait' | 'bot' | 'remove', label: string, cls: string) => (
    <Button class={(cls + (f.mine === k ? ' active' : '')).trim()} disabled={!!f.mine} onClick={() => void App.net!.sendVote(k)}>{px(`${label} (${f.counts[k]})`, T)}</Button>
  );
  return (
    <Modal onClose={noop} style={{ textAlign: 'center' }}>
      <h2>{px(`🔌 ${f.name} bị mất kết nối`, 28)}</h2>
      <p>{f.mine ? `Bạn đã bỏ phiếu. Đang chờ những người khác (${f.cast}/${f.voters})... ${f.left}s` : `Làm gì bây giờ? Số đông quyết định. Nếu người đó quay lại trước, họ được giữ ghế. ${f.left}s`}</p>
      <div class="row" style={{ justifyContent: 'center' }}>
        {opt('wait', '⏳ Chờ', '')}{opt('bot', '🤖 Để bot chơi thay', 'green')}{opt('remove', '🚪 Cho rời ván', 'pink')}
      </div>
    </Modal>
  );
}

// ---------------- +/- steppers (trade, discard) ----------------
function Stepper({ r, n, max, onChange }: { r: Res; n: number; max: number | null; onChange: (n: number) => void }): JSX.Element {
  return (
    <div class="stepper">
      <div class="ic"><PixelIcon emoji={TILE_INFO[r].icon} size={28} /></div>
      <div class="n">{n}</div>
      {max != null ? <div class="have">{`bạn có ${max}`}</div> : null}
      <div class="ctl">
        <Button sm disabled={n <= 0} onClick={() => onChange(n - 1)}>−</Button>
        <Button sm disabled={max != null && n >= max} onClick={() => onChange(n + 1)}>+</Button>
      </div>
    </div>
  );
}

function DiscardModal({ v, need }: { v: number; need: number }): JSX.Element {
  const [d, setD] = useState<Hand>(zeroHand);
  const st = cur()!;
  const p = st.players[v]!;
  const n = G.handSize(d);
  return (
    <Modal onClose={noop}>
      <div>
        <h2>{px(`🗑️ ${p.name}: bỏ ${need} thẻ`, 28)}</h2>
        <p>{`Ra 7 mà bạn có hơn ${st.config.rules.handLimit} thẻ! Chọn ${need} thẻ trả lại ngân hàng.`}</p>
        <div class="steppers">{RES.map(r => <Stepper r={r} n={d[r]} max={p.res[r]} onChange={x => setD({ ...d, [r]: x })} />)}</div>
        <div class="row">
          <span class="pill">{`${n} / ${need}`}</span>
          <Button variant="primary" disabled={n !== need} onClick={() => void App.dispatch({ type: 'discard', pid: v, res: { ...d } })}>Bỏ thẻ</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- trade ----------------
type Tab = 'bank' | 'players';

function TradeModal(): JSX.Element {
  const st0 = cur()!;
  const v = seat.peek();
  const [tab, setTab] = useState<Tab>('bank');
  const [give, setGive] = useState<Hand>(zeroHand);
  const [get, setGet] = useState<Hand>(zeroHand);
  const [bankGive, setBankGive] = useState<Res | null>(null);
  const [bankGet, setBankGet] = useState<Res | null>(null);
  const [to, setTo] = useState<number[]>(() => st0.players.filter(p => p.id !== v).map(p => p.id));
  const st = st0, p = st.players[v]!;
  const tabs = (
    <div class="tabs">
      <Button sm class={tab === 'bank' ? 'active' : ''} onClick={() => setTab('bank')}>{px('🏦 Ngân hàng và cảng', T)}</Button>
      <Button sm class={tab === 'players' ? 'active' : ''} onClick={() => setTab('players')}>{px('🤝 Người chơi', T)}</Button>
    </div>
  );
  if (tab === 'bank') {
    const ratio = (r: Res) => G.tradeRatio(st, v, r);
    const label = bankGive ? `Đổi ${ratio(bankGive)}${TILE_INFO[bankGive].icon} → 1${bankGet ? TILE_INFO[bankGet].icon : '?'}` : 'Đổi';
    return (
      <Modal onClose={closeModal}>
        <h2>Giao dịch</h2>{tabs}
        <div class="section-label">Bạn đưa</div>
        <div class="respick">
          {RES.map(r => (
            <Button class={bankGive === r ? 'active' : ''} disabled={p.res[r] < ratio(r)} onClick={() => setBankGive(r)}>
              <PixelIcon emoji={TILE_INFO[r].icon} size={28} /><small>{`${ratio(r)}:1 · bạn có ${p.res[r]}`}</small>
            </Button>
          ))}
        </div>
        <div class="section-label">Bạn nhận</div>
        <div class="respick">
          {RES.map(r => (
            <Button class={bankGet === r ? 'active' : ''} disabled={r === bankGive || st.bank[r] < 1} onClick={() => setBankGet(r)}>
              <PixelIcon emoji={TILE_INFO[r].icon} size={28} /><small>{`ngân hàng còn ${st.bank[r]}`}</small>
            </Button>
          ))}
        </div>
        <div class="row">
          <Button variant="ghost" onClick={closeModal}>Đóng</Button>
          <Button
            variant="primary" disabled={!bankGive || !bankGet || bankGive === bankGet || p.res[bankGive] < ratio(bankGive)}
            onClick={() => {
              if (!bankGive || !bankGet) return;
              App.dispatch({ type: 'bankTrade', pid: v, give: bankGive, get: bankGet });
              if (App.state!.players[v]!.res[bankGive] < ratio(bankGive)) setBankGive(null);
            }}
          >{px(label, T)}</Button>
        </div>
      </Modal>
    );
  }
  const others = st.players.filter(o => o.id !== v);
  const valid = G.handSize(give) > 0 && G.handSize(get) > 0 && to.length > 0 && G.canAfford(p.res, give) && !RES.some(r => give[r] && get[r]);
  return (
    <Modal onClose={closeModal}>
      <h2>Giao dịch</h2>{tabs}
      <div class="section-label">Bạn đưa</div>
      <div class="steppers">{RES.map(r => <Stepper r={r} n={give[r]} max={p.res[r]} onChange={n => setGive({ ...give, [r]: n })} />)}</div>
      <div class="section-label">Bạn nhận</div>
      <div class="steppers">{RES.map(r => <Stepper r={r} n={get[r]} max={null} onChange={n => setGet({ ...get, [r]: n })} />)}</div>
      <div class="section-label">Mời</div>
      <div class="chips">
        {others.map(o => (
          <button type="button" class={'chip' + (to.includes(o.id) ? ' on' : '')} onClick={() => setTo(to.includes(o.id) ? to.filter(x => x !== o.id) : [...to, o.id])}>
            {px(`${o.kind === 'bot' ? '🤖 ' : ''}${o.name} (${G.handSize(o.res)})`, 16)}
          </button>
        ))}
      </div>
      <div class="row">
        <Button variant="ghost" onClick={closeModal}>Đóng</Button>
        <Button variant="primary" disabled={!valid} onClick={() => { closeModal(); App.dispatch({ type: 'proposeTrade', pid: v, give, get, to }); }}>Gửi lời mời</Button>
      </div>
    </Modal>
  );
}

// ---------------- dev cards & robber ----------------
function MonopolyModal({ v }: { v: number }): JSX.Element {
  return (
    <Modal onClose={closeModal}>
      <h2>{px('👑 Độc quyền', 28)}</h2>
      <p>Mọi người chơi phải đưa bạn toàn bộ thẻ loại này.</p>
      <div class="respick">
        {RES.map(r => (
          <Button onClick={() => { closeModal(); App.dispatch({ type: 'playDev', pid: v, card: 'monopoly', res: r }); }}>
            <PixelIcon emoji={TILE_INFO[r].icon} size={28} /><small>{TILE_INFO[r].name}</small>
          </Button>
        ))}
      </div>
      <div class="row"><Button variant="ghost" onClick={closeModal}>Hủy</Button></div>
    </Modal>
  );
}

function YearOfPlentyModal({ v }: { v: number }): JSX.Element {
  const [d, setD] = useState<Res[]>([]);
  const st = cur()!;
  return (
    <Modal onClose={closeModal}>
      <h2>{px('🎁 Năm bội thu', 28)}</h2>
      <p>Chọn 2 tài nguyên từ ngân hàng (được chọn trùng).</p>
      <div class="respick">
        {RES.map(r => (
          <Button disabled={d.length >= 2 || st.bank[r] <= d.filter(x => x === r).length} onClick={() => setD([...d, r])}>
            <PixelIcon emoji={TILE_INFO[r].icon} size={28} /><small>{`ngân hàng còn ${st.bank[r]}`}</small>
          </Button>
        ))}
      </div>
      <p class="res-inline">{px(`Đã chọn: ${d.map(r => TILE_INFO[r].icon).join(' ') || '—'}`, T)}</p>
      <div class="row">
        <Button variant="ghost" onClick={() => setD([])}>Xóa</Button>
        <Button variant="ghost" onClick={closeModal}>Hủy</Button>
        <Button variant="primary" disabled={d.length !== 2} onClick={() => { closeModal(); App.dispatch({ type: 'playDev', pid: v, card: 'yearOfPlenty', res: d }); }}>Lấy</Button>
      </div>
    </Modal>
  );
}

function VictimsModal({ tile, v, victims }: { tile: number; v: number; victims: number[] }): JSX.Element {
  const st = cur()!;
  return (
    <Modal onClose={closeModal}>
      <h2>{px('🫳 Bạn muốn cướp của ai?', 28)}</h2>
      <div class="chips">
        {victims.map(pid => {
          const p = st.players[pid]!;
          return (
            <Button style={{ borderColor: p.color }} onClick={() => { closeModal(); App.dispatch({ type: 'moveRobber', pid: v, tile, victim: pid }); }}>
              <span class="turn-dot" style={{ background: p.color }} />{`${p.name} (${G.handSize(p.res)} thẻ)`}
            </Button>
          );
        })}
      </div>
      <div class="row"><Button variant="ghost" onClick={closeModal}>Hủy</Button></div>
    </Modal>
  );
}

// ---------------- game over ----------------
function GameOverModal(): JSX.Element | null {
  const st = cur()!;
  if (st.phase !== 'gameOver' || st.winner == null) return null;
  const ranking = [...st.players].sort((a, b) => G.victoryPoints(st, b.id) - G.victoryPoints(st, a.id));
  const w = st.players[st.winner]!;
  const maxRoll = Math.max(1, ...st.stats.rolls);
  const heads = ['Người chơi', 'Điểm', '🏠', '🏰', '🏆🃏', '⚔️', '🛣️', 'Cướp được', 'Nhận được'];
  return (
    <Modal onClose={closeModal}>
      <div class="winner-hero">
        <div class="trophy"><PixelIcon emoji="🏆" size={48} /></div>
        <h2 style={{ color: w.color }}>{`${w.name} thắng!`}</h2>
        <p>{`Sau ${st.round} vòng (${st.turn} lượt).`}</p>
      </div>
      <table class="score-table">
        <tr>{heads.map(x => <th>{px(x, 16)}</th>)}</tr>
        {ranking.map(p => {
          const bs = Object.values(st.buildings).filter(b => b.owner === p.id);
          return (
            <tr>
              <td><b class="pname" style={{ '--pc': p.color }}>{p.name}</b></td>
              <td><b>{G.victoryPoints(st, p.id)}</b></td>
              <td>{bs.filter(b => b.type === 'settlement').length}</td>
              <td>{bs.filter(b => b.type === 'city').length}</td>
              <td>{p.dev.filter(c => c.type === 'vp').length}</td>
              <td>{px(p.knights + (st.largestArmy.owner === p.id ? '🏅' : ''), 16)}</td>
              <td>{px(p.roadLen + (st.longestRoad.owner === p.id ? '🏅' : ''), 16)}</td>
              <td>{p.stats.stolen}</td>
              <td>{p.stats.gained}</td>
            </tr>
          );
        })}
      </table>
      <div class="section-label">Xúc xắc của ván</div>
      <div class="hist">
        {st.stats.rolls.slice(2).map((n, i) => <div class={i + 2 === 7 ? 's' : ''} style={{ height: (n / maxRoll) * 100 + '%' }}><em>{n || ''}</em><span>{i + 2}</span></div>)}
      </div>
      <div class="row" style={{ marginTop: '28px' }}>
        <Button variant="ghost" onClick={closeModal}>Xem bàn cờ</Button>
        <Button onClick={() => { closeModal(); App.leaveGame(); }}>{px('🏠 Menu', T)}</Button>
        {!App.isClient() && <Button variant="primary" onClick={() => { closeModal(); App.rematch(); }}>{px('🔁 Phục thù', T)}</Button>}
      </div>
    </Modal>
  );
}

// ---------------- in-game menu (graphics tier, icons, sound, speed...) ----------------
const ICON_LABEL: Record<string, string> = { render: '🧊 3D (Blender)', pico: '🆕 Pixel PICO', classic: '🕹️ Cổ điển' };

function Chip({ on, title, onClick, children }: { on: boolean; title?: string; onClick: () => void; children: ComponentChildren }): JSX.Element {
  return <button type="button" class={'chip' + (on ? ' on' : '')} title={title} onClick={onClick}>{children}</button>;
}

function MenuModal(): JSX.Element {
  const [, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);
  const b = boards.d3;
  const gfx = (opts: Parameters<NonNullable<typeof b>['setGraphics']>[0]) => () => {
    b!.setGraphics(opts);
    refresh();
  };
  const icons = iconSetSignal.value;
  const st = cur()!;
  return (
    <Modal onClose={closeModal}>
      <div>
        <h2>{px('☰ Menu', 28)}</h2>
        <div style={{ display: 'grid', gap: '10px' }}>
          {b ? (
            <div>
              <div class="section-label">Đồ họa 3D</div>
              <div class="gfx-row">
                {TIERS.map(t => (
                  <Chip on={SETTINGS.quality === t} title={t === 'low' ? 'Không bóng đổ mềm, không hiệu ứng hậu kỳ, đứng yên khi không chạm vào: dành cho máy cũ' : ''} onClick={gfx({ quality: t })}>{px((t === 'low' ? '🐢 ' : '✨ ') + TIER_LABEL[t], 16)}</Chip>
                ))}
                <Chip on={SETTINGS.tiltShift} onClick={gfx({ tiltShift: !SETTINGS.tiltShift })}>{px('📷 Hiệu ứng mô hình', 16)}</Chip>
                <Chip on={SETTINGS.pixel > 1} onClick={gfx({ pixel: SETTINGS.pixel > 1 ? 1 : 3 })}>{px('👾 Bộ lọc pixel', 16)}</Chip>
                <Chip on={SETTINGS.ao} onClick={gfx({ ao: !SETTINGS.ao })}>{px('🌑 Đổ bóng môi trường', 16)}</Chip>
                <Chip on={SETTINGS.outline} title="Viền mảnh theo màu từng người chơi, nhìn xuyên qua núi và cây" onClick={gfx({ outline: !SETTINGS.outline })}>{px('🔲 Viền công trình', 16)}</Chip>
              </div>
            </div>
          ) : null}
          <div>
            <div class="section-label">Biểu tượng tài nguyên</div>
            <div class="gfx-row">
              {ICON_SETS.map((k: string) => <Chip on={icons === k} onClick={() => { setIconSet(k); redrawBoard(); }}>{px(ICON_LABEL[k] || k, 16)}</Chip>)}
            </div>
          </div>
          <Button onClick={() => { closeModal(); showHelp(); }}>{px('📖 Cách chơi', T)}</Button>
          <Button onClick={() => { const on = App.toggleSound(); toast(on ? '🔊 Đã bật âm thanh' : '🔇 Đã tắt âm thanh'); }}>{px('🔊 Bật/tắt âm thanh', T)}</Button>
          <div><div class="section-label">Tốc độ của bot</div><SpeedControl /></div>
          <div class="section-label">Ván chơi</div>
          <div class="pill">{`Mã sinh bản đồ: ${st.config.seed}`}</div>
          {!App.isClient() && <Button onClick={() => { closeModal(); App.rematch(); }}>{px('🔁 Ván mới với cài đặt cũ', T)}</Button>}
          <Button variant="pink" onClick={() => { closeModal(); App.leaveGame(); }}>{px(App.isOnline() ? '🚪 Rời phòng' : '💾 Lưu và về menu', T)}</Button>
        </div>
        <div class="row"><Button variant="ghost" onClick={closeModal}>Đóng</Button></div>
      </div>
    </Modal>
  );
}

// ---------------- host ----------------
export function ModalHost(): JSX.Element | null {
  countRender('ModalHost');
  if (locked.value) return null;
  const f = forced.value;
  if (f) {
    if (f.kind === 'reconnect') return <ReconnectModal key="reconnect" />;
    if (f.kind === 'vote') return <VoteModal key={'vote' + f.id} f={f} />;
    return <DiscardModal key={'discard' + f.v} v={f.v} need={f.need} />;
  }
  const m = modal.value;
  if (!m) return null;
  switch (m.kind) {
    case 'trade': return <TradeModal key="trade" />;
    case 'menu': return <MenuModal key="menu" />;
    case 'gameOver': return <GameOverModal key="gameOver" />;
    case 'victims': return <VictimsModal key="victims" tile={m.tile} v={m.v} victims={m.victims} />;
    case 'monopoly': return <MonopolyModal key="monopoly" v={m.v} />;
    case 'yop': return <YearOfPlentyModal key="yop" v={m.v} />;
  }
}
