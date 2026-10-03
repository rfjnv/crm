import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Card, Col, Row, Statistic } from 'antd';
import { callsApi } from '../../api/calls.api';
import CallsList from './CallsList';
import { useCallActions } from './useCallActions';
import { formatDuration } from './callsUi';

/** Вкладка «Звонки» в карточке клиента: все звонки по всем его номерам, новые сверху. */
export default function ClientCallsTab({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { data, isFetching } = useQuery({
    queryKey: ['client-calls', clientId, page, pageSize],
    queryFn: () => callsApi.forClient(clientId, page, pageSize),
    placeholderData: keepPreviousData,
  });
  const { actions, elements } = useCallActions();

  return (
    <div>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        <Col xs={8}>
          <Card size="small"><Statistic title="Звонков за 30 дней" value={data?.stats.callsCount ?? 0} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small"><Statistic title="Пропущенных" value={data?.stats.missedCount ?? 0} /></Card>
        </Col>
        <Col xs={8}>
          <Card size="small">
            <Statistic title="Средняя длительность" value={data?.stats.avgDurationSec != null ? formatDuration(data.stats.avgDurationSec) : '—'} />
          </Card>
        </Col>
      </Row>
      <CallsList
        items={data?.items ?? []}
        loading={isFetching && !data}
        totalCount={data?.totalCount ?? 0}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => { setPage(p); setPageSize(s); }}
        showClient={false}
        {...actions}
      />
      {elements}
    </div>
  );
}
