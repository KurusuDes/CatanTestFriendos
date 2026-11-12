// @vitest-environment happy-dom
// Smoke tests for the Preact screens: each one renders, shows its key buttons/texts, and its main
// interactions work without exceptions. Canvas / 3D / sprite generation are stubbed (no GPU, no canvas).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('@ui/pixel', () => ({ pxURL: (n: string) => `sprite:${n}`, pxIcon: () => document.createElement('img'), pixelize: () => {}, ICON_SETS: ['render', 'pico', 'classic'], setIconSet: () => {}, iconSet: () => 'render' }));
vi.mock('@ui/screens/Diorama', () => ({ Diorama: () => <div class="menu-bg3d" /> }));
vi.mock('@board/BoardView', () => ({ BoardView: class { zoom = 1; render() {} dispose() {} resetView() {} setZoom() {} } }));
// no WebGL in happy-dom: the game screen falls back to the flat board, as it does on a machine without GPU
vi.mock('@board/Board3D', () => ({ Board3D: { create: () => Promise.reject(new Error('no webgl')) } }));
vi.mock('@ui/sfx', () => ({ sfx: { on: false }, play: new Proxy({}, { get: () => () => {} }) }));
vi.mock('@ui/flag/flag', async importOriginal => ({ ...(await importOriginal<typeof import('@ui/flag/flag')>()), flagURL: () => 'flag:url' }));

import { App } from '@app/index';
import { preactScreen } from '@ui/components/mount';
import { Jit } from '@ui/components/Jit';
import { Menu } from '@ui/screens/Menu';
import { Online } from '@ui/screens/Online';
import { Lobby } from '@ui/screens/Lobby';
import { Editor, encodeMap, decodeMap } from '@ui/screens/Editor';
import { HelpModal, showHelp } from '@ui/screens/Help';
import { gameScreen } from '@ui/game/GameScreen';
import { Rich } from '@ui/game/Rich';
import { renders } from '@ui/game/signals';
import { applyAction, legalSetupRoads, legalSetupSettlements, pendingActors } from '@engine/game';
import { botAct } from '@engine/bot';
import { makeConfig } from '../scripts/sim.ts';

let root: HTMLElement;
beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
});
afterEach(() => {
  render(null, root);
});

const buttons = () => [...root.querySelectorAll('button')].map(b => (b.textContent || '').trim());
const has = (re: RegExp) => buttons().some(t => re.test(t));
const find = (re: RegExp) => [...root.querySelectorAll('button')].find(b => re.test((b.textContent || '').trim()))!;

describe('shared components', () => {
  it('<Jit> renders pixelize-compatible letters', () => {
    act(() => render(<Jit class="t1" text={['KA', { cls: 'x', text: 'B C' }]} />, root));
    const el = root.firstElementChild!;
    expect(el.className).toBe('t1 jit');
    expect(el.getAttribute('data-jit')).toBe('1');
    expect(el.querySelectorAll('.jl').length).toBe(4);
    expect(el.querySelectorAll('.jw').length).toBe(3);
    expect((el.querySelectorAll('.jl')[1] as HTMLElement).style.animationDelay).toBe('-0.137s');
  });
});

describe('screens', () => {
  it('Menu', () => {
    act(() => render(<Menu />, root));
    expect(has(/Chơi trên một máy/)).toBe(true);
    expect(has(/Chơi online/)).toBe(true);
    expect(has(/Tạo bản đồ/)).toBe(true);
    expect(has(/Cách chơi/)).toBe(true);
    expect(root.querySelector('.menu-kingdom input')).toBeTruthy();
    expect(root.querySelector('.logo .jl')).toBeTruthy();
    expect(root.querySelector('img.px')!.getAttribute('src')).toMatch(/^sprite:/);
    // typing a name persists it
    const input = root.querySelector<HTMLInputElement>('.menu-kingdom input')!;
    act(() => { input.value = 'Mai'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(JSON.parse(localStorage.getItem('katanittes.name')!)).toBe('Mai');
    // navigation
    const go = vi.spyOn(App, 'go').mockImplementation(() => {});
    act(() => find(/Chơi trên một máy/).click());
    expect(go).toHaveBeenCalledWith('lobby');
    go.mockRestore();
  });

  it('Menu shows resume / reopen entries from saved sessions', () => {
    localStorage.setItem('katanittes.save.v1', JSON.stringify({ round: 3 }));
    localStorage.setItem('katanittes.hostSession', JSON.stringify({ code: 'ABCDE', at: Date.now(), state: { round: 4 } }));
    localStorage.setItem('katanittes.guestSession', JSON.stringify({ code: 'ZZZZZ', name: 'x', at: Date.now() }));
    act(() => render(<Menu />, root));
    expect(has(/Chơi tiếp \(vòng 3\)/)).toBe(true);
    expect(has(/Mở lại phòng ABCDE \(vòng 4\)/)).toBe(true);
    expect(has(/Quay lại phòng ZZZZZ/)).toBe(true);
    act(() => find(/^✕$/).click());
    expect(has(/Mở lại phòng/)).toBe(false);
  });

  it('Online hub: create/join cards, 5 pin boxes, capacity', () => {
    act(() => render(<Online />, root));
    expect(root.querySelectorAll('input.pin').length).toBe(5);
    expect(has(/Tạo phòng/)).toBe(true);
    expect(has(/Vào phòng/)).toBe(true);
    expect(root.querySelectorAll('.cap-people span').length).toBe(4);
    act(() => find(/^6$/).click());
    expect(root.querySelectorAll('.cap-people span').length).toBe(6);
    // joining without a name is refused with a toast, no exception
    act(() => find(/Vào phòng/).click());
  });

  it('Online hub: waiting room for a guest, updated through App.onLobby', () => {
    const net = { role: 'client', lobby: null as unknown, close() {}, code: 'QWERT' };
    App.net = net as never;
    act(() => render(<Online />, root));
    expect(root.querySelector('.waiting-card')).toBeFalsy();
    net.lobby = { code: 'QWERT', capacity: 3, open: true, host: { name: 'Chủ', flag: null, color: '#e53935' }, players: [{ name: 'Khách', flag: null, color: null }] };
    act(() => App.onLobby!());
    expect(root.querySelector('.waiting-card')).toBeTruthy();
    expect(root.querySelectorAll('.seat').length).toBe(3);
    expect(root.querySelector('.seat.empty')).toBeTruthy();
    expect(root.querySelector('.room-code')!.textContent).toBe('QWERT');
    expect(has(/Rời phòng/)).toBe(true);
    act(() => render(null, root));
    expect(App.onLobby).toBeNull();
    App.net = null;
  });

  it('Lobby (local): players, modes, rules, start', () => {
    act(() => render(<Lobby />, root));
    expect(root.querySelectorAll('.player-row').length).toBe(4);
    expect(root.querySelectorAll('.mode').length).toBeGreaterThan(5);
    expect(root.querySelectorAll('.map-card').length).toBeGreaterThan(5);
    expect(root.querySelector('#startBtn')).toBeTruthy();
    expect(root.querySelector('.preview-meta .pill')).toBeTruthy();
    // add / remove a player
    act(() => find(/Thêm người chơi/).click());
    expect(root.querySelectorAll('.player-row').length).toBe(5);
    // toggle a mode: persisted in the saved config
    const mode = root.querySelector<HTMLElement>('.mode')!;
    act(() => mode.click());
    expect(mode.classList.contains('on')).toBe(true);
    const cfg = JSON.parse(localStorage.getItem('katanittes.lastConfig')!);
    expect(cfg.players.length).toBe(5);
    // start the game with the config
    const start = vi.spyOn(App, 'startGame').mockImplementation(() => {});
    act(() => root.querySelector<HTMLElement>('#startBtn')!.click());
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0]![0].players.length).toBe(5);
    start.mockRestore();
  });

  it('Lobby (online host): room card with code and capacity', () => {
    const net = { guests: [], code: 'ROOM1', open: true, capacity: 4, hostInfo: null as unknown, pushLobby: vi.fn(), onChange() {}, closeRoom() {}, startGame: vi.fn() };
    App.net = net as never;
    act(() => render(<Lobby arg={{ online: 'host', capacity: 3 }} />, root));
    expect(root.querySelector('.room-card .room-code')!.textContent).toBe('ROOM1');
    expect(root.querySelectorAll('.player-row').length).toBe(3);
    expect(net.pushLobby).toHaveBeenCalled();
    expect(net.capacity).toBe(3);
    act(() => find(/^5$/).click());
    expect(root.querySelectorAll('.player-row').length).toBe(5);
    expect(net.capacity).toBe(5);
    App.net = null;
  });

  it('Editor: paint, save, encode/decode', () => {
    act(() => render(<Editor />, root));
    expect(root.querySelectorAll('svg.board-svg g').length).toBe(91);
    expect(root.textContent).toContain('Số ô: 19');
    const before = root.querySelectorAll('svg.board-svg g')[45]!;
    act(() => find(/Gỗ/).click());
    act(() => { before.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(root.querySelectorAll('svg.board-svg g')[45]).toBe(before); // same node: only that hex re-rendered
    act(() => find(/^Lưu$/).click());
    const saved = JSON.parse(localStorage.getItem('katanittes.maps')!);
    expect(saved[0].tiles.length).toBe(19);
    expect(root.querySelectorAll('[title="Xóa"]').length).toBe(1);
    expect(decodeMap(encodeMap(saved[0]))).toEqual(saved[0]);
  });

  it('Help modal', () => {
    act(() => render(<HelpModal onClose={() => {}} />, root));
    expect(root.querySelector('.help-body h2')!.textContent).toContain('Cách chơi');
    expect(root.querySelectorAll('.help-body li').length).toBeGreaterThan(15);
    showHelp();
    expect(document.querySelector('.nopx .overlay')).toBeTruthy();
    act(() => [...document.querySelectorAll<HTMLElement>('.nopx button')].find(b => /Đã hiểu/.test(b.textContent || ''))!.click());
    expect(document.querySelector('.nopx .overlay')).toBeFalsy();
  });

  it('preactScreen mounts into the root as .nopx and unmounts on leave', () => {
    const fn = preactScreen(Menu);
    fn(root);
    expect(root.classList.contains('nopx')).toBe(true);
    expect(root.querySelector('.menu')).toBeTruthy();
    App.onLeave!();
    expect(root.classList.contains('nopx')).toBe(false);
    expect(root.childElementCount).toBe(0);
    App.onLeave = null;
  });
});

describe('GameScreen', () => {
  const tick = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const snap = () => ({ ...renders });
  const delta = (a: Record<string, number>) => Object.fromEntries(Object.entries(renders).map(([k, n]) => [k, n - (a[k] || 0)]).filter(([, n]) => n));

  beforeEach(() => {
    vi.spyOn(App, 'scheduleBots').mockImplementation(() => {});
    App.screens.game = gameScreen;
    App.screens.menu = () => {};
  });
  afterEach(() => {
    App.onLeave?.();
    App.onLeave = null;
    App.state = null;
    vi.restoreAllMocks();
  });

  it('<Rich> turns @n and :res: into a coloured name and a sprite', () => {
    act(() => render(<Rich msg="@1 lấy :wood: 🎲" players={[{ name: 'A', color: '#111' }, { name: 'B', color: '#222' }]} />, root));
    expect(root.querySelector('b.pname')!.textContent).toBe('B');
    expect(root.querySelectorAll('img.px').length).toBe(2);
    expect(root.querySelector('.ico')!.getAttribute('title')).toBe('Gỗ');
  });

  it('mounts every region, a move updates only what changed, and leaving cleans up', async () => {
    const cfg = makeConfig(1);
    cfg.players[0]!.kind = 'human';
    cfg.players = cfg.players.slice(0, 3);
    act(() => App.startGame(cfg));
    await tick();
    expect(root.classList.contains('nopx')).toBe(true);
    for (const sel of ['.topbar', '.turn-info', '.board-wrap', '.banner', '.zoom-ctrl', '.players', '.bank-info', '.log', '.actionbar']) expect(root.querySelector(sel), sel).toBeTruthy();
    expect(root.querySelectorAll('.players .pcard').length).toBe(3);
    expect(root.querySelector('.board-loading')).toBeFalsy(); // the loader goes away once the (fallback) board is up

    // bots place their houses until it is the human's turn
    const st = App.state!;
    for (let guard = 0; guard < 20 && pendingActors(st)[0] !== 0; guard++) {
      const pid = pendingActors(st)[0]!;
      act(() => { applyAction(st, botAct(st, pid)!); App.changed(); });
    }
    await tick();
    expect(root.querySelector('.banner')!.textContent).toContain('Đặt nhà của bạn');
    expect(root.querySelectorAll('.log > div').length).toBeGreaterThan(0);

    // the human places a house: players' VP and the log change, the top bar does not
    const before = snap(), logBefore = root.querySelectorAll('.log > div').length;
    const vp0 = root.querySelectorAll('.pcard .vp')[0]!.textContent;
    act(() => { App.dispatch({ type: 'placeSettlement', pid: 0, vid: legalSetupSettlements(st, 0)[0]! }); });
    const d = delta(before);
    expect(root.querySelectorAll('.log > div').length).toBe(logBefore + 1);
    expect(root.querySelectorAll('.pcard .vp')[0]!.textContent).not.toBe(vp0);
    expect(d.Log).toBe(1);
    expect(d.PlayerCard).toBe(1); // only the card of the player who built
    expect(d.TopBar ?? 0).toBe(0);
    expect(d.TurnInfo ?? 0).toBe(0);
    expect(d.Dice ?? 0).toBe(0);
    expect(root.querySelector('.banner')!.textContent).toContain('Đặt đường của bạn');

    // the road, then the in-game menu opens and Escape closes it
    act(() => { App.dispatch({ type: 'placeRoad', pid: 0, eid: legalSetupRoads(st, 0)[0]! }); });
    act(() => (document.querySelector('[title="Menu"]') as HTMLElement).click());
    expect(document.querySelector('.overlay .modal h2')!.textContent).toContain('Menu');
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(document.querySelector('.overlay')).toBeFalsy();

    // leaving unmounts the tree and the global listeners go with it
    App.onLeave!();
    App.onLeave = null;
    expect(root.childElementCount).toBe(0);
    expect(root.classList.contains('nopx')).toBe(false);
  });

  it('the toolbar follows the phase: roll button on your turn, then build buttons', async () => {
    const cfg = makeConfig(2);
    cfg.players = cfg.players.slice(0, 2);
    cfg.players[0]!.kind = 'human';
    act(() => App.startGame(cfg));
    await tick();
    const st = App.state!;
    // play the whole setup (bots decide for everybody), stop at the first roll
    act(() => {
      for (let guard = 0; guard < 40 && st.phase === 'setup'; guard++) {
        const pid = pendingActors(st)[0]!;
        applyAction(st, botAct(st, pid)!);
      }
      App.changed();
    });
    await tick();
    expect(st.phase).toBe('roll');
    if (st.current !== 0) {
      act(() => { applyAction(st, botAct(st, st.current)!); App.changed(); });
    }
    expect(root.querySelectorAll('.actionbar .rcard').length).toBe(5);
    // our turn at the roll phase (when the bot opened, play it out until it is ours)
    for (let guard = 0; guard < 60 && !(st.current === 0 && st.phase === 'roll'); guard++) {
      act(() => {
        const pid = pendingActors(st)[0]!;
        const a = botAct(st, pid);
        applyAction(st, a!);
        App.changed();
      });
    }
    await tick();
    expect(root.querySelector('.roll-btn')).toBeTruthy();
    act(() => { App.dispatch({ type: 'roll', pid: 0, power: 0 }); });
    await tick();
    expect(root.querySelector('.roll-btn')).toBeFalsy();
    expect(root.querySelector('.dice .die')).toBeTruthy();
    expect(root.querySelectorAll('.dice-sum').length).toBe(1);
  });
});
