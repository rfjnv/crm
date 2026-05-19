import { Typography, Timeline, Tag, Card, theme } from 'antd';
import {
  PlusCircleOutlined,
  ToolOutlined,
  BugOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  CHANGELOG,
  CHANGELOG_SECTION_LABELS,
  type ChangelogRelease,
  type ChangelogSection,
} from '../data/changelog';

dayjs.locale('ru');

const SECTION_META: Record<
  ChangelogSection,
  { icon: React.ReactNode; color: string }
> = {
  added: { icon: <PlusCircleOutlined />, color: 'green' },
  improved: { icon: <ToolOutlined />, color: 'blue' },
  fixed: { icon: <BugOutlined />, color: 'orange' },
};

function ReleaseSections({ release }: { release: ChangelogRelease }) {
  const sections: ChangelogSection[] = ['added', 'improved', 'fixed'];

  return (
    <>
      {sections.map((key) => {
        const items = release[key];
        if (!items?.length) return null;
        const meta = SECTION_META[key];
        return (
          <div key={key} style={{ marginTop: 12 }}>
            <Tag icon={meta.icon} color={meta.color} style={{ marginBottom: 8 }}>
              {CHANGELOG_SECTION_LABELS[key]}
            </Tag>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {items.map((text) => (
                <li key={text} style={{ marginBottom: 4 }}>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function ReleaseCard({
  release,
  borderColor,
  compact,
}: {
  release: ChangelogRelease;
  borderColor: string;
  compact: boolean;
}) {
  return (
    <Card
      size="small"
      style={{ borderLeft: `3px solid ${borderColor}` }}
      styles={{ body: { padding: compact ? 12 : 16 } }}
    >
      {release.title && (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
          {release.title}
        </Typography.Text>
      )}
      <ReleaseSections release={release} />
    </Card>
  );
}

export default function ChangelogPage() {
  const { token: tk } = theme.useToken();
  const isMobile = useIsMobile();

  const timelineItems = CHANGELOG.map((release) => ({
    color: tk.colorPrimary as const,
    children: (
      <div style={{ paddingBottom: 8 }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Typography.Text strong style={{ fontSize: 16 }}>
            v{release.version}
          </Typography.Text>
          <Tag>{dayjs(release.date).format('D MMMM YYYY')}</Tag>
        </div>
        <ReleaseCard release={release} borderColor={tk.colorPrimary} compact={isMobile} />
      </div>
    ),
  }));

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: isMobile ? 16 : 24,
        }}
      >
        <RocketOutlined style={{ fontSize: 22, color: tk.colorPrimary }} />
        <Typography.Title level={4} style={{ margin: 0 }}>
          Обновления системы
        </Typography.Title>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Здесь собраны последние изменения в CRM: новые функции, улучшения и исправления.
        Список обновляется при выкладке новой версии.
      </Typography.Paragraph>

      <Timeline items={timelineItems} />
    </div>
  );
}
