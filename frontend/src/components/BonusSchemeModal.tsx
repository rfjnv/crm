import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, InputNumber, Button, Typography, Row, Col, Space, Divider, Alert, Spin, message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { analyticsApi } from '../api/analytics.api';
import type { BonusCriterionKey, BonusScheme } from '../types';

const { Text } = Typography;

// Пять критериев без плана продаж: план уже определил ставку и базу бонуса.
const CRITERIA: { key: BonusCriterionKey; label: string; hint: string }[] = [
  { key: 'assortment', label: 'Ассортимент', hint: 'сколько разных позиций продал' },
  { key: 'contacts', label: 'Звонки и контакты', hint: 'заметки клиента + доска звонков' },
  { key: 'clients', label: 'Привлечение клиентов', hint: 'новые + вернувшиеся' },
  { key: 'leads', label: 'Лиды', hint: 'холодные контакты, которые купили' },
  { key: 'attendance', label: 'Посещаемость', hint: 'дней вовремя / рабочих дней' },
];

const TARGETS: { key: keyof BonusScheme['targets']; label: string; suffix: string }[] = [
  { key: 'assortment', label: 'Ассортимент', suffix: 'позиций' },
  { key: 'contacts', label: 'Контакты', suffix: 'шт.' },
  { key: 'clients', label: 'Привлечение', suffix: 'клиентов' },
  { key: 'leads', label: 'Лиды', suffix: 'покупок' },
];

/**
 * Настройка расчёта бонуса: веса критериев, ступени ставки и цели по умолчанию.
 *
 * Цель по плану продаж и по контактам задаётся каждому лично в «Изменить план»;
 * здесь — только то, что общее для отдела.
 */
export default function BonusSchemeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BonusScheme>();

  const { data, isLoading } = useQuery({
    queryKey: ['bonus-scheme'],
    queryFn: analyticsApi.getBonusScheme,
    enabled: open,
  });

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (scheme: BonusScheme) => analyticsApi.saveBonusScheme(scheme),
    onSuccess: () => {
      message.success('Схема бонуса сохранена');
      queryClient.invalidateQueries({ queryKey: ['bonus-scheme'] });
      queryClient.invalidateQueries({ queryKey: ['manager-kpi'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      message.error(msg || 'Не удалось сохранить схему');
    },
  });

  const weights = Form.useWatch('weights', form);
  const sum = CRITERIA.reduce((s, c) => s + (Number(weights?.[c.key]) || 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.05;

  return (
    <Modal
      title="Расчёт бонуса"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={save.isPending}
      okButtonProps={{ disabled: !sumOk }}
      width={640}
      destroyOnClose
    >
      {isLoading ? (
        <Spin style={{ display: 'block', margin: '40px auto' }} />
      ) : (
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Text strong>Веса критериев</Text>
          <div style={{ marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Из них складываются 100% бонуса. Ненужный критерий можно поставить в 0 —
              его вес разойдётся по остальным.
            </Text>
          </div>
          <Row gutter={[12, 0]}>
            {CRITERIA.map((c) => (
              <Col xs={12} md={8} key={c.key}>
                {/* Подсказка под полем, а не в подписи: подписи разной высоты
                    разъезжались и поля вставали на разных уровнях. */}
                <Form.Item
                  name={['weights', c.key]}
                  label={c.label}
                  extra={<Text type="secondary" style={{ fontSize: 11 }}>{c.hint}</Text>}
                >
                  <InputNumber style={{ width: '100%' }} min={0} max={100} addonAfter="%" />
                </Form.Item>
              </Col>
            ))}
          </Row>
          <Alert
            type={sumOk ? 'success' : 'error'}
            showIcon
            message={sumOk ? 'Сумма весов 100%' : `Сумма весов ${Math.round(sum * 10) / 10}% — должно быть ровно 100%`}
          />

          <Divider titlePlacement="start" style={{ marginTop: 20 }}>Ступени ставки</Divider>
          <Text type="secondary" style={{ fontSize: 12 }}>
            От какого процента выполнения плана какая доля от фактической выручки идёт в базу бонуса.
            Например: от 50% — 0,5%, от 80% — 0,6%.
          </Text>
          <Form.List name="tiers">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 10 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                    <Form.Item {...field} name={[field.name, 'fromPercent']} label={null} style={{ marginBottom: 0 }}>
                      <InputNumber min={0} max={1000} addonBefore="от" addonAfter="% плана" style={{ width: 190 }} />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'rate']} label={null} style={{ marginBottom: 0 }}>
                      <InputNumber min={0} max={100} step={0.1} addonBefore="ставка" addonAfter="%" style={{ width: 200 }} />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                      disabled={fields.length <= 1}
                    />
                  </Space>
                ))}
                <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add({ fromPercent: 0, rate: 0 })}>
                  Добавить ступень
                </Button>
              </div>
            )}
          </Form.List>

          <Divider titlePlacement="start" style={{ marginTop: 20 }}>Цели по умолчанию</Divider>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Применяются, когда сотруднику не задана личная цель. План по выручке и по контактам
            задаётся каждому отдельно в «Изменить план», посещаемость считается от рабочих дней месяца.
          </Text>
          <Row gutter={[12, 0]} style={{ marginTop: 10 }}>
            {TARGETS.map((t) => (
              <Col xs={12} md={6} key={t.key}>
                <Form.Item name={['targets', t.key]} label={t.label}>
                  <InputNumber style={{ width: '100%' }} min={0} addonAfter={t.suffix} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      )}
    </Modal>
  );
}
