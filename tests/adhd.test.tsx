// @vitest-environment happy-dom
// ADHD arcade: the Preact window (levels, wallet, ghost mode, loop) and, for every machine, a replay against the
// frozen pre-Preact code (tests/legacy/adhd.js): same RNG + same clock => same bets, payouts and messages.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'preact/test-utils';

vi.mock('@ui/pixel', () => ({
  pxURL: (n: string) => `sprite:${n}`,
  pxIcon: (n: string, _s?: number, title?: string) => Object.assign(document.createElement('img'), { alt: title || n, className: 'px' }),
  pixelize: () => {},
  autoPixelize: () => {},
}));
vi.mock('@ui/sfx', () => ({ play: new Proxy({}, { get: () => () => {} }), sfx: { on: false } }));
vi.mock('@engine/game', async importOriginal => ({
  ...(await importOriginal<typeof import('@engine/game')>()),
  pendingActors: (st: { pending?: number[] }) => st.pending || [],
}));

import { App } from '@app/index';
import type { GameState } from '@engine/types';
import { mountAdhd, disposeAdhd, adhdButton, updateAdhd } from '@ui/adhd';
import { KEY, START, GOALS, loadWallet, saveWallet, walletSaver, loadStore } from '@ui/adhd/wallet';
import { plinko } from '@ui/adhd/plinko';
import { slots } from '@ui/adhd/slots';
import { coin } from '@ui/adhd/coin';
import { sheep } from '@ui/adhd/sheep';
import { mine, mineMult } from '@ui/adhd/mine';
import { rocket } from '@ui/adhd/rocket';
import type { MachineCore, Purse } from '@ui/adhd/machine';
import * as legacy from './legacy/adhd';

// ---- environment: fake canvas, controllable rAF and clock ----
const fakeCtx = new Proxy({ fillRect: vi.fn() }, { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : () => {}), set: (t: Record<string, unknown>, k: string, v) => ((t[k] = v), true) });
let rafs = new Map<number, FrameRequestCallback>();
let rafId = 0;
let clock = 1000;
const runFrame = (now = clock) => {
  const cbs = [...rafs.values()];
  rafs.clear();
  cbs.forEach(cb => cb(now));
};

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="wrap"></div>';
  rafs = new Map();
  clock = 1000;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (rafs.set(++rafId, cb), rafId));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => rafs.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
  (App as { state: GameState | null }).state = { config: { seed: 7 }, phase: 'main', players: [{ name: 'An', color: '#f00' }, { name: 'Bo', color: '#0f0' }] } as unknown as GameState;
});
afterEach(() => {
  act(() => disposeAdhd());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const st = (pending: number[] = []) => ({ phase: 'main', pending }) as unknown as GameState;
const win = () => document.querySelector('.adhd') as HTMLElement;
const cells = () => document.querySelectorAll('.adhd-cell');
const toggle = () => document.querySelector('.adhd-toggle') as HTMLButtonElement;
const press = (root: ParentNode, re: RegExp) => [...root.querySelectorAll('button')].find(b => re.test(b.textContent || ''))!.click();

function boot(seat: number, wallet?: { money: number; level: number; wins: number }) {
  if (wallet) saveWallet(seat, wallet);
  const bar = document.createElement('div');
  act(() => {
    bar.append(adhdButton());
    document.body.append(bar);
    mountAdhd(document.getElementById('wrap')!, () => null);
    updateAdhd(st(), seat, false);
  });
}

describe('wallet', () => {
  it('same key and format as before, tied to the match seed', () => {
    expect(KEY).toBe('katanittes.adhd.v2');
    saveWallet(1, { money: 120.5, level: 2, wins: 3 });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ id: 7, seats: { 1: { money: 120.5, level: 2, wins: 3 } } });
    expect(loadWallet(1)).toEqual({ money: 120.5, level: 2, wins: 3 });
    expect(loadWallet(0)).toEqual({ money: START, level: 1, wins: 0 });
    (App.state as { config: { seed: number } }).config.seed = 8; // another match: old wallets are ignored
    expect(loadStore()).toEqual({ id: 8, seats: {} });
    expect(loadWallet(1).money).toBe(START);
  });
  it('debounces the save (400 ms) and flush writes at once', () => {
    vi.useFakeTimers();
    const cur = { seat: 0 as number | null, w: { money: 90, level: 1, wins: 0 } };
    const s = walletSaver(() => cur);
    s.save();
    s.save();
    vi.advanceTimersByTime(399);
    expect(localStorage.getItem(KEY)).toBeNull();
    vi.advanceTimersByTime(2);
    expect(loadWallet(0).money).toBe(90);
    cur.w = { money: 95, level: 1, wins: 0 };
    s.flush();
    expect(loadWallet(0).money).toBe(95);
    cur.seat = null;
    cur.w = { money: 1, level: 1, wins: 0 };
    s.flush();
    expect(loadWallet(0).money).toBe(95);
  });
});

describe('window', () => {
  it('stays hidden until the button is pressed; starts with the Plinko and five hatched slots', () => {
    boot(0);
    expect(win().classList.contains('hidden')).toBe(true);
    expect(toggle().classList.contains('on')).toBe(false);
    act(() => toggle().click());
    expect(win().classList.contains('hidden')).toBe(false);
    expect(toggle().classList.contains('on')).toBe(true);
    expect(cells().length).toBe(1);
    expect(win().querySelector('h4')!.textContent).toBe('Plinko');
    expect(win().querySelectorAll('.adhd-slot').length).toBe(GOALS.length - 1);
    expect(win().querySelector('.adhd-money')!.textContent).toBe('$100');
    expect(win().querySelector('.adhd-goal')!.textContent).toBe('/ $150');
    expect(win().querySelector('.adhd-money')!.classList.contains('nopx')).toBe(true);
    expect(win().parentElement!.classList.contains('nopx')).toBe(true);
    // emoji are sprites here (the host is .nopx, nothing else would render them)
    expect(win().querySelector('.adhd-title img.px')).not.toBeNull();
    expect(toggle().querySelector('img.px')).not.toBeNull();
  });
  it('shows one machine per unlocked level, with the saved money and wins', () => {
    boot(1, { money: 300, level: 4, wins: 2 });
    act(() => toggle().click());
    expect([...win().querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Plinko', 'Máy đánh bạc', 'Tung đồng xu', 'Đua cừu']);
    expect(win().querySelectorAll('.adhd-slot').length).toBe(2);
    expect(win().querySelector('.adhd-money')!.textContent).toBe('$300');
    expect(win().querySelector('.adhd-goal')!.textContent).toBe('/ $650');
    expect(win().querySelector('.adhd-wins img')).not.toBeNull();
    expect(win().querySelector('.adhd-wins')!.textContent).toBe('2');
    // the coin machine's buttons carry sprites, not emoji text
    const coinCell = cells()[2]!;
    expect(coinCell.querySelectorAll('button img.px').length).toBe(2);
    expect(coinCell.textContent).not.toMatch(/👑|🌾/);
    act(() => disposeAdhd());
    boot(1, { money: 1000, level: 6, wins: 0 });
    act(() => toggle().click());
    expect(cells().length).toBe(6);
  });
  it('unlocks the next machine when the goal is reached (and saves)', () => {
    boot(0, { money: 149, level: 1, wins: 0 });
    act(() => toggle().click());
    expect(cells().length).toBe(1);
    vi.spyOn(Math, 'random').mockReturnValue(0.9999); // every peg goes the same way: the x25 bin
    act(() => press(cells()[0]!, /Thả/));
    expect(win().querySelector('.adhd-money')!.textContent).toBe('$148');
    act(() => {
      clock += 3000;
      runFrame();
    });
    expect(cells().length).toBe(2);
    expect(cells()[1]!.classList.contains('fresh')).toBe(true);
    expect(win().querySelector('.adhd-money')!.textContent).toBe('$173');
    act(() => disposeAdhd()); // leaving the match writes the wallet
    expect(loadWallet(0)).toEqual({ money: 173, level: 2, wins: 0 });
  });
  it('ghost mode (your turn): see-through, inert, and the loop stops; closing stops it too', () => {
    boot(0);
    act(() => toggle().click());
    expect(rafs.size).toBe(1);
    act(() => runFrame());
    expect(rafs.size).toBe(1); // loop keeps going while it's open and you're free
    act(() => updateAdhd(st([0]), 0, false));
    expect(win().classList.contains('ghost')).toBe(true);
    expect(win().inert).toBe(true);
    act(() => runFrame());
    expect(rafs.size).toBe(0); // ... and stops the moment it is see-through
    act(() => updateAdhd(st([]), 0, false));
    expect(win().classList.contains('ghost')).toBe(false);
    expect(win().inert).toBe(false);
    expect(rafs.size).toBe(1); // back to life
    act(() => updateAdhd(st([]), 0, true)); // a trade offer is up: ghost again
    expect(win().classList.contains('ghost')).toBe(true);
    act(() => updateAdhd(st([]), 0, false));
    act(() => toggle().click()); // close
    expect(win().classList.contains('hidden')).toBe(true);
    act(() => runFrame());
    expect(rafs.size).toBe(0);
  });
  it('an idle machine does not redraw; a busy one does', () => {
    boot(0);
    const draws = fakeCtx.fillRect as ReturnType<typeof vi.fn>;
    act(() => toggle().click());
    act(() => runFrame(2000)); // first pass: everything is dirty
    expect(draws).toHaveBeenCalled();
    draws.mockClear();
    for (let i = 0; i < 10; i++) act(() => runFrame(2016 + 16 * i));
    expect(draws).not.toHaveBeenCalled(); // plinko with nothing in the air: 0 fps
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    act(() => press(cells()[0]!, /Thả/));
    act(() => runFrame(2200));
    expect(draws).toHaveBeenCalled();
  });
  it('seat change builds a fresh window, no seat (spectator) empties it', () => {
    boot(0, { money: 200, level: 2, wins: 0 });
    act(() => toggle().click());
    expect(cells().length).toBe(2);
    act(() => updateAdhd(st(), 1, false));
    expect(cells().length).toBe(1);
    act(() => updateAdhd(st(), -1, false));
    expect(win().classList.contains('hidden')).toBe(true);
    expect(win().children.length).toBe(0);
  });
});

// ---- replay against the legacy code ----
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const text = (n: Node): string => (n.nodeType === 3 ? n.textContent! : n instanceof HTMLImageElement ? n.alt : [...n.childNodes].map(text).join(''));

type Make = (K: Purse) => MachineCore;
type Script = (m: MachineCore, tick: (ms: number) => void, r: () => number) => void;

function replay(make: Make, script: Script, seed: number): string[] {
  const log: string[] = [];
  const r = rng(seed ^ 0x9e37);
  vi.spyOn(Math, 'random').mockImplementation(rng(seed));
  clock = 1000;
  let money = 1000;
  const K: Purse = {
    dead: false,
    spend: n => (money >= n ? ((money -= n), log.push('spend ' + n), true) : false),
    pay: n => (log.push('pay ' + n), void (money += n)),
    done: () => void log.push('done'),
    money: () => money,
    passed: () => true,
  };
  const m = make(K);
  document.body.append(m.el);
  const snap = () => log.push('note ' + text(m.el.querySelector('.adhd-note') || document.createTextNode('')) + ' | ' + [...m.el.querySelectorAll('button')].map(b => text(b)).join(','));
  const tick = (ms: number) => {
    for (let t = 0; t < ms; t += 16) {
      clock += 16;
      m.frame(clock);
      if (t % 480 === 0) snap();
    }
  };
  script(m, tick, r);
  snap();
  m.settle();
  snap();
  m.dispose();
  m.el.remove();
  vi.restoreAllMocks();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx as unknown as CanvasRenderingContext2D);
  return log;
}

const same = (name: string, make: Make, old: Make, script: Script) =>
  it(`${name}: same bets, payouts and messages as the old code`, () => {
    for (const seed of [1, 2, 3, 99]) {
      const a = replay(old, script, seed);
      const b = replay(make, script, seed);
      expect(b.length).toBeGreaterThan(10);
      expect(b.filter(l => l.startsWith('spend')).length).toBeGreaterThan(5);
      expect(b.some(l => l.startsWith('pay') || l === 'done')).toBe(true);
      expect(b).toEqual(a);
    }
  });

describe('machines vs legacy', () => {
  same('plinko', plinko, legacy.plinko, (m, tick) => {
    for (let i = 0; i < 25; i++) {
      press(m.el, /Thả/);
      tick(100);
    }
    tick(1500);
    press(m.el, /Tự động/);
    tick(2000);
  });
  same('slots', slots, legacy.slots, (m, tick, r) => {
    for (let i = 0; i < 12; i++) {
      if (r() < 0.3) press(m.el, /^\$/);
      press(m.el, /Xoay/);
      tick(2200);
    }
    press(m.el, /Tự động/);
    tick(5000);
  });
  same('coin', coin, legacy.coin, (m, tick, r) => {
    const slider = m.el.querySelector('input')!;
    for (let i = 0; i < 20; i++) {
      slider.value = String(1 + Math.floor(r() * 30));
      slider.dispatchEvent(new Event('input'));
      press(m.el, r() < 0.5 ? /Ngửa/ : /Sấp/);
      tick(1300);
      m.sync();
    }
    press(m.el, /Tự động/);
    tick(4000);
  });
  same('sheep', sheep, legacy.sheep, (m, tick, r) => {
    for (let i = 0; i < 14; i++) {
      if (r() < 0.3) press(m.el, /^\$/);
      const picks = [...m.el.querySelectorAll('.adhd-picks button')] as HTMLButtonElement[];
      picks[Math.floor(r() * 4)]!.click();
      tick(3000);
    }
    press(m.el, /Tự động/);
    tick(8000);
  });
  same('mine', mine, legacy.mine, (m, tick, r) => {
    const cv = m.el.querySelector('canvas')!;
    cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 90, height: 66, right: 90, bottom: 66, x: 0, y: 0, toJSON: () => ({}) });
    const click = (i: number) => {
      const x = 14 + (i % 4) * 16 + 7, y = 2 + Math.floor(i / 4) * 16 + 7;
      cv.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }));
    };
    for (let round = 0; round < 12; round++) {
      if ([...m.el.querySelectorAll('button')].some(b => /^Vào/.test(b.textContent || ''))) press(m.el, /^Vào/);
      tick(32);
      const digs = 1 + Math.floor(r() * 8);
      for (let d = 0; d < digs; d++) {
        click(Math.floor(r() * 16));
        tick(32);
      }
      if ([...m.el.querySelectorAll('button')].some(b => /^Nhận/.test(b.textContent || '')) && r() < 0.7) press(m.el, /^Nhận/);
      tick(480);
    }
  });
  same('rocket', rocket, legacy.rocket, (m, tick, r) => {
    for (let i = 0; i < 25; i++) {
      press(m.el, /Cất cánh/);
      tick(300 + Math.floor(r() * 3000));
      if ([...m.el.querySelectorAll('button')].some(b => /Rút/.test(b.textContent || ''))) press(m.el, /Rút/);
      tick(2500);
    }
  });
  it('mine multipliers', () => {
    expect(mineMult(1)).toBe(1.23);
    expect(mineMult(13)).toBe(560);
  });
});
