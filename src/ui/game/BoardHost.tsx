// `.board-wrap`: where the 3D island (or, without WebGL, the flat SVG map) is mounted, with the panels that
// float over it. The board is created once (dynamic import of Board3D, so the menu never pays for three.js);
// after that the controller effect calls `board.render(view, boardView)` whenever the inputs change.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BoardView } from '@board/BoardView';
import type { BoardRenderer } from '@board/BoardRenderer';
import { Jit } from '@ui/components/Jit';
import { px } from '@ui/components/PixelIcon';
import { toast } from '@ui/dom';
import { Banner, Offer, RollLog } from './BoardOverlays';
import { boardPing } from './fx';
import { boards, boardSig, countRender, pick, topView } from './signals';

export function BoardHost(): JSX.Element {
  countRender('BoardHost');
  const wrap = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = wrap.current!;
    let dead = false;
    let board: BoardRenderer | null = null;
    (async () => {
      try {
        const { Board3D } = await import('@board/Board3D');
        if (dead) return;
        const b = await Board3D.create(el);
        if (dead) return b.dispose();
        board = b;
        boards.d3 = b;
        b.onSlow = () => toast('Máy hơi chậm: thử chọn mức "Máy yếu" trong ☰ Menu → Đồ họa 3D', 'info', 7000);
        b.onPing = boardPing;
      } catch (e) {
        console.error(e);
        if (dead) return;
        toast('Không tải được bản đồ 3D (mất mạng hoặc thiếu WebGL?): chuyển sang bản đồ phẳng', 'error', 4000);
        board = new BoardView(el);
      }
      boards.any = board;
      boardSig.value = board; // the controller effect draws the island; shaders compile (compileAsync) while the loader is up
      if (boards.d3 && boards.d3.ready) await boards.d3.ready;
      if (!dead) setLoading(false);
    })();
    return () => {
      dead = true;
      boardSig.value = null;
      boards.any = boards.d3 = null;
      if (board) board.dispose();
    };
  }, []);

  const toggleTopView = () => {
    const b = boards.any;
    if (!b || !b.setTopView) return;
    b.setTopView(!b.top);
    topView.value = !!b.top;
  };
  const zoom = (k: number) => {
    const b = boards.any;
    if (b) b.setZoom(b.zoom * k);
  };
  const top = topView.value;

  return (
    <section class="board-wrap" ref={wrap} onClick={e => {
      // a click on the panels around the map (not the canvas) drops the armed build button
      if (pick.peek() && (e.target as Element).tagName !== 'CANVAS') pick.value = null;
    }}>
      <Banner />
      <Offer />
      <RollLog />
      <div class="zoom-ctrl">
        <button type="button" class={'btn' + (top ? ' active' : '')} title={top ? 'Về góc nhìn nghiêng' : 'Nhìn từ trên xuống'} onClick={toggleTopView}>{px('🗺️', 20)}</button>
        <button type="button" class="btn" title="Phóng to" onClick={() => zoom(1.25)}>+</button>
        <button type="button" class="btn" title="Thu nhỏ" onClick={() => zoom(1 / 1.25)}>−</button>
        <button type="button" class="btn" title="Căn giữa" onClick={() => boards.any?.resetView()}>⤢</button>
      </div>
      {loading && <Jit class="board-loading" text="🏝️ Đang dựng đảo..." size={22} />}
    </section>
  );
}
