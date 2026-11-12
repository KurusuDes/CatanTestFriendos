// ADHD: a tiny arcade to kill time while the others play (the brain button next to the reactions).
// Per player and purely local: one wallet that starts at $100, and every goal reached adds the
// next machine to the grid (Plinko -> slots -> coin -> sheep race -> mine -> rocket), all playable at once; a machine
// you have already beaten gets an Auto button (all but the mine and the rocket). Going broke sends you back to the
// Plinko. When it's your turn (or a trade offer is up) the window turns see-through and ignores clicks until you're
// done, so it never hides the board nor the game. Only the final win is shared:
// it is a game action, so everyone sees the fireworks and the banner, and the winner's pieces get gold trims (up to 5 wins).
//
// Preact owns the frame (header, grid, slots); each machine is an imperative canvas widget mounted into its slot.
// The window is a `.nopx` root: every emoji here is rendered as a sprite by us (PixelIcon / rich()).
import { render } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { signal, useSignalEffect } from '@preact/signals';
import { pendingActors } from '@engine/game';
import type { GameState } from '@engine/types';
import { App } from '@app/index';
import { toast } from '@ui/dom';
import { play } from '@ui/sfx';
import { PixelIcon } from '@ui/components/PixelIcon';
import { setSpriteHook } from './canvas';
import { coin } from './coin';
import { resetCheers, setFxContext, type BoardLike } from './fireworks';
import { fmt, round, type Machine, type MachineFactory, type Purse } from './machine';
import { mine } from './mine';
import { plinko } from './plinko';
import { rocket } from './rocket';
import { sheep } from './sheep';
import { slots } from './slots';
import { GOALS, freshWallet, loadWallet, walletSaver, type Saver, type Wallet } from './wallet';

const MACHINES: MachineFactory[] = [plinko, slots, coin, sheep, mine, rocket];

interface Adhd {
  wrap: HTMLElement;
  host: HTMLElement;
  seat: number | null;
  w: Wallet | null;
  games: (Machine | undefined)[];
  open: boolean;
  wait: boolean;
  visible: boolean;
  ghost: boolean;
  raf: number;
  saver: Saver;
}
let A: Adhd | null = null;
// toggle buttons handed to the action bar (it is built off-screen and may drop what it built)
let btnHosts: HTMLElement[] = [];
let btnOn = false;

// what the Preact parts show: texts that change often are signals bound straight to text nodes
const visibleS = signal(false);
const ghostS = signal(false);
const seatS = signal<number | null>(null);
const levelS = signal(1);
const buildS = signal(0);
const winsS = signal(0);
const barS = signal(0);
const moneyS = signal('');
const goalS = signal('');

/** how many frames the machines drew (for measuring) */
const stats = { frames: 0 };

// ---------------- mounting ----------------
export function mountAdhd(wrap: HTMLElement, getBoard: () => BoardLike | null | undefined): void {
  teardown();
  const host = document.createElement('div');
  host.className = 'nopx'; // pixelize skips it: we render our own sprites
  host.style.display = 'contents';
  wrap.append(host);
  const a: Adhd = { wrap, host, seat: null, w: null, games: [], open: false, wait: false, visible: false, ghost: false, raf: 0, saver: walletSaver(() => ({ seat: a.seat, w: a.w })) };
  A = a;
  seatS.value = null;
  visibleS.value = ghostS.value = false;
  btnOn = false;
  setFxContext({ wrap, getBoard });
  setSpriteHook(markDirty);
  render(<AdhdWindow />, host);
}

function teardown(): void {
  resetCheers();
  const a = A;
  if (!a) return;
  A = null;
  settleAll(a);
  a.saver.flush();
  cancelAnimationFrame(a.raf);
  for (const g of a.games) g && g.dispose();
  render(null, a.host);
  a.host.remove();
  setFxContext(null);
  setSpriteHook(() => {});
  visibleS.value = ghostS.value = false;
  seatS.value = null;
  btnOn = false;
  for (const b of btnHosts) render(<AdhdButton on={false} />, b);
}

export function disposeAdhd(): void {
  teardown();
  for (const b of btnHosts) render(null, b);
  btnHosts = [];
}

/** the toggle button the action bar appends to the hand bar. Like the old one it is a new element on every call
 *  (the bar is built off-screen and compared with the live one; it keeps whichever it likes), so we track the
 *  ones still on screen to flip their `on` class and unmount the rest. */
export function adhdButton(): HTMLElement {
  btnHosts = btnHosts.filter(b => b.isConnected || (render(null, b), false));
  const host = document.createElement('span');
  host.className = 'nopx'; // pixelize skips it: the button renders its own sprite
  host.style.display = 'contents';
  render(<AdhdButton on={!!A && A.visible} />, host);
  btnHosts.push(host);
  return host;
}

// called on every render: whose wallet, and whether you have something to do in the game (your turn,
// a discard, a trade offer up...): then the arcade stays on screen but see-through and untouchable
export function updateAdhd(st: GameState, v: number, offerUp: boolean): void {
  if (!A) return;
  const seat = v >= 0 && st.phase !== 'gameOver' ? v : null;
  if (seat !== A.seat) setSeat(A, seat);
  A.wait = seat != null && (pendingActors(st).includes(seat) || !!offerUp);
  apply(A);
}

function toggleAdhd(): void {
  if (!A || A.seat == null) return;
  A.open = !A.open;
  apply(A);
}

function apply(a: Adhd): void {
  const vis = a.seat != null && a.open;
  const ghost = vis && a.wait;
  // closing it or fading it out cashes out anything still in the air (and stops the Autos)
  if (a.visible && !a.ghost && (!vis || ghost)) settleAll(a);
  const wasGhost = a.ghost;
  a.visible = vis;
  a.ghost = ghost;
  visibleS.value = vis;
  ghostS.value = ghost;
  if (btnOn !== vis) for (const b of btnHosts) render(<AdhdButton on={vis} />, b);
  btnOn = vis;
  // see-through (your turn): nobody is playing, so the loop stops; draw the settled state once
  if (ghost && !wasGhost) for (const g of a.games) g && g.frame(performance.now());
  if (vis && !ghost && !a.raf) {
    markDirty();
    a.raf = requestAnimationFrame(loop);
  }
}

function markDirty(): void {
  if (A) for (const g of A.games) if (g) g.dirty = true;
}

// Each machine says how often it needs a redraw right now (g.fps): 60 while something moves,
// a few per second for idle decorations, 0 when still (it then only redraws when marked dirty).
function loop(now: number): void {
  const a = A;
  if (!a) return;
  if (!a.visible || a.ghost) {
    a.raf = 0;
    return;
  }
  for (const g of a.games) {
    if (!g) continue;
    const f = g.fps(now);
    if (g.dirty || f >= 60 || (f > 0 && now - g.drawn >= 1000 / f - 4)) {
      g.dirty = false;
      g.drawn = now;
      stats.frames++;
      g.frame(now);
    }
  }
  a.raf = requestAnimationFrame(loop);
}

function settleAll(a: Adhd): void {
  for (const g of a.games) g && g.settle();
}

// ---------------- wallet & machines ----------------
function setSeat(a: Adhd, seat: number | null): void {
  settleAll(a);
  a.saver.flush();
  a.seat = seat;
  a.w = seat == null ? null : loadWallet(seat);
  build(a);
}

function build(a: Adhd): void {
  for (const g of a.games) g && g.dispose();
  a.games = [];
  if (a.seat != null && a.w) {
    levelS.value = a.w.level;
    winsS.value = a.w.wins;
    buildS.value++; // new grid: the slots mount again, empty, and fill with this wallet's machines
  }
  seatS.value = a.seat;
  if (a.seat != null) refresh(a);
}

function addGame(a: Adhd, i: number, host: HTMLElement, fresh: boolean): void {
  const m = MACHINES[i]!(purse(a, i)) as Machine;
  m.dirty = true;
  m.drawn = 0;
  a.games[i] = m;
  if (fresh) m.el.classList.add('fresh');
  host.append(m.el);
  m.sync();
}

function purse(a: Adhd, i: number): Purse {
  const K: Purse = {
    dead: false,
    spend(n) {
      if (K.dead || a.w!.money < n - 1e-9) return false;
      a.w!.money = round(a.w!.money - n);
      // no bust check here: the bet is still in play, it gets checked when it resolves
      refresh(a);
      a.saver.save();
      return true;
    },
    pay(n) {
      if (K.dead) return;
      a.w!.money = round(a.w!.money + n);
      changed(a);
    },
    done() {
      if (!K.dead) changed(a);
    },
    money: () => a.w!.money,
    passed: () => a.w!.level > i + 1, // the next machine is out: this one may run on Auto
  };
  return K;
}

function changed(a: Adhd): void {
  const w = a.w!;
  while (w.level < GOALS.length && w.money >= GOALS[w.level - 1]!) {
    w.level++;
    levelS.value = w.level; // the slot swaps its hatching pattern for the new machine
    play.unlock();
  }
  if (w.level === GOALS.length && w.money >= GOALS[GOALS.length - 1]!) return win(a);
  if (w.money < 1 && !a.games.some(g => g && g.busy())) return bust(a);
  refresh(a);
  a.saver.save();
}

function refresh(a: Adhd): void {
  const w = a.w!;
  const goal = GOALS[w.level - 1]!;
  moneyS.value = fmt(w.money);
  goalS.value = '/ ' + fmt(goal);
  barS.value = Math.min(100, (w.money / goal) * 100);
  winsS.value = w.wins;
  for (const g of a.games) g && g.sync();
}

function bust(a: Adhd): void {
  a.w = freshWallet(a.w!.wins);
  a.saver.flush();
  build(a);
  play.bad();
  toast('💸 Cháy túi rồi! Quay lại Plinko với $100', 'error', 3000);
}

function win(a: Adhd): void {
  a.w = freshWallet(a.w!.wins + 1);
  a.saver.flush();
  build(a);
  App.cheer(a.seat!);
}

// ---------------- components ----------------
const stop = (e: Event) => e.stopPropagation();

function AdhdWindow() {
  const root = useRef<HTMLDivElement>(null);
  const seat = seatS.value, vis = visibleS.value, ghost = ghostS.value;
  // no clicks, no keyboard focus while you play
  useLayoutEffect(() => {
    if (root.current) root.current.inert = ghost;
  }, [ghost]);
  // clicks inside must not reach the board (they would cancel a pending pick)
  return (
    <div ref={root} class={'adhd' + (vis ? '' : ' hidden') + (ghost ? ' ghost' : '')} onClick={stop} onPointerDown={stop}>
      {seat != null && (
        <>
          <Head />
          <div class="adhd-grid" key={buildS.value}>
            {GOALS.map((_, i) => <Slot i={i} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Head() {
  const bar = useRef<HTMLElement>(null);
  useSignalEffect(() => {
    if (bar.current) bar.current.style.width = barS.value + '%';
  });
  const wins = winsS.value;
  return (
    <div class="adhd-head">
      <span class="adhd-title"><PixelIcon emoji="🧠" size={15} /> ADHD</span>
      <b class="adhd-money nopx">{moneyS}</b>
      <div class="adhd-prog"><i ref={bar} /></div>
      <span class="adhd-goal nopx">{goalS}</span>
      <span class="adhd-wins">{wins ? <><PixelIcon emoji="🏆" size={15} />{wins}</> : ''}</span>
      <button class="btn sm adhd-min" title="Thu gọn" onClick={toggleAdhd}>—</button>
    </div>
  );
}

// An empty (hatched) slot until its machine is earned: a surprise. The machine is created imperatively
// into this host; display:contents keeps the machine's cell a direct grid child like before.
function Slot({ i }: { i: number }) {
  const host = useRef<HTMLDivElement>(null);
  const level = levelS.value;
  const earnedLater = useRef(level <= i); // locked when first drawn: a machine that appears now is new
  useLayoutEffect(() => {
    const a = A;
    if (a && host.current && level > i && !a.games[i]) addGame(a, i, host.current, earnedLater.current);
  }, [level]);
  return <div ref={host} style={{ display: 'contents' }}>{level <= i && <div class="adhd-slot" />}</div>;
}

function AdhdButton({ on }: { on: boolean }) {
  return (
    <button
      class={'btn adhd-toggle' + (on ? ' on' : '')}
      title="ADHD: trò chơi nhỏ trong lúc chờ"
      onClick={e => {
        e.stopPropagation();
        toggleAdhd();
      }}
    >
      <PixelIcon emoji="🧠" size={18} />
    </button>
  );
}
