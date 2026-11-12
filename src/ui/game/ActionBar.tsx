import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import * as G from '@engine/game';
import { COSTS, DEV_INFO, RES, TILE_INFO } from '@engine/constants';
import type { BuildKind, DevType } from '@engine/types';
import { App, store } from '@app/index';
import { PixelIcon, px } from '@ui/components/PixelIcon';
import { play } from '@ui/sfx';
import { cur, countRender, costIcons, jsonEq, legalCities, legalRoads, legalSettlements, locked, modal, pick, seat, select } from './signals';
import { playDev, showHint, throwDice } from './actions';

// ---------------- the dice button: tap to throw, hold to charge a harder throw ----------------
const CHARGE_DEAD = 180, CHARGE_FULL = 1100; // ms: a tap throws at once; full power after holding this long

const chargePower = (t0: number, now = performance.now()): number => Math.max(0, Math.min(1, (now - t0 - CHARGE_DEAD) / CHARGE_FULL));

function RollButton({ v }: { v: number }): JSX.Element {
  const btn = useRef<HTMLButtonElement>(null);
  const live = useRef<(() => void) | null>(null); // stops a charge in progress (release / unmount)
  useEffect(() => () => live.current?.(), []);
  const start = (e: PointerEvent) => {
    if (e.button !== 0 || live.current) return;
    e.preventDefault();
    const t0 = performance.now();
    let tick = 0, raf = 0, done = false;
    const stop = (throwNow: boolean) => {
      if (done) return;
      done = true;
      removeEventListener('pointerup', release);
      removeEventListener('pointercancel', release);
      cancelAnimationFrame(raf);
      live.current = null;
      btn.current?.classList.remove('charging', 'full');
      if (throwNow) throwDice(v, chargePower(t0));
    };
    const release = () => stop(true);
    live.current = () => stop(false);
    addEventListener('pointerup', release);
    addEventListener('pointercancel', release);
    const frame = (now: number) => {
      if (done) return;
      const b = btn.current;
      const pw = chargePower(t0, now);
      if (b) {
        b.style.setProperty('--charge', pw.toFixed(3));
        b.classList.toggle('charging', now - t0 > CHARGE_DEAD);
        b.classList.toggle('full', pw >= 1);
      }
      // the dice rattle in your hand, faster the harder you shake them
      if (now - t0 > CHARGE_DEAD && now >= tick) {
        play.rattle(pw);
        tick = now + 150 - pw * 80;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };
  return (
    <button
      type="button" ref={btn} class="btn primary big roll-btn" title="Chạm để tung · nhấn giữ để lấy đà"
      onPointerDown={start}
      onClick={e => e.detail === 0 && throwDice(v, 0)} // keyboard (Enter / Space)
      onContextMenu={e => e.preventDefault()} // long press on a phone
    >
      <i class="roll-fill" />
      <span>{px('🎲 Tung xúc xắc', 22)}</span>
    </button>
  );
}

// ---------------- bot speed ----------------
const SPEEDS: [number, string][] = [[1400, '🐢'], [650, '▶️'], [250, '⏩'], [60, '⚡']];

export function SpeedControl({ auto }: { auto?: boolean }): JSX.Element {
  const speed = store.speed.value;
  return (
    <div class="chips" style={auto ? { marginLeft: 'auto' } : undefined}>
      {SPEEDS.map(([ms, l]) => (
        <button type="button" class={'chip' + (speed === ms ? ' on' : '')} title="Tốc độ của bot" onClick={() => { App.setSpeed(ms); App.scheduleBots(); }}>{px(l, 18)}</button>
      ))}
    </div>
  );
}

// ---------------- hand, dev cards ----------------
function Hand(): JSX.Element {
  countRender('Hand');
  const sel = useMemo(() => select(() => {
    const p = cur()!.players[seat.value];
    return RES.map(r => (p ? p.res[r] : 0));
  }, jsonEq), []);
  const res = sel.value;
  return (
    <div class="hand">
      {RES.map((r, i) => {
        const info = TILE_INFO[r], n = res[i]!;
        return (
          <div class={'rcard' + (n ? '' : ' zero')} style={{ background: `linear-gradient(160deg, ${info.color}, ${info.dark})` }} title={info.name}>
            <PixelIcon emoji={info.icon} size={30} />
            <b>{n}</b>
          </div>
        );
      })}
    </div>
  );
}

function DevCards(): JSX.Element | null {
  countRender('DevCards');
  const sel = useMemo(() => select(() => {
    const st = cur()!, v = seat.value;
    const p = st.players[v];
    if (!p) return [];
    const playable = new Set<DevType>(st.current === v ? G.playableDev(st, v) : []);
    const groups = new Map<DevType, { n: number; fresh: boolean }>();
    for (const c of p.dev) {
      const g = groups.get(c.type) || { n: 0, fresh: true };
      g.n++;
      g.fresh &&= c.turn >= st.turn;
      groups.set(c.type, g);
    }
    return [...groups].map(([type, g]) => ({ type, n: g.n, fresh: g.fresh && type !== 'vp', can: playable.has(type) }));
  }, jsonEq), []);
  const groups = sel.value;
  if (!groups.length) return null;
  return (
    <div class="devcards">
      {groups.map(g => {
        const info = DEV_INFO[g.type];
        return (
          <div class={'dcard' + (g.can ? ' playable' : '') + (g.fresh ? ' new' : '')} title={`${info.name}: ${info.desc}${g.fresh ? ' (vừa mua: lượt sau mới dùng được)' : ''}`} onClick={() => g.can && playDev(seat.peek(), g.type)}>
            <PixelIcon emoji={info.icon} size={23} />
            <b>×{g.n}</b>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- the actions ----------------
interface AffordItem { what: 'road' | 'settlement' | 'city' | 'dev'; icon: string; label: string; ok: boolean; room: boolean; tip: string }

type ActModel =
  | { k: 'none' }
  | { k: 'over' }
  | { k: 'discard'; n: number }
  | { k: 'wait'; text: string; afford: AffordItem[] | null }
  | { k: 'roll'; v: number }
  | { k: 'robber' }
  | { k: 'roads' }
  | { k: 'main'; v: number; pick: BuildKind | null; road: [boolean, number]; settlement: [boolean, number]; city: [boolean, number]; dev: boolean; tradeBusy: boolean };

const missing = (res: Record<string, number>, cost: Partial<Record<string, number>>): string =>
  Object.entries(cost).filter(([r, n]) => (res[r] || 0) < (n || 0)).map(([r, n]) => TILE_INFO[r as keyof typeof TILE_INFO].icon.repeat((n || 0) - (res[r] || 0))).join('');

const ITEMS: [AffordItem['what'], string, string][] = [['road', '🛤️', 'Đường'], ['settlement', '🏠', 'Nhà'], ['city', '🏰', 'Thành phố'], ['dev', '🃏', 'Thẻ']];

const actModel = select<ActModel>(() => {
  const st = cur()!, v = seat.value;
  const p = st.players[v];
  if (!p) return { k: 'none' };
  const myTurn = st.current === v;
  if (st.phase === 'gameOver') return { k: 'over' };
  if (st.phase === 'setup' || !myTurn) {
    const need = st.pendingDiscards[v];
    if (st.phase === 'discard' && need) return { k: 'discard', n: need };
    const first = G.pendingActors(st)[0];
    const text = st.phase === 'setup' && first === v ? '👆 Chạm vào bàn cờ' : `⏳ Đang chờ ${first != null ? st.players[first]!.name : ''}...`;
    if (st.phase === 'setup') return { k: 'wait', text, afford: null };
    // out of turn: what your hand already pays for, so you can plan while the others play
    const room: Record<AffordItem['what'], boolean> = {
      road: p.roadsLeft > 0 && legalRoads.value.length > 0,
      settlement: p.settlementsLeft > 0 && legalSettlements.value.length > 0,
      city: p.citiesLeft > 0 && legalCities.value.length > 0,
      dev: st.devDeck.length > 0,
    };
    return {
      k: 'wait', text,
      afford: ITEMS.map(([what, icon, label]) => {
        const ok = G.canAfford(p.res, COSTS[what]);
        const tip = ok ? (room[what] ? `Bạn đã đủ tài nguyên: ${label}. Xây vào lượt của bạn nhé.` : `Bạn đủ tiền, nhưng giờ chưa có chỗ: ${label}.`) : `${label}: bạn còn thiếu ${missing(p.res, COSTS[what])}`;
        return { what, icon, label, ok, room: room[what], tip };
      }),
    };
  }
  if (st.phase === 'roll') return { k: 'roll', v };
  if (st.phase === 'robber') return { k: 'robber' };
  if (st.phase === 'roadBuilding') return { k: 'roads' };
  if (st.phase !== 'main') return { k: 'none' };
  const can = (what: BuildKind, left: number, legal: number[]): [boolean, number] => [left > 0 && G.canAfford(p.res, COSTS[what]) && legal.length > 0, left];
  return {
    k: 'main', v, pick: pick.value,
    road: can('road', p.roadsLeft, legalRoads.value),
    settlement: can('settlement', p.settlementsLeft, legalSettlements.value),
    city: can('city', p.citiesLeft, legalCities.value),
    dev: st.devDeck.length > 0 && G.canAfford(p.res, COSTS.dev),
    tradeBusy: !!st.trade,
  };
}, jsonEq);

const BUILD: [BuildKind, string, string][] = [['road', 'Đường', '🛤️'], ['settlement', 'Nhà', '🏠'], ['city', 'Thành phố', '🏰']];

function Actions(): JSX.Element {
  countRender('Actions');
  const m = actModel.value;
  const v = seat.peek();
  const body = (): ComponentChildren => {
    switch (m.k) {
      case 'none': return null;
      case 'over': return <button type="button" class="btn primary" onClick={() => (modal.value = { kind: 'gameOver' })}>{px('🏆 Xem kết quả', 18)}</button>;
      case 'discard': return <button type="button" class="btn pink" onClick={() => {}}>{px(`🗑️ Bỏ ${m.n} thẻ`, 18)}</button>;
      case 'wait':
        return [
          <div class="waiting">{px(m.text, 18)}</div>,
          m.afford ? (
            <div class="afford">
              {m.afford.map(a => (
                <div class={'afford-item' + (a.ok && a.room ? ' ok' : a.ok ? ' half' : '')} title={a.tip}>
                  <span class="bicon"><PixelIcon emoji={a.icon} size={26} /></span>
                  <span>{a.label}<span class="cost">{px(costIcons(COSTS[a.what]), 14)}</span></span>
                  {a.ok && a.room && <b class="tick">✓</b>}
                </div>
              ))}
            </div>
          ) : null,
        ];
      case 'roll': return <RollButton v={m.v} />;
      case 'robber': return <div class="waiting">{px('🦹 Chạm vào một ô trên bàn cờ', 18)}</div>;
      case 'roads': return <button type="button" class="btn" onClick={() => void App.dispatch({ type: 'endRoadBuilding', pid: v })}>Xong phần làm đường</button>;
      case 'main':
        return [
          ...BUILD.map(([what, label, icon]) => {
            const [ok, left] = m[what];
            return (
              <button
                type="button" class={'btn' + (m.pick === what ? ' active' : '')} disabled={!ok}
                title={`${label} — giá ${costIcons(COSTS[what])} (còn ${left})`}
                onClick={e => { e.stopPropagation(); pick.value = pick.peek() === what ? null : what; }}
              >
                <span class="bicon"><PixelIcon emoji={icon} size={28} /></span>
                <span>{label}<span class="cost">{px(costIcons(COSTS[what]), 14)}</span></span>
              </button>
            );
          }),
          <button type="button" class="btn" disabled={!m.dev} title={`Thẻ phát triển — giá ${costIcons(COSTS.dev)}`} onClick={() => void App.dispatch({ type: 'buyDev', pid: m.v })}>
            <span class="bicon"><PixelIcon emoji="🃏" size={28} /></span>
            <span>Thẻ<span class="cost">{px(costIcons(COSTS.dev), 14)}</span></span>
          </button>,
          <button type="button" class="btn" disabled={m.tradeBusy} onClick={() => (modal.value = { kind: 'trade' })}>{px('🤝 Giao dịch', 18)}</button>,
          <button type="button" class="btn sm ghost" title="Gợi ý" onClick={() => showHint(m.v)}>{px('💡', 18)}</button>,
          <button type="button" class="btn green" onClick={() => void App.dispatch({ type: 'endTurn', pid: m.v })}>{px('✅ Kết thúc', 18)}</button>,
        ];
    }
  };
  return <div class="actions">{body()}</div>;
}

export function ActionBar(): JSX.Element {
  countRender('ActionBar');
  const mode = useMemo(() => select(() => (seat.value < 0 ? 'spectator' : locked.value ? 'locked' : 'player')), []).value;
  return (
    <footer class="actionbar">
      {mode === 'spectator' && [<div class="waiting">{px('👀 Chế độ xem: các bot tự chơi với nhau.', 18)}</div>, <SpeedControl auto />]}
      {mode === 'locked' && <div class="waiting">{px('🙈 Đang chờ người chơi nhìn màn hình...', 18)}</div>}
      {mode === 'player' && [<Hand />, <DevCards />, <Actions />]}
    </footer>
  );
}
