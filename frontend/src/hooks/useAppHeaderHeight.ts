import { useEffect, useState } from 'react';

/**
 * Высота верхней панели приложения: она сама липкая, и шапка таблицы,
 * прилипшая к top:0, ушла бы под неё.
 */
export function useAppHeaderHeight() {
  const [height, setHeight] = useState(56);
  useEffect(() => {
    const header = document.querySelector('.ant-layout-header');
    if (!header) return;
    const update = () => setHeight(header.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return height;
}
