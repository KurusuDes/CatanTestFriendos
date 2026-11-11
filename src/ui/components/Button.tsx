import type { ComponentChildren, JSX, ButtonHTMLAttributes } from 'preact';

export type ButtonVariant = 'primary' | 'green' | 'pink' | 'ghost';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size' | 'class'> {
  variant?: ButtonVariant;
  sm?: boolean;
  big?: boolean;
  /** extra classes */
  class?: string;
  children?: ComponentChildren;
}

/** `<button class="btn ...">` with the existing variant classes */
export function Button({ variant, sm, big, class: extra, children, ...rest }: ButtonProps): JSX.Element {
  const cls = ['btn', variant, sm && 'sm', big && 'big', extra].filter(Boolean).join(' ');
  return <button type="button" {...rest} class={cls}>{children}</button>;
}
