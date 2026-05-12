import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Calendar, Card, Col, Empty, List, Row, Skeleton, Space, Tag, Typography, theme } from 'antd';
import { Link } from 'react-router-dom';
import dayjs, { type Dayjs } from 'dayjs';
import { foreignTradeApi } from '../api/foreign-trade.api';
import type { BlockingHolidayEvent, ImportOrderListItem } from '../types';
import {
  getBlockingHitsForDate,
  groupBlockingEventsByDate,
  normalizeVedCountry,
  uniqueCountryCodes,
} from '../utils/vedBlockingCalendar';

type RiskOrderHit = {
  order: ImportOrderListItem;
  etdHits: BlockingHolidayEvent[];
  etaHits: BlockingHolidayEvent[];
};

function monthRange(value: Dayjs) {
  return {
    from: value.startOf('month').startOf('week'),
    to: value.endOf('month').endOf('week'),
  };
}

export default function ImportBlockingCalendarCard({ orders }: { orders: ImportOrderListItem[] }) {
  const { token } = theme.useToken();
  const [panelValue, setPanelValue] = useState(() => dayjs().startOf('month'));
  const [selectedDate, setSelectedDate] = useState(() => dayjs().startOf('day'));

  const visibleRange = useMemo(() => monthRange(panelValue), [panelValue]);

  const { data, isLoading } = useQuery({
    queryKey: [
      'foreign-trade-blocking-events',
      visibleRange.from.format('YYYY-MM-DD'),
      visibleRange.to.format('YYYY-MM-DD'),
    ],
    queryFn: () => foreignTradeApi.getBlockingEvents({
      from: visibleRange.from.format('YYYY-MM-DD'),
      to: visibleRange.to.format('YYYY-MM-DD'),
    }),
    staleTime: 5 * 60_000,
  });

  const events = data?.items ?? [];
  const eventsByDate = useMemo(() => groupBlockingEventsByDate(events), [events]);
  const selectedDateKey = selectedDate.format('YYYY-MM-DD');
  const selectedDayEvents = eventsByDate.get(selectedDateKey) ?? [];
  const monthCountryCodes = useMemo(() => uniqueCountryCodes(events), [events]);

  const riskOrders = useMemo<RiskOrderHit[]>(() => {
    return orders
      .map((order) => {
        const countryCode = normalizeVedCountry(order.supplier.country);
        const etdHits = getBlockingHitsForDate(order.etd, eventsByDate, countryCode);
        const etaHits = getBlockingHitsForDate(order.eta, eventsByDate, countryCode);
        return { order, etdHits, etaHits };
      })
      .filter((row) => row.etdHits.length > 0 || row.etaHits.length > 0);
  }, [orders, eventsByDate]);

  const selectedDayRiskOrders = useMemo(() => {
    return riskOrders.filter((row) => (
      row.etdHits.some((hit) => hit.date === selectedDateKey)
      || row.etaHits.some((hit) => hit.date === selectedDateKey)
    ));
  }, [riskOrders, selectedDateKey]);

  const countryLabelMap = useMemo(() => {
    return new Map((data?.countries ?? []).map((country) => [country.code, country.label]));
  }, [data?.countries]);

  return (
    <Card
      style={{ marginBottom: 16 }}
      title={(
        <Space wrap size={[8, 8]}>
          <Typography.Text strong>Календарь блокирующих дней ВЭД</Typography.Text>
          <Tag color="red">Красные дни: праздники / нерабочие дни</Tag>
        </Space>
      )}
      extra={(
        <Space wrap size={[6, 6]}>
          {monthCountryCodes.map((code) => (
            <Tag key={code} color={code === 'CN' || code === 'TR' ? 'volcano' : 'default'}>
              {countryLabelMap.get(code) ?? code}
            </Tag>
          ))}
        </Space>
      )}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        Календарь показывает официальные праздники для Китая, Турции, Грузии, России, Казахстана,
        Ирана, Кыргызстана и Туркменистана. Если ETD или ETA заказа попадает на такой день, заказ
        попадает в блок риска.
      </Typography.Paragraph>

      {isLoading ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={16}>
            <Calendar
              fullscreen={false}
              value={selectedDate}
              onSelect={(value) => setSelectedDate(value.startOf('day'))}
              onPanelChange={(value) => {
                setPanelValue(value.startOf('month'));
                setSelectedDate(value.startOf('month'));
              }}
              dateFullCellRender={(value) => {
                const dayEvents = eventsByDate.get(value.format('YYYY-MM-DD')) ?? [];
                const dayCountryCodes = uniqueCountryCodes(dayEvents);
                const isSelected = value.isSame(selectedDate, 'day');
                const isCurrentMonth = value.month() === panelValue.month();

                return (
                  <div
                    style={{
                      minHeight: 76,
                      padding: 6,
                      borderRadius: 12,
                      border: `1px solid ${
                        isSelected ? token.colorPrimary : dayEvents.length ? token.colorErrorBorder : 'transparent'
                      }`,
                      background: dayEvents.length
                        ? (isSelected ? token.colorErrorBg : 'rgba(255, 77, 79, 0.10)')
                        : isSelected
                        ? token.colorPrimaryBg
                        : 'transparent',
                      opacity: isCurrentMonth ? 1 : 0.52,
                      transition: 'all 120ms ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <Typography.Text
                        strong={isSelected}
                        style={{ color: dayEvents.length ? token.colorError : undefined }}
                      >
                        {value.date()}
                      </Typography.Text>
                      {dayEvents.length > 0 ? (
                        <Badge
                          count={dayEvents.length}
                          size="small"
                          style={{ backgroundColor: token.colorError }}
                        />
                      ) : null}
                    </div>
                    {dayCountryCodes.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
                        {dayCountryCodes.slice(0, 2).map((code) => (
                          <Tag key={code} color="red" style={{ marginInlineEnd: 0 }}>
                            {code}
                          </Tag>
                        ))}
                        {dayCountryCodes.length > 2 ? (
                          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            +{dayCountryCodes.length - 2}
                          </Typography.Text>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
          </Col>

          <Col xs={24} xl={8}>
            <div
              style={{
                display: 'grid',
                gap: 12,
                padding: 16,
                borderRadius: 16,
                background: token.colorFillQuaternary,
                border: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  Выбранная дата
                </Typography.Text>
                <Typography.Text strong style={{ fontSize: 18 }}>
                  {selectedDate.format('DD.MM.YYYY')}
                </Typography.Text>
              </div>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  События дня
                </Typography.Text>
                {selectedDayEvents.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="На этот день блокирующих событий нет"
                  />
                ) : (
                  <List
                    size="small"
                    dataSource={selectedDayEvents}
                    renderItem={(item) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space direction="vertical" size={2}>
                          <Space wrap size={[6, 6]}>
                            <Tag color={item.isPrimaryCountry ? 'volcano' : 'red'}>
                              {item.countryLabel}
                            </Tag>
                            <Typography.Text strong>{item.name}</Typography.Text>
                          </Space>
                          {item.note ? (
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {item.note}
                            </Typography.Text>
                          ) : null}
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </div>

              <div>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  Заказы под риском в этом месяце
                </Typography.Text>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {riskOrders.length > 0
                    ? `Найдено ${riskOrders.length} заказ(ов), где ETD или ETA попадает на красный день.`
                    : 'В текущем месяце совпадений по ETD/ETA нет.'}
                </Typography.Text>
                {selectedDayRiskOrders.length > 0 ? (
                  <List
                    size="small"
                    dataSource={selectedDayRiskOrders.slice(0, 6)}
                    renderItem={(row) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space direction="vertical" size={2}>
                          <Link to={`/foreign-trade/import-orders/${row.order.id}`} style={{ fontWeight: 600 }}>
                            {row.order.number}
                          </Link>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {row.order.supplier.companyName}
                          </Typography.Text>
                          <Space wrap size={[6, 6]}>
                            {row.etdHits.some((hit) => hit.date === selectedDateKey) ? (
                              <Tag color="volcano">ETD</Tag>
                            ) : null}
                            {row.etaHits.some((hit) => hit.date === selectedDateKey) ? (
                              <Tag color="magenta">ETA</Tag>
                            ) : null}
                          </Space>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="На выбранную дату заказов под риском нет"
                  />
                )}
              </div>
            </div>
          </Col>
        </Row>
      )}
    </Card>
  );
}
