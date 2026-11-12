import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import * as G from '@engine/game';
import { RES, TILE_INFO } from '@engine/constants';
import { App } from '@app/index';
import { FlagImg } from '@ui/components/FlagImg';
import { px } from '@ui/components/PixelIcon';
import { countRender, cur, gains, jsonEq, metaTick, actors, select, seat } from './signals';

const LEVEL: Record<string, string> = { easy: 'bot dễ', normal: 'bot thường', hard: 'bot khó' };

function cardData(pid: number) {
  const st = cur()!;
  void metaTick.value; // presence of online players
  const v = seat.value;
  const p = st.players[pid]!;
  const pub = G.victoryPoints(st, pid, false);
  const all = G.victoryPoints(st, pid, true);
  const me = pid === v;
  const conn = App.isOnline() && p.kind === 'human' && App.net ? App.net.presence(pid) : undefined;
  const over = st.phase === 'gameOver';
  return {
    name: p.name, color: p.color, flag: p.flag, bot: p.kind === 'bot',
    tag: p.retired ? 'đã rời' : p.kind === 'bot' ? ((p as { remote?: boolean }).remote ? 'bot thay thế' : LEVEL[p.level] || 'bot') : me ? 'bạn' : '',
    current: st.current === pid, winner: st.winner === pid, retired: p.retired,
    acting: !over && actors.value.includes(pid), off: conn === false,
    pub, extra: (me || over) && all > pub ? all - pub : 0,
    hand: G.handSize(p.res), dev: p.dev.length, knights: p.knights, road: p.roadLen,
    roadAward: st.longestRoad.owner === pid, armyAward: st.largestArmy.owner === pid,
    discard: st.pendingDiscards[pid] || 0,
    gain: gains.value.filter(g => g.pid === pid).map(g => g.text).join(' '),
  };
}

function PlayerCard({ pid }: { pid: number }): JSX.Element {
  countRender('PlayerCard');
  const sel = useMemo(() => select(() => cardData(pid), (a, b) => jsonEq(a, b)), [pid]);
  const d = sel.value;
  const initial = d.bot ? '🤖' : d.name.slice(0, 1).toUpperCase();
  return (
    <div class={'pcard' + (d.current ? ' current' : '') + (d.winner ? ' winner' : '') + (d.retired ? ' retired' : '')} style={{ '--pc': d.color }}>
      <div class="top">
        <div class="avatar">{d.flag ? <FlagImg flag={d.flag} size={30} /> : px(initial, 18)}</div>
        <div class="name">{d.name}{d.tag && <small>{d.tag}</small>}{d.off && <span class="conn off" title="Mất kết nối"> {px('🔌', 16)}</span>}</div>
        {d.acting && <span class="acting-dot" title="Đang đi" />}
        <div class="vp" title="Điểm chiến thắng">{d.pub}{d.extra > 0 && <small> +{d.extra}</small>}</div>
      </div>
      <div class="stats">
        <span title="Thẻ tài nguyên">{px(`🂠 ${d.hand}`, 15)}</span>
        <span title="Thẻ phát triển">{px(`🃏 ${d.dev}`, 15)}</span>
        <span title="Hiệp sĩ đã dùng">{px(`⚔️ ${d.knights}`, 15)}</span>
        <span title="Đường dài nhất của bạn">{px(`🛣️ ${d.road}`, 15)}</span>
        {d.roadAward && <span class="award" title="Con đường dài nhất (+2)">{px('🏅Đường', 15)}</span>}
        {d.armyAward && <span class="award" title="Đội quân lớn nhất (+2)">{px('🏅Quân đội', 15)}</span>}
        {d.discard > 0 && <span style={{ color: 'var(--red)' }}>{px(`🗑️ ${d.discard}`, 15)}</span>}
      </div>
      {d.gain && <div class="gainfx" key={d.gain}>{px(d.gain, 17)}</div>}
    </div>
  );
}

/** the player cards: `.players` keeps one child per seat (flying cards aim at them by index) */
export function Players(): JSX.Element {
  countRender('Players');
  const n = useMemo(() => select(() => cur()!.players.length), []).value;
  return (
    <div class={'players' + (n > 5 ? ' compact' : '')}>
      {Array.from({ length: n }, (_, i) => <PlayerCard key={i} pid={i} />)}
    </div>
  );
}

export function Bank(): JSX.Element {
  countRender('Bank');
  const sel = useMemo(() => select(() => {
    const st = cur()!;
    return { bank: RES.map(r => st.bank[r]), deck: st.devDeck.length, vp: st.config.rules.vpTarget };
  }, jsonEq), []);
  const b = sel.value;
  return (
    <div class="bank-info">
      <span>{px('🏦', 16)}</span>
      {RES.map((r, i) => <span title={TILE_INFO[r].name}>{px(`${TILE_INFO[r].icon}${b.bank[i]}`, 16)}</span>)}
      <span title="Thẻ phát triển còn lại">{px(`🃏${b.deck}`, 16)}</span>
      <span title="Mục tiêu">{px(`🏆 ${b.vp}`, 16)}</span>
    </div>
  );
}
