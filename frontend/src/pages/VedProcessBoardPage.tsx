import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Dropdown,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  DeleteOutlined,
  DownOutlined,
  ExportOutlined,
  ImportOutlined,
  PlusOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ColumnsType } from 'antd/es/table';

const STORAGE_KEY = 'crm-ved-process-board-v1';

export type DocStage = 'empty' | 'in_progress' | 'done' | 'na';

export type ProductionStatus = 'confirmed' | 'draft' | 'no_data' | '';

export interface ProductionLine {
  id: string;
  factoryOrProduct: string;
  note: string;
  status: ProductionStatus;
}

export interface LogisticsRow {
  id: string;
  factoryOrProduct: string;
  proforma: DocStage;
  contract: DocStage;
  ciPl: DocStage;
  coo: DocStage;
  exportDeclaration: DocStage;
  forwarder: string;
  billOfLading: DocStage;
  certificateOfCompletion: DocStage;
  loadedAt: string | null;
  dispatchedAt: string | null;
  currentLocation: string;
  customsClearance: string;
}

export interface ShipmentBlock {
  id: string;
  title: string;
  container: string;
  production: ProductionLine[];
  logistics: LogisticsRow[];
}

const DOC_OPTIONS: { value: DocStage; label: string }[] = [
  { value: 'empty', label: '—' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Готово' },
  { value: 'na', label: 'Н/п' },
];

const PROD_STATUS_OPTIONS: { value: ProductionStatus; label: string }[] = [
  { value: '', label: 'Не указано' },
  { value: 'confirmed', label: 'Подтверждено' },
  { value: 'draft', label: 'Черновик / в процессе' },
  { value: 'no_data', label: 'Нет данных' },
];

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyLogisticsRow(): LogisticsRow {
  return {
    id: newId(),
    factoryOrProduct: '',
    proforma: 'empty',
    contract: 'empty',
    ciPl: 'empty',
    coo: 'empty',
    exportDeclaration: 'empty',
    forwarder: '',
    billOfLading: 'empty',
    certificateOfCompletion: 'empty',
    loadedAt: null,
    dispatchedAt: null,
    currentLocation: '',
    customsClearance: '',
  };
}

function emptyProductionLine(): ProductionLine {
  return { id: newId(), factoryOrProduct: '', note: '', status: '' };
}

function emptyBlock(): ShipmentBlock {
  return {
    id: newId(),
    title: 'Новая партия',
    container: '',
    production: [emptyProductionLine()],
    logistics: [emptyLogisticsRow()],
  };
}

/** Пример по структуре вашего №3 Process checklist — для быстрого старта */
function demoBlocks(): ShipmentBlock[] {
  return [
    {
      id: newId(),
      title: 'Оборудование (ламинация, матрицы)',
      container: '1×40HC',
      production: [
        { id: newId(), factoryOrProduct: 'Wenzhou — ламинация', note: '', status: 'confirmed' },
        { id: newId(), factoryOrProduct: 'GraphicS — creasing matrix', note: '', status: 'draft' },
        { id: newId(), factoryOrProduct: 'Zhaoqing — tracing', note: '', status: 'no_data' },
        { id: newId(), factoryOrProduct: 'Zhisen — одеяло (blanket)', note: '', status: '' },
        { id: newId(), factoryOrProduct: 'Lecai — офсетная форма', note: '', status: '' },
      ],
      logistics: [
        {
          id: newId(),
          factoryOrProduct: 'Wenzhou — ламинация',
          proforma: 'done',
          contract: 'in_progress',
          ciPl: 'empty',
          coo: 'empty',
          exportDeclaration: 'done',
          forwarder: 'Benma',
          billOfLading: 'empty',
          certificateOfCompletion: 'empty',
          loadedAt: '2026-02-15',
          dispatchedAt: null,
          currentLocation: 'Алтынкуль, 11.03',
          customsClearance: '',
        },
      ],
    },
    {
      id: newId(),
      title: 'Бумага самоклейка + формы',
      container: '2×20GP',
      production: [
        {
          id: newId(),
          factoryOrProduct: 'Winbond — Self-Adh. Paper',
          note: 'Предоплата 10.03 / производство 12–30.03',
          status: 'confirmed',
        },
        {
          id: newId(),
          factoryOrProduct: 'Jiaxing Zhengshuo — бумага',
          note: 'Подтверждение / аванс 18.03',
          status: 'confirmed',
        },
        { id: newId(), factoryOrProduct: 'Huafeng — офсетная пластина', note: 'Аванс 12.03, окончание ~15.04', status: 'draft' },
      ],
      logistics: [
        {
          id: newId(),
          factoryOrProduct: 'Winbond — Self-Adh. Paper',
          proforma: 'in_progress',
          contract: 'in_progress',
          ciPl: 'empty',
          coo: 'empty',
          exportDeclaration: 'empty',
          forwarder: 'NeoSafeTrans',
          billOfLading: 'empty',
          certificateOfCompletion: 'empty',
          loadedAt: '2026-04-28',
          dispatchedAt: null,
          currentLocation: 'Ожидание отгрузки',
          customsClearance: '',
        },
      ],
    },
  ];
}

function loadFromStorage(): ShipmentBlock[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [emptyBlock()];
    const parsed = JSON.parse(raw) as ShipmentBlock[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [emptyBlock()];
    return parsed;
  } catch {
    return [emptyBlock()];
  }
}

function docTag(stage: DocStage) {
  if (stage === 'done') return <Tag color="success">Готово</Tag>;
  if (stage === 'in_progress') return <Tag color="processing">В работе</Tag>;
  if (stage === 'na') return <Tag>Н/п</Tag>;
  return <Tag color="default">—</Tag>;
}

export default function VedProcessBoardPage() {
  const [blocks, setBlocks] = useState<ShipmentBlock[]>(() => loadFromStorage());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blocks));
    } catch {
      /* ignore quota */
    }
  }, [blocks]);

  const updateBlock = useCallback((blockId: string, fn: (b: ShipmentBlock) => ShipmentBlock) => {
    setBlocks((prev) => prev.map((b) => (b.id === blockId ? fn(b) : b)));
  }, []);

  const removeBlock = useCallback((blockId: string) => {
    setBlocks((prev) => {
      const next = prev.filter((b) => b.id !== blockId);
      return next.length ? next : [emptyBlock()];
    });
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(blocks, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ved-process-board-${dayjs().format('YYYY-MM-DD')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success('Файл сохранён');
  };

  const importJson: MenuProps['onClick'] = ({ key }) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as ShipmentBlock[];
          if (!Array.isArray(data)) throw new Error('Неверный формат');
          setBlocks(data.length ? data : [emptyBlock()]);
          message.success('Импорт выполнен');
        } catch {
          message.error('Не удалось прочитать JSON');
        }
      };
      reader.readAsText(file);
    };
    input.click();
    void key;
  };

  const blockSummary = useMemo(() => {
    return blocks.map((block) => {
      let total = 0;
      let done = 0;
      for (const row of block.logistics) {
        const stages: DocStage[] = [
          row.proforma,
          row.contract,
          row.ciPl,
          row.coo,
          row.exportDeclaration,
          row.billOfLading,
          row.certificateOfCompletion,
        ];
        for (const s of stages) {
          if (s === 'na') continue;
          total += 1;
          if (s === 'done') done += 1;
        }
      }
      return { id: block.id, done, total };
    });
  }, [blocks]);

  const summaryMap = useMemo(() => Object.fromEntries(blockSummary.map((s) => [s.id, s])), [blockSummary]);

  return (
    <div>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            Трекинг импорта и документов
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0, maxWidth: 720 }}>
            Веб-версия логики чеклиста №3: производство по линиям поставщиков и параллельно — стадии ВЭД
            (proforma, контракт, CI/PL, COO, экспортная декларация, экспедитор, коносамент, акт/сертификат,
            даты, локация, таможня). Данные хранятся в браузере; через меню можно выгрузить или загрузить JSON.
          </Typography.Paragraph>
        </div>

        <Alert
          type="info"
          showIcon
          message="Как пользоваться"
          description={
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              <li>Каждая карточка — отдельная партия / контейнер (как блок в Excel).</li>
              <li>Верхняя таблица — статус производства и комментарии (аналог «Production tracing»).</li>
              <li>Нижняя широкая таблица — документы и логистика (аналог «Transportation tracing»).</li>
              <li>Колонка «Экспедитор» — свободный текст (Benma, EGS, NeoSafeTrans и т.д.).</li>
            </ul>
          }
        />

        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setBlocks((p) => [...p, emptyBlock()])}>
            Добавить партию
          </Button>
          <Button
            icon={<RocketOutlined />}
            onClick={() => {
              setBlocks(demoBlocks());
              message.success('Загружен пример данных');
            }}
          >
            Загрузить пример
          </Button>
          <Button icon={<ExportOutlined />} onClick={exportJson}>
            Экспорт JSON
          </Button>
          <Dropdown menu={{ items: [{ key: 'i', label: 'Выбрать файл…' }], onClick: importJson }}>
            <Button icon={<ImportOutlined />}>
              Импорт JSON <DownOutlined />
            </Button>
          </Dropdown>
          <Button
            danger
            type="text"
            onClick={() => {
              setBlocks([emptyBlock()]);
              message.info('Сброшено к одной пустой партии');
            }}
          >
            Очистить всё
          </Button>
        </Space>

        {blocks.map((block) => {
          const { done, total } = summaryMap[block.id] ?? { done: 0, total: 0 };
          const prodColumns: ColumnsType<ProductionLine> = [
            {
              title: '№',
              width: 48,
              render: (_: unknown, __: ProductionLine, i: number) => i + 1,
            },
            {
              title: 'Завод / продукт',
              dataIndex: 'factoryOrProduct',
              render: (v: string, row) => (
                <Input
                  value={v}
                  placeholder="Название"
                  variant="borderless"
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      production: b.production.map((l) =>
                        l.id === row.id ? { ...l, factoryOrProduct: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Комментарий (оплаты, сроки)',
              dataIndex: 'note',
              render: (v: string, row) => (
                <Input
                  value={v}
                  placeholder="Напр. предоплата / окончание производства"
                  variant="borderless"
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      production: b.production.map((l) =>
                        l.id === row.id ? { ...l, note: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Статус',
              dataIndex: 'status',
              width: 200,
              render: (v: ProductionStatus, row) => (
                <Select
                  value={v || undefined}
                  placeholder="Статус"
                  allowClear
                  style={{ width: '100%' }}
                  options={PROD_STATUS_OPTIONS.slice(1)}
                  onChange={(val) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      production: b.production.map((l) =>
                        l.id === row.id ? { ...l, status: (val as ProductionStatus) ?? '' } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: '',
              width: 48,
              render: (_: unknown, row: ProductionLine) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={block.production.length <= 1}
                  onClick={() =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      production: b.production.filter((l) => l.id !== row.id),
                    }))
                  }
                />
              ),
            },
          ];

          const logisticsColumns: ColumnsType<LogisticsRow> = [
            {
              title: 'Завод / продукт',
              fixed: 'left',
              width: 200,
              render: (_: unknown, row) => (
                <Input
                  value={row.factoryOrProduct}
                  placeholder="Совпадает с производством или отдельно"
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, factoryOrProduct: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Proforma',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.proforma}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) => (l.id === row.id ? { ...l, proforma: v } : l)),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Контракт',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.contract}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) => (l.id === row.id ? { ...l, contract: v } : l)),
                    }))
                  }
                />
              ),
            },
            {
              title: 'CI & PL',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.ciPl}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) => (l.id === row.id ? { ...l, ciPl: v } : l)),
                    }))
                  }
                />
              ),
            },
            {
              title: 'COO',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.coo}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) => (l.id === row.id ? { ...l, coo: v } : l)),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Эксп. декл.',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.exportDeclaration}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, exportDeclaration: v } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Экспедитор',
              width: 140,
              render: (_: unknown, row) => (
                <Input
                  value={row.forwarder}
                  placeholder="Компания"
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, forwarder: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Коносамент',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.billOfLading}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, billOfLading: v } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Акт / сертификат',
              width: 118,
              render: (_: unknown, row) => (
                <Select
                  value={row.certificateOfCompletion}
                  style={{ width: '100%' }}
                  options={DOC_OPTIONS}
                  onChange={(v) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, certificateOfCompletion: v } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Погрузка',
              width: 128,
              render: (_: unknown, row) => (
                <DatePicker
                  style={{ width: '100%' }}
                  value={row.loadedAt ? dayjs(row.loadedAt) : null}
                  onChange={(d) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, loadedAt: d ? d.format('YYYY-MM-DD') : null } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Отправка',
              width: 128,
              render: (_: unknown, row) => (
                <DatePicker
                  style={{ width: '100%' }}
                  value={row.dispatchedAt ? dayjs(row.dispatchedAt) : null}
                  onChange={(d) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, dispatchedAt: d ? d.format('YYYY-MM-DD') : null } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Текущая локация',
              width: 160,
              render: (_: unknown, row) => (
                <Input
                  value={row.currentLocation}
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, currentLocation: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Таможня',
              width: 140,
              render: (_: unknown, row) => (
                <Input
                  value={row.customsClearance}
                  placeholder="Статус / дата"
                  onChange={(e) =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.map((l) =>
                        l.id === row.id ? { ...l, customsClearance: e.target.value } : l,
                      ),
                    }))
                  }
                />
              ),
            },
            {
              title: 'Сводка',
              width: 160,
              fixed: 'right',
              render: (_: unknown, row) => {
                const stages: DocStage[] = [
                  row.proforma,
                  row.contract,
                  row.ciPl,
                  row.coo,
                  row.exportDeclaration,
                  row.billOfLading,
                  row.certificateOfCompletion,
                ];
                const relevant = stages.filter((s) => s !== 'na');
                const d = relevant.filter((s) => s === 'done').length;
                const t = relevant.length;
                return (
                  <Space size={4} wrap>
                    {docTag(row.proforma)}
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {t ? `${d}/${t} док.` : '—'}
                    </Typography.Text>
                  </Space>
                );
              },
            },
            {
              title: '',
              width: 48,
              fixed: 'right',
              render: (_: unknown, row: LogisticsRow) => (
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  disabled={block.logistics.length <= 1}
                  onClick={() =>
                    updateBlock(block.id, (b) => ({
                      ...b,
                      logistics: b.logistics.filter((l) => l.id !== row.id),
                    }))
                  }
                />
              ),
            },
          ];

          return (
            <Card
              key={block.id}
              title={
                <Space wrap>
                  <Input
                    value={block.title}
                    onChange={(e) =>
                      updateBlock(block.id, (b) => ({ ...b, title: e.target.value }))
                    }
                    style={{ minWidth: 200, maxWidth: 360, fontWeight: 600 }}
                    variant="borderless"
                  />
                  <Input
                    value={block.container}
                    placeholder="Контейнер (1×40HC, 2×20GP…)"
                    onChange={(e) =>
                      updateBlock(block.id, (b) => ({ ...b, container: e.target.value }))
                    }
                    style={{ width: 200 }}
                    prefix={<Typography.Text type="secondary">Конт.:</Typography.Text>}
                  />
                  {total > 0 && (
                    <Tag color={done === total ? 'success' : 'blue'}>
                      Документы: {done}/{total}
                    </Tag>
                  )}
                </Space>
              }
              extra={
                <Button danger type="link" icon={<DeleteOutlined />} onClick={() => removeBlock(block.id)}>
                  Удалить партию
                </Button>
              }
            >
              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Производство
              </Typography.Text>
              <Table
                size="small"
                pagination={false}
                columns={prodColumns}
                dataSource={block.production}
                rowKey="id"
                style={{ marginBottom: 24 }}
              />
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                style={{ marginBottom: 24 }}
                onClick={() =>
                  updateBlock(block.id, (b) => ({
                    ...b,
                    production: [...b.production, emptyProductionLine()],
                  }))
                }
              >
                Добавить строку производства
              </Button>

              <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                Документы и логистика
              </Typography.Text>
              <Table
                size="small"
                pagination={false}
                columns={logisticsColumns}
                dataSource={block.logistics}
                rowKey="id"
                scroll={{ x: 2200 }}
              />
              <Button
                type="dashed"
                block
                icon={<PlusOutlined />}
                style={{ marginTop: 12 }}
                onClick={() =>
                  updateBlock(block.id, (b) => ({
                    ...b,
                    logistics: [...b.logistics, emptyLogisticsRow()],
                  }))
                }
              >
                Добавить строку логистики
              </Button>
            </Card>
          );
        })}
      </Space>
    </div>
  );
}
