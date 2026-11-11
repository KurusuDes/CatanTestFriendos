// Tiny typed DOM helpers for the imperative parts of the ADHD window (machines draw on canvases and
// keep a few buttons / notes; Preact owns the frame around them).
import { pxIcon } from '@ui/pixel.js';

export type Kid = Node | string | number | null | false | undefined | Kid[];
export type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props)
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v as Record<string, string>)) el.style.setProperty(p, x);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  for (const c of kids.flat(Infinity as 1) as Exclude<Kid, Kid[]>[]) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'object' ? c : String(c));
  }
  return el;
}

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[⭐✨])/gu;

/** "x10 🌕" -> text nodes + pixel sprites (this window is .nopx: nothing else turns emoji into sprites) */
export function rich(s: string, size: number): (Node | string)[] {
  return s
    .split(EMOJI)
    .map((part, i) => (i % 2 === 1 ? pxIcon(part.replace(/️/g, ''), size, part) : part))
    .filter(p => p !== '');
}

/** set an element's text, emoji as sprites. Plain text takes the fast path. */
export function setText(el: HTMLElement, s: string, size: number): void {
  if (!/\p{Extended_Pictographic}|[⭐✨]/u.test(s)) el.textContent = s;
  else el.replaceChildren(...rich(s, size));
}
