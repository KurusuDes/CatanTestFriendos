// Translation helper. Spanish is the source language (see js/i18n.js).
//   node tools/i18n.mjs keys          -> every Spanish text to translate, as JSON
//   node tools/i18n.mjs check         -> per language: missing keys, unused keys, broken {placeholders}
//   node tools/i18n.mjs missing <lang> -> the keys a language still lacks, as JSON
// It finds texts in t('...'), tk('...') and, in the engine, msg('...'), log(s, '...'), fail('...'),
// plus the name/desc fields of the engine data (modes, presets, cards, events, map shapes).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
const LANGS = ['en', 'pt', 'fr', 'de', 'it'];
const STR = String.raw`('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\x60(?:\\.|[^\x60\\])*\x60)`;
const CALLS = [new RegExp(String.raw`\b(?:t|tk|msg|fail)\(\s*` + STR, 'g'), new RegExp(String.raw`\blog\(\s*s\s*,\s*` + STR, 'g')];
const DATA = new RegExp(String.raw`\b(?:name|desc)\s*:\s*` + STR, 'g');
const DATA_FILES = ['engine/constants.js', 'engine/config.js', 'engine/board.js'];

const files = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'i18n' ? [] : files(p);
  return e.name.endsWith('.js') ? [p] : [];
});
const unquote = lit => Function(`return ${lit}`)();

export function extract() {
  const keys = new Set(), warn = [];
  for (const f of files(JS)) {
    const src = fs.readFileSync(f, 'utf8'), rel = path.relative(JS, f).replace(/\\/g, '/');
    const res = [...CALLS, ...(DATA_FILES.includes(rel) ? [DATA] : [])];
    for (const re of res) for (const m of src.matchAll(re)) {
      if (m[1].startsWith('`') && m[1].includes('${')) {
        warn.push(`${rel}: template with \${} used as a key: ${m[1].slice(0, 60)}`);
        continue;
      }
      const s = unquote(m[1]);
      if (/\p{L}/u.test(s)) keys.add(s);
    }
  }
  return { keys: [...keys].sort(), warn };
}

const holes = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const dict = async l => (await import(pathToFileURL(path.join(JS, 'i18n', `${l}.js`)).href + `?${Date.now()}`)).default;

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'keys') {
  const { keys, warn } = extract();
  warn.forEach(w => console.error('⚠️', w));
  console.log(JSON.stringify(keys, null, 1));
} else if (cmd === 'missing') {
  const { keys } = extract(), d = await dict(arg);
  console.log(JSON.stringify(keys.filter(k => !(k in d)), null, 1));
} else if (cmd === 'check') {
  const { keys, warn } = extract();
  warn.forEach(w => console.log('⚠️', w));
  console.log(`${keys.length} texts`);
  let bad = 0;
  for (const l of LANGS) {
    const d = await dict(l), set = new Set(keys);
    const missing = keys.filter(k => !(k in d)), unused = Object.keys(d).filter(k => !set.has(k));
    const broken = keys.filter(k => k in d && holes(k) !== holes(d[k]));
    console.log(`${l}: ${keys.length - missing.length}/${keys.length}${missing.length ? `, ${missing.length} missing` : ''}${unused.length ? `, ${unused.length} unused` : ''}${broken.length ? `, ${broken.length} with wrong {placeholders}` : ''}`);
    for (const k of broken) console.log('   placeholders:', JSON.stringify(k), '→', JSON.stringify(d[k]));
    bad += missing.length + broken.length;
  }
  process.exitCode = bad ? 1 : 0;
}
