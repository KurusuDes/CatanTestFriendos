import { TILE_INFO } from '../engine/constants.js';

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

// Re-render `el` only when its markup really changed. Rebuilding identical DOM on every state
// update (bots move several times a second) swaps the button under the finger between press and
// release, so clicks get lost, and it resets scroll and hover. The signature is taken from the
// fresh markup because the live one gets emojis swapped for pixel sprites afterwards.
export function sync(el, ...children) {
  const next = h('div', null, ...children);
  const sig = next.innerHTML;
  if (sig === el._sig && el.firstChild) return false;
  const scrolls = [...el.querySelectorAll('[data-keep-scroll], .modal')].map(x => x.scrollTop);
  el._sig = sig;
  clear(el).append(...next.childNodes);
  [...el.querySelectorAll('[data-keep-scroll], .modal')].forEach((x, i) => scrolls[i] && (x.scrollTop = scrolls[i]));
  return true;
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
  const t = h('div', { class: 'toast ' + kind }, typeof msg === 'string' ? msg : msg);
  toastBox.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
}
