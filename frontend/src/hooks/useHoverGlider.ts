import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface GliderBox {
  top: number;
  left: number;
  width: number;
  height: number;
  visible: boolean;
  /** Первое появление — встать сразу на место, а не приехать из прошлой позиции. */
  instant: boolean;
}

const HIDDEN: GliderBox = { top: 0, left: 0, width: 0, height: 0, visible: false, instant: true };

/**
 * «Едущая» подсветка пунктов: одна плашка плавно переезжает к пункту под курсором,
 * вместо того чтобы каждый пункт мигал своим фоном (как в Animate UI).
 *
 * `selector` — какие элементы внутри контейнера считаются пунктами. Контейнер должен
 * быть `position: relative`; плашку рисуют внутри него с возвращённым стилем.
 */
export function useHoverGlider<T extends HTMLElement>(selector: string, enabled = true) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<GliderBox>(HIDDEN);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const onOver = (e: MouseEvent) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (!item || !el.contains(item)) return;
      const c = el.getBoundingClientRect();
      const r = item.getBoundingClientRect();
      setBox((prev) => ({
        top: r.top - c.top + el.scrollTop,
        left: r.left - c.left + el.scrollLeft,
        width: r.width,
        height: r.height,
        visible: true,
        instant: !prev.visible,
      }));
    };
    const onLeave = () => setBox((prev) => ({ ...prev, visible: false }));
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [selector, enabled]);

  const style: CSSProperties = {
    transform: `translate(${box.left}px, ${box.top}px)`,
    width: box.width,
    height: box.height,
    opacity: box.visible ? 1 : 0,
    ...(box.instant ? { transitionProperty: 'opacity' } : null),
  };

  return { ref, style };
}
