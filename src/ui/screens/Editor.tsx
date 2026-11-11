// Map editor. Every hex of the board owns a signal: painting only re-renders the touched <g>
// (the per-hex update optimisation of the imperative version), the sidebar reads other signals.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { memo } from 'preact/compat';
import type { JSX } from 'preact';
import { signal, computed, type Signal } from '@preact/signals';
import { App } from '@app/index';
import { TILE_INFO } from '@engine/constants';
import { hexagon, hexCenter, hk, SHAPES } from '@engine/board';
import type { CustomMap, ShapeId, TileKind } from '@engine/types';
import { storage, toast } from '@ui/dom.js';
import { pxURL } from '@ui/pixel.js';
import { Button } from '@ui/components/Button';
import { PixelIcon, px } from '@ui/components/PixelIcon';
import { MAPS_KEY } from './Lobby';

const U = 100;
const R = 5;
const hexPts = (cx: number, cy: number, r: number): string => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 30);
  return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
}).join(' ');

type Res = TileKind | 'random';
type Brush = Res | 'erase';
interface ETile { q: number; r: number; res: Res; num: number }

const BRUSHES: Array<[Brush, string, string]> = [
  ['random', '🎲', 'Ngẫu nhiên'], ['wood', TILE_INFO.wood.icon, 'Gỗ'], ['brick', TILE_INFO.brick.icon, 'Gạch'], ['sheep', TILE_INFO.sheep.icon, 'Cừu'],
  ['wheat', TILE_INFO.wheat.icon, 'Lúa'], ['ore', TILE_INFO.ore.icon, 'Đá'], ['desert', TILE_INFO.desert.icon, 'Sa mạc'], ['gold', TILE_INFO.gold.icon, 'Vàng'],
  ['erase', '🌊', 'Biển'],
];
const NUMS = [0, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12];
const DEFAULT_NAME = 'Mi mapa';

export const encodeMap = (m: CustomMap): string => btoa(unescape(encodeURIComponent(JSON.stringify(m))));
export const decodeMap = (c: string): CustomMap => JSON.parse(decodeURIComponent(escape(atob(c.trim())))) as CustomMap;

const shapeTiles = (k: ShapeId): Array<{ q: number; r: number }> =>
  (SHAPES[k].gen as unknown as () => Array<[number, number]>)().map(([q, r]) => ({ q, r }));

const spriteHref = (emoji: string, size: number): string => pxURL(emoji.replace(/️/g, ''), size);

// ---------- one hex ----------
interface CellProps { q: number; r: number; sig: Signal<ETile | undefined>; onDown: (q: number, r: number) => void; onEnter: (q: number, r: number) => void }
const Cell = memo(function Cell({ q, r, sig, onDown, onEnter }: CellProps): JSX.Element {
  const t = sig.value;
  const c = hexCenter(q, r);
  const cx = c.x * U, cy = c.y * U;
  const events = { onPointerDown: (e: PointerEvent) => { e.preventDefault(); onDown(q, r); }, onPointerEnter: () => onEnter(q, r) };
  if (!t) return <g {...events}><polygon points={hexPts(cx, cy, U * 0.95)} class="slot" /></g>;
  const info = t.res === 'random' ? { color: '#6b7aa6', icon: '🎲' } : TILE_INFO[t.res];
  return (
    <g {...events}>
      <polygon points={hexPts(cx, cy, U * 0.96)} fill={info.color} stroke="rgba(0,0,0,.35)" stroke-width={5} style="cursor:pointer" />
      <image href={spriteHref(info.icon, 40)} x={cx - 20} y={cy - 22 - 20} width={40} height={40} style="image-rendering:pixelated;pointer-events:none" />
      {t.res !== 'desert' && (
        <>
          <circle cx={cx} cy={cy + 26} r={24} fill="#f6ecd2" stroke="#9c8a60" stroke-width={2} />
          <text x={cx} y={cy + 34} class={'token-num' + (t.num ? '' : ' q')} style={t.num === 6 || t.num === 8 ? 'fill:#d32f2f' : ''}>{t.num || '?'}</text>
        </>
      )}
    </g>
  );
});

function createStore(initial?: CustomMap) {
  const cells = new Map<string, Signal<ETile | undefined>>();
  for (const [q, r] of hexagon(R)) cells.set(hk(q, r), signal<ETile | undefined>(undefined));
  const extra = new Map<string, ETile>(); // tiles of a loaded map that fall outside the editable board
  const brush = signal<Brush>('random');
  const numBrush = signal<number | null>(null);
  const name = signal(DEFAULT_NAME);
  const count = computed(() => { let n = extra.size; for (const s of cells.values()) if (s.value) n++; return n; });
  const load = (m: { tiles: CustomMap['tiles']; name?: string }) => {
    extra.clear();
    const next = new Map<string, ETile>();
    for (const t of m.tiles) next.set(hk(t.q, t.r), { q: t.q, r: t.r, res: (t.res || 'random') as Res, num: t.num || 0 });
    for (const [k, s] of cells) s.value = next.get(k);
    for (const [k, t] of next) if (!cells.has(k)) extra.set(k, t);
    name.value = m.name || name.peek();
  };
  load(initial || { tiles: shapeTiles('classic') });
  const apply = (q: number, r: number) => {
    const sig = cells.get(hk(q, r));
    if (!sig) return;
    const nb = numBrush.peek(), b = brush.peek(), t = sig.peek();
    if (nb !== null) {
      if (t) sig.value = { ...t, num: t.res === 'desert' ? 0 : nb };
    } else if (b === 'erase') sig.value = undefined;
    else sig.value = { q, r, num: b === 'desert' ? 0 : t ? t.num : 0, res: b };
  };
  const current = (): CustomMap => {
    const all = [...[...cells.values()].map(s => s.peek()).filter((t): t is ETile => !!t), ...extra.values()];
    return { name: name.peek(), tiles: all.map(t => ({ q: t.q, r: t.r, res: t.res, num: t.num || null })) };
  };
  const clear = () => { for (const s of cells.values()) s.value = undefined; extra.clear(); };
  return { cells, brush, numBrush, name, count, load, apply, current, clear };
}

export function Editor({ arg }: { arg?: CustomMap }): JSX.Element {
  const store = useMemo(() => createStore(arg), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [saved, setSaved] = useState<CustomMap[]>(() => (storage(MAPS_KEY) as CustomMap[] | null) || []);
  const painting = useRef(false);

  useEffect(() => {
    const stop = () => { painting.current = false; };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const onDown = useRef((q: number, r: number) => { painting.current = true; store.apply(q, r); }).current;
  const onEnter = useRef((q: number, r: number) => { if (painting.current) store.apply(q, r); }).current;

  const brush = store.brush.value, numBrush = store.numBrush.value, name = store.name.value;

  function saveMap(play: boolean): void {
    const m = store.current();
    if (m.tiles.length < 7) return void toast('Bản đồ cần ít nhất 7 ô', 'error');
    const list = ((storage(MAPS_KEY) as CustomMap[] | null) || []).filter(x => x.name !== m.name);
    list.push(m);
    storage(MAPS_KEY, list);
    toast(`💾 Đã lưu "${m.name}"`, 'good');
    if (play) {
      const cfg = storage('katanittes.lastConfig') as { map: Record<string, unknown> } | null;
      if (cfg) {
        cfg.map.shape = 'custom';
        cfg.map.custom = m;
        storage('katanittes.lastConfig', cfg);
      } else storage('katanittes.lastConfig', { map: { shape: 'custom', custom: m } });
      App.go('lobby');
    } else setSaved(list);
  }

  async function exportCode(): Promise<void> {
    const code = encodeMap(store.current());
    try {
      await navigator.clipboard.writeText(code);
      toast('📋 Đã sao chép mã. Gửi cho bạn bè đi!', 'good');
    } catch {
      prompt('Sao chép mã này:', code);
    }
  }
  function importCode(): void {
    const code = prompt('Dán mã bản đồ:');
    if (!code) return;
    try {
      store.load(decodeMap(code));
      toast('✅ Đã nhập bản đồ', 'good');
    } catch {
      toast('Mã không hợp lệ', 'error');
    }
  }

  return (
    <div class="editor screen">
      <div class="editor-side">
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
          <Button sm onClick={() => App.go('menu')}>← Menu</Button>
          <h2 style={{ fontSize: '22px' }}>{px('✏️ Tạo bản đồ', 25)}</h2>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: 0 }}>Tô các ô (có thể kéo chuột). Ô "Ngẫu nhiên" sẽ được điền cân bằng khi vào ván. Số "?" cũng vậy.</p>
        <div class="section-label">Địa hình</div>
        <div class="brushes">
          {BRUSHES.map(([k, ic, label]) => (
            <button key={k} class={'brush' + (numBrush === null && brush === k ? ' on' : '')} onClick={() => { store.brush.value = k; store.numBrush.value = null; }}>
              <PixelIcon emoji={ic} size={25} /><small>{label}</small>
            </button>
          ))}
        </div>
        <div class="section-label">Số</div>
        <div class="brushes">
          {NUMS.map(n => (
            <button key={n} class={'brush' + (numBrush === n ? ' on' : '')} style={{ fontSize: '18px', fontWeight: 900, color: n === 6 || n === 8 ? '#ff6b6b' : '' }} onClick={() => { store.numBrush.value = n; }}>
              {n || '?'}<small>{n ? '' : 'tự động'}</small>
            </button>
          ))}
        </div>
        <div class="section-label">{`Số ô: ${store.count.value}`}</div>
        <div class="chips">
          <Button sm onClick={() => store.clear()}>{px('🧹 Xóa trắng', 15)}</Button>
          {(['classic', 'extended', 'ring', 'star'] as const).map(k => <Button key={k} sm onClick={() => store.load({ name, tiles: shapeTiles(k) })}>{SHAPES[k].name}</Button>)}
        </div>
        <div class="section-label">Tên</div>
        <input type="text" value={name} maxLength={24} onBlur={e => { store.name.value = e.currentTarget.value.trim() || DEFAULT_NAME; }} />
        <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
          <Button variant="primary" onClick={() => saveMap(true)}>{px('▶️ Lưu và chơi', 20)}</Button>
          <Button onClick={() => saveMap(false)}>{px('💾 Lưu', 20)}</Button>
          <Button onClick={() => void exportCode()}>{px('📤 Xuất mã', 20)}</Button>
          <Button onClick={importCode}>{px('📥 Nhập mã', 20)}</Button>
        </div>
        {saved.length > 0 && (
          <div>
            <div class="section-label">Bản đồ của tôi</div>
            {saved.map((m, i) => (
              <div key={(m.name || "") + i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <Button sm style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => store.load(m)}>{px(`✏️ ${m.name || ""} (${m.tiles.length})`, 20)}</Button>
                <Button sm variant="ghost" title="Xóa" onClick={() => {
                  if (!confirm(`Xóa "${m.name}"?`)) return;
                  const next = saved.filter((_, j) => j !== i);
                  storage(MAPS_KEY, next);
                  setSaved(next);
                }}>{px('🗑️', 20)}</Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <section class="board-wrap">
        <svg class="board-svg" viewBox={`${-9.3 * U} ${-8.3 * U} ${18.6 * U} ${16.6 * U}`}>
          {hexagon(R).map(([q, r]) => <Cell key={hk(q, r)} q={q} r={r} sig={store.cells.get(hk(q, r))!} onDown={onDown} onEnter={onEnter} />)}
        </svg>
      </section>
    </div>
  );
}
