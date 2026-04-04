import { Popover, Typography, Button, theme } from 'antd';
import { ExpandAltOutlined } from '@ant-design/icons';
import type { AbcXyzRecommendation } from '../types';

type Props = {
  recommendation: AbcXyzRecommendation;
};

/**
 * Карточка рекомендации ABC/XYZ на всю высоту ячейки (строка таблицы).
 * Верх: заголовок + описание · середина (flex): действие + риск · низ: «Развернуть».
 * Лёгкий градиент у нижнего края карточки (над кнопкой) для визуального баланса.
 */
export default function AbcXyzRecommendationCell({ recommendation: rec }: Props) {
  const { token } = theme.useToken();

  const row = (emoji: string, node: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.5, flexShrink: 0, opacity: 0.92 }}>
        {emoji}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>{node}</div>
    </div>
  );

  const gap = 10;
  const cardBg = token.colorFillAlter;

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
    <div
      className="abc-xyz-rec-fill"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          maxWidth: 320,
          width: '100%',
          margin: 0,
          padding: '14px 16px',
          paddingBottom: 12,
          borderRadius: 8,
          background: cardBg,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowTertiary,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ flexShrink: 0 }}>
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
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 24,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            paddingTop: gap,
          }}
        >
          {row(
            '⚙️',
            <Typography.Text
              ellipsis={{ tooltip: rec.action }}
              style={{ fontSize: 12, lineHeight: 1.45, display: 'block' }}
            >
              {rec.action}
            </Typography.Text>,
          )}
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
        </div>

        {/* Градиент над зоной кнопки — без перекрытия текста в средней части */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 36,
            height: 32,
            pointerEvents: 'none',
            zIndex: 0,
            background: `linear-gradient(180deg, transparent 0%, ${cardBg} 88%, ${cardBg} 100%)`,
            opacity: 0.85,
          }}
        />

        <div style={{ flexShrink: 0, position: 'relative', zIndex: 1, paddingTop: 4 }}>
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
    </div>
  );
}
