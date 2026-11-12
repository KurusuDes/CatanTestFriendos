// What every machine is, and the widgets they share (bet button, Auto button, the cell frame).
import { toast } from '@ui/dom';
import { h, setText, rich } from './dom';

export const BG = '#0f1020';
const BETS = [5, 10, 25, 50, 100];

export const round = (n: number): number => Math.round(n * 100) / 100;
export const fmt = (n: number): string => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
export const rnd = (n: number): number => Math.floor(Math.random() * n);
export const notEnough = (): void => void toast('Không đủ tài nguyên', 'error', 1500);

/** what a machine sees of the wallet; a machine thrown away (win, bust, seat change) can't pay any more */
export interface Purse {
  dead: boolean;
  spend(n: number): boolean;
  pay(n: number): void;
  done(): void;
  money(): number;
  /** the next machine is out: this one may run on Auto */
  passed(): boolean;
}

export interface MachineCore {
  el: HTMLElement;
  busy(): boolean;
  /** how often it needs a redraw right now: 60 while something moves, a few per second for idle
   *  decorations, 0 when still (then it only redraws when marked dirty) */
  fps(now: number): number;
  sync(): void;
  settle(): void;
  dispose(): void;
  frame(now: number): void;
}
export interface Machine extends MachineCore {
  dirty: boolean;
  drawn: number;
}
export type MachineFactory = (K: Purse) => MachineCore;

// font sizes in the CSS -> sprite size (round(font * 1.15)): .adhd-note 12px, .btn.sm 13px
const NOTE_PX = 14;
const BTN_PX = 15;

export function note(first: string): HTMLDivElement {
  const el = h('div', { class: 'adhd-note nopx' });
  setText(el, first, NOTE_PX);
  return el;
}
export const say = (el: HTMLElement, s: string): void => setText(el, s, NOTE_PX);

export function betButton(get: () => number, set: (n: number) => void): HTMLButtonElement {
  const b = h('button', {
    class: 'btn sm nopx',
    title: 'Đổi mức cược',
    onclick: () => {
      set(BETS[(BETS.indexOf(get()) + 1) % BETS.length]!);
      b.textContent = fmt(get());
    },
  }, fmt(get()));
  return b;
}

interface Auto {
  on: boolean;
  /** next automatic play (ms) */
  at: number;
  el: HTMLButtonElement;
  set(v: boolean): void;
  show(v: boolean): void;
  due(now: number): boolean;
}

// Auto shows up once you've beaten the machine; it plays for you until you stop it or can't pay
export function autoButton(): Auto {
  const a: Auto = {
    on: false,
    at: 0,
    set(v) {
      a.on = v;
      a.at = 0;
      a.el.classList.toggle('pink', v);
    },
    show(v) {
      a.el.style.display = v ? '' : 'none';
      if (!v && a.on) a.set(false);
    },
    due(now) {
      return a.on && now >= a.at;
    },
    el: h('button', { class: 'btn sm', style: { display: 'none' }, onclick: () => a.set(!a.on) }, 'Tự động'),
  };
  return a;
}

export function cell(title: string, ...kids: (Node | null)[]): HTMLDivElement {
  return h('div', { class: 'adhd-cell' }, h('h4', null, title), ...kids);
}

/** a button whose label may hold emoji */
export function btnRich(cls: string, label: string, onclick: () => void): HTMLButtonElement {
  return h('button', { class: cls, onclick }, ...rich(label, BTN_PX));
}
