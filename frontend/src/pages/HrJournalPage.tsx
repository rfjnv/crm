import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, DatePicker, Empty, Input, Rate, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import {
  CalendarOutlined, StarOutlined, TeamOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { hrJournalApi, type HrJournalItem, type HrJournalType } from '../api/hrJournal.api';
import { usersApi } from '../api/users.api';
import { getFirstName } from '../lib/name-utils';
import { ATTENDANCE_MARK_META, type AttendanceMark } from '../constants/attendanceMarks';
import { REVIEW_CRITERIA } from '../constants/employeeCards';
import EmployeeCardDrawer from '../components/EmployeeCardDrawer';

const { Text } = Typography;

const TYPE_META: Record<HrJournalType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
  attendance: { label: 'Посещаемость', icon: <CalendarOutlined />, color: '#2a78d6', bg: 'rgba(42,120,214,.12)' },
  review: { label: 'Оценки', icon: <StarOutlined />, color: '#c27803', bg: 'rgba(234,161,0,.16)' },
  staff: { label: 'Сотрудники', icon: <TeamOutlined />, color: '#1f9d55', bg: 'rgba(31,157,85,.12)' },
  goal: { label: 'Планы и оклады', icon: <DollarOutlined />, color: '#7b5cd6', bg: 'rgba(123,92,214,.12)' },
};
const TYPES = Object.keys(TYPE_META) as HrJournalType[];

/** Заголовок дня в ленте: «Сегодня», «Вчера», «пн, 12 октября». */
function dayTitle(d: Dayjs): string {
  if (d.isSame(dayjs(), 'day')) return 'Сегодня';
  if (d.isSame(dayjs().subtract(1, 'day'), 'day')) return 'Вчера';
  const t = d.format('dd, D MMMM YYYY');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function itemText(i: HrJournalItem): string {
  return [
    i.title, i.employee?.fullName, i.author.fullName,
    ...(i.texts ?? []).map((t) => t.text), ...(i.details ?? []),
    ...(i.marks ?? []).map((m) => ATTENDANCE_MARK_META[m as AttendanceMark]?.label ?? m),
  ].join(' ').toLowerCase();
}

/**
 * Журнал HR — для руководства: всё, что HR отметила и написала, одной лентой.
 * Плашки и комментарии посещаемости, оценки в карточках, приём и увольнение,
 * планы и оклады. Записи берутся из самих разделов, поэтому совпадают с ними.
 */
export default function HrJournalPage() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(29, 'day'), dayjs()]);
  const [type, setType] = useState<HrJournalType | null>(null);
  const [author, setAuthor] = useState<string>('hr');
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [card, setCard] = useState<{ userId: string; year: number; month: number } | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users', 'manage'],
    queryFn: () => usersApi.list({ includeInactive: true }),
  });

  const params = {
    from: range[0].format('YYYY-MM-DD'),
    to: range[1].format('YYYY-MM-DD'),
    employeeId,
    authorId: author === 'hr' || author === 'all' ? undefined : author,
    onlyHr: author === 'hr',
  };
  const { data, isLoading } = useQuery({
    queryKey: ['hr-journal', params],
    queryFn: () => hrJournalApi.list(params),
  });

  const items = data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<HrJournalType, number> = { attendance: 0, review: 0, staff: 0, goal: 0 };
    items.forEach((i) => { c[i.type] += 1; });
    return c;
  }, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => (!type || i.type === type) && (!q || itemText(i).includes(q)));
  }, [items, type, search]);

  const groups = useMemo(() => {
    const map = new Map<string, HrJournalItem[]>();
    for (const i of visible) {
      const k = dayjs(i.at).format('YYYY-MM-DD');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(i);
    }
    return [...map.entries()];
  }, [visible]);

  const authorOptions = [
    { value: 'hr', label: 'Только HR' },
    { value: 'all', label: 'Все авторы (вместе с админами)' },
    ...(users ?? [])
      .filter((u) => ['HR', 'ADMIN', 'SUPER_ADMIN'].includes(u.role))
      .map((u) => ({ value: u.id, label: `${getFirstName(u.fullName) || u.fullName}${u.isActive ? '' : ' (неактивен)'}` })),
  ];
  const employeeOptions = (users ?? []).map((u) => ({
    value: u.id,
    label: `${u.fullName}${u.isActive ? '' : ' (уволен)'}`,
  }));

  const openCard = (i: HrJournalItem) => {
    if (!i.employee) return;
    const d = i.forDate ? dayjs(i.forDate) : dayjs(i.at);
    setCard({ userId: i.employee.id, year: d.year(), month: d.month() + 1 });
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Журнал HR</Typography.Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Всё, что HR отметила и написала: посещаемость, оценки сотрудников, приём и увольнение, планы и оклады.
        </Text>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {TYPES.map((t) => {
          const m = TYPE_META[t];
          const active = type === t;
          return (
            <Col xs={12} md={6} key={t}>
              <Card
                size="small"
                hoverable
                onClick={() => setType(active ? null : t)}
                style={{ borderColor: active ? m.color : undefined, borderWidth: active ? 2 : 1 }}
              >
                <Space size={10}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: m.bg, color: m.color, fontSize: 16 }}>
                    {m.icon}
                  </span>
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{m.label}</Text>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{counts[t]}</div>
                  </div>
                </Space>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card bordered={false}>
        <Space wrap style={{ marginBottom: 16 }}>
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => v?.[0] && v[1] && setRange([v[0], v[1]])}
            format="DD.MM.YYYY"
            allowClear={false}
            presets={[
              { label: 'Сегодня', value: [dayjs(), dayjs()] },
              { label: '7 дней', value: [dayjs().subtract(6, 'day'), dayjs()] },
              { label: 'Этот месяц', value: [dayjs().startOf('month'), dayjs()] },
              { label: 'Прошлый месяц', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            ]}
          />
          <Select value={author} onChange={setAuthor} options={authorOptions} style={{ width: 240 }} />
          <Select
            placeholder="Сотрудник"
            value={employeeId}
            onChange={setEmployeeId}
            allowClear
            showSearch
            optionFilterProp="label"
            options={employeeOptions}
            style={{ width: 240 }}
          />
          <Input.Search
            placeholder="Поиск по тексту"
            allowClear
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          {type && <Tag closable onClose={() => setType(null)} color={TYPE_META[type].color}>{TYPE_META[type].label}</Tag>}
        </Space>

        {data?.truncated && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Показаны последние 1000 записей — сузьте период или выберите сотрудника." />
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
        ) : groups.length === 0 ? (
          <Empty description="За этот период записей нет" />
        ) : (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            {groups.map(([day, list]) => (
              <div key={day}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                  {dayTitle(dayjs(day))} <Text type="secondary" style={{ fontWeight: 400 }}>· {list.length}</Text>
                </Text>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {list.map((i) => <JournalRow key={i.id} item={i} onEmployee={() => openCard(i)} />)}
                </Space>
              </div>
            ))}
          </Space>
        )}
      </Card>

      <EmployeeCardDrawer
        userId={card?.userId ?? null}
        year={card?.year ?? dayjs().year()}
        month={card?.month ?? dayjs().month() + 1}
        onClose={() => setCard(null)}
      />
    </div>
  );
}

function JournalRow({ item: i, onEmployee }: { item: HrJournalItem; onEmployee: () => void }) {
  const m = TYPE_META[i.type];
  return (
    <div
      style={{
        display: 'flex', gap: 12, padding: '10px 12px', borderRadius: 12,
        border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
      }}
    >
      <span style={{ width: 32, height: 32, flex: 'none', borderRadius: 10, display: 'grid', placeItems: 'center', background: m.bg, color: m.color }}>
        {m.icon}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Text>
            <Text strong>{i.title}</Text>
            {i.employee && (
              <>
                {' — '}
                <Typography.Link onClick={onEmployee}>{i.employee.fullName}</Typography.Link>
              </>
            )}
            {i.type === 'attendance' && i.forDate && (
              <Text type="secondary"> · за {dayjs(i.forDate).format('DD.MM.YYYY')}</Text>
            )}
          </Text>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
            {getFirstName(i.author.fullName) || i.author.fullName} · {dayjs(i.at).format('HH:mm')}
          </Text>
        </div>

        {!!i.marks?.length && (
          <Space size={4} wrap style={{ marginTop: 6 }}>
            {i.marks.map((mk) => {
              const meta = ATTENDANCE_MARK_META[mk as AttendanceMark];
              return <Tag key={mk} color={meta?.color} style={{ marginInlineEnd: 0 }}>{meta?.label ?? mk}</Tag>;
            })}
          </Space>
        )}

        {i.scores && (
          <Space size={[16, 4]} wrap style={{ marginTop: 6 }}>
            {REVIEW_CRITERIA.map((c) => {
              const v = i.scores?.[c.key];
              return v ? (
                <Space key={c.key} size={6}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{c.label}</Text>
                  <Rate disabled value={v} style={{ fontSize: 12 }} />
                </Space>
              ) : null;
            })}
            {i.scores.avg !== null && <Text strong>Средний балл {i.scores.avg}</Text>}
          </Space>
        )}

        {i.texts?.map((t) => (
          <div key={t.label} style={{ marginTop: 6, paddingLeft: 10, borderLeft: `3px solid ${m.color}` }}>
            <Text type="secondary" style={{ fontSize: 12 }}>{t.label}</Text>
            <div style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
          </div>
        ))}

        {!!i.details?.length && (
          <div style={{ marginTop: 6 }}>
            {i.details.map((d) => <div key={d}><Text type="secondary">{d}</Text></div>)}
          </div>
        )}
      </div>
    </div>
  );
}
