import type { ReactNode } from 'react';
import './StatusPill.css';

export type StatusTone = 'positive' | 'negative' | 'warning' | 'neutral';

interface Props {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

/**
 * Пилюля статуса по смыслу, а не по цвету: positive / negative / warning / neutral
 * (DASHBOARD.md §5). Высота 22, радиус 999, без рамки.
 */
export default function StatusPill({ tone = 'neutral', children, className, title }: Props) {
  return (
    <span className={className ? `ui-pill ${className}` : 'ui-pill'} data-tone={tone} title={title}>
      {children}
    </span>
  );
}
