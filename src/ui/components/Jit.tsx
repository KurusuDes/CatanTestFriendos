// Wobbling "boil" letters, same markup pixelize's jitterEl() produces (.jw word > .jl letter) so the
// CSS applies unchanged. Needed because Preact roots are `.nopx` (pixelize does not touch them).
import type { ComponentChildren, JSX } from 'preact';
import { PixelIcon } from './PixelIcon';

const EMOJI = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?|[⭐✨])/gu;

type JitPart = string | { cls: string; text: string };

interface JitProps {
  as?: 'div' | 'h2' | 'h3' | 'p' | 'span';
  class?: string;
  /** sprite size for emojis inside the text */
  size?: number;
  /** plain text, or several parts (a part with `cls` becomes a span with that class) */
  text: JitPart | JitPart[];
}

export function Jit({ as: Tag = 'div', class: cls, size = 20, text }: JitProps): JSX.Element {
  let i = 0;
  const letters = (s: string): ComponentChildren[] => {
    const out: ComponentChildren[] = [];
    let word: ComponentChildren[] | null = null;
    const push = (child: ComponentChildren) => {
      if (!word) {
        word = [];
        out.push(<span class="jw">{word}</span>);
      }
      word.push(<span class="jl" style={{ animationDelay: `-${((i++ * 137) % 600) / 1000}s` }}>{child}</span>);
    };
    s.split(EMOJI).forEach((part, k) => {
      if (!part) return;
      if (k % 2 === 1) return push(<PixelIcon emoji={part} size={size} />);
      for (const ch of part) {
        if (ch === ' ') {
          out.push(' ');
          word = null;
        } else push(ch);
      }
    });
    return out;
  };
  const parts = Array.isArray(text) ? text : [text];
  return (
    <Tag class={cls ? `${cls} jit` : 'jit'} data-jit="1">
      {parts.map(p => (typeof p === 'string' ? letters(p) : <span class={p.cls}>{letters(p.text)}</span>))}
    </Tag>
  );
}
