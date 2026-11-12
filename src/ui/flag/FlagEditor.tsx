// Kingdom flag editor: a Gartic-Phone-like paint modal (pencil, eraser, bucket, line, rectangle,
// ellipse, sizes, palette, undo/redo) plus the castle colour. The canvas drawing stays imperative.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button } from '@ui/components/Button';
import { Modal, openModal } from '@ui/components/Modal';
import { Emo, PixelIcon } from '@ui/components/PixelIcon';
import { FLAG_H, FLAG_W, drawGrid, hexToRgb, isGrid, loadImage, nearestPal, patternFlag, validFlag } from './flag';

const EDIT_W = 300, EDIT_H = 200; // drawing resolution
// Gartic-like palette
const PAINT = ['#000000', '#666666', '#b2b2b2', '#ffffff', '#7a1f1f', '#e53935', '#ff7a00', '#ffd400', '#fff3a3', '#1b5e20',
  '#43a047', '#9be15d', '#0d2c6c', '#1e88e5', '#4fc3f7', '#6a1b9a', '#ba68c8', '#ff80ab', '#6d4c41', '#f1c8a0'];
const SIZES = [2, 5, 10, 20, 36];
const CASTLE_PRESETS = ['#e53935', '#1e88e5', '#ff9800', '#f5f5f5', '#43a047', '#8e24aa', '#00acc1', '#795548', '#fdd835', '#ec407a', '#26a69a', '#5d4037'];

type Tool = 'pen' | 'eraser' | 'fill' | 'line' | 'rect' | 'ellipse';
const TOOLS: Array<[Tool, string, string]> = [
  ['pen', '✏️', 'Bút chì'], ['eraser', '🧽', 'Tẩy'], ['fill', '🪣', 'Đổ màu'], ['line', '📏', 'Đường thẳng'], ['rect', '⬛', 'Hình chữ nhật'], ['ellipse', '⚫', 'Hình tròn'],
];
type Pt = [number, number];

interface FlagEditorOptions {
  flag?: string | null;
  color?: string;
  name?: string;
  title?: string;
  onSave?: (r: { flag: string; color: string }) => void;
}

function FlagEditor({ flag, color, name, title = 'Vương quốc của bạn', onSave, onClose }: FlagEditorOptions & { onClose: () => void }): JSX.Element {
  const [col, setCol] = useState(color || '#e53935');
  const [ink, setInk] = useState('#000000');
  const [size, setSize] = useState(SIZES[2]!);
  const [tool, setTool] = useState<Tool>('pen');
  const [preview, setPreview] = useState('');
  const [, setRev] = useState(0); // undo/redo availability
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const seed = useRef(0);
  const drag = useRef<{ start: Pt; last: Pt } | null>(null);
  // the pointer handlers read the latest tool/ink/size through this ref
  const cur = useRef({ tool, ink, size });
  cur.current = { tool, ink, size };

  const ctx = () => canvasRef.current!.getContext('2d', { willReadFrequently: true })!;
  const drawPreview = () => setPreview(canvasRef.current!.toDataURL());
  const bump = () => setRev(n => n + 1);

  useEffect(() => {
    const g = ctx();
    const gg = ghostRef.current!.getContext('2d')!;
    g.lineCap = g.lineJoin = gg.lineCap = gg.lineJoin = 'round';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, EDIT_W, EDIT_H);
    const f = flag && validFlag(flag) ? flag : patternFlag(col, 0);
    let live = true;
    if (isGrid(f)) {
      drawGrid(g, f, EDIT_W, EDIT_H);
      drawPreview();
    } else {
      drawPreview();
      void loadImage(f).then(im => {
        if (!im || !live) return;
        g.drawImage(im, 0, 0, EDIT_W, EDIT_H);
        drawPreview();
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshot = () => {
    undo.current.push(ctx().getImageData(0, 0, EDIT_W, EDIT_H));
    if (undo.current.length > 40) undo.current.shift();
    redo.current.length = 0;
    bump();
  };

  const pos = (e: PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * EDIT_W, ((e.clientY - r.top) / r.height) * EDIT_H];
  };

  function fill(x0: number, y0: number) {
    const g = ctx();
    const x = Math.floor(x0), y = Math.floor(y0);
    if (x < 0 || y < 0 || x >= EDIT_W || y >= EDIT_H) return;
    const img = g.getImageData(0, 0, EDIT_W, EDIT_H);
    const d = img.data;
    const at = (x + y * EDIT_W) * 4;
    const [tr, tg, tb] = [d[at]!, d[at + 1]!, d[at + 2]!];
    const [nr = 0, ng = 0, nb = 0] = hexToRgb(cur.current.ink);
    if (Math.abs(tr - nr) + Math.abs(tg - ng) + Math.abs(tb - nb) < 6) return;
    const same = (i: number) => Math.abs(d[i]! - tr) + Math.abs(d[i + 1]! - tg) + Math.abs(d[i + 2]! - tb) < 90;
    const stack = [x + y * EDIT_W];
    const seen = new Uint8Array(EDIT_W * EDIT_H);
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      const i = p * 4;
      if (!same(i)) continue;
      d[i] = nr;
      d[i + 1] = ng;
      d[i + 2] = nb;
      d[i + 3] = 255;
      const px = p % EDIT_W;
      if (px > 0) stack.push(p - 1);
      if (px < EDIT_W - 1) stack.push(p + 1);
      if (p >= EDIT_W) stack.push(p - EDIT_W);
      if (p < EDIT_W * (EDIT_H - 1)) stack.push(p + EDIT_W);
    }
    g.putImageData(img, 0, 0);
  }

  function shape(c: CanvasRenderingContext2D, [x0, y0]: Pt, [x1, y1]: Pt) {
    const { tool: t, ink: k, size: s } = cur.current;
    c.strokeStyle = c.fillStyle = k;
    c.lineWidth = s;
    c.beginPath();
    if (t === 'line') {
      c.moveTo(x0, y0);
      c.lineTo(x1, y1);
      c.stroke();
    } else if (t === 'rect') {
      c.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else if (t === 'ellipse') {
      c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  const strokeStyle = () => (cur.current.tool === 'eraser' ? '#ffffff' : cur.current.ink);

  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    snapshot();
    if (cur.current.tool === 'fill') {
      fill(...p);
      drawPreview();
      return;
    }
    drag.current = { start: p, last: p };
    if (cur.current.tool === 'pen' || cur.current.tool === 'eraser') {
      const g = ctx();
      g.strokeStyle = g.fillStyle = strokeStyle();
      g.lineWidth = cur.current.size;
      g.beginPath();
      g.arc(p[0], p[1], cur.current.size / 2, 0, Math.PI * 2);
      g.fill();
    }
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = pos(e);
    if (cur.current.tool === 'pen' || cur.current.tool === 'eraser') {
      const g = ctx();
      g.strokeStyle = strokeStyle();
      g.lineWidth = cur.current.size;
      g.beginPath();
      g.moveTo(...d.last);
      g.lineTo(...p);
      g.stroke();
      d.last = p;
    } else {
      const gg = ghostRef.current!.getContext('2d')!;
      gg.clearRect(0, 0, EDIT_W, EDIT_H);
      shape(gg, d.start, p);
    }
  };
  const onEnd = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!['pen', 'eraser'].includes(cur.current.tool)) {
      ghostRef.current!.getContext('2d')!.clearRect(0, 0, EDIT_W, EDIT_H);
      shape(ctx(), d.start, pos(e));
    }
    drag.current = null;
    drawPreview();
  };

  const exportFlag = (): string => {
    const c = document.createElement('canvas');
    c.width = FLAG_W;
    c.height = FLAG_H;
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(canvasRef.current!, 0, 0, FLAG_W, FLAG_H);
    return c.toDataURL('image/png');
  };

  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(ctx().getImageData(0, 0, EDIT_W, EDIT_H));
    ctx().putImageData(prev, 0, 0);
    drawPreview();
    bump();
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ctx().getImageData(0, 0, EDIT_W, EDIT_H));
    ctx().putImageData(next, 0, 0);
    drawPreview();
    bump();
  };
  const clearAll = () => {
    snapshot();
    const g = ctx();
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, EDIT_W, EDIT_H);
    drawPreview();
  };
  const pattern = () => {
    snapshot();
    seed.current++;
    drawGrid(ctx(), patternFlag(col, seed.current, nearestPal(ink) === nearestPal(col) ? 12 : nearestPal(ink)), EDIT_W, EDIT_H);
    drawPreview();
  };

  const eraser = tool === 'eraser';
  return (
    <Modal onClose={onClose} class="flag-modal">
      <h2><Emo size={28}>{`🏰 ${title}${name ? ': ' + name : ''}`}</Emo></h2>
      <div class="paint">
        <div class="paint-tools">
          {TOOLS.map(([k, ic, label]) => (
            <button key={k} class={'ptool' + (tool === k ? ' on' : '')} title={label} onClick={() => setTool(k)}><PixelIcon emoji={ic} size={25} /></button>
          ))}
          <div class="psep" />
          <button class="ptool" title="Hoàn tác" disabled={!undo.current.length} onClick={doUndo}>↶</button>
          <button class="ptool" title="Làm lại" disabled={!redo.current.length} onClick={doRedo}>↷</button>
        </div>
        <div class="paint-stage">
          <canvas ref={canvasRef} width={EDIT_W} height={EDIT_H} class="paint-canvas" style={{ cursor: tool === 'fill' ? 'cell' : 'crosshair' }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onEnd} onPointerCancel={onEnd} />
          <canvas ref={ghostRef} width={EDIT_W} height={EDIT_H} class="paint-ghost" />
        </div>
        <div class="paint-pal">
          <div class="pcur" style={{ background: ink }} title="Màu hiện tại" />
          <div class="pgrid">
            {PAINT.map(c => (
              <button key={c} class={'pcol' + (c === ink ? ' on' : '')} style={{ background: c }} onClick={() => { setInk(c); if (tool === 'eraser') setTool('pen'); }} />
            ))}
          </div>
          <input type="color" value={ink} class="paint-custom" title="Màu khác" onInput={e => setInk(e.currentTarget.value)} />
        </div>
      </div>
      <div class="paint-sizes">
        {SIZES.map(s => (
          <button key={s} class={'psize' + (s === size ? ' on' : '')} title={s + 'px'} onClick={() => setSize(s)}>
            <i style={{ width: Math.max(4, s * 0.8) + 'px', height: Math.max(4, s * 0.8) + 'px', background: eraser ? '#fff' : ink }} />
          </button>
        ))}
        <div class="psep" />
        <Button sm onClick={clearAll}><Emo size={15}>🗑️ Xóa hết</Emo></Button>
        <Button sm onClick={pattern}><Emo size={15}>🎲 Mẫu có sẵn</Emo></Button>
      </div>
      <div class="flag-bottom">
        <div>
          <div class="section-label">Màu lâu đài của bạn</div>
          <div class="chips">
            {CASTLE_PRESETS.map(p => <button key={p} class="sw big" style={{ background: p }} onClick={() => setCol(p)} />)}
            <input type="color" value={col} class="castle-color" title="Màu khác" onInput={e => setCol(e.currentTarget.value)} />
          </div>
        </div>
        <div>
          <div class="section-label">Xem trước</div>
          <div class="flag-preview">
            <svg viewBox="0 0 130 118" width="168" height="152">
              <rect x="18" y="62" width="84" height="42" fill="#b7ae9c" stroke="#1a1c2c" stroke-width="3" />
              <rect x="40" y="40" width="40" height="64" fill="#c9c0ae" stroke="#1a1c2c" stroke-width="3" />
              <polygon points="36,42 60,18 84,42" fill={col} stroke="#1a1c2c" stroke-width="3" />
              <polygon points="14,64 30,48 46,64" fill={col} stroke="#1a1c2c" stroke-width="3" />
              <polygon points="74,64 90,48 106,64" fill={col} stroke="#1a1c2c" stroke-width="3" />
              <rect x="52" y="84" width="16" height="20" fill="#5b3e2b" />
              <line x1="60" y1="18" x2="60" y2="0" stroke="#5b3e2b" stroke-width="3" />
              <rect x="61" y="0" width="45" height="30" fill="#fff" stroke="#1a1c2c" stroke-width="2" />
              {preview && <image href={preview} x="61" y="0" width="45" height="30" preserveAspectRatio="none" />}
            </svg>
          </div>
        </div>
      </div>
      <div class="row">
        <Button variant="ghost" onClick={onClose}>Hủy</Button>
        <Button variant="primary" onClick={() => { const res = { flag: exportFlag(), color: col }; onClose(); if (onSave) onSave(res); }}><Emo size={20}>✅ Lưu vương quốc</Emo></Button>
      </div>
    </Modal>
  );
}

/** Opens the flag editor over the current screen (same signature the JS version had). */
export function openFlagEditor(opts: FlagEditorOptions): void {
  openModal(close => <FlagEditor {...opts} onClose={close} />);
}
