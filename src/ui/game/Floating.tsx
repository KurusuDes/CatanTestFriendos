// Screen-level layers: privacy hand-over screen, announcements and confetti.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { Jit } from '@ui/components/Jit';
import { PixelIcon, px } from '@ui/components/PixelIcon';
import { announces, confettiOn, countRender, cur, locked, seat, select, unlockedFor } from './signals';

/** hot-seat privacy: hand the device to the next player */
export function PassScreen(): JSX.Element {
  countRender('PassScreen');
  const lock = locked.value;
  const sel = useMemo(() => select(() => {
    const p = cur()?.players[seat.value];
    return p ? { name: p.name, color: p.color } : null;
  }), []);
  const who = sel.value;
  if (!lock || !who) return <div />;
  return (
    <div>
      <div class="pass-screen" onClick={() => (unlockedFor.value = seat.peek())}>
        <div>
          <div class="eye"><PixelIcon emoji="🙈" size={90} /></div>
          <div class="big" style={{ color: who.color }}>{who.name}</div>
          <p style={{ color: '#bbb', fontWeight: 700, fontSize: '18px' }}>Đưa máy cho người này. Những người khác, không nhìn nhé!</p>
          <button type="button" class="btn primary big">Là tôi, hiện ra</button>
        </div>
      </div>
    </div>
  );
}

/** big centred announcements (events, reveals) */
export function Announces(): JSX.Element {
  countRender('Announces');
  return (
    <>
      {announces.value.map(a => (
        <div class="announce" key={a.id}>
          <div>
            <div class="ai"><PixelIcon emoji={a.icon} size={64} /></div>
            <Jit class="at" text={a.title} size={34} />
            <div class="ad">{px(a.desc, 18)}</div>
          </div>
        </div>
      ))}
    </>
  );
}

const COLORS = ['#ffc233', '#ff5d8f', '#3ddc84', '#1e88e5', '#fff'];

/** 90 falling pieces for a win (rendered only while it lasts) */
export function Confetti(): JSX.Element | null {
  const n = confettiOn.value;
  if (!n) return null;
  return (
    <>
      {Array.from({ length: 90 }, (_, i) => (
        <div class="confetti" key={`${n}:${i}`} style={{ left: Math.random() * 100 + 'vw', background: COLORS[i % 5], animationDuration: 2 + Math.random() * 2.5 + 's', animationDelay: Math.random() * 0.8 + 's' }} />
      ))}
    </>
  );
}
