import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Typography,
  Table,
  Button,
  Input,
  Select,
  Space,
  Tag,
  Modal,
  message,
  Tooltip,
  Row,
  Col,
  Statistic,
  Card,
  Popconfirm,
} from 'antd';
import {
  MergeCellsOutlined,
  SearchOutlined,
  SwapOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { clientsApi } from '../api/clients.api';

const { Title, Text } = Typography;

type DuplicatePair = {
  client1: { id: string; companyName: string; contactName: string; phone: string | null; inn: string | null; manager: { id: string; fullName: string } | null };
  client2: { id: string; companyName: string; contactName: string; phone: string | null; inn: string | null; manager: { id: string; fullName: string } | null };
  similarity: number;
  reason: string;
};

function simColor(sim: number): string {
  if (sim >= 95) return '#cf1322';
  if (sim >= 85) return '#d46b08';
  return '#7c7c7c';
}

export default function DuplicateClientsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [minSim, setMinSim] = useState<number>(0);
  const [mergeModal, setMergeModal] = useState<{ pair: DuplicatePair; keepId: string } | null>(null);
  const [mergedIds, setMergedIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['clients', 'duplicates'],
    queryFn: () => clientsApi.findDuplicates(),
    staleTime: 5 * 60 * 1000,
  });

  const mergeMutation = useMutation({
    mutationFn: ({ keepId, mergeId }: { keepId: string; mergeId: string }) =>
      clientsApi.merge(keepId, mergeId),
    onSuccess: (_data, vars) => {
      message.success('Клиенты успешно объединены');
      setMergedIds((prev) => new Set([...prev, vars.mergeId]));
      setMergeModal(null);
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.message || 'Ошибка при объединении');
    },
  });

  const filtered = useMemo(() => {
    if (!data?.pairs) return [];
    return data.pairs.filter((p) => {
      if (mergedIds.has(p.client1.id) || mergedIds.has(p.client2.id)) return false;
      if (p.similarity < minSim) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          p.client1.companyName.toLowerCase().includes(q) ||
          p.client2.companyName.toLowerCase().includes(q) ||
          (p.client1.contactName || '').toLowerCase().includes(q) ||
          (p.client2.contactName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data?.pairs, search, minSim, mergedIds]);

  const columns = [
    {
      title: '#',
      width: 48,
      render: (_: any, __: any, idx: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {idx + 1}
        </Text>
      ),
    },
    {
      title: 'Клиент 1',
      key: 'c1',
      render: (_: any, record: DuplicatePair) => (
        <Space direction="vertical" size={0}>
          <Link to={`/clients/${record.client1.id}`} target="_blank">
            <Text strong style={{ fontSize: 13 }}>
              {record.client1.companyName}
            </Text>
          </Link>
          {record.client1.contactName && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.client1.contactName}
            </Text>
          )}
          {record.client1.phone && (
            <Text style={{ fontSize: 12 }}>{record.client1.phone}</Text>
          )}
          {record.client1.manager && (
            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
              {record.client1.manager.fullName}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Клиент 2',
      key: 'c2',
      render: (_: any, record: DuplicatePair) => (
        <Space direction="vertical" size={0}>
          <Link to={`/clients/${record.client2.id}`} target="_blank">
            <Text strong style={{ fontSize: 13 }}>
              {record.client2.companyName}
            </Text>
          </Link>
          {record.client2.contactName && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.client2.contactName}
            </Text>
          )}
          {record.client2.phone && (
            <Text style={{ fontSize: 12 }}>{record.client2.phone}</Text>
          )}
          {record.client2.manager && (
            <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
              {record.client2.manager.fullName}
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: 'Сходство',
      key: 'sim',
      width: 110,
      sorter: (a: DuplicatePair, b: DuplicatePair) => a.similarity - b.similarity,
      render: (_: any, record: DuplicatePair) => (
        <Space direction="vertical" size={2}>
          <Text strong style={{ color: simColor(record.similarity), fontSize: 16 }}>
            {record.similarity}%
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {record.reason.split(' | ')[0]}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Действие',
      key: 'action',
      width: 130,
      render: (_: any, record: DuplicatePair) => (
        <Button
          type="primary"
          size="small"
          icon={<MergeCellsOutlined />}
          onClick={() => setMergeModal({ pair: record, keepId: record.client1.id })}
        >
          Объединить
        </Button>
      ),
    },
  ];

  const keepClient = mergeModal
    ? mergeModal.keepId === mergeModal.pair.client1.id
      ? mergeModal.pair.client1
      : mergeModal.pair.client2
    : null;
  const removeClient = mergeModal
    ? mergeModal.keepId === mergeModal.pair.client1.id
      ? mergeModal.pair.client2
      : mergeModal.pair.client1
    : null;

  return (
    <div style={{ padding: '24px' }}>
      <Space direction="vertical" style={{ width: '100%' }} size={20}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <MergeCellsOutlined style={{ marginRight: 8 }} />
            Дубликаты клиентов
          </Title>
          <Text type="secondary">
            Клиенты с похожими названиями — проверьте и объедините если это один и тот же клиент
          </Text>
        </div>

        {data && (
          <Row gutter={16}>
            <Col>
              <Card size="small" style={{ minWidth: 140 }}>
                <Statistic
                  title="Активных клиентов"
                  value={data.totalClients}
                  valueStyle={{ fontSize: 22 }}
                />
              </Card>
            </Col>
            <Col>
              <Card size="small" style={{ minWidth: 140 }}>
                <Statistic
                  title="Пар на проверке"
                  value={filtered.length}
                  valueStyle={{ fontSize: 22, color: filtered.length > 0 ? '#d46b08' : undefined }}
                  prefix={filtered.length > 0 ? <WarningOutlined /> : <CheckCircleOutlined />}
                />
              </Card>
            </Col>
            <Col>
              <Card size="small" style={{ minWidth: 140 }}>
                <Statistic
                  title="Точных совпадений"
                  value={filtered.filter((p) => p.similarity >= 95).length}
                  valueStyle={{ fontSize: 22, color: '#cf1322' }}
                />
              </Card>
            </Col>
          </Row>
        )}

        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Поиск по названию..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
          <Select
            value={minSim}
            onChange={setMinSim}
            style={{ width: 180 }}
            options={[
              { value: 0, label: 'Все пары' },
              { value: 90, label: 'Сходство ≥ 90%' },
              { value: 85, label: 'Сходство ≥ 85%' },
              { value: 80, label: 'Сходство ≥ 80%' },
            ]}
          />
        </Space>

        <Table<DuplicatePair>
          dataSource={filtered}
          columns={columns}
          rowKey={(r) => `${r.client1.id}__${r.client2.id}`}
          loading={isLoading || isFetching}
          pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'] }}
          size="small"
          scroll={{ x: 700 }}
          rowClassName={(record) =>
            record.similarity >= 95 ? 'duplicate-row-high' : ''
          }
        />
      </Space>

      {/* Merge confirmation modal */}
      <Modal
        open={!!mergeModal}
        title={
          <Space>
            <MergeCellsOutlined />
            Объединить клиентов
          </Space>
        }
        onCancel={() => setMergeModal(null)}
        footer={null}
        width={520}
      >
        {mergeModal && keepClient && removeClient && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Text>
              Выберите какого клиента <Text strong>оставить</Text>. Все сделки, платежи, договоры и
              заметки второго клиента будут перенесены на первого, а второй будет заархивирован.
            </Text>

            {/* Keep/swap selection */}
            <Card
              size="small"
              style={{ background: 'var(--ant-color-success-bg, #f6ffed)', borderColor: 'var(--ant-color-success-border, #b7eb8f)' }}
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ОСТАВИТЬ
                </Text>
                <Link to={`/clients/${keepClient.id}`} target="_blank">
                  <Text strong>{keepClient.companyName}</Text>
                </Link>
                {keepClient.phone && <Text style={{ fontSize: 12 }}>{keepClient.phone}</Text>}
                {keepClient.manager && <Tag color="blue">{keepClient.manager.fullName}</Tag>}
              </Space>
            </Card>

            <div style={{ textAlign: 'center' }}>
              <Tooltip title="Поменять местами">
                <Button
                  icon={<SwapOutlined />}
                  onClick={() =>
                    setMergeModal((m) =>
                      m
                        ? {
                            ...m,
                            keepId:
                              m.keepId === m.pair.client1.id
                                ? m.pair.client2.id
                                : m.pair.client1.id,
                          }
                        : null,
                    )
                  }
                >
                  Поменять местами
                </Button>
              </Tooltip>
            </div>

            <Card
              size="small"
              style={{ background: 'var(--ant-color-error-bg, #fff2f0)', borderColor: 'var(--ant-color-error-border, #ffccc7)' }}
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  ЗААРХИВИРОВАТЬ (данные перенесутся на первого)
                </Text>
                <Link to={`/clients/${removeClient.id}`} target="_blank">
                  <Text strong>{removeClient.companyName}</Text>
                </Link>
                {removeClient.phone && <Text style={{ fontSize: 12 }}>{removeClient.phone}</Text>}
                {removeClient.manager && <Tag color="blue">{removeClient.manager.fullName}</Tag>}
              </Space>
            </Card>

            <Popconfirm
              title="Подтвердите объединение"
              description={
                <span>
                  Все данные «{removeClient.companyName}» будут перенесены на «{keepClient.companyName}»
                  и второй клиент будет заархивирован. Это действие нельзя отменить.
                </span>
              }
              okText="Объединить"
              cancelText="Отмена"
              okButtonProps={{ danger: true }}
              onConfirm={() =>
                mergeMutation.mutate({
                  keepId: mergeModal.keepId,
                  mergeId:
                    mergeModal.keepId === mergeModal.pair.client1.id
                      ? mergeModal.pair.client2.id
                      : mergeModal.pair.client1.id,
                })
              }
            >
              <Button
                type="primary"
                danger
                block
                loading={mergeMutation.isPending}
                icon={<MergeCellsOutlined />}
              >
                Объединить
              </Button>
            </Popconfirm>
          </Space>
        )}
      </Modal>
    </div>
  );
}
