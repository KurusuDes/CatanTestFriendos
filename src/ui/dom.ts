import { TILE_INFO } from '@engine/constants';
import type { TileKind } from '@engine/types';
import { pixelize } from '@ui/pixel';

type Props = Record<string, unknown>;
type Child = Node | string | number | boolean | null | undefined | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement;
export function h(tag: string, props?: Props | null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): SVGElementTagNameMap[K];
export function s(tag: string, props?: Props | null, ...children: Child[]): SVGElement;
export function s(tag: string, props?: Props | null, ...children: Child[]): SVGElement {
  const el = document.createElementNS(NS, tag);
  setProps(el, props);
  append(el, children);
  return el;
}

function setProps(el: Element, props?: Props | null): void {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    // custom properties (--pc...) only take effect through setProperty, not assignment
    else if (k === 'style' && typeof v === 'object') {
      const style = (el as HTMLElement).style;
      for (const [p, x] of Object.entries(v as Record<string, string>)) p.startsWith('--') ? style.setProperty(p, x) : ((style as unknown as Record<string, string>)[p] = x);
    } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Child[]): void {
  for (const c of children.flat(Infinity as 1) as Exclude<Child, Child[]>[]) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}


export function clear<E extends Node>(el: E): E {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// "@2 roba :wood:" -> colored name + emoji
export function rich(msg: string, players: ReadonlyArray<{ name: string; color: string }>): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /@(\d+)|:(wood|brick|sheep|wheat|ore):/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(msg))) {
    if (m.index > last) frag.append(msg.slice(last, m.index));
    if (m[1] != null) {
      const p = players[+m[1]!];
      frag.append(h('b', { class: 'pname', style: { '--pc': p ? p.color : '#fff' } }, p ? p.name : '?'));
    } else {
      const info = TILE_INFO[m[2] as TileKind];
      frag.append(h('span', { class: 'ico', title: info.name }, info.icon));
    }
    last = re.lastIndex;
  }
  if (last < msg.length) frag.append(msg.slice(last));
  return frag;
}

let toastBox: HTMLElement | undefined;
export function toast(msg: Child, kind = 'info', ms = 2600): void {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastBox.append(t);
  pixelize(t); // no body-wide observer: this element swaps its own emojis for sprites
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// Old saves: the game used to save under 'kchudites.*', and later in several languages with the
// bots named in Spanish. Once: move everything to 'katanittes.*', give the old bots their
// Vietnamese names, drop the language choice, and drop saved games whose history is still in the
// old translatable format ({ t, p } messages), which the game no longer reads.
const OLD_BOTS: Record<string, string> = {
  Kchudo: 'Cô Tiều', 'La Kchuda': 'Ngài Gạch', Chuchito: 'Ông Ngân Hàng',
  Leñadora: 'Cô Tiều', 'Sir Ladrillo': 'Ngài Gạch', 'El Banquero': 'Ông Ngân Hàng', 'Don Trigo': 'Chú Lúa',
  Ovejita: 'Bé Cừu', Mineralman: 'Người Đá', 'Doña Arcilla': 'Bà Đất Sét', Ladronzuelo: 'Trộm Vặt', Tú: 'Bạn',
};
(function migrateStorage() {
  for (const box of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[box as 'localStorage' | 'sessionStorage'];
      if (s.getItem('katanittes.vi')) continue;
      for (const k of Object.keys(s)) {
        if (!k.startsWith('kchudites.') && !k.startsWith('katanittes.')) continue;
        const nk = 'katanittes.' + k.replace(/^\w+\./, '');
        let v: string | null = s.getItem(k) ?? '';
        if (nk === 'katanittes.lang' || v.includes('"msg":{"t":')) v = null;
        else for (const [a, b] of Object.entries(OLD_BOTS)) v = v.split(`"${a}"`).join(`"${b}"`);
        if (k !== nk) s.removeItem(k);
        if (v == null) s.removeItem(nk);
        else if (k === nk || s.getItem(nk) == null) s.setItem(nk, v);
      }
      s.setItem('katanittes.vi', '1');
    } catch {}
  }
})();

// Persisted JSON: callers validate what they read, so the result is typed by the caller (default any).
export function storage<T = any>(key: string, value?: T | null): T | null {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return null;
  } catch {
    return null;
  }
}
