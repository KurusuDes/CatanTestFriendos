import { TILE_INFO } from '@engine/constants';
import { pixelize } from './pixel.js';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  setProps(el, props);
  append(el, children);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function s(tag, props, ...children) {
  const el = document.createElementNS(NS, tag);
  setProps(el, props);
  append(el, children);
  return el;
}

function setProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    // custom properties (--pc...) only take effect through setProperty, not assignment
    else if (k === 'style' && typeof v === 'object') for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// "@2 roba :wood:" -> colored name + emoji
export function rich(msg, players) {
  const frag = document.createDocumentFragment();
  const re = /@(\d+)|:(wood|brick|sheep|wheat|ore):/g;
  let last = 0, m;
  while ((m = re.exec(msg))) {
    if (m.index > last) frag.append(msg.slice(last, m.index));
    if (m[1] != null) {
      const p = players[+m[1]];
      frag.append(h('b', { class: 'pname', style: { '--pc': p ? p.color : '#fff' } }, p ? p.name : '?'));
    } else frag.append(h('span', { class: 'ico', title: TILE_INFO[m[2]].name }, TILE_INFO[m[2]].icon));
    last = re.lastIndex;
  }
  if (last < msg.length) frag.append(msg.slice(last));
  return frag;
}

let toastBox;
export function toast(msg, kind = 'info', ms = 2600) {
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
const OLD_BOTS = {
  Kchudo: 'Cô Tiều', 'La Kchuda': 'Ngài Gạch', Chuchito: 'Ông Ngân Hàng',
  Leñadora: 'Cô Tiều', 'Sir Ladrillo': 'Ngài Gạch', 'El Banquero': 'Ông Ngân Hàng', 'Don Trigo': 'Chú Lúa',
  Ovejita: 'Bé Cừu', Mineralman: 'Người Đá', 'Doña Arcilla': 'Bà Đất Sét', Ladronzuelo: 'Trộm Vặt', Tú: 'Bạn',
};
(function migrateStorage() {
  for (const box of ['localStorage', 'sessionStorage']) {
    try {
      const s = window[box];
      if (s.getItem('katanittes.vi')) continue;
      for (const k of Object.keys(s)) {
        if (!k.startsWith('kchudites.') && !k.startsWith('katanittes.')) continue;
        const nk = 'katanittes.' + k.replace(/^\w+\./, '');
        let v = s.getItem(k);
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

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}
