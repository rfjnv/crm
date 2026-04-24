import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Space, Tag, Tooltip, Typography, Button, Alert, message } from 'antd';
import { ReloadOutlined, ArrowUpOutlined, ArrowDownOutlined, CloudSyncOutlined } from '@ant-design/icons';
import { isAxiosError } from 'axios';
import { cbuApi, type CbuRate } from '../api/cbu.api';
import { useAuthStore } from '../store/authStore';
import type { SupplierCurrency } from '../types';

interface Props {
  /** Если задано — рядом с курсом отображается кнопка «подставить». */
  onPick?: (ccy: SupplierCurrency, rate: number) => void;
  compact?: boolean;
}

function formatRate(r: CbuRate): string {
  const unit = r.nominal && r.nominal > 1 ? ` / ${r.nominal}` : '';
  return `${r.rate.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}${unit}`;
}

function cbuLoadErrorText(err: unknown): { message: string; description?: string } {
  if (isAxiosError(err)) {
    const status = err.response?.status;
    const body = err.response?.data;
    const apiMsg =
      body && typeof body === 'object' && 'error' in body && typeof (body as { error: string }).error === 'string'
        ? (body as { error: string }).error
        : err.message;
    if (status === 403) {
      return {
        message: 'Нет доступа к курсам ЦБ',
        description:
          'Нужно право «Просмотр импортных заказов». Обратитесь к администратору или откройте раздел импорта под учётной записью с этим правом.',
      };
    }
    if (status === 502) {
      return {
        message: 'Сервер не смог получить данные с cbu.uz',
        description: apiMsg,
      };
    }
    return { message: apiMsg || 'Ошибка загрузки курсов' };
  }
  return { message: err instanceof Error ? err.message : 'Ошибка загрузки курсов' };
}

export default function CbuRatesWidget({ onPick, compact }: Props) {
  const user = useAuthStore((s) => s.user);
  const canSync =
    !!user &&
    (user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.permissions?.includes('manage_import_orders'));

  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['cbu-rates'],
    queryFn: cbuApi.rates,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const syncMut = useMutation({
    mutationFn: cbuApi.sync,
    onSuccess: (res) => {
      message.success(
        `Синхронизировано: ${res.upserted}/${res.fetched}${res.sourceDate ? ` на ${res.sourceDate}` : ''}`,
      );
      queryClient.invalidateQueries({ queryKey: ['cbu-rates'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Ошибка синхронизации';
      message.error(msg);
    },
  });

  const rates = data?.rates ?? [];
  const loadErr = isError ? cbuLoadErrorText(error) : null;

  return (
    <Card
      size="small"
      style={{ marginBottom: compact ? 12 : 16 }}
      bodyStyle={{ padding: compact ? '8px 12px' : '10px 14px' }}
      title={(
        <Space size={8}>
          <span style={{ fontWeight: 500 }}>Курсы ЦБ РУз</span>
          {data?.date && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              на {data.date}
            </Typography.Text>
          )}
          {data?.stale && <Tag color="orange">закеширован</Tag>}
        </Space>
      )}
      extra={(
        <Space size={4}>
          {canSync && (
            <Tooltip title="Синхронизировать в БД (для автоподстановки курса в заказы)">
              <Button
                type="text"
                size="small"
                icon={<CloudSyncOutlined spin={syncMut.isPending} />}
                onClick={() => syncMut.mutate()}
                loading={syncMut.isPending}
              >
                {!compact && <span style={{ fontSize: 12 }}>В БД</span>}
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Обновить с cbu.uz">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={isFetching} />}
              onClick={() => refetch()}
            />
          </Tooltip>
        </Space>
      )}
    >
      {isLoading ? (
        <Typography.Text type="secondary">Загрузка…</Typography.Text>
      ) : loadErr ? (
        <Alert
          type="error"
          showIcon
          message={loadErr.message}
          description={loadErr.description}
          action={(
            <Button size="small" onClick={() => refetch()}>
              Повторить
            </Button>
          )}
        />
      ) : rates.length === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Курсы ЦБ недоступны"
          description="Ответ получен, но нет данных по валютам USD, EUR, CNY, RUB, GBP. Попробуйте обновить позже."
        />
      ) : (
        <Space wrap size={compact ? 8 : 14}>
          {rates.map((r) => {
            const up = r.diff > 0;
            const down = r.diff < 0;
            const diffColor = up ? '#cf1322' : down ? '#3f8600' : 'rgba(0,0,0,0.45)';
            const Arrow = up ? ArrowUpOutlined : down ? ArrowDownOutlined : null;
            return (
              <div
                key={r.code}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'rgba(34, 96, 154, 0.06)',
                }}
              >
                <Tag color="blue" style={{ margin: 0 }}>{r.code}</Tag>
                <span style={{ fontWeight: 500 }}>{formatRate(r)}</span>
                <Tooltip title={`Изменение к предыдущему дню: ${r.diff > 0 ? '+' : ''}${r.diff}`}>
                  <span style={{ color: diffColor, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {Arrow && <Arrow style={{ fontSize: 10 }} />}
                    {r.diff > 0 ? '+' : ''}{r.diff.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                  </span>
                </Tooltip>
                {onPick && (r.code === 'USD' || r.code === 'EUR' || r.code === 'CNY' || r.code === 'RUB') && (
                  <Button
                    size="small"
                    type="link"
                    style={{ padding: '0 4px', height: 20, fontSize: 11 }}
                    onClick={() => onPick(r.code as SupplierCurrency, r.rate / (r.nominal || 1))}
                  >
                    подставить
                  </Button>
                )}
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );
}
