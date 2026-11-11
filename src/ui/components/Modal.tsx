import { render, type ComponentChildren, type JSX, type CSSProperties } from 'preact';

export interface ModalProps {
  onClose: () => void;
  class?: string;
  style?: CSSProperties;
  children?: ComponentChildren;
}

/** `.overlay > .modal`: clicking the backdrop closes it */
export function Modal({ onClose, class: cls, style, children }: ModalProps): JSX.Element {
  return (
    <div class="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div class={cls ? `modal ${cls}` : 'modal'} style={style}>{children}</div>
    </div>
  );
}

/** Mounts a Preact modal on <body> from imperative code (gameView, handlers). Returns `close`. */
export function openModal(view: (close: () => void) => ComponentChildren): () => void {
  const host = document.createElement('div');
  host.className = 'nopx'; // pixelize must not touch Preact's DOM
  document.body.append(host);
  const close = () => {
    if (!host.isConnected) return;
    render(null, host);
    host.remove();
  };
  render(view(close), host);
  return close;
}
