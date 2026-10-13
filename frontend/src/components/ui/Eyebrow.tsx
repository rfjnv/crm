import type { ReactNode } from 'react';
import './Eyebrow.css';

interface Props {
  children: ReactNode;
  className?: string;
}

/** Заголовок зоны или секции: 11/600, капс, разрядка .06em (DASHBOARD.md §4). */
export default function Eyebrow({ children, className }: Props) {
  return <div className={className ? `ui-eyebrow ${className}` : 'ui-eyebrow'}>{children}</div>;
}
