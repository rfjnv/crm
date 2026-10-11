import { useEffect, useState } from 'react';
import { Checkbox, Col, Form, InputNumber, Row, Tag, Typography, type FormInstance } from 'antd';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';

/**
 * Часть оплаты, принятая долларами. Поле формы `amount` остаётся полным эквивалентом в
 * сумах (он засчитывается на сделку), а здесь указывается, сколько из него пришло в $ и по
 * какому курсу — чтобы касса вела сумы и доллары раздельно, как кассовая книга.
 */
export function UsdPaymentFields({ form }: { form: FormInstance }) {
  const amount = Number(Form.useWatch('amount', form) || 0);
  const usdAmount = Form.useWatch('usdAmount', form) as number | null | undefined;
  const usdRate = Form.useWatch('usdRate', form) as number | null | undefined;
  const [enabled, setEnabled] = useState(false);

  // Форма редактирования приходит с уже заполненной долларовой частью.
  useEffect(() => {
    if (usdAmount != null) setEnabled(true);
  }, [usdAmount]);

  const usdUzs = usdAmount && usdRate ? Math.round(usdAmount * usdRate) : 0;
  const uzsPart = amount - usdUzs;

  return (
    <>
      <Form.Item style={{ marginBottom: enabled ? 8 : undefined }}>
        <Checkbox
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            if (!e.target.checked) form.setFieldsValue({ usdAmount: null, usdRate: null });
          }}
        >
          Часть оплаты принята в долларах
        </Checkbox>
      </Form.Item>
      {enabled && (
        <>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="usdAmount"
                label="Долларами, $"
                rules={[{ required: true, message: 'Сколько $' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0.01} formatter={moneyFormatter} parser={(v) => Number(moneyParser(v))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="usdRate"
                label="Курс, сум за $1"
                rules={[
                  { required: true, message: 'Укажите курс' },
                  {
                    // Доллары больше суммы — это сдача сумами; больше половины — скорее опечатка.
                    validator: () => (usdUzs - amount > usdUzs / 2
                      ? Promise.reject(new Error('Доллары по этому курсу намного больше суммы'))
                      : Promise.resolve()),
                  },
                ]}
              >
                <InputNumber style={{ width: '100%' }} min={1} formatter={moneyFormatter} parser={(v) => Number(moneyParser(v))} />
              </Form.Item>
            </Col>
          </Row>
          {usdUzs > 0 && (
            <Typography.Text type={uzsPart < 0 ? 'warning' : 'secondary'} style={{ display: 'block', marginTop: -8, marginBottom: 12, fontSize: 12 }}>
              ${Number(usdAmount).toLocaleString('ru-RU')} × {Number(usdRate).toLocaleString('ru-RU')} = {formatUZS(usdUzs)} ·{' '}
              {uzsPart >= 0 ? `сумами: ${formatUZS(uzsPart)}` : `сдача сумами: ${formatUZS(-uzsPart)}`}
            </Typography.Text>
          )}
        </>
      )}
    </>
  );
}

/** Значения формы → поля API. forUpdate: снятая галочка явно очищает долларовую часть. */
export function usdPayload(
  values: { usdAmount?: number | null; usdRate?: number | null },
  forUpdate = false,
): { usdAmount?: number | null; usdRate?: number | null } {
  if (values.usdAmount && values.usdRate) return { usdAmount: values.usdAmount, usdRate: values.usdRate };
  return forUpdate ? { usdAmount: null, usdRate: null } : {};
}

/** Плашка «$4 300 × 12 245» у оплаты, принятой (частично) долларами. */
export function UsdPaymentTag({ usdAmount, usdRate }: { usdAmount?: number | string | null; usdRate?: number | string | null }) {
  if (usdAmount == null || Number(usdAmount) === 0) return null;
  const usd = Number(usdAmount).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return (
    <Tag color="green" style={{ marginInlineEnd: 0, marginInlineStart: 6 }} title="Часть оплаты принята долларами по курсу">
      ${usd}{usdRate != null ? ` × ${Number(usdRate).toLocaleString('ru-RU')}` : ''}
    </Tag>
  );
}
