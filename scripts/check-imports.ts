// Kiểm tra quy ước import: engine không được import app/ui/net/board/workers, và không có vòng import tĩnh.
// Chạy: pnpm check:imports (cũng chạy trong pnpm test qua tests/imports.test.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ALIASES: Record<string, string> = {
  '@engine': 'src/engine', '@app': 'src/app', '@net': 'src/net', '@board': 'src/board', '@ui': 'src/ui', '@workers': 'src/workers',
};
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else {
    const alias = Object.keys(ALIASES).find(a => spec === a || spec.startsWith(a + '/'));
    if (!alias) return null; // gói npm
    base = join(ROOT, ALIASES[alias]!, spec.slice(alias.length));
  }
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  return null;
}

export interface ImportEdge { from: string; to: string; typeOnly: boolean; dynamic: boolean }

export function collectEdges(): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const spec = m[2] ?? m[3]!;
      const to = resolveSpec(file, spec);
      if (to) edges.push({ from: file, to, typeOnly: !!m[1], dynamic: m[3] !== undefined });
    }
  }
  return edges;
}

export function findProblems(): { layer: string[]; cycles: string[][] } {
  const edges = collectEdges();
  const rel = (f: string) => relative(ROOT, f);
  const layer: string[] = [];
  for (const e of edges) {
    if (rel(e.from).startsWith('src/engine/') && /^src\/(app|ui|net|board|workers)\//.test(rel(e.to))) layer.push(`${rel(e.from)} -> ${rel(e.to)}`);
  }
  // vòng import: chỉ tính import tĩnh không phải `import type` (đã bị xoá khi build)
  const graph = new Map<string, string[]>();
  for (const e of edges) {
    if (e.typeOnly || e.dynamic) continue;
    const list = graph.get(e.from) ?? [];
    list.push(e.to);
    graph.set(e.from, list);
  }
  const cycles: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const dfs = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (state.get(m) === 1) {
        const cyc = stack.slice(stack.indexOf(m)).map(rel);
        const key = [...cyc].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cyc, rel(m)]);
        }
      } else if (!state.has(m)) dfs(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) dfs(n);
  return { layer, cycles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { layer, cycles } = findProblems();
  for (const l of layer) console.error('engine import sai tầng:', l);
  for (const c of cycles) console.error('vòng import:', c.join(' -> '));
  if (layer.length || cycles.length) process.exit(1);
  console.log('Import ổn: engine độc lập, không có vòng import tĩnh.');
}
