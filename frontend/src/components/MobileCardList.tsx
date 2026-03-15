import type { ReactNode } from 'react';
import { Spin, Empty, Pagination } from 'antd';
import { useState } from 'react';

interface MobileCardListProps<T> {
  data: T[];
  loading?: boolean;
  renderCard: (item: T, index: number) => ReactNode;
  rowKey: keyof T | ((item: T) => string);
  emptyText?: string;
  pageSize?: number;
}

export default function MobileCardList<T>({
  data,
  loading = false,
  renderCard,
  rowKey,
  emptyText = 'Нет данных',
  pageSize = 20,
}: MobileCardListProps<T>) {
  const [page, setPage] = useState(1);

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
            onChange={setPage}
            size="small"
            showSizeChanger={false}
          />
        </div>
      )}
    </div>
  );
}
