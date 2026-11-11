import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { TILE_INFO } from '@engine/constants';
import { px } from '@ui/components/PixelIcon';
import { showHelp } from '@ui/help.js';
import { cur, countRender, diceAnim, eventDesc, modal, PHASE_TEXT, select } from './signals';

function Die({ n, red }: { n: number; red?: boolean }): JSX.Element {
  const on = ({ 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] } as Record<number, number[]>)[n] || [];
  return <div class={'die' + (red ? ' red-die' : '')}>{Array.from({ length: 9 }, (_, i) => <i class={on.includes(i) ? 'on' : ''} />)}</div>;
}

/** who plays, which phase, which round */
function TurnInfo(): JSX.Element {
  countRender('TurnInfo');
  const sel = useMemo(() => select(() => {
    const st = cur()!;
    const c = st.players[st.current]!;
    return { color: c.color, name: st.phase === 'gameOver' ? `🏆 ${st.players[st.winner!]!.name}` : c.name, phase: PHASE_TEXT[st.phase] || '', round: st.round };
  }), []);
  const t = sel.value;
  return (
    <div class="turn-info">
      <span class="turn-dot" style={{ background: t.color }} />
      <span>{px(t.name, 18)}</span>
      <span class="phase-tag">{`· ${t.phase}${t.round ? ` · Vòng ${t.round}` : ''}`}</span>
    </div>
  );
}

/** the random event of the round */
function EventBadge(): JSX.Element {
  countRender('EventBadge');
  const sel = useMemo(() => select(() => {
    const e = cur()!.event;
    return e ? { id: e.id, icon: e.icon, name: e.name, res: e.res || null } : null;
  }), []);
  const e = sel.value;
  return <div>{e && <div class="event-badge" title={eventDesc(e.id)}>{px(`${e.icon} ${e.name}${e.res ? ' ' + TILE_INFO[e.res].icon : ''}`, 18)}</div>}</div>;
}

/** the dice: faces + sum; a new throw replays the shake (new key = new element = CSS animation runs) */
function Dice(): JSX.Element {
  countRender('Dice');
  const sel = useMemo(() => select(() => cur()!.dice), []);
  const dice = sel.value;
  const anim = diceAnim.value;
  if (!dice) return <div class="dice" />;
  const sum = dice[0] + dice[1];
  return (
    <div class={'dice' + (anim ? ' rolling' : '')} key={anim}>
      <Die n={dice[0]} />
      <Die n={dice[1]} red />
      <div class={'dice-sum' + (sum === 7 ? ' seven' : '')}>{sum}</div>
    </div>
  );
}

export function TopBar(): JSX.Element {
  countRender('TopBar');
  return (
    <header class="topbar">
      <div class="brand">Katan<i>ittes</i></div>
      <TurnInfo />
      <EventBadge />
      <Dice />
      <div class="top-actions">
        <button type="button" class="btn sm" title="Trợ giúp" onClick={() => showHelp()}>{px('❔', 18)}</button>
        <button type="button" class="btn sm" title="Menu" onClick={() => (modal.value = { kind: 'menu' })}>{px('☰', 18)}</button>
      </div>
    </header>
  );
}
