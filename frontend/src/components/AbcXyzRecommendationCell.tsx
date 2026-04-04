import { Popover, Typography, Button, theme } from 'antd';
import { ExpandAltOutlined } from '@ant-design/icons';
import type { AbcXyzRecommendation } from '../types';

type Props = {
  recommendation: AbcXyzRecommendation;
};

/**
 * Компактная карточка рекомендации ABC/XYZ в ячейке таблицы.
 * Краткий вид в ячейке; без обрезки — кнопка «Развернуть» (Popover).
 */
export default function AbcXyzRecommendationCell({ recommendation: rec }: Props) {
  const { token } = theme.useToken();

  const card: React.CSSProperties = {
    maxWidth: 320,
    width: '100%',
    margin: 0,
    padding: '14px 16px',
    borderRadius: 8,
    background: token.colorFillAlter,
    border: `1px solid ${token.colorBorderSecondary}`,
    boxShadow: token.boxShadowTertiary,
  };

  const row = (emoji: string, node: React.ReactNode, opts?: { gap?: number }) => (
    <div
      style={{
        display: 'flex',
        gap: opts?.gap ?? 8,
        alignItems: 'flex-start',
        marginTop: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.5, flexShrink: 0, opacity: 0.92 }}>
        {emoji}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>{node}</div>
    </div>
  );

  const gap = 10;

  const detailBody = (
    <div style={{ maxWidth: 360, padding: 4 }}>
      {row(
        '🔥',
        <Typography.Text strong style={{ fontSize: 14 }}>
          {rec.title}
        </Typography.Text>,
      )}
      <div style={{ marginTop: gap }}>
        {row(
          '📝',
          <Typography.Paragraph style={{ margin: 0, fontSize: 13, color: token.colorTextSecondary }}>
            {rec.description}
          </Typography.Paragraph>,
        )}
      </div>
      <div style={{ marginTop: gap }}>
        {row(
          '⚙️',
          <Typography.Paragraph style={{ margin: 0, fontSize: 13 }}>
            {rec.action}
          </Typography.Paragraph>,
        )}
      </div>
      {rec.risk ? (
        <div
          style={{
            marginTop: gap,
            padding: '10px 12px',
            borderRadius: 6,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
          }}
        >
          {row(
            '⚠️',
            <Typography.Text style={{ fontSize: 13, color: token.colorWarning }}>
              {rec.risk}
            </Typography.Text>,
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ padding: '2px 0' }}>
      <div style={card}>
        {row(
          '🔥',
          <Typography.Text strong ellipsis={{ tooltip: rec.title }} style={{ display: 'block', fontSize: 13 }}>
            {rec.title}
          </Typography.Text>,
        )}
        <div style={{ marginTop: gap }}>
          {row(
            '📝',
            <Typography.Paragraph
              type="secondary"
              ellipsis={{ rows: 2, tooltip: rec.description }}
              style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}
            >
              {rec.description}
            </Typography.Paragraph>,
          )}
        </div>
        <div style={{ marginTop: gap }}>
          {row(
            '⚙️',
            <Typography.Text
              ellipsis={{ tooltip: rec.action }}
              style={{ fontSize: 12, lineHeight: 1.45, display: 'block' }}
            >
              {rec.action}
            </Typography.Text>,
          )}
        </div>
        {rec.risk ? (
          <div style={{ marginTop: gap }}>
            {row(
              '⚠️',
              <Typography.Text
                ellipsis={{ tooltip: rec.risk }}
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  display: 'block',
                  color: token.colorWarning,
                  fontWeight: 500,
                }}
              >
                {rec.risk}
              </Typography.Text>,
            )}
          </div>
        ) : null}

        <Popover
          title={<Typography.Text strong>Полная рекомендация</Typography.Text>}
          content={detailBody}
          trigger="click"
          placement="leftTop"
          overlayStyle={{ maxWidth: 400 }}
        >
          <Button
            type="link"
            size="small"
            icon={<ExpandAltOutlined />}
            style={{
              marginTop: 12,
              padding: 0,
              height: 'auto',
              fontSize: 12,
              color: token.colorPrimary,
            }}
          >
            Развернуть
          </Button>
        </Popover>
      </div>
    </div>
  );
}
