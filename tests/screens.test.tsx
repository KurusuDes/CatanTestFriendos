// @vitest-environment happy-dom
// Smoke tests for the Preact screens: each one renders, shows its key buttons/texts, and its main
// interactions work without exceptions. Canvas / 3D / sprite generation are stubbed (no GPU, no canvas).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('@ui/pixel.js', () => ({ pxURL: (n: string) => `sprite:${n}`, pxIcon: () => document.createElement('img'), pixelize: () => {}, autoPixelize: () => {} }));
vi.mock('@ui/screens/Diorama', () => ({ Diorama: () => <div class="menu-bg3d" /> }));
vi.mock('@board/BoardView', () => ({ BoardView: class { render() {} dispose() {} } }));
vi.mock('@ui/flag/flag', async importOriginal => ({ ...(await importOriginal<typeof import('@ui/flag/flag')>()), flagURL: () => 'flag:url' }));

import { App } from '@app/index';
import { preactScreen } from '@ui/components/mount';
import { Jit } from '@ui/components/Jit';
import { Menu } from '@ui/screens/Menu';
import { Online } from '@ui/screens/Online';
import { Lobby } from '@ui/screens/Lobby';
import { Editor, encodeMap, decodeMap } from '@ui/screens/Editor';
import { HelpModal, showHelp } from '@ui/screens/Help';

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
