// Translations. Spanish is the source language: every text is written in Spanish in the code,
// and t() looks it up in the chosen language's dictionary (js/i18n/<lang>.js), falling back to
// the Spanish. Texts with variable parts use {placeholders}: t('Turno de {name}', { name }).
// The engine stores its messages (history, errors) as { t, p } so every client shows them in
// its own language, online included.
import en from './i18n/en.js';
import pt from './i18n/pt.js';
import fr from './i18n/fr.js';
import de from './i18n/de.js';
import it from './i18n/it.js';

export const LANGS = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
  { id: 'pt', name: 'Português' },
  { id: 'fr', name: 'Français' },
  { id: 'de', name: 'Deutsch' },
  { id: 'it', name: 'Italiano' },
];
const DICTS = { es: {}, en, pt, fr, de, it };
const KEY = 'katanittes.lang';

// the saved choice, else the browser's language, else English (Spanish when there is no browser: tests)
function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (DICTS[saved]) return saved;
  } catch {}
  const nav = globalThis.navigator;
  if (!nav || !globalThis.document) return 'es';
  for (const l of nav.languages || [nav.language]) {
    const id = String(l || '').slice(0, 2).toLowerCase();
    if (DICTS[id]) return id;
  }
  return 'en';
}

export let lang = detect();
if (globalThis.document) document.documentElement.lang = lang;

export function setLang(id) {
  if (!DICTS[id]) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {}
  lang = id;
}

// values are put in as they are (player names stay untouched); a value that is itself an engine
// message ({ t, p }) is translated
export function t(s, p) {
  if (s == null) return '';
  let out = DICTS[lang][s] || s;
  if (p) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in p ? (p[k] && p[k].t ? tx(p[k]) : p[k]) : m));
  return out;
}

// marks a text kept in a module-level constant so the extractor finds it; translate it with t() when shown
export const tk = s => s;

// a message from the engine: a plain Spanish string or { t: template, p: values }. Its text values
// are engine words (an event or card name) and get translated too.
export function tx(m) {
  if (!m || typeof m !== 'object') return t(m);
  const p = {};
  for (const k in m.p || {}) p[k] = typeof m.p[k] === 'string' ? t(m.p[k]) : m.p[k];
  return t(m.t, p);
}
