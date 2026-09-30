// Shared helpers for the showcase and the trailer: easing, pixel-snapped transforms, animated
// titles and bot games. Every animation is a pure function of the scene's local time.
import { h } from '../js/ui/dom.js';
import { applyAction, pendingActors } from '../js/engine/game.js';
import { botAct } from '../js/engine/bot.js';
import { defaultConfig, PLAYER_COLORS, BOT_NAMES } from '../js/engine/config.js';

// ---------- easing ----------
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const P = (t, s, d) => clamp((t - s) / d);
export const eOut = x => 1 - Math.pow(1 - x, 3);
export const eIn = x => x * x * x;
export const eInOut = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const eBack = x => { const c1 = 1.9, c3 = c1 + 1; return x <= 0 ? 0 : x >= 1 ? 1 : 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
export const lerp = (a, b, x) => a + (b - a) * x;
export const step = (x, n) => Math.round(x * n) / n; // chunky, pixel-like motion
export const tf = (el, x = 0, y = 0, s = 1, r = 0, o) => {
  el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px) scale(${s}) rotate(${r}deg)`;
  if (o !== undefined) el.style.opacity = o;
};

// ---------- bot games ----------
export function botConfig(shape, seed, extra) {
  const c = defaultConfig();
  c.seed = seed;
  c.rules.randomStart = false;
  c.players = [0, 1, 2, 3].map(i => ({ name: BOT_NAMES[i], kind: 'bot', level: ['hard', 'normal', 'normal', 'easy'][i], color: PLAYER_COLORS[i] }));
  c.map.shape = shape;
  c.map.size = 26;
  if (extra) extra(c);
  return c;
}
export const step1 = st => {
  const a = pendingActors(st).map(p => botAct(st, p)).find(Boolean);
  if (a) applyAction(st, a);
  return a;
};
export const clone = st => JSON.parse(JSON.stringify(st));

// kicker + title whose letters pop in and "boil" + subtitle; returns update(lt, dur)
export function makeTitle(root, kicker, text, sub) {
  const k = h('div', { class: 'sc-kicker' }, kicker);
  const t = h('div', { class: 'sc-title' }, [...text].map(ch => h('span', null, ch === ' ' ? ' ' : ch)));
  const sb = sub ? h('div', { class: 'sc-sub' }, sub) : null;
  root.append(k, t, sb || '');
  return (lt, dur) => {
    const out = eIn(P(lt, dur - 420, 380));
    [...t.children].forEach((sp, i) => {
      const p = eBack(P(lt, 60 + i * 24, 420));
      const j = Math.floor(lt / 120 + i * 3) % 4; // pixel "boil"
      const jx = [0, 1, -1, 0][j], jy = [0, -1, 0, 1][j];
      sp.style.transform = `translate(${jx}px,${Math.round((1 - p) * 70 - out * 40) + jy}px)`;
      sp.style.opacity = P(lt, 60 + i * 24, 120) * (1 - out);
    });
    k.style.opacity = P(lt, 0, 250) * (1 - out);
    tf(k, (1 - eOut(P(lt, 0, 400))) * -50);
    if (sb) tf(sb, 0, (1 - eOut(P(lt, 400, 450))) * 20, 1, 0, P(lt, 400, 350) * (1 - out));
  };
}

// The map's number and port labels step aside for the video: a label is hidden when it sits in
// the left text column or touches anything a scene has on screen (titles, stamps, cards...).
export function clearLabels(labelsEl, roots, pad = 8) {
  const boxes = [];
  for (const root of roots)
    for (const el of root.children) {
      if (el.classList.contains('layer')) {
        for (const c of el.children) boxes.push(c);
        continue;
      }
      boxes.push(el);
    }
  const rects = boxes.filter(el => parseFloat(el.style.opacity || '1') > 0.05).map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
  const stage = labelsEl.closest('#stage').getBoundingClientRect();
  const k = stage.width / 1280;
  for (const el of labelsEl.children) {
    el.style.visibility = '';
    const r = el.getBoundingClientRect();
    const left = (r.left + r.width / 2 - stage.left) / k < 600;
    const hit = rects.some(b => r.right + pad > b.left && r.left - pad < b.right && r.bottom + pad > b.top && r.top - pad < b.bottom);
    if (left || hit) el.style.visibility = 'hidden';
  }
}
