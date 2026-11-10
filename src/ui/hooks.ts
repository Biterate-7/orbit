import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Arrow-key / WASD focus navigation between `.nav` elements inside a container. */
export function useArrowNav(ref: RefObject<HTMLElement>, autoFocus = true, deps: unknown[] = []): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = (): HTMLElement[] =>
      Array.from(el.querySelectorAll<HTMLElement>('.nav')).filter((n) => !(n as HTMLButtonElement).disabled);
    if (autoFocus) {
      const first = items()[0];
      first?.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent): void => {
      const list = items();
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      const next = e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'ArrowRight';
      const prev = e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'ArrowLeft';
      if (!next && !prev) return;
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return;
      e.preventDefault();
      const n = idx < 0 ? 0 : (idx + (next ? 1 : -1) + list.length) % list.length;
      list[n].focus({ preventScroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Global keyboard shortcuts while `active`. Keys are KeyboardEvent.code values. */
export function useKeys(map: Record<string, () => void>, active = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      const fn = ref.current[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/** True when on-screen touch controls should be shown. */
export function useTouchMode(setting: 'auto' | 'on' | 'off'): boolean {
  const [touched, setTouched] = useState<boolean>(() => {
    try {
      return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (touched) return;
    const on = (): void => setTouched(true);
    window.addEventListener('touchstart', on, { once: true, passive: true });
    return () => window.removeEventListener('touchstart', on);
  }, [touched]);
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return touched;
}
