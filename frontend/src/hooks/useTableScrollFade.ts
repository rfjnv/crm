import { type RefObject, useEffect } from 'react';

const EPS = 2;

function updateScrollState(el: HTMLElement): void {
  el.classList.remove('scroll-start', 'scroll-middle', 'scroll-end', 'scroll-no-overflow');
  const { scrollLeft, scrollWidth, clientWidth } = el;

  if (scrollWidth <= clientWidth + EPS) {
    el.classList.add('scroll-no-overflow');
    return;
  }

  const atStart = scrollLeft <= EPS;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - EPS;

  if (atStart) el.classList.add('scroll-start');
  else if (atEnd) el.classList.add('scroll-end');
  else el.classList.add('scroll-middle');
}

/**
 * Adds `table-scroll-container` + `scroll-*` classes to `.ant-table-wrapper` under `containerRef`
 * for mobile gradient hints (see `mobile.css`).
 */
export function useTableScrollFade(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const bound = new WeakSet<HTMLElement>();
    const cleanups = new Map<HTMLElement, () => void>();

    const bind = (el: HTMLElement) => {
      if (bound.has(el)) return;
      bound.add(el);
      el.classList.add('table-scroll-container');

      const run = () => updateScrollState(el);
      el.addEventListener('scroll', run, { passive: true });
      const ro = new ResizeObserver(run);
      ro.observe(el);
      run();

      cleanups.set(el, () => {
        el.removeEventListener('scroll', run);
        ro.disconnect();
        el.classList.remove(
          'table-scroll-container',
          'scroll-start',
          'scroll-middle',
          'scroll-end',
          'scroll-no-overflow',
        );
      });
    };

    let raf = 0;
    const scan = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.querySelectorAll<HTMLElement>('.ant-table-wrapper').forEach(bind);
      });
    };

    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      root.querySelectorAll<HTMLElement>('.ant-table-wrapper').forEach((el) => {
        cleanups.get(el)?.();
      });
    };
  }, [containerRef]);
}
