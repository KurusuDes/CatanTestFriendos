// Tiny typed event emitter (ping / meta), alongside the legacy `App.onPing` style callback slots.
type Listener<A extends unknown[]> = (...args: A) => void;

export class Emitter<E extends { [K in keyof E]: unknown[] }> {
  private map = new Map<keyof E, Set<Listener<never>>>();

  on<K extends keyof E>(ev: K, fn: Listener<E[K]>): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  emit<K extends keyof E>(ev: K, ...args: E[K]) {
    const set = this.map.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Listener<E[K]>)(...args);
      } catch (e) {
        console.error(`event ${String(ev)}`, e);
      }
    }
  }

  clear() {
    this.map.clear();
  }
}

export interface AppEvents {
  ping: [seat: number, x: number, z: number];
  meta: [];
}
