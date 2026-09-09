import { Card, Table, Progress, Row, Col, Statistic, Typography, Alert, Tag, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { formatUZS } from '../utils/currency';
import type { ManagerBonus, ManagerBonusCriterion, BonusTier, ManagerKpiRow } from '../types';

const { Text } = Typography;

const MONTHS = [
  'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
  'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
];

/** Процент с одним знаком — «59,2%», а не «59.2 %». */
function fmtPercent(value: number | null, digits = 1): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',').replace(/,0$/, '')}%`;
}

/** Ставка — доля процента, поэтому свой формат: 0,5% и 0,05% должны читаться. */
function fmtRate(rate: number): string {
  return `${String(rate).replace('.', ',')}%`;
}

function fmtValue(value: number, unit: 'money' | 'count'): string {
  return unit === 'money' ? formatUZS(value) : value.toLocaleString('ru-RU');
}

function tiersLabel(tiers: BonusTier[]): string {
  return tiers
    .map((t, i) => {
      const next = tiers[i + 1];
      const range = next ? `${t.fromPercent}–${next.fromPercent}%` : `от ${t.fromPercent}%`;
      return `${range} → ${fmtRate(t.rate)}`;
    })
    .join(' · ');
}

/**
 * Расчёт бонуса менеджера с раскрытой арифметикой.
 *
 * Показываем каждый шаг, а не только итог: премия — цифра, которую человек
 * оспаривает, и «поверьте расчёту» здесь не работает.
 */
export default function ManagerBonusCard(
  { bonus, salary, tiers }: { bonus: ManagerBonus; salary: ManagerKpiRow['salary']; tiers: BonusTier[] },
) {
  const noPlan = bonus.planPercent === null;
  const belowFirstTier = !noPlan && bonus.rate === 0;
  const redistributed = Math.abs(bonus.weightUsed - 100) > 0.05;

  const columns = [
    {
      title: 'Критерий',
      dataIndex: 'label',
      key: 'label',
      render: (v: string, c: ManagerBonusCriterion) => (
        <span>
          {v}
          {c.target === null && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>цель не задана</Text>
          )}
        </span>
      ),
    },
    {
      title: 'Вес',
      dataIndex: 'weight',
      key: 'weight',
      width: 70,
      align: 'right' as const,
      render: (v: number, c: ManagerBonusCriterion) =>
        c.target === null ? <Text delete type="secondary">{v}%</Text> : `${v}%`,
    },
    {
      title: 'Факт / цель',
      key: 'fact',
      width: 155,
      align: 'right' as const,
      // Двумя строками: «592 395 100 so'm / 1 000 000 000 so'm» в одну не влезает
      // и переносится посреди числа.
      render: (_: unknown, c: ManagerBonusCriterion) => (
        <div style={{ lineHeight: 1.35 }}>
          <Text strong style={{ whiteSpace: 'nowrap' }}>{fmtValue(c.fact, c.unit)}</Text>
          <br />
          <Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
            из {c.target === null ? '—' : fmtValue(c.target, c.unit)}
          </Text>
        </div>
      ),
    },
    {
      title: 'Выполнение',
      key: 'percent',
      width: 140,
      render: (_: unknown, c: ManagerBonusCriterion) =>
        c.percent === null ? (
          <Text type="secondary">—</Text>
        ) : (
          <Tooltip title={c.rawPercent !== null && c.rawPercent > 1
            ? `Фактически ${fmtPercent(c.rawPercent)}, в расчёт идёт 100%`
            : undefined}>
            <Progress
              percent={Math.round(c.percent * 100)}
              size="small"
              strokeColor={c.percent >= 1 ? '#52c41a' : c.percent >= 0.7 ? '#faad14' : '#ff4d4f'}
            />
          </Tooltip>
        ),
    },
    {
      title: 'Вклад',
      dataIndex: 'contribution',
      key: 'contribution',
      width: 80,
      align: 'right' as const,
      render: (v: number, c: ManagerBonusCriterion) =>
        c.target === null ? <Text type="secondary">—</Text> : <Text strong>{fmtPercent(v)}</Text>,
    },
  ];

  return (
    <Card
      size="small"
      style={{ marginBottom: 12 }}
      title={(
        <span>
          Бонус за месяц
          <Tooltip title="Сначала ставка по выполнению плана даёт базу от фактической выручки, затем база умножается на средневзвешенное выполнение критериев.">
            <InfoCircleOutlined style={{ marginLeft: 8, fontSize: 13, opacity: 0.55 }} />
          </Tooltip>
        </span>
      )}
      extra={<Tag color={bonus.amount > 0 ? 'green' : 'default'} style={{ margin: 0, fontSize: 13 }}>
        {formatUZS(bonus.amount)}
      </Tag>}
    >
      {noPlan && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="План на месяц не задан — ставка 0%, бонус не считается."
        />
      )}
      {belowFirstTier && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Выполнение плана ${fmtPercent(bonus.planPercent)} — ниже первой ступени, ставка 0%.`}
        />
      )}

      <Row gutter={[12, 12]} style={{ marginBottom: 4 }}>
        <Col xs={12} md={6}>
          <Statistic
            title="Выполнение плана"
            value={fmtPercent(bonus.planPercent)}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="Ставка"
            value={fmtRate(bonus.rate)}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="База (100%)"
            value={bonus.base}
            formatter={(v) => formatUZS(Number(v))}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col xs={12} md={6}>
          <Statistic
            title="Критерии"
            value={fmtPercent(bonus.score)}
            valueStyle={{ fontSize: 18, color: '#1677ff' }}
          />
        </Col>
      </Row>

      {/* Строка формулы: те же числа, что в статистиках, но подряд — так проверяют счёт вручную. */}
      <div style={{ margin: '10px 0 12px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatUZS(bonus.revenueFact)}
          {` × ${fmtRate(bonus.rate)} = `}
          <Text strong style={{ fontSize: 12 }}>{formatUZS(bonus.base)}</Text>
          {` → × ${fmtPercent(bonus.score)} = `}
          <Text strong style={{ fontSize: 12, color: '#52c41a' }}>{formatUZS(bonus.amount)}</Text>
        </Text>
      </div>

      <Table
        size="small"
        pagination={false}
        dataSource={bonus.criteria}
        rowKey="key"
        columns={columns}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><Text strong>Итого</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={1} align="right">
              <Text strong>{bonus.weightUsed}%</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} />
            <Table.Summary.Cell index={3} />
            <Table.Summary.Cell index={4} align="right">
              <Text strong style={{ color: '#1677ff' }}>{fmtPercent(bonus.score)}</Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />

      <Row gutter={[12, 12]} style={{ marginTop: 14 }}>
        <Col xs={8}>
          <Statistic
            title="Оклад"
            value={salary.fixed ?? 0}
            formatter={(v) => (salary.fixed === null ? '—' : formatUZS(Number(v)))}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col xs={8}>
          <Statistic
            title="Бонус"
            value={salary.bonus}
            formatter={(v) => formatUZS(Number(v))}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col xs={8}>
          <Statistic
            title="К выплате"
            value={salary.total}
            formatter={(v) => formatUZS(Number(v))}
            valueStyle={{ fontSize: 18, color: '#52c41a' }}
          />
        </Col>
      </Row>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {salary.fixed === null
          ? 'Оклад на этот месяц не задан — в выплате только бонус. Задать можно в «Изменить план».'
          : salary.carriedFrom
            ? `Оклад перенесён с ${MONTHS[salary.carriedFrom.month - 1]} ${salary.carriedFrom.year}: на этот месяц его не задавали.`
            : 'Оклад задан на этот месяц.'}
      </Text>

      <div style={{ marginTop: 10 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Ступени ставки: {tiersLabel(tiers)}. Ставка берётся от фактической выручки, а не от плана.
        </Text>
        {redistributed && (
          <>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Критерии без цели из расчёта исключены, их вес распределён между остальными —
              поэтому в работе {bonus.weightUsed}% весов, а не 100%.
            </Text>
          </>
        )}
      </div>
    </Card>
  );
}
