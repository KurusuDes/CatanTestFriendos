// The little panels that sit on top of the map: banner text, trade offer, last rolls.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { App } from '@app/index';
import { Jit } from '@ui/components/Jit';
import { px } from '@ui/components/PixelIcon';
import { banner, cur, countRender, jsonEq, offer, select } from './signals';
import { resLine } from './actions';

/** "what to do now" line (jit letters) */
export function Banner(): JSX.Element {
  countRender('Banner');
  const txt = banner.value;
  return <Jit class={'banner' + (txt ? '' : ' hidden')} text={txt} size={20} />;
}

/** the last rolls, newest first, each in the colour of whoever threw it */
export function RollLog(): JSX.Element {
  countRender('RollLog');
  const sel = useMemo(() => select(() => {
    const st = cur()!;
    return (st.rollLog || []).slice(-12).reverse().map(r => {
      const p = st.players[r.pid];
      return { sum: r.sum, color: p ? p.color : '#94b0c2', title: p ? `${p.name}: ${r.sum}` : String(r.sum) };
    });
  }, jsonEq), []);
  const rolls = sel.value;
  return (
    <div class={'roll-log' + (rolls.length ? '' : ' hidden')}>
      <span class="roll-log-head" title="Các lần tung gần đây">{px('🎲', 17)}</span>
      {rolls.map((r, i) => (
        <b key={rolls.length - i} class={'roll-chip' + (r.sum === 7 ? ' seven' : '') + (i === 0 ? ' newest' : '')} style={{ '--pc': r.color }} title={r.title}>{r.sum}</b>
      ))}
    </div>
  );
}

const respond = (pid: number, accept: boolean, tradeId: number): void => void App.dispatch({ type: 'respondTrade', pid, accept, tradeId });

/** one frame per offer (keyed by trade id): answers coming in do not replay its pop-in */
export function Offer(): JSX.Element {
  countRender('Offer');
  const o = offer.value;
  if (!o) return <div />;
  return (
    <div>
      <div class="offer" key={o.id} data-trade={o.id}>
        <div class="line">
          <span class="turn-dot" style={{ background: o.fromColor }} />
          {o.fromName} đưa <span class="res-inline">{px(resLine(o.give), 18)}</span> và muốn nhận <span class="res-inline">{px(resLine(o.get), 18)}</span>
        </div>
        <div class="resp">
          {o.rows.map(row => {
            if (row.r == null && row.mine && !o.iAmProposer)
              return [
                <span class="tag">{row.name}:</span>,
                <button type="button" class="btn sm green" disabled={!row.can} title={row.can ? '' : 'Bạn không có thứ họ cần'} onClick={() => respond(row.pid, true, o.id)}>✓ Đồng ý</button>,
                <button type="button" class="btn sm" onClick={() => respond(row.pid, false, o.id)}>✗ Không</button>,
              ];
            if (row.r == null && row.mine && o.iAmProposer && !o.online)
              // hotseat: another human at the table answers from here
              return [
                <span class="tag">{row.name}:</span>,
                <button type="button" class="btn sm green" disabled={!row.can} onClick={() => respond(row.pid, true, o.id)}>✓</button>,
                <button type="button" class="btn sm" onClick={() => respond(row.pid, false, o.id)}>✗</button>,
              ];
            return [
              <span class={'tag' + (row.r === 'accept' ? ' ok' : row.r === 'reject' ? ' no' : '')}>{`${row.name} ${row.r === 'accept' ? '✓' : row.r === 'reject' ? '✗' : '…'}`}</span>,
              row.r === 'accept' && o.iAmProposer ? <button type="button" class="btn sm primary" onClick={() => void App.dispatch({ type: 'confirmTrade', pid: o.from, with: row.pid })}>Đổi với {row.name}</button> : null,
            ];
          })}
          {o.iAmProposer && <button type="button" class="btn sm ghost" onClick={() => void App.dispatch({ type: 'cancelTrade', pid: o.from })}>Rút lời mời</button>}
        </div>
      </div>
    </div>
  );
}
