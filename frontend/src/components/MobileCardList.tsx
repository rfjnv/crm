import type { ReactNode } from 'react';
import { Spin, Empty, Pagination } from 'antd';
import { useState } from 'react';

export interface MobileCardListPagination {
  current: number;
  pageSize: number;
  onChange: (page: number, pageSize: number) => void;
}

interface MobileCardListProps<T> {
  data: T[];
  loading?: boolean;
  renderCard: (item: T, index: number) => ReactNode;
  rowKey: keyof T | ((item: T) => string);
  emptyText?: string;
  /** Default page size when pagination is not controlled */
  pageSize?: number;
  /** URL-driven or external pagination */
  pagination?: MobileCardListPagination;
}

export default function MobileCardList<T>({
  data,
  loading = false,
  renderCard,
  rowKey,
  emptyText = 'Нет данных',
  pageSize: defaultPageSize = 20,
  pagination: controlledPagination,
}: MobileCardListProps<T>) {
  const [internalPage, setInternalPage] = useState(1);
  const pageSize = controlledPagination?.pageSize ?? defaultPageSize;
  const page = controlledPagination?.current ?? internalPage;

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>;
  }

  if (!data.length) {
    return <Empty description={emptyText} style={{ padding: 40 }} />;
  }

  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);

  const getKey = (item: T, index: number): string => {
    if (typeof rowKey === 'function') return rowKey(item);
    return String(item[rowKey] ?? index);
  };

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {pageData.map((item, i) => (
          <div key={getKey(item, start + i)}>{renderCard(item, start + i)}</div>
        ))}
      </div>
      {data.length > pageSize && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Pagination
            current={page}
            total={data.length}
            pageSize={pageSize}
            onChange={(p, ps) => {
              if (controlledPagination) {
                controlledPagination.onChange(p, ps);
              } else {
                setInternalPage(p);
              }
            }}
            size="small"
            showSizeChanger={!!controlledPagination}
            pageSizeOptions={controlledPagination ? ['10', '20', '50', '100'] : undefined}
          />
        </div>
      )}
    </div>
  );
}
