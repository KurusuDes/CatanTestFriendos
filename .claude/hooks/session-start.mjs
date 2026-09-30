// SessionStart hook: puts the vault's Active Context and the open tasks into Claude's context,
// so every session starts knowing where we left off.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const vault = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'CatanVault');
const read = f => { try { return readFileSync(join(vault, f), 'utf8'); } catch { return null; } };

const ctx = read('01 - Active Context.md');
if (ctx) console.log(`===== 01 - ACTIVE CONTEXT (hook SessionStart) =====\n${ctx.trim()}\n`);
const tasks = read('02 - Tareas.md');
if (tasks) {
  const open = tasks.split(/\r?\n/).filter(l => /^\s*- \[ \]/.test(l));
  console.log(`===== TAREAS ABIERTAS (${open.length}) =====\n${open.join('\n') || '(ninguna)'}`);
}
