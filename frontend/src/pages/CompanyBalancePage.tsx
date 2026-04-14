import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Typography, Space, Segmented, Select, Row, Col, Spin, Form, InputNumber, DatePicker, Button } from 'antd';
import { Line, Column } from '@ant-design/charts';
import { theme } from 'antd';
import dayjs from 'dayjs';
import { financeApi } from '../api/finance.api';
import { settingsApi } from '../api/settings.api';
import { usersApi } from '../api/users.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import { useIsMobile } from '../hooks/useIsMobile';
import BackButton from '../components/BackButton';

export default function CompanyBalancePage() {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { token: tk } = theme.useToken();
  const [setupForm] = Form.useForm();
  const [balancePeriod, setBalancePeriod] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [balanceMethod, setBalanceMethod] = useState<string | undefined>(undefined);
  const [balanceManagerId, setBalanceManagerId] = useState<string | undefined>(undefined);

  const { data: users } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => usersApi.list(),
  });

  const managers = (users ?? [])
    .filter((u: { role: string; isActive: boolean }) =>
      ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'OPERATOR'].includes(u.role) && u.isActive,
    )
    .map((u: { id: string; fullName: string }) => ({ value: u.id, label: u.fullName }));

  const { data: companySettings } = useQuery({
    queryKey: ['company-settings'],
    queryFn: settingsApi.getCompanySettings,
  });

  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['company-balance', balancePeriod, balanceMethod, balanceManagerId],
    queryFn: () =>
      financeApi.companyBalance({
        period: balancePeriod,
        method: balanceMethod,
        managerId: balanceManagerId,
      }),
    refetchInterval: 30_000,
  });

  const setupBalanceMut = useMutation({
    mutationFn: (vals: { initialBalance: number; balanceStartDate: string }) =>
      settingsApi.updateCompanySettings({
        initialBalance: vals.initialBalance,
        balanceStartDate: vals.balanceStartDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-settings'] });
      queryClient.invalidateQueries({ queryKey: ['company-balance'] });
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <BackButton fallback="/dashboard" />
        <Typography.Title level={4} style={{ margin: 0 }}>Баланс компании</Typography.Title>
      </div>

      {!companySettings?.balanceStartDate || balanceData?.setupRequired ? (
        <Card>
          <Typography.Title level={5} style={{ marginTop: 0 }}>Первичная настройка баланса</Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Исторические данные до выбранной даты не учитываются. Баланс считается только от начальной точки.
          </Typography.Paragraph>
          <Form
            form={setupForm}
            layout="vertical"
            initialValues={{
              initialBalance: Number(companySettings?.initialBalance || 0),
              balanceStartDate: dayjs(),
            }}
            onFinish={(vals) =>
              setupBalanceMut.mutate({
                initialBalance: Number(vals.initialBalance || 0),
                balanceStartDate: dayjs(vals.balanceStartDate).format('YYYY-MM-DD'),
              })
            }
          >
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="initialBalance"
                  label="Начальный баланс"
                  rules={[{ required: true, message: 'Укажите начальный баланс' }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={moneyFormatter}
                    parser={moneyParser}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="balanceStartDate"
                  label="Дата начала учета"
                  rules={[{ required: true, message: 'Укажите дату начала' }]}
                >
                  <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" htmlType="submit" loading={setupBalanceMut.isPending}>
              Подтвердить и запустить учет
            </Button>
          </Form>
        </Card>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 16 }}>
            <Segmented
              value={balancePeriod}
              onChange={(v) => setBalancePeriod(v as 'day' | 'week' | 'month' | 'year')}
              options={[
                { label: 'День', value: 'day' },
                { label: 'Неделя', value: 'week' },
                { label: 'Месяц', value: 'month' },
                { label: 'Год', value: 'year' },
              ]}
            />
            <Select
              allowClear
              placeholder="Способ оплаты"
              style={{ width: isMobile ? '100%' : 180 }}
              value={balanceMethod}
              onChange={setBalanceMethod}
              options={[
                { label: 'Наличные', value: 'CASH' },
                { label: 'Перечисление', value: 'TRANSFER' },
                { label: 'Payme', value: 'PAYME' },
                { label: 'QR', value: 'QR' },
                { label: 'Click', value: 'CLICK' },
                { label: 'Терминал', value: 'TERMINAL' },
                { label: 'Рассрочка', value: 'INSTALLMENT' },
              ]}
            />
            <Select
              allowClear
              placeholder="Менеджер"
              style={{ width: isMobile ? '100%' : 200 }}
              value={balanceManagerId}
              onChange={setBalanceManagerId}
              options={managers}
            />
          </Space>

          {balanceLoading ? (
            <Spin />
          ) : (
            <>
              <Card style={{ marginBottom: 16, borderRadius: 12 }} bodyStyle={{ padding: isMobile ? 16 : 24 }}>
                <Typography.Text type="secondary">Баланс компании</Typography.Text>
                <div style={{ fontSize: isMobile ? 34 : 46, fontWeight: 700, lineHeight: 1.1, marginTop: 8 }}>
                  {formatUZS(balanceData?.kpi?.balance ?? 0)}
                </div>
                <Space size="large" style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">Касса: {formatUZS(balanceData?.kpi?.cash ?? 0)}</Typography.Text>
                  <Typography.Text type="secondary">Банк: {formatUZS(balanceData?.kpi?.bank ?? 0)}</Typography.Text>
                  <Typography.Text type="secondary">
                    Обновлено: {dayjs(balanceData?.updatedAt).format('DD.MM.YYYY HH:mm')}
                  </Typography.Text>
                </Space>
              </Card>

              <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Реальные деньги</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: tk.colorSuccess }}>{formatUZS(balanceData?.breakdown?.real ?? 0)}</div>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Ожидается</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#faad14' }}>{formatUZS(balanceData?.breakdown?.expected ?? 0)}</div>
                  </Card>
                </Col>
                <Col xs={24} md={8}>
                  <Card style={{ borderRadius: 12 }}>
                    <Typography.Text type="secondary">Долги</Typography.Text>
                    <div style={{ fontSize: 24, fontWeight: 700, color: tk.colorError }}>{formatUZS(balanceData?.breakdown?.debts ?? 0)}</div>
                  </Card>
                </Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                  <Card title="Баланс во времени" style={{ borderRadius: 12 }}>
                    <Line
                      data={balanceData?.charts?.balanceLine ?? []}
                      xField="day"
                      yField="balance"
                      smooth
                      height={isMobile ? 240 : 280}
                      axis={{ y: { labelFormatter: (v) => formatUZS(Number(v)) } }}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={12}>
                  <Card title="Денежный поток" style={{ borderRadius: 12 }}>
                    <Column
                      data={
                        (balanceData?.charts?.cashFlow ?? []).flatMap((d) => ([
                          { day: d.day, type: 'Входящий', value: d.incoming ?? 0 },
                          { day: d.day, type: 'Исходящий', value: d.outgoing ?? 0 },
                        ]))
                      }
                      xField="day"
                      yField="value"
                      seriesField="type"
                      group
                      height={isMobile ? 240 : 280}
                      color={[tk.colorSuccess, tk.colorError]}
                      axis={{ y: { labelFormatter: (v) => formatUZS(Number(v)) } }}
                    />
                  </Card>
                </Col>
                <Col span={24}>
                  <Card title="Поступления по дням" style={{ borderRadius: 12 }}>
                    <Column
                      data={(balanceData?.charts?.paymentsPerDay ?? []).map((d) => ({ day: d.day, total: d.total ?? 0 }))}
                      xField="day"
                      yField="total"
                      height={isMobile ? 220 : 260}
                      color={tk.colorSuccess}
                      axis={{ y: { labelFormatter: (v) => formatUZS(Number(v)) } }}
                    />
                  </Card>
                </Col>
              </Row>
            </>
          )}
        </>
      )}
    </div>
  );
}
