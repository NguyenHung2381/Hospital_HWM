import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { darkMapTheme, lightMapTheme, type MapTheme } from './theme';

export interface Size {
  width: number;
  height: number;
}

/** Theo dõi kích thước phần tử bằng ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const darkQuery = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = darkQuery();
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => darkQuery()?.matches ?? false,
    () => false,
  );
}

export type ThemeSetting = 'auto' | 'light' | 'dark' | MapTheme;

export function useMapTheme(setting: ThemeSetting = 'auto'): MapTheme {
  const prefersDark = usePrefersDark();
  if (typeof setting === 'object') return setting;
  const dark = setting === 'dark' || (setting === 'auto' && prefersDark);
  return dark ? darkMapTheme : lightMapTheme;
}

const reducedMotionQuery = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

/** Người dùng bật "giảm chuyển động" trong hệ điều hành. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = reducedMotionQuery();
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}
