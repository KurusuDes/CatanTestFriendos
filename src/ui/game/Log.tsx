import { Component, type JSX } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import type { Player } from '@engine/types';
import { store } from '@app/index';
import { cur, countRender, jsonEq, select } from './signals';
import { Rich } from './Rich';

/** the visible tail of the log (older lines are dropped from the DOM) */
const TAIL = 60;

interface LineProps { msg: string; players: readonly Pick<Player, 'name' | 'color'>[] }

/** a log line never changes once written: it renders once */
class LogLine extends Component<LineProps> {
  override shouldComponentUpdate(next: LineProps): boolean {
    return next.msg !== this.props.msg;
  }
  override render({ msg, players }: LineProps): JSX.Element {
    return <div><Rich msg={msg} players={players} size={15} /></div>;
  }
}

export function Log(): JSX.Element {
  countRender('Log');
  // stable keys: turn|player|message plus the occurrence number among identical lines of the window
  const sel = useMemo(() => select(() => {
    const st = cur()!;
    const seen = new Map<string, number>();
    return st.log.slice(-TAIL).map(l => {
      const base = `${l.turn}|${l.pid}|${l.msg}`;
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { key: `${base}|${n}`, msg: l.msg };
    });
  }, jsonEq), []);
  const lines = sel.value;
  const players = store.state.peek()!.players; // names never change: do not subscribe to every move
  const box = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true); // updated by scroll events: no layout read while rendering
  const last = lines.length ? lines[lines.length - 1]!.key : '';
  // follow new entries only while the reader is at the bottom (one write, no forced layout read)
  useLayoutEffect(() => {
    const el = box.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <div class="log" ref={box} onScroll={e => {
      const el = e.currentTarget;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    }}>
      {lines.map(l => <LogLine key={l.key} msg={l.msg} players={players} />)}
    </div>
  );
}
