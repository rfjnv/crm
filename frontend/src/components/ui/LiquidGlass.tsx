import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './LiquidGlass.css';

/**
 * Карта смещения «линзы» скруглённого прямоугольника для feDisplacementMap: у кромки
 * пиксели берутся ближе к центру — фон за стеклом загибается вокруг края, как у iOS.
 * R/G = смещение по X/Y (128 — без смещения).
 */
function lensMap(w: number, h: number, radius: number, bevel: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const r = Math.min(radius, w / 2, h / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - (w / 2 - r);
      const qy = Math.abs(py) - (h / 2 - r);
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      // Расстояние от точки до кромки (положительное внутри)
      const inside = r - (Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0));
      let nx = 0;
      let ny = 0;
      if (qx > 0 || qy > 0) {
        const l = Math.hypot(ox, oy) || 1;
        nx = ox / l;
        ny = oy / l;
      } else if (qx > qy) nx = 1;
      else ny = 1;
      nx *= Math.sign(px) || 1;
      ny *= Math.sign(py) || 1;
      const t = Math.max(0, Math.min(1, 1 - inside / bevel));
      const m = t ** 1.6; // выпуклый профиль: сильнее всего у самой кромки
      const i = (y * w + x) * 4;
      img.data[i] = 128 - nx * m * 127;
      img.data[i + 1] = 128 - ny * m * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

/**
 * Преломление через backdrop-filter: url(#svg) умеет только Chromium. В WebKit (весь iOS)
 * и Firefox фон с таким фильтром пропадает — там остаётся стекло без искажения.
 */
function supportsRefraction(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return false;
  return /Chrome\/\d+/.test(ua) && !/Firefox/.test(ua);
}

interface Props {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Радиус скругления — тот же, что в CSS, иначе линза не совпадёт с краем */
  radius?: number;
  /** Ширина преломляющей кромки, px */
  bevel?: number;
  /** Сила искажения */
  strength?: number;
}

/**
 * Жидкое стекло в духе iOS 26: прозрачный центр, фон у кромки преломляется линзой,
 * светящаяся кайма. Размер карты подстраивается под элемент.
 */
export default function LiquidGlass({ children, className, style, radius = 28, bevel = 34, strength = 90 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filterId = `lg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [refract] = useState(supportsRefraction);
  const [map, setMap] = useState<{ w: number; h: number; href: string } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !refract) return undefined;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (!w || !h) return;
        setMap((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h, href: lensMap(w, h, radius, bevel) }));
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [refract, radius, bevel]);

  const on = refract && !!map;
  return (
    <div
      ref={ref}
      className={`liquid-glass${on ? ' liquid-glass--refract' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...style, borderRadius: radius, ...(on ? { ['--lg-filter' as string]: `url(#${filterId})` } : null) }}
    >
      {on && (
        <svg className="liquid-glass__defs" width="0" height="0" aria-hidden>
          <filter
            id={filterId}
            x="0"
            y="0"
            width={map.w}
            height={map.h}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feImage href={map.href} x="0" y="0" width={map.w} height={map.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  );
}
