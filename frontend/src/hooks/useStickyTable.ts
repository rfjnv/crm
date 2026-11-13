import { useEffect, useState } from 'react';
import type { TableProps } from 'antd';
import { useAppHeaderHeight } from './useAppHeaderHeight';

/**
 * Липкая шапка и липкая полоса горизонтальной прокрутки для широких таблиц.
 *
 * В новом дизайне страница прокручивается внутри `.app-main-content`, а верхняя панель
 * стоит над ним и не накрывает таблицу: шапка липнет к краю контейнера (отступ 0), иначе
 * между ними оставалась щель высотой с панель и сквозь неё были видны строки. В старом
 * дизайне прокручивается окно, а липкая панель лежит поверх, поэтому отступ — её высота.
 * Полоса прокрутки держится у нижнего края экрана: раньше она была под последней строкой,
 * и прокрутить таблицу вправо, не долистав до конца, было нечем.
 */
export function useStickyTable(): TableProps['sticky'] {
  const headerHeight = useAppHeaderHeight();
  const [main, setMain] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.app-main-content');
    setMain(el && /(auto|scroll)/.test(getComputedStyle(el).overflowY) ? el : null);
  }, []);
  return main
    ? { offsetHeader: 0, offsetScroll: 0, getContainer: () => main }
    : { offsetHeader: headerHeight, offsetScroll: 0 };
}
