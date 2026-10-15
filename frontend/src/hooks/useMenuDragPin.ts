import { useEffect, useRef, type RefObject } from 'react';

const HOLD_MS = 450;
/** Сдвиг до срабатывания долгого нажатия — это уже прокрутка или обычный клик. */
const MOVE_TOLERANCE = 8;
const MAIN_SELECTOR = '.sider-section-main';

interface Options {
  enabled: boolean;
  /** Отпустили над «Главным»: закрепить пункт на месте `index` среди закреплённых. */
  onPin: (key: string, index: number) => void;
  /** Закреплённый пункт вытащили из «Главного» — вернуть в свою группу. */
  onUnpin: (key: string) => void;
}

/**
 * Перетаскивание пунктов бокового меню в «Главное».
 * Мышь — с зажатым Alt: нажал и тянешь. Без Alt ссылка работает как обычно, а встроенное
 * перетаскивание ссылок браузером в меню выключено (оно перехватывало жест).
 * Палец — долгим нажатием: пункт «поднимается» и едет за пальцем. Отпустил над «Главным» —
 * закрепился там, в том месте списка, куда отпустили. Закреплённый пункт можно утащить
 * обратно — тогда он вернётся в свою группу. Обычный клик и прокрутка работают как раньше.
 */
export function useMenuDragPin(containerRef: RefObject<HTMLElement | null>, { enabled, onPin, onUnpin }: Options) {
  // Колбэки меняются на каждом рендере — читаем свежие из ref, чтобы не перевешивать слушатели
  const handlers = useRef({ onPin, onUnpin });
  useEffect(() => {
    handlers.current = { onPin, onUnpin };
  });

  useEffect(() => {
    if (!enabled) return;
    // Меню монтируется заново (выдвижная панель на телефоне, смена ширины окна), поэтому
    // слушаем документ и каждый раз берём текущий контейнер, а не тот, что был при подписке
    const inMenu = (target: EventTarget | null) => {
      const root = containerRef.current;
      return root && target instanceof Node && root.contains(target) ? root : null;
    };

    let timer: number | undefined;
    let start: { x: number; y: number } | null = null;
    let source: HTMLElement | null = null;
    let ghost: HTMLElement | null = null;
    let dragging = false;

    const mainSection = () => containerRef.current?.querySelector<HTMLElement>(MAIN_SELECTOR) ?? null;
    const overMain = (x: number, y: number) => {
      const main = mainSection();
      if (!main) return false;
      const r = main.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top - 8 && y <= r.bottom + 8;
    };

    /** Место среди закреплённых: сколько закреплённых пунктов выше точки, куда отпустили. */
    const dropIndex = (y: number, key: string) => {
      const main = mainSection();
      if (!main) return 0;
      const pinned = [...main.querySelectorAll<HTMLElement>('[data-menu-pinned="1"]')].filter(
        (el) => el.dataset.menuKey !== key,
      );
      return pinned.filter((el) => {
        const r = (el.closest('.ant-menu-item') ?? el).getBoundingClientRect();
        return r.top + r.height / 2 < y;
      }).length;
    };

    const cleanup = () => {
      window.clearTimeout(timer);
      timer = undefined;
      start = null;
      ghost?.remove();
      ghost = null;
      source?.closest('.ant-menu-item')?.classList.remove('sider-item--lifted');
      mainSection()?.classList.remove('sider-section-main--target');
      document.documentElement.classList.remove('sider-dragging');
      source = null;
      dragging = false;
    };

    const moveGhost = (x: number, y: number) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${x + 12}px, ${y - 18}px)`;
      mainSection()?.classList.toggle('sider-section-main--target', overMain(x, y));
    };

    const lift = (x: number, y: number) => {
      if (!source) return;
      dragging = true;
      const item = source.closest('.ant-menu-item');
      item?.classList.add('sider-item--lifted');
      document.documentElement.classList.add('sider-dragging');
      ghost = document.createElement('div');
      ghost.className = 'sider-drag-ghost';
      ghost.textContent = source.textContent ?? '';
      document.body.appendChild(ghost);
      moveGhost(x, y);
      navigator.vibrate?.(12);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !inMenu(e.target)) return;
      const link = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-key]');
      if (!link || link.dataset.menuFixed === '1') return;
      if (e.pointerType === 'mouse') {
        // Мышью — только с Alt и сразу, без ожидания; без Alt это обычный клик по ссылке
        if (!e.altKey) return;
        e.preventDefault();
        source = link;
        start = { x: e.clientX, y: e.clientY };
        lift(e.clientX, e.clientY);
        return;
      }
      source = link;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => lift(e.clientX, e.clientY), HOLD_MS);
    };

    // Встроенное перетаскивание ссылок браузером (серая плашка с адресом) в меню не нужно
    const onDragStart = (e: DragEvent) => {
      if (inMenu(e.target) && (e.target as HTMLElement).closest?.('[data-menu-key]')) e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (!start) return;
      if (!dragging) {
        // Сдвинулся раньше времени — это прокрутка или клик, не перетаскивание
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE) cleanup();
        return;
      }
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      if (!dragging || !source) {
        cleanup();
        return;
      }
      const key = source.dataset.menuKey!;
      const wasPinned = source.dataset.menuPinned === '1';
      if (overMain(e.clientX, e.clientY)) handlers.current.onPin(key, dropIndex(e.clientY, key));
      else if (wasPinned) handlers.current.onUnpin(key);
      // Отпускание после перетаскивания — не клик по ссылке
      window.addEventListener('click', swallowClick, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 400);
      cleanup();
    };

    const swallowClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Пока пункт поднят, палец не прокручивает меню
    const onTouchMove = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };
    // Долгое нажатие пальцем не открывает системное меню ссылки
    const onContextMenu = (e: Event) => {
      if (start && inMenu(e.target)) e.preventDefault();
    };

    document.addEventListener('pointerdown', onDown);
    document.addEventListener('dragstart', onDragStart);
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cleanup);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('contextmenu', onContextMenu);
    return () => {
      cleanup();
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cleanup);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('contextmenu', onContextMenu);
    };
  }, [containerRef, enabled]);
}
