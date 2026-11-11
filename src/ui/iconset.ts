// Which resource icon set is on ('render' | 'pico' | 'classic') as a signal: <PixelIcon> reads it, so
// switching the set in the game menu re-renders every sprite on screen without remounting anything.
import { signal } from '@preact/signals';

export const iconSetSignal = signal<string>('render');
