import defaultBackground from '../assets/glass-bg.webp';
import { useBackgroundStore } from '../store/backgroundStore';

/**
 * «Запечённое» стекло для меню и большого окна нового дизайна.
 *
 * Живой `backdrop-filter: blur(48px)` браузер пересчитывает на каждом кадре прокрутки:
 * на слабых компьютерах без нормальной видеокарты дашборд прокручивался ~15 кадров/с.
 * Меню и окно стоят на месте поверх неподвижного фото, значит размытое фото под ними
 * можно посчитать один раз: рисуем его в маленький canvas с тем же радиусом и кладём
 * в `--glass-bg-blurred`, а glass.css подставляет его фоном с `background-attachment: fixed`.
 *
 * Пока картинка не готова (или canvas не умеет `filter` — старый Safari), работает
 * обычное живое размытие.
 */

/** Как у `--win-blur` в glass.css */
const BLUR_PX = 48;
const SATURATE = 1.15;
/** Ширина запечённой картинки: после такого размытия детали всё равно не видны */
const BAKED_WIDTH = 640;

let bakedFor = '';
let objectUrl: string | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function bake(src: string): Promise<void> {
  const root = document.documentElement;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const key = `${src}|${vw}x${vh}`;
  if (key === bakedFor) return;
  bakedFor = key;

  const img = await loadImage(src);
  if (bakedFor !== key) return;

  // Фото лежит на экране как background-size: cover — во сколько раз canvas мельче его
  const cover = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);
  const scale = BAKED_WIDTH / (img.naturalWidth * cover);
  const w = BAKED_WIDTH;
  const h = Math.round(img.naturalHeight * cover * scale);
  const blur = BLUR_PX * scale;
  // Поля, чтобы края не выцветали: размытие тянет внутрь прозрачность из-за границы
  const pad = Math.ceil(blur * 3);

  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx || !('filter' in ctx)) return;
  // Подложка на поля — то же фото, растянутое на весь холст
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, pad, pad, w, h);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  if (!octx) return;
  octx.filter = `blur(${blur}px) saturate(${SATURATE})`;
  octx.drawImage(canvas, -pad, -pad);
  // Браузер без поддержки filter молча рисует без размытия — проверять нечем, кроме
  // самого свойства: если он его «не запомнил», оставляем живое стекло.
  if (octx.filter === 'none') return;

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/webp', 0.9));
  if (!blob || bakedFor !== key) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  root.style.setProperty('--glass-bg-blurred', `url("${objectUrl}")`);
  root.setAttribute('data-glass-baked', '');
}

function currentSource(): string {
  return useBackgroundStore.getState().url ?? defaultBackground;
}

function refresh(): void {
  if (document.documentElement.dataset.design !== 'modern') return;
  bake(currentSource()).catch(() => {
    // Не загрузилось или canvas недоступен — остаётся живое размытие
    bakedFor = '';
  });
}

export function installGlassBackdrop(): void {
  refresh();
  useBackgroundStore.subscribe((s, prev) => {
    if (s.url !== prev.url) refresh();
  });
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-design'] });
  let timer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(refresh, 300);
  });
}
