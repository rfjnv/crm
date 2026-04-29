import { useState } from 'react';
import {
  Button, Card, Col, Drawer, Empty, Popconfirm, Progress,
  Row, Space, Spin, Statistic, Table, Tag, Typography, theme, message,
} from 'antd';
import {
  ArrowLeftOutlined, DeleteOutlined, EyeOutlined,
  PhoneOutlined, RiseOutlined, TeamOutlined, TrophyOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { aiAssistantApi, type CallAuditSummary } from '../api/ai-assistant.api';

const { Title, Text } = Typography;

function ScoreTag({ score }: { score: number | null }) {
  if (score === null) return <Text type="secondary">—</Text>;
  const color = score >= 8 ? 'green' : score >= 6 ? 'gold' : score >= 4 ? 'orange' : 'red';
  return <Tag color={color}>{score}/10</Tag>;
}

function ProbTag({ prob }: { prob: number | null }) {
  if (prob === null) return <Text type="secondary">—</Text>;
  const color = prob >= 70 ? 'green' : prob >= 40 ? 'gold' : 'red';
  return <Tag color={color}>{prob}%</Tag>;
}

export default function CallAuditDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { token } = theme.useToken();

  const [selectedAuditId, setSelectedAuditId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: audits = [], isLoading: auditsLoading } = useQuery({
    queryKey: ['call-audits'],
    queryFn: aiAssistantApi.listCallAudits,
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['call-audit-stats'],
    queryFn: aiAssistantApi.getCallAuditStats,
  });

  const { data: auditDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['call-audit-detail', selectedAuditId],
    queryFn: () => aiAssistantApi.getCallAudit(selectedAuditId!),
    enabled: !!selectedAuditId,
  });

  const deleteMutation = useMutation({
    mutationFn: aiAssistantApi.deleteCallAudit,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['call-audits'] });
      queryClient.invalidateQueries({ queryKey: ['call-audit-stats'] });
      message.success('Аудит удалён');
    },
  });

  const openDetail = (id: string) => {
    setSelectedAuditId(id);
    setDrawerOpen(true);
  };

  const overallAvgScore = stats?.managers.length
    ? stats.managers.filter((m) => m.avgScore !== null).reduce((s, m) => s + (m.avgScore ?? 0), 0) /
      (stats.managers.filter((m) => m.avgScore !== null).length || 1)
    : null;

  const columns = [
    {
      title: 'Дата',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleDateString('ru', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
      width: 130,
    },
    {
      title: 'Менеджер',
      key: 'manager',
      render: (_: any, r: CallAuditSummary) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontSize: 13 }}>{r.author.fullName}</Text>
          {r.managerName && r.managerName !== r.author.fullName && (
            <Text type="secondary" style={{ fontSize: 12 }}>{r.managerName}</Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Оценка',
      dataIndex: 'score',
      key: 'score',
      render: (v: number | null) => <ScoreTag score={v} />,
      width: 90,
      sorter: (a: CallAuditSummary, b: CallAuditSummary) => (a.score ?? 0) - (b.score ?? 0),
    },
    {
      title: 'Вероятность продажи',
      dataIndex: 'saleProbability',
      key: 'saleProbability',
      render: (v: number | null) => <ProbTag prob={v} />,
      width: 160,
    },
    {
      title: 'Источник',
      dataIndex: 'source',
      key: 'source',
      render: (v: string) => <Tag>{v === 'audio' ? '🎵 Аудио' : '📄 Текст'}</Tag>,
      width: 110,
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_: any, r: CallAuditSummary) => (
        <Space>
          <Button
            size="small"
            type="text"
            icon={<EyeOutlined />}
            onClick={() => openDetail(r.id)}
          />
          <Popconfirm
            title="Удалить аудит?"
            onConfirm={() => deleteMutation.mutate(r.id)}
            okText="Да"
            cancelText="Нет"
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 0 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/ai-assistant/transcribe')} />
        <div style={{ flex: 1 }}>
          <Title level={4} style={{ margin: 0 }}>
            <PhoneOutlined style={{ marginRight: 8 }} />
            Аудиты звонков — Ментор менеджеров
          </Title>
          <Text type="secondary">История аудитов, рейтинг менеджеров, динамика</Text>
        </div>
        <Button type="primary" onClick={() => navigate('/ai-assistant/transcribe')}>
          + Новый аудит
        </Button>
      </div>

      {/* Stats cards */}
      {statsLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Всего аудитов"
                  value={stats?.total ?? 0}
                  prefix={<PhoneOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Средний балл"
                  value={overallAvgScore !== null ? overallAvgScore.toFixed(1) : '—'}
                  suffix={overallAvgScore !== null ? '/10' : ''}
                  prefix={<TrophyOutlined />}
                  valueStyle={{ color: overallAvgScore !== null && overallAvgScore >= 7 ? token.colorSuccess : token.colorWarning }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="Менеджеров"
                  value={stats?.managers.length ?? 0}
                  prefix={<TeamOutlined />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="За неделю"
                  value={stats?.weekly?.slice(-1)[0]?.count ?? 0}
                  prefix={<RiseOutlined />}
                />
              </Card>
            </Col>
          </Row>

          {/* Manager ratings */}
          {stats && stats.managers.length > 0 && (
            <Card title="Рейтинг менеджеров" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {stats.managers.map((m, i) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Text style={{ width: 24, fontWeight: 600, color: token.colorTextSecondary }}>
                      #{i + 1}
                    </Text>
                    <Text style={{ width: 160, fontWeight: 600 }} ellipsis>{m.name}</Text>
                    <div style={{ flex: 1 }}>
                      <Progress
                        percent={m.avgScore !== null ? (m.avgScore / 10) * 100 : 0}
                        format={() => m.avgScore !== null ? `${m.avgScore}/10` : '—'}
                        strokeColor={
                          m.avgScore !== null && m.avgScore >= 8 ? token.colorSuccess
                          : m.avgScore !== null && m.avgScore >= 6 ? token.colorWarning
                          : token.colorError
                        }
                        size="small"
                      />
                    </div>
                    <Tag style={{ minWidth: 60, textAlign: 'center' }}>
                      {m.count} звонков
                    </Tag>
                    {m.avgSaleProbability !== null && (
                      <ProbTag prob={m.avgSaleProbability} />
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Audit history table */}
      <Card title="История аудитов">
        {auditsLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
        ) : audits.length === 0 ? (
          <Empty description="Нет аудитов. Загрузите аудио или вставьте текст на странице «Аудио в текст»." />
        ) : (
          <Table
            dataSource={audits}
            columns={columns}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: 700 }}
          />
        )}
      </Card>

      {/* Audit detail drawer */}
      <Drawer
        title="Детали аудита"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedAuditId(null); }}
        width={680}
        styles={{ body: { padding: '16px 24px' } }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
        ) : auditDetail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="Оценка" value={auditDetail.score ?? '—'} suffix={auditDetail.score !== null ? '/10' : ''} />
              </Col>
              <Col span={8}>
                <Statistic title="Вероятность продажи" value={auditDetail.saleProbability !== null ? `${auditDetail.saleProbability}%` : '—'} />
              </Col>
              <Col span={8}>
                <Statistic
                  title="Дата"
                  value={new Date(auditDetail.createdAt).toLocaleDateString('ru')}
                />
              </Col>
            </Row>

            <Card title="Транскрипт" size="small">
              <Text style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{auditDetail.transcript}</Text>
            </Card>

            <Card title="Анализ AI-аудитора" size="small">
              <Text style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{auditDetail.analysis}</Text>
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
