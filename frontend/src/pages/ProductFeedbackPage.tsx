import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, Card, Col, DatePicker, Empty, Input, Modal, Rate, Row, Segmented, Select, Space, Statistic, Table, Tag,
  Tooltip, Typography, message, theme,
} from 'antd';
import { PhoneOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import {
  productFeedbackApi,
  type FeedbackClientRow,
  type LastContactSource,
  type ProductFeedbackEntry,
} from '../api/productFeedback.api';
import { useAuthStore } from '../store/authStore';
import { useAppHeaderHeight } from '../hooks/useAppHeaderHeight';
import { matchesSearch, smartFilterOption } from '../utils/translit';

type StatusFilter = 'all' | 'todo' | 'done' | 'unhappy';

const SOURCE_LABEL: Record<LastContactSource, { label: string; color: string }> = {
  notes: { label: 'Заметка обзвона', color: 'blue' },
  call: { label: 'Звонок', color: 'green' },
  client_note: { label: 'Заметка в карточке', color: 'purple' },
  feedback: { label: 'Отзыв о товаре', color: 'gold' },
};

const fmtDate = (iso: string) => dayjs(iso).format('DD.MM.YYYY');
const fmtDateTime = (iso: string) => dayjs(iso).format('DD.MM.YYYY HH:mm');

/** Последний отзыв с оценкой — по нему считаем «опрошен» и «недоволен». */
const latestReached = (rows: ProductFeedbackEntry[]) => rows.find((f) => f.reached) ?? null;

/**
 * Обзвон «как вам товар»: выбираем товар и его приход — видим всех, кто купил партию
 * с даты прихода до сегодня, с телефонами, последним контактом любого менеджера и отзывами.
 */
export default function ProductFeedbackPage() {
  const { token } = theme.useToken();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const headerHeight = useAppHeaderHeight();
  const [searchParams, setSearchParams] = useSearchParams();
  const productId = searchParams.get('product');
  const fromParam = searchParams.get('from');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [modalClient, setModalClient] = useState<FeedbackClientRow | null>(null);
  const [reached, setReached] = useState(true);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');

  const setParams = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    setSearchParams(params, { replace: true });
  };

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['product-feedback-products'],
    queryFn: productFeedbackApi.products,
    staleTime: 60_000,
  });
  const product = products.find((p) => p.id === productId) ?? null;

  const { data: arrivals = [], isLoading: arrivalsLoading } = useQuery({
    queryKey: ['product-feedback-arrivals', productId],
    queryFn: () => productFeedbackApi.arrivals(productId!),
    enabled: !!productId,
  });

  // По умолчанию — последний приход; без приходов — 30 дней назад.
  const from: Dayjs | null = useMemo(() => {
    if (fromParam && dayjs(fromParam).isValid()) return dayjs(fromParam);
    if (!productId || arrivalsLoading) return null;
    return arrivals[0] ? dayjs(arrivals[0].createdAt).startOf('day') : dayjs().subtract(30, 'day').startOf('day');
  }, [fromParam, productId, arrivals, arrivalsLoading]);
  const arrivalAt = useMemo(
    () => (from ? arrivals.find((a) => dayjs(a.createdAt).isSame(from, 'day'))?.createdAt ?? null : null),
    [arrivals, from],
  );

  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ['product-feedback-clients', productId, from?.toISOString()],
    queryFn: () => productFeedbackApi.clients(productId!, from!.toISOString()),
    enabled: !!productId && !!from,
  });

  useEffect(() => {
    setStatusFilter('all');
  }, [productId]);

  const saveMut = useMutation({
    mutationFn: productFeedbackApi.create,
    onSuccess: () => {
      message.success('Записано');
      setModalClient(null);
      queryClient.invalidateQueries({ queryKey: ['product-feedback-clients'] });
    },
    onError: (err: unknown) => {
      const details = (err as { response?: { data?: { details?: string[]; error?: string } } }).response?.data;
      message.error(details?.details?.join(', ') || details?.error || 'Не удалось сохранить');
    },
  });

  const openModal = (row: FeedbackClientRow) => {
    setModalClient(row);
    setReached(true);
    setRating(0);
    setComment('');
  };

  const stats = useMemo(() => {
    let done = 0;
    let noAnswer = 0;
    let unhappy = 0;
    let ratingSum = 0;
    for (const r of rows) {
      const last = latestReached(r.feedback);
      if (last) {
        done += 1;
        ratingSum += last.rating ?? 0;
        if ((last.rating ?? 0) <= 2) unhappy += 1;
      } else if (r.feedback.length > 0) {
        noAnswer += 1;
      }
    }
    return { total: rows.length, done, noAnswer, unhappy, avg: done ? ratingSum / done : null };
  }, [rows]);

  const visibleRows = useMemo(() => rows.filter((r) => {
    const last = latestReached(r.feedback);
    if (statusFilter === 'todo' && last) return false;
    if (statusFilter === 'done' && !last) return false;
    if (statusFilter === 'unhappy' && !(last && (last.rating ?? 0) <= 2)) return false;
    if (search) {
      const haystack = [r.companyName, r.contactName, r.phone ?? '', r.clientManager.fullName, r.lastContact?.userName ?? ''].join(' ');
      if (!matchesSearch(haystack, search)) return false;
    }
    return true;
  }), [rows, statusFilter, search]);

  const whoName = (userId: string | null, name: string | null) => (userId && userId === me?.id ? 'Вы' : name ?? '—');

  const columns: ColumnsType<FeedbackClientRow> = [
    {
      title: 'Клиент',
      key: 'client',
      fixed: 'left',
      width: 230,
      render: (_, r) => (
        <div>
          <Link to={`/clients/${r.clientId}`}>{r.isSvip ? `👑 ${r.companyName}` : r.companyName}</Link>
          {r.contactName && (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{r.contactName}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: 'Телефон',
      dataIndex: 'phone',
      key: 'phone',
      width: 150,
      render: (phone: string | null) => (phone
        ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} style={{ whiteSpace: 'nowrap' }}><PhoneOutlined /> {phone}</a>
        : <Typography.Text type="secondary">—</Typography.Text>),
    },
    {
      title: 'Менеджер клиента',
      key: 'clientManager',
      width: 150,
      render: (_, r) => whoName(r.clientManager.id, r.clientManager.fullName),
    },
    {
      title: 'Купил',
      key: 'bought',
      width: 150,
      render: (_, r) => (
        <Tooltip
          title={(
            <div>
              {r.deals.map((d) => (
                <div key={d.id}>{fmtDate(d.at)} · {d.title} · {d.managerName}</div>
              ))}
            </div>
          )}
        >
          <div style={{ whiteSpace: 'nowrap' }}>
            <Typography.Text strong>{r.qty.toLocaleString('ru-RU')} {product?.unit ?? ''}</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {fmtDate(r.lastPurchaseAt)}{r.deals.length > 1 ? ` · ${r.deals.length} сделки` : ''}
            </Typography.Text>
          </div>
        </Tooltip>
      ),
    },
    {
      title: (
        <Tooltip title="Кто из менеджеров последним общался с клиентом: заметки обзвонов, звонки, заметки в карточке, отзывы о товарах">
          Последний контакт
        </Tooltip>
      ),
      key: 'lastContact',
      width: 280,
      render: (_, r) => {
        const c = r.lastContact;
        if (!c) return <Typography.Text type="secondary">Никто не связывался</Typography.Text>;
        const source = SOURCE_LABEL[c.source];
        return (
          <div>
            <Space size={6} wrap>
              <Typography.Text strong>{whoName(c.userId, c.userName)}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtDateTime(c.at)}</Typography.Text>
            </Space>
            <div>
              <Tag color={source.color} style={{ marginTop: 2 }}>{source.label}</Tag>
            </div>
            {c.text && (
              <Tooltip title={c.text}>
                <Typography.Text type="secondary" ellipsis style={{ display: 'block', maxWidth: 260, fontSize: 12 }}>
                  {c.text}
                </Typography.Text>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: 'Отзыв о товаре',
      key: 'feedback',
      width: 280,
      render: (_, r) => {
        const latest = r.feedback[0];
        if (!latest) return <Typography.Text type="secondary">Ещё не спрашивали</Typography.Text>;
        const history = r.feedback.length > 1 && (
          <Tooltip
            title={(
              <div>
                {r.feedback.map((f) => (
                  <div key={f.id} style={{ marginBottom: 4 }}>
                    {fmtDate(f.createdAt)} · {f.author.fullName}: {f.reached ? `${f.rating}/5` : 'не дозвонился'}
                    {f.comment ? ` — ${f.comment}` : ''}
                  </div>
                ))}
              </div>
            )}
          >
            <Typography.Link style={{ fontSize: 12 }}>история ({r.feedback.length})</Typography.Link>
          </Tooltip>
        );
        return (
          <div>
            {latest.reached
              ? <Rate disabled value={latest.rating ?? 0} style={{ fontSize: 14 }} />
              : <Tag>Не дозвонился</Tag>}
            {latest.comment && (
              <Tooltip title={latest.comment}>
                <Typography.Text ellipsis style={{ display: 'block', maxWidth: 260 }}>{latest.comment}</Typography.Text>
              </Tooltip>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {whoName(latest.author.id, latest.author.fullName)} · {fmtDate(latest.createdAt)}
            </Typography.Text>
            {history && <> · {history}</>}
          </div>
        );
      },
    },
    {
      title: '',
      key: 'action',
      fixed: 'right',
      width: 110,
      render: (_, r) => (
        <Button size="small" type="primary" ghost icon={<StarOutlined />} onClick={() => openModal(r)}>
          Отзыв
        </Button>
      ),
    },
  ];

  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.lastArrivalAt ? `${p.name} · приход ${fmtDate(p.lastArrivalAt)}` : p.name,
  }));

  const arrivalOptions = arrivals.map((a) => ({
    value: dayjs(a.createdAt).format('YYYY-MM-DD'),
    label: `${fmtDate(a.createdAt)} · +${a.quantity.toLocaleString('ru-RU')} ${product?.unit ?? ''}${a.note ? ` · ${a.note}` : ''}`,
  }));

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>Обзвон по товару</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        Выберите товар и его приход — здесь все, кто купил с даты прихода до сегодня. Позвоните, узнайте, как товар,
        и запишите отзыв. В «Последнем контакте» видно, кто из коллег уже общался с клиентом.
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <Select
            showSearch
            placeholder="Товар"
            loading={productsLoading}
            style={{ width: 420, maxWidth: '100%' }}
            value={productId ?? undefined}
            onChange={(v) => setParams({ product: v, from: null })}
            options={productOptions}
            filterOption={smartFilterOption}
          />
          {productId && arrivalOptions.length > 0 && (
            <Select
              placeholder="Приход"
              style={{ width: 300, maxWidth: '100%' }}
              value={from?.format('YYYY-MM-DD')}
              onChange={(v) => setParams({ from: v })}
              options={arrivalOptions}
              notFoundContent="Приходов нет"
            />
          )}
          {productId && (
            <Space size={6}>
              <Typography.Text type="secondary">с</Typography.Text>
              <DatePicker
                allowClear={false}
                format="DD.MM.YYYY"
                value={from}
                onChange={(d) => d && setParams({ from: d.format('YYYY-MM-DD') })}
              />
              <Typography.Text type="secondary">по сегодня</Typography.Text>
            </Space>
          )}
        </Space>
      </Card>

      {!productId ? (
        <Card><Empty description="Выберите товар — сверху товары с самыми свежими приходами" /></Card>
      ) : (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Купили клиентов" value={stats.total} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="Опрошено" value={stats.done} suffix={`/ ${stats.total}`} /></Card></Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="Средняя оценка" value={stats.avg ?? '—'} precision={stats.avg ? 1 : undefined} suffix={stats.avg ? '/ 5' : undefined} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="Недовольны (1–2★)" value={stats.unhappy} valueStyle={stats.unhappy ? { color: token.colorError } : undefined} />
                {stats.noAnswer > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>не дозвонились: {stats.noAnswer}</Typography.Text>
                )}
              </Card>
            </Col>
          </Row>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Segmented
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { label: `Все (${stats.total})`, value: 'all' },
                { label: `Не опрошены (${stats.total - stats.done})`, value: 'todo' },
                { label: `Опрошены (${stats.done})`, value: 'done' },
                { label: `Недовольны (${stats.unhappy})`, value: 'unhappy' },
              ]}
            />
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
              placeholder="Клиент, телефон, менеджер"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 280, maxWidth: '100%' }}
            />
          </div>

          <Table
            size="small"
            rowKey="clientId"
            loading={rowsLoading || arrivalsLoading}
            dataSource={visibleRows}
            columns={columns}
            pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: ['20', '50', '100', '200'] }}
            scroll={{ x: 'max-content' }}
            sticky={{ offsetHeader: headerHeight }}
            locale={{ emptyText: <Empty description="С этой даты товар никто не покупал" /> }}
          />
        </>
      )}

      <Modal
        title={modalClient ? `Отзыв: ${modalClient.companyName}` : 'Отзыв'}
        open={!!modalClient}
        onCancel={() => setModalClient(null)}
        okText="Сохранить"
        confirmLoading={saveMut.isPending}
        okButtonProps={{ disabled: reached && !rating }}
        onOk={() => {
          if (!modalClient || !productId) return;
          saveMut.mutate({
            productId,
            clientId: modalClient.clientId,
            reached,
            rating: reached ? rating : null,
            comment: comment.trim() || null,
            arrivalAt,
          });
        }}
      >
        {modalClient && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              {product?.name}
              {modalClient.phone && (
                <> · <a href={`tel:${modalClient.phone.replace(/[^\d+]/g, '')}`}><PhoneOutlined /> {modalClient.phone}</a></>
              )}
            </Typography.Text>
            <Segmented
              block
              value={reached ? 'yes' : 'no'}
              onChange={(v) => setReached(v === 'yes')}
              options={[
                { label: 'Дозвонился', value: 'yes' },
                { label: 'Не дозвонился', value: 'no' },
              ]}
            />
            {reached && (
              <div>
                <Typography.Text>Как клиенту товар?</Typography.Text>
                <div><Rate value={rating} onChange={setRating} style={{ fontSize: 28 }} /></div>
              </div>
            )}
            <Input.TextArea
              rows={4}
              maxLength={2000}
              placeholder={reached ? 'Что сказал клиент: качество, проблемы, пожелания' : 'Комментарий (необязательно)'}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Space>
        )}
      </Modal>
    </div>
  );
}
