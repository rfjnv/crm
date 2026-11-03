import { useQuery } from '@tanstack/react-query';
import { Card, Statistic, Table, Typography, theme } from 'antd';
import dayjs from 'dayjs';
import { hrCallsApi, type HrSummaryCounters } from '../../api/calls.api';
import { useIsMobile } from '../../hooks/useIsMobile';

/** «1 ч 20 мин», «35 мин», «40 сек» — для суммарного времени разговоров */
function talkLabel(sec: number): string {
  if (sec < 60) return `${sec} сек`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function hoursLabel(c: Pick<HrSummaryCounters, 'firstAt' | 'lastAt'>): string {
  if (!c.firstAt || !c.lastAt) return '—';
  return `${dayjs(c.firstAt).format('HH:mm')}–${dayjs(c.lastAt).format('HH:mm')}`;
}

/**
 * Сводка над журналом «Звонков HR»: со сколькими людьми поговорили, разговоры, минуты,
 * недозвоны и пропущенные. Период — из фильтра, без фильтра — сегодня.
 */
export default function HrCallsSummary({ from, to, seeAll, onShowMissed }: {
  from?: string;
  to?: string;
  seeAll: boolean;
  onShowMissed: () => void;
}) {
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const { data } = useQuery({
    queryKey: ['hr-calls-summary', from, to],
    queryFn: () => hrCallsApi.summary({ from, to }),
    refetchInterval: 60_000,
  });
  if (!data) return null;

  const oneDay = !from || from === to;
  const title = !from ? 'Сегодня' : oneDay ? dayjs(from).format('DD.MM.YYYY') : `${dayjs(from).format('DD.MM')} – ${to ? dayjs(to).format('DD.MM.YYYY') : 'сегодня'}`;
  const tile = { flex: isMobile ? '1 1 calc(50% - 8px)' : '1 1 0', minWidth: isMobile ? 0 : 140 };
  const valueStyle = { fontSize: isMobile ? 20 : 24 };

  return (
    <Card size="small" style={{ marginBottom: 12 }} title={title}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Statistic style={tile} valueStyle={valueStyle} title={seeAll ? 'Общались с людьми' : 'Общалась с людьми'} value={data.people} />
        <Statistic
          style={tile}
          valueStyle={valueStyle}
          title="Разговоров"
          value={data.conversations}
          suffix={<Typography.Text type="secondary" style={{ fontSize: 13 }}>вх. {data.incoming} · исх. {data.outgoing}</Typography.Text>}
        />
        <Statistic style={tile} valueStyle={valueStyle} title="Время разговоров" value={talkLabel(data.talkSec)} />
        <Statistic style={tile} valueStyle={valueStyle} title={seeAll ? 'Не дозвонились' : 'Не дозвонилась'} value={data.notReached} />
        <div style={{ ...tile, cursor: data.missed ? 'pointer' : undefined }} onClick={data.missed ? onShowMissed : undefined}>
          <Statistic
            valueStyle={{ ...valueStyle, color: data.missedPending ? token.colorError : undefined }}
            title="Пропущенные"
            value={data.missed}
            suffix={data.missedPending
              ? <Typography.Text type="danger" style={{ fontSize: 13 }}>не перезвонили: {data.missedPending}</Typography.Text>
              : undefined}
          />
        </div>
        {oneDay && <Statistic style={tile} valueStyle={valueStyle} title="Первый – последний звонок" value={hoursLabel(data)} />}
      </div>

      {seeAll && data.employees && data.employees.length > 1 && (
        <Table
          style={{ marginTop: 12 }}
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={data.employees}
          columns={[
            { title: 'Сотрудник', dataIndex: 'fullName' },
            { title: 'Людей', dataIndex: 'people' },
            { title: 'Разговоров', dataIndex: 'conversations' },
            { title: 'Время', dataIndex: 'talkSec', render: (v: number) => talkLabel(v) },
            { title: 'Не дозвонились', dataIndex: 'notReached' },
            {
              title: 'Пропущенные',
              key: 'missed',
              render: (_, e) => (e.missedPending
                ? <Typography.Text type="danger">{e.missed} (не перезвонили {e.missedPending})</Typography.Text>
                : e.missed),
            },
          ]}
        />
      )}
    </Card>
  );
}
