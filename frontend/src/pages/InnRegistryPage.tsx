import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Col, Input, Progress, Row, Select, Space, Statistic, Switch, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { CheckOutlined, CloseOutlined, CloudDownloadOutlined, EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { innRegistryApi, type InnIssue, type InnRow } from '../api/innRegistry.api';
import { formatUZS } from '../utils/currency';

const { Title, Text } = Typography;

const ISSUES: Record<InnIssue, { label: string; color: string; hint: string }> = {
  bad_format: { label: 'Неверный формат', color: 'red', hint: 'ИНН юрлица — 9 цифр, ПИНФЛ физлица — 14' },
  shared_owner: { label: 'ИНН у нескольких клиентов', color: 'red', hint: 'Один ИНН записан в карточках разных клиентов — возможно, дубликат клиента' },
  name_mismatch: { label: 'Название не совпадает', color: 'red', hint: 'Юр. название по ИНН не похоже на название клиента в CRM — проверьте, тот ли ИНН' },
  other_client_inn: { label: 'ИНН другого клиента', color: 'orange', hint: 'По сделке указан ИНН, который в CRM числится за другим клиентом' },
  client_without_inn: { label: 'У клиента нет ИНН', color: 'orange', hint: 'Клиент платит перечислением, а своего ИНН в карточке нет' },
  dirty_format: { label: 'Записан по-разному', color: 'orange', hint: 'В разных местах ИНН записан с пробелами или лишними символами' },
  shared_transfer: { label: 'Платит за нескольких', color: 'blue', hint: 'С этого ИНН перечисляли за нескольких клиентов' },
  no_name: { label: 'Нет названия', color: 'default', hint: 'Юр. название не найдено — впишите вручную или подтяните с orginfo.uz' },
};

function NameCell({ row }: { row: InnRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.legalName ?? '');

  const save = useMutation({
    mutationFn: () => innRegistryApi.setName(row.inn, value.trim() || null),
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['inn-registry'] });
    },
    onError: () => message.error('Не удалось сохранить'),
  });

  const lookup = useMutation({
    mutationFn: () => innRegistryApi.lookup(row.inn, true),
    onSuccess: (res: { lookupStatus?: string }) => {
      if (res.lookupStatus === 'found') message.success('Название подтянуто');
      else if (res.lookupStatus === 'error') message.error('orginfo.uz не ответил, попробуйте позже');
      else message.warning('На orginfo.uz не найдено — впишите вручную');
      qc.invalidateQueries({ queryKey: ['inn-registry'] });
    },
  });

  if (editing) {
    return (
      <Space.Compact style={{ width: '100%' }}>
        <Input
          size="small"
          autoFocus
          value={value}
          placeholder="Юр. название"
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={() => save.mutate()}
        />
        <Button size="small" type="primary" icon={<CheckOutlined />} loading={save.isPending} onClick={() => save.mutate()} />
        <Button size="small" icon={<CloseOutlined />} onClick={() => { setEditing(false); setValue(row.legalName ?? ''); }} />
      </Space.Compact>
    );
  }

  return (
    <div>
      <Space size={4} align="start">
        {row.legalName
          ? <Text strong>{row.legalName}</Text>
          : <Text type="secondary">{row.lookupStatus === 'not_found' ? 'не найдено на orginfo.uz' : '—'}</Text>}
        <Tooltip title="Изменить вручную">
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)} />
        </Tooltip>
        <Tooltip title="Подтянуть с orginfo.uz">
          <Button size="small" type="text" icon={<ReloadOutlined />} loading={lookup.isPending} onClick={() => lookup.mutate()} />
        </Tooltip>
      </Space>
      {row.address && <div><Text type="secondary" style={{ fontSize: 12 }}>{row.address}</Text></div>}
      {row.legalName && row.source && (
        <Tag style={{ marginTop: 2 }} color={row.source === 'orginfo' ? 'green' : 'default'}>
          {row.source === 'orginfo' ? 'orginfo.uz' : 'вручную'}
        </Tag>
      )}
    </div>
  );
}

export default function InnRegistryPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [issueFilter, setIssueFilter] = useState<InnIssue[]>([]);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [bulk, setBulk] = useState<{ done: number; total: number; found: number } | null>(null);
  const stopRef = useRef(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inn-registry'],
    queryFn: innRegistryApi.reconciliation,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    return (data?.rows ?? []).filter((r) => {
      if (onlyProblems && !r.issues.some((i) => i !== 'no_name' && i !== 'shared_transfer')) return false;
      if (issueFilter.length > 0 && !issueFilter.some((i) => r.issues.includes(i))) return false;
      if (!q) return true;
      return (
        (qDigits && r.inn.includes(qDigits)) ||
        (r.legalName ?? '').toLowerCase().includes(q) ||
        r.clients.some((c) => c.companyName.toLowerCase().includes(q))
      );
    });
  }, [data, search, issueFilter, onlyProblems]);

  async function lookupAll() {
    stopRef.current = false;
    const total = (data?.rows ?? []).filter((r) => !r.legalName).length;
    let done = 0;
    let found = 0;
    setBulk({ done, total, found });
    try {
      for (;;) {
        const res = await innRegistryApi.lookupMissing(15);
        done += res.checked;
        found += res.found;
        setBulk({ done, total: Math.max(total, done + res.left), found });
        qc.invalidateQueries({ queryKey: ['inn-registry'] });
        if (res.left === 0 || res.checked === 0 || stopRef.current) break;
      }
      message.success(`Проверено ${done}, найдено названий: ${found}`);
    } catch {
      message.error('Поиск прервался — можно запустить ещё раз, найденное сохранено');
    } finally {
      setBulk(null);
    }
  }

  const summary = data?.summary ?? {};
  const problemCount = (data?.rows ?? []).filter((r) => r.issues.some((i) => i !== 'no_name' && i !== 'shared_transfer')).length;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 4 }}>ИНН и сверка</Title>
      <Text type="secondary">
        Все ИНН из карточек клиентов и перечислений по сделкам, с юр. названием и проверкой расхождений.
      </Text>

      <Row gutter={[12, 12]} style={{ margin: '16px 0' }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Всего ИНН" value={summary.total ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="С расхождениями" value={problemCount} valueStyle={{ color: problemCount ? '#cf1322' : undefined }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="Без названия" value={summary.no_name ?? 0} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="У клиента нет ИНН" value={summary.client_without_inn ?? 0} /></Card></Col>
      </Row>

      <Space wrap style={{ marginBottom: 12 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="ИНН, юр. название или клиент"
          style={{ width: 280 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          mode="multiple"
          allowClear
          placeholder="Тип расхождения"
          style={{ minWidth: 240 }}
          value={issueFilter}
          onChange={setIssueFilter}
          options={(Object.keys(ISSUES) as InnIssue[]).map((k) => ({
            value: k,
            label: `${ISSUES[k].label} (${summary[k] ?? 0})`,
          }))}
        />
        <Space size={6}>
          <Switch size="small" checked={onlyProblems} onChange={setOnlyProblems} />
          <Text>Только расхождения</Text>
        </Space>
        {bulk ? (
          <Space>
            <Progress percent={bulk.total ? Math.round((bulk.done / bulk.total) * 100) : 0} size="small" style={{ width: 160 }} />
            <Text type="secondary">найдено {bulk.found}</Text>
            <Button size="small" onClick={() => { stopRef.current = true; }}>Стоп</Button>
          </Space>
        ) : (
          <Button icon={<CloudDownloadOutlined />} onClick={lookupAll} disabled={!summary.no_name}>
            Подтянуть названия с orginfo.uz
          </Button>
        )}
      </Space>

      <Table<InnRow>
        rowKey="inn"
        size="small"
        loading={isLoading || isFetching}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        scroll={{ x: 1000 }}
        columns={[
          {
            title: 'ИНН',
            dataIndex: 'inn',
            width: 150,
            render: (inn: string, r) => (
              <div>
                <Text code copyable={{ text: inn }}>{inn}</Text>
                {r.rawVariants.some((v) => v !== inn) && (
                  <div><Text type="secondary" style={{ fontSize: 12 }}>как записан: {r.rawVariants.join(' · ')}</Text></div>
                )}
              </div>
            ),
          },
          {
            title: 'Юр. название',
            key: 'name',
            width: 300,
            render: (_: unknown, r) => <NameCell key={`${r.inn}:${r.legalName ?? ''}`} row={r} />,
          },
          {
            title: 'Клиенты в CRM',
            key: 'clients',
            render: (_: unknown, r) => (
              <Space direction="vertical" size={2}>
                {r.clients.map((c) => (
                  <div key={c.clientId}>
                    <Link to={`/clients/${c.clientId}`}>{c.companyName}</Link>
                    {c.isArchived && <Tag style={{ marginLeft: 6 }}>архив</Tag>}
                    {c.isOwn
                      ? <Tag color="green" style={{ marginLeft: 6 }}>свой ИНН</Tag>
                      : <Tag color="purple" style={{ marginLeft: 6 }}>перечисление</Tag>}
                    {c.dealsCount > 0 && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {c.dealsCount} сд. · {formatUZS(c.dealsSum)}
                        {c.lastDealAt && ` · посл. ${dayjs(c.lastDealAt).format('DD.MM.YY')}`}
                      </Text>
                    )}
                  </div>
                ))}
              </Space>
            ),
          },
          {
            title: 'Сделок',
            dataIndex: 'dealsCount',
            width: 90,
            align: 'right',
            sorter: (a, b) => a.dealsCount - b.dealsCount,
          },
          {
            title: 'Расхождения',
            key: 'issues',
            width: 230,
            render: (_: unknown, r) =>
              r.issues.length === 0
                ? <Tag color="success">ок</Tag>
                : r.issues.map((i) => (
                  <Tooltip key={i} title={ISSUES[i].hint}>
                    <Tag color={ISSUES[i].color} style={{ marginBottom: 4 }}>{ISSUES[i].label}</Tag>
                  </Tooltip>
                )),
          },
        ]}
      />
    </div>
  );
}
