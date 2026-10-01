import { Suspense, type ReactNode } from 'react';
import { Spin } from 'antd';

/** Пока догружается чанк страницы, оболочка (меню, шапка) остаётся на месте — крутится только область контента. */
export default function PageSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={(
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      )}
    >
      {children}
    </Suspense>
  );
}
