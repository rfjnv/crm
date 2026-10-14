import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Card, Checkbox, Col, DatePicker, Empty, Input, InputNumber, Modal, Row, Segmented,
  Select, Space, Table, Tag, Typography, message,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import BackButton from '../components/BackButton';
import { adminApi, type BackdatedDealsPayload, type BackdatedPlan } from '../api/admin.api';
import { clientsApi } from '../api/clients.api';
import { usersApi } from '../api/users.api';
import { productsApi } from '../api/products.api';
import { formatUZS, moneyFormatter, moneyParser } from '../utils/currency';
import type { Product } from '../types';

/**
 * SUPER_ADMIN: сделки задним числом по отпускной ведомости. Таблицу можно вставить прямо
 * из Excel (дата · клиент · … · товар · кол-во · ед. · цена · сумма) — по одной сделке на
 * каждую дату. Создать можно только после предпросмотра: он показывает рулоны, остатки и
 * возможные дубли, ничего не записывая.
 */

interface Row {
  key: number;
  date: string | null;
  productId: string | null;
  qty: number | null;
  price: number | null;
  rollCount: number | null;
}

const METHODS = [
  { label: 'Наличные', value: 'CASH' },
  { label: 'Перечисление', value: 'TRANSFER' },
  { label: 'QR', value: 'QR' },
  { label: 'Click', value: 'CLICK' },
  { label: 'Payme', value: 'PAYME' },
  { label: 'Терминал', value: 'TERMINAL' },
  { label: 'Рассрочка', value: 'INSTALLMENT' },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
const squash = (s: string) => norm(s).replace(/\s/g, '');

/** «4,145,200» / «1 487 800» / «38.7» / «38,7» → число. */
function parseNumber(raw: string): number | null {
  let s = raw.replace(/[\s ]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Excel отдаёт «10/7/2026» (месяц/день); вручную пишут «07.10.2026». */
function parseDate(raw: string): string | null {
  const t = raw.trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return dayjs(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`).format('YYYY-MM-DD');
  m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? t : null;
}

function parsePasted(text: string, products: Product[]) {
  const bySku = new Map<string, Product>();
  const bySquashed = new Map<string, Product>();
  for (const p of products) {
    bySku.set(norm(p.sku), p);
    bySquashed.set(squash(p.sku), p);
  }
  const rows: Omit<Row, 'key'>[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    if (!line.trim()) return;
    const cells = line.split('\t');
    const date = cells.map(parseDate).find(Boolean) ?? null;
    const skuIdx = cells.findIndex((c) => c.trim() && (bySku.has(norm(c)) || bySquashed.has(squash(c))));
    if (skuIdx < 0) {
      errors.push(`Строка ${idx + 1}: товар не найден — «${line.trim().slice(0, 60)}»`);
      return;
    }
    const product = bySku.get(norm(cells[skuIdx])) ?? bySquashed.get(squash(cells[skuIdx]))!;
    const nums = cells.slice(skuIdx + 1).map(parseNumber).filter((n): n is number => n != null);
    const [qty, price] = nums;
    if (!date || qty == null || price == null) {
      errors.push(`Строка ${idx + 1}: не хватает даты, количества или цены — «${line.trim().slice(0, 60)}»`);
      return;
    }
    rows.push({ date, productId: product.id, qty, price, rollCount: null });
  });
  return { rows, errors };
}

let nextKey = 1;

export default function BackdatedDealsPage() {
  const [clientId, setClientId] = useState<string>();
  const [managerId, setManagerId] = useState<string>();
  const [status, setStatus] = useState<'CLOSED' | 'NEW'>('CLOSED');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentState, setPaymentState] = useState<'UNPAID' | 'PAID'>('UNPAID');
  const [deductStock, setDeductStock] = useState(true);
  const [reason, setReason] = useState('Сделка по отпускной ведомости');
  const [rows, setRows] = useState<Row[]>([]);
  const [paste, setPaste] = useState('');
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<BackdatedPlan | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string; amount: number }[] | null>(null);

  const { data: clients } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list });
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.list() });
  const { data: products } = useQuery<Product[]>({ queryKey: ['products'], queryFn: productsApi.list });
  const productById = useMemo(() => new Map((products ?? []).map((p) => [p.id, p])), [products]);

  // Любая правка делает предпросмотр устаревшим — создавать можно только по свежему.
  const touch = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPlan(null); setCreated(null); };
  const updateRow = (key: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setPlan(null);
  };

  const payload = (): BackdatedDealsPayload | null => {
    if (!clientId || !managerId) { message.warning('Выберите клиента и менеджера'); return null; }
    const bad = rows.find((r) => !r.date || !r.productId || !r.qty || r.price == null);
    if (!rows.length || bad) { message.warning('Заполните у всех строк дату, товар, количество и цену'); return null; }
    return {
      clientId, managerId, status, paymentMethod, paymentState, deductStock, reason,
      items: rows.map((r) => ({ date: r.date!, productId: r.productId!, qty: r.qty!, price: r.price!, rollCount: r.rollCount })),
    };
  };

  const errorText = (err: unknown) => {
    const d = (err as { response?: { data?: { error?: string; details?: string[] } } })?.response?.data;
    return [d?.error, ...(d?.details ?? [])].filter(Boolean).join(': ') || 'Ошибка';
  };

  const previewMut = useMutation({
    mutationFn: adminApi.previewBackdatedDeals,
    onSuccess: (p) => setPlan(p),
    onError: (err) => message.error(errorText(err)),
  });
  const createMut = useMutation({
    mutationFn: adminApi.createBackdatedDeals,
    onSuccess: (r) => { setCreated(r.deals); setPlan(null); setRows([]); message.success(`Создано сделок: ${r.deals.length}`); },
    onError: (err) => message.error(errorText(err)),
  });

  const applyPaste = () => {
    const { rows: parsed, errors } = parsePasted(paste, products ?? []);
    setPasteErrors(errors);
    if (parsed.length) {
      setRows((rs) => [...rs, ...parsed.map((r) => ({ ...r, key: nextKey++ }))]);
      setPaste('');
      setPlan(null);
      setCreated(null);
    }
  };

  const confirmCreate = () => {
    const data = payload();
    if (!data || !plan) return;
    Modal.confirm({
      title: `Создать ${plan.deals.length} сделк${plan.deals.length === 1 ? 'у' : 'и'} на ${formatUZS(plan.total)}?`,
      content: status === 'CLOSED' && deductStock
        ? 'Сделки будут закрыты, склад списан датами сделок.'
        : 'Склад не трогаем.',
      okText: 'Создать',
      cancelText: 'Отмена',
      onOk: () => createMut.mutateAsync(data),
    });
  };

  const blocking = plan?.warnings.some((w) => w.includes('не хватает')) ?? false;

  return (
    <div style={{ maxWidth: 1200 }}>
      <Space align="center" style={{ marginBottom: 16 }}>
        <BackButton fallback="/deals" />
        <Typography.Title level={3} style={{ margin: 0 }}>Сделки задним числом</Typography.Title>
      </Space>

      <Card title="Параметры" size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]}>
          <Col xs={24} md={12}>
            <Typography.Text type="secondary">Клиент</Typography.Text>
            <Select
              showSearch style={{ width: '100%' }} placeholder="Выберите клиента" value={clientId}
              onChange={touch(setClientId)} optionFilterProp="label"
              options={(clients ?? []).map((c) => ({ value: c.id, label: c.companyName }))}
            />
          </Col>
          <Col xs={24} md={12}>
            <Typography.Text type="secondary">Менеджер</Typography.Text>
            <Select
              showSearch style={{ width: '100%' }} placeholder="На кого" value={managerId}
              onChange={touch(setManagerId)} optionFilterProp="label"
              options={(users ?? []).map((u) => ({ value: u.id, label: u.fullName }))}
            />
          </Col>
          <Col xs={24} md={8}>
            <Typography.Text type="secondary" style={{ display: 'block' }}>Статус</Typography.Text>
            <Segmented
              value={status} onChange={touch((v) => setStatus(v as 'CLOSED' | 'NEW'))}
              options={[{ label: 'Закрыта', value: 'CLOSED' }, { label: 'Открыта', value: 'NEW' }]}
            />
          </Col>
          <Col xs={24} md={8}>
            <Typography.Text type="secondary">Способ оплаты</Typography.Text>
            <Select style={{ width: '100%' }} value={paymentMethod} onChange={touch(setPaymentMethod)} options={METHODS} />
          </Col>
          <Col xs={24} md={8}>
            <Typography.Text type="secondary" style={{ display: 'block' }}>Оплата</Typography.Text>
            <Segmented
              value={paymentState} onChange={touch((v) => setPaymentState(v as 'UNPAID' | 'PAID'))}
              options={[{ label: 'Не оплачено', value: 'UNPAID' }, { label: 'Оплачено полностью', value: 'PAID' }]}
            />
          </Col>
          <Col xs={24} md={8}>
            <Checkbox
              checked={deductStock && status === 'CLOSED'} disabled={status !== 'CLOSED'}
              onChange={(e) => touch(setDeductStock)(e.target.checked)}
            >
              Списать со склада датой сделки
            </Checkbox>
          </Col>
          <Col xs={24} md={16}>
            <Input value={reason} onChange={(e) => touch(setReason)(e.target.value)} addonBefore="Причина" />
          </Col>
        </Row>
      </Card>

      <Card title="Позиции" size="small" style={{ marginBottom: 16 }}>
        <Input.TextArea
          rows={4} value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder={'Вставьте строки из Excel: дата · клиент · … · товар · кол-во · ед. · цена · сумма\n10/7/2026\tппс\t\t\tлам65\t91.2\tкг\t43000\t3,921,600'}
        />
        <Space style={{ marginTop: 8, marginBottom: 12 }}>
          <Button onClick={applyPaste} disabled={!paste.trim() || !products}>Разобрать вставку</Button>
          <Button icon={<PlusOutlined />} onClick={() => { setRows((rs) => [...rs, { key: nextKey++, date: rs[rs.length - 1]?.date ?? dayjs().format('YYYY-MM-DD'), productId: null, qty: null, price: null, rollCount: null }]); setPlan(null); }}>
            Добавить строку
          </Button>
          {!!rows.length && <Button danger onClick={() => { setRows([]); setPlan(null); }}>Очистить</Button>}
        </Space>
        {!!pasteErrors.length && (
          <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="Не разобраны строки" description={pasteErrors.map((e) => <div key={e}>{e}</div>)} />
        )}
        <Table
          size="small" pagination={false} rowKey="key" dataSource={rows} scroll={{ x: 760 }}
          locale={{ emptyText: <Empty description="Вставьте ведомость или добавьте строку" /> }}
          columns={[
            {
              title: 'Дата', width: 140,
              render: (_: unknown, r: Row) => (
                <DatePicker
                  value={r.date ? dayjs(r.date) : null} format="DD.MM.YYYY" allowClear={false}
                  disabledDate={(d) => d.isAfter(dayjs().endOf('day'))}
                  onChange={(d) => updateRow(r.key, { date: d ? d.format('YYYY-MM-DD') : null })}
                />
              ),
            },
            {
              title: 'Товар',
              render: (_: unknown, r: Row) => (
                <Select
                  showSearch style={{ width: '100%', minWidth: 200 }} value={r.productId ?? undefined} placeholder="Товар"
                  optionFilterProp="label" onChange={(v) => updateRow(r.key, { productId: v })}
                  options={(products ?? []).filter((p) => p.isActive !== false).map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` }))}
                />
              ),
            },
            {
              title: 'Кол-во', width: 110,
              render: (_: unknown, r: Row) => (
                <InputNumber value={r.qty} min={0.001} style={{ width: '100%' }} onChange={(v) => updateRow(r.key, { qty: v })}
                  addonAfter={r.productId ? productById.get(r.productId)?.unit : undefined} />
              ),
            },
            {
              title: 'Цена', width: 140,
              render: (_: unknown, r: Row) => (
                <InputNumber value={r.price} min={0} style={{ width: '100%' }} formatter={moneyFormatter}
                  parser={(v) => Number(moneyParser(v))} onChange={(v) => updateRow(r.key, { price: v })} />
              ),
            },
            {
              title: 'Рулоны', width: 90,
              render: (_: unknown, r: Row) => {
                const p = r.productId ? productById.get(r.productId) : undefined;
                if (!p || p.rollStock == null) return <Typography.Text type="secondary">—</Typography.Text>;
                return <InputNumber value={r.rollCount} min={1} placeholder="авто" style={{ width: '100%' }} onChange={(v) => updateRow(r.key, { rollCount: v })} />;
              },
            },
            {
              title: 'Сумма', width: 120, align: 'right' as const,
              render: (_: unknown, r: Row) => (r.qty && r.price != null ? formatUZS(r.qty * r.price) : '—'),
            },
            {
              width: 40,
              render: (_: unknown, r: Row) => (
                <Button type="text" danger icon={<DeleteOutlined />} onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setPlan(null); }} />
              ),
            },
          ]}
        />
        <Space style={{ marginTop: 12 }}>
          <Button onClick={() => { const d = payload(); if (d) previewMut.mutate(d); }} loading={previewMut.isPending} disabled={!rows.length}>
            Предпросмотр
          </Button>
          <Button type="primary" onClick={confirmCreate} disabled={!plan || blocking} loading={createMut.isPending}>
            Создать
          </Button>
          {!plan && !!rows.length && <Typography.Text type="secondary">Создать можно после предпросмотра</Typography.Text>}
        </Space>
      </Card>

      {created && (
        <Alert
          type="success" showIcon style={{ marginBottom: 16 }} message={`Создано сделок: ${created.length}`}
          description={created.map((d) => (
            <div key={d.id}><Link to={`/deals/${d.id}`}>{d.title}</Link> — {formatUZS(d.amount)}</div>
          ))}
        />
      )}

      {plan && (
        <Card title={`Предпросмотр: ${plan.deals.length} сделк${plan.deals.length === 1 ? 'а' : 'и'} на ${formatUZS(plan.total)}`} size="small">
          {!!plan.warnings.length && (
            <Alert
              type={blocking ? 'error' : 'warning'} showIcon style={{ marginBottom: 12 }}
              message={blocking ? 'Создать нельзя' : 'Проверьте'}
              description={plan.warnings.map((w) => <div key={w}>{w}</div>)}
            />
          )}
          {plan.deals.map((d) => (
            <div key={d.date} style={{ marginBottom: 16 }}>
              <Typography.Text strong>{d.title}</Typography.Text>{' '}
              <Typography.Text type="secondary">— {formatUZS(d.amount)}</Typography.Text>
              <Table
                size="small" pagination={false} rowKey={(i) => `${i.productId}-${i.qty}-${i.price}`} dataSource={d.items}
                columns={[
                  { title: 'Товар', dataIndex: 'sku' },
                  { title: 'Кол-во', render: (_: unknown, i) => `${i.qty} ${i.unit}` },
                  { title: 'Цена', dataIndex: 'price', align: 'right' as const, render: (v: number) => formatUZS(v) },
                  { title: 'Сумма', dataIndex: 'lineTotal', align: 'right' as const, render: (v: number) => formatUZS(v) },
                  {
                    title: 'Рулоны',
                    render: (_: unknown, i) => (i.rollCount == null ? '—' : (
                      <span title={i.rollHow ?? undefined}>
                        {i.rollCount} {i.rollHow !== 'указано' && <Tag style={{ marginInlineStart: 4 }}>авто</Tag>}
                      </span>
                    )),
                  },
                ]}
              />
            </div>
          ))}
          {status === 'CLOSED' && deductStock && (
            <>
              <Typography.Text strong>Остатки на складе сейчас → после</Typography.Text>
              <Table
                size="small" pagination={false} rowKey="sku" dataSource={plan.stock}
                columns={[
                  { title: 'Товар', dataIndex: 'sku' },
                  { title: 'Остаток', render: (_: unknown, s) => `${s.before} → ${s.after} ${s.unit}` },
                  { title: 'Рулоны', render: (_: unknown, s) => (s.rollsBefore == null ? '—' : `${s.rollsBefore} → ${s.rollsAfter}`) },
                ]}
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
