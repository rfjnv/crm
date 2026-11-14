import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, DatePicker, Empty, Segmented, Space, Spin, Table, Typography, theme } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { financeReportApi, type FinanceReport, type FinanceReportPart } from '../api/financeReport.api';
import { useCostAccess } from '../hooks/useCostAccess';
import CostAccessButton from '../components/CostAccessButton';
import { formatUZS } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';

const { Title, Text } = Typography;

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthLabel = (key: string) => `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

type RowKind = 'line' | 'bold' | 'section' | 'subtotal' | 'grand' | 'profit' | 'gross';

interface ReportRow {
  key: string;
  no?: number;
  title: string;
  kind: RowKind;
  /** null — строка-заголовок без чисел */
  values: Record<string, number> | null;
  total: number | null;
  hint?: string;
}

type PeriodPreset = 'month' | 'prev' | 'quarter' | 'year' | 'custom';

function presetRange(p: Exclude<PeriodPreset, 'custom'>): [Dayjs, Dayjs] {
  const now = dayjs();
  switch (p) {
    case 'month': return [now.startOf('month'), now];
    case 'prev': return [now.subtract(1, 'month').startOf('month'), now.subtract(1, 'month').endOf('month')];
    case 'quarter': return [now.subtract(2, 'month').startOf('month'), now];
    case 'year': return [now.startOf('year'), now];
  }
}

function buildRows(r: FinanceReport): ReportRow[] {
  const col = (pick: (p: { cash: FinanceReportPart; transfer: FinanceReportPart; all: FinanceReportPart }) => number) =>
    Object.fromEntries(r.columns.map((c) => [c.month, pick(c)]));
  const line = (key: string, title: string, kind: RowKind, pick: Parameters<typeof col>[0], no?: number, hint?: string): ReportRow => ({
    key, no, title, kind, values: col(pick), total: pick(r.total), hint,
  });

  const rows: ReportRow[] = [
    line('revenue', 'Товарооборот без НДС (чистый товарооборот)', 'bold', (p) => p.all.revenue, 1,
      `С НДС: ${formatUZS(r.total.all.revenueGross)}. НДС ${Math.round(r.vatRate * 100)}% вычтен из сумм строк закрытых сделок`),
    line('cogs', 'Себестоимость', 'line', (p) => p.all.cogs, 2, 'Количество × цена закупки товара'),
    line('gross', 'Валовая прибыль', 'bold', (p) => p.all.grossProfit, 3),
    { key: 'gap', title: '', kind: 'gross', values: null, total: null },
  ];

  const expenseBlock = (part: 'cash' | 'transfer', totalTitle: string) => {
    const list = r.expenses[part];
    if (list.length === 0) {
      rows.push({ key: `${part}-empty`, title: 'Расходов нет', kind: 'line', values: null, total: null });
    }
    list.forEach((e, i) => {
      rows.push({
        key: `${part}-${e.category}`,
        no: i + 1,
        title: e.category,
        kind: 'line',
        values: Object.fromEntries(r.months.map((m) => [m, e.byMonth[m] ?? 0])),
        total: e.total,
        hint: e.count ? `Записей: ${e.count}` : undefined,
      });
    });
    rows.push(line(`${part}-total`, totalTitle, 'subtotal', (p) => p[part].expenses));
  };

  expenseBlock('cash', 'ИТОГО ВСЕ РАСХОДЫ наличная часть:');
  expenseBlock('transfer', 'ИТОГО ВСЕ РАСХОДЫ перечислением');

  rows.push(
    line('expenses', 'Общие расходы', 'grand', (p) => p.all.expenses),
    { key: 'np-section', title: 'ЧИСТАЯ ПРИБЫЛЬ в разрезе:', kind: 'profit', values: null, total: null },
    line('np-cash', 'Наличная часть', 'line', (p) => p.cash.netProfit, undefined,
      'Сделки не на перечисление: валовая прибыль минус расходы наличной части'),
    line('np-transfer', 'Перечисление', 'line', (p) => p.transfer.netProfit, undefined,
      'Сделки на перечисление: валовая прибыль минус расходы перечислением'),
    line('np', 'ЧИСТАЯ ПРИБЫЛЬ ВСЕГО:', 'profit', (p) => p.all.netProfit),
  );
  return rows;
}

export default function FinanceReportPage() {
  const cost = useCostAccess();
  const isMobile = useIsMobile();
  const { token } = theme.useToken();
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => presetRange('month'));

  const from = range[0].format('YYYY-MM-DD');
  const to = range[1].format('YYYY-MM-DD');

  const { data, isLoading, error } = useQuery({
    queryKey: ['finance-report', from, to],
    queryFn: () => financeReportApi.get(from, to),
    enabled: cost.open,
  });

  const rows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const showMonths = (data?.months.length ?? 0) > 1;

  const rowStyle = (kind: RowKind): CSSProperties => {
    switch (kind) {
      case 'bold': return { fontWeight: 600 };
      case 'gross': return { background: token.colorWarningBg };
      case 'subtotal': return { fontWeight: 600, background: token.colorFillSecondary };
      case 'grand': return { fontWeight: 700, background: token.colorErrorBg, color: token.colorErrorText };
      case 'profit': return { fontWeight: 700, background: token.colorSuccessBg };
      default: return {};
    }
  };

  const money = (v: number | null | undefined, kind: RowKind) => {
    if (v == null) return null;
    const neg = v < 0 && (kind === 'bold' || kind === 'profit' || kind === 'line');
    return (
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: neg ? token.colorError : undefined }}>
        {formatUZS(Math.round(v))}
      </span>
    );
  };

  const columns = [
    {
      title: '№',
      dataIndex: 'no',
      width: 44,
      align: 'center' as const,
      onCell: (r: ReportRow) => ({ style: rowStyle(r.kind) }),
    },
    {
      title: 'Наименование и статьи расходов',
      dataIndex: 'title',
      fixed: 'left' as const,
      width: isMobile ? 200 : 340,
      onCell: (r: ReportRow) => ({ style: rowStyle(r.kind) }),
      render: (title: string, r: ReportRow) => (
        <span title={r.hint}>
          {title}
          {r.hint && (r.key === 'revenue' || r.key === 'cogs') && (
            <Text type="secondary" style={{ display: 'block', fontSize: 11, fontWeight: 400 }}>{r.hint}</Text>
          )}
        </span>
      ),
    },
    ...(showMonths
      ? (data?.months ?? []).map((m) => ({
        title: monthLabel(m),
        key: m,
        align: 'right' as const,
        width: 150,
        onCell: (r: ReportRow) => ({ style: rowStyle(r.kind) }),
        render: (_: unknown, r: ReportRow) => money(r.values?.[m], r.kind),
      }))
      : []),
    {
      title: showMonths ? 'Итого' : 'Сумма',
      key: 'total',
      align: 'right' as const,
      width: 170,
      onCell: (r: ReportRow) => ({ style: { ...rowStyle(r.kind), fontWeight: 600 } }),
      render: (_: unknown, r: ReportRow) => money(r.total, r.kind),
    },
  ];

  const errMsg = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <div style={{ padding: isMobile ? 0 : undefined }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Финансовый отчёт</Title>
        <Space wrap>
          <Segmented<PeriodPreset>
            value={preset}
            onChange={(v) => {
              setPreset(v);
              if (v !== 'custom') setRange(presetRange(v));
            }}
            options={[
              { label: 'Этот месяц', value: 'month' },
              { label: 'Прошлый', value: 'prev' },
              { label: '3 месяца', value: 'quarter' },
              { label: 'Год', value: 'year' },
              { label: 'Период', value: 'custom' },
            ]}
          />
          <DatePicker.RangePicker
            value={range}
            format="DD.MM.YYYY"
            allowClear={false}
            onChange={(v) => {
              if (v?.[0] && v?.[1]) {
                setRange([v[0], v[1]]);
                setPreset('custom');
              }
            }}
          />
        </Space>
      </Space>

      {!cost.open ? (
        <Card>
          <Empty
            image={<LockOutlined style={{ fontSize: 48, color: token.colorTextTertiary }} />}
            description={
              <Space direction="vertical">
                <Text strong>Отчёт защищён ПИН-кодом</Text>
                <Text type="secondary">В нём себестоимость и прибыль. Откройте доступ своим ПИН-кодом.</Text>
              </Space>
            }
          >
            <CostAccessButton label="Ввести ПИН-код" />
          </Empty>
        </Card>
      ) : isLoading ? (
        <Card><div style={{ textAlign: 'center', padding: 48 }}><Spin /></div></Card>
      ) : error || !data ? (
        <Alert type="error" showIcon message={errMsg || 'Не удалось загрузить отчёт'} />
      ) : (
        <>
          {(data.warnings.linesWithoutPurchasePrice > 0 || data.warnings.foreignExpensesWithoutRate > 0) && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Отчёт может быть неполным"
              description={
                <>
                  {data.warnings.linesWithoutPurchasePrice > 0 && (
                    <div>
                      У {data.warnings.linesWithoutPurchasePrice} строк сделок нет цены закупки — их себестоимость не посчитана
                      (выручка по ним {formatUZS(Math.round(data.warnings.revenueWithoutPurchasePrice))} с НДС).
                    </div>
                  )}
                  {data.warnings.foreignExpensesWithoutRate > 0 && (
                    <div>{data.warnings.foreignExpensesWithoutRate} валютных расходов без курса не вошли в отчёт.</div>
                  )}
                </>
              }
            />
          )}
          <Card styles={{ body: { padding: 0 } }}>
            <Table<ReportRow>
              size="small"
              bordered
              pagination={false}
              rowKey="key"
              dataSource={rows}
              columns={columns}
              scroll={{ x: 'max-content' }}
            />
          </Card>
          {data.nonOperating.length > 0 && (
            <Card size="small" style={{ marginTop: 12 }} title="Не входит в расходы (деньги ушли из кассы, но это не расход бизнеса)">
              {data.nonOperating.map((n) => (
                <div key={n.category} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>{n.category}</Text>
                  <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatUZS(Math.round(n.total))}</Text>
                </div>
              ))}
            </Card>
          )}
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
            Товарооборот — строки закрытых сделок по дате закрытия; себестоимость — по текущей цене закупки товара.
            Расходы — одобренные записи из раздела «Расходы»: перечислением — способ «Перечисление», остальные — наличная часть.
          </Text>
        </>
      )}
    </div>
  );
}
