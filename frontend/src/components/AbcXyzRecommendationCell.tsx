import { useState, type ReactNode } from 'react';
import { Typography, Button, theme } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import type { AbcXyzRecommendation } from '../types';

type Props = {
  recommendation: AbcXyzRecommendation;
};

const GAP = 8;

/**
 * Минимальная карточка ABC/XYZ: свёрнуто — только заголовок; развёрнуто — описание, действие, риск.
 */
export default function AbcXyzRecommendationCell({ recommendation: rec }: Props) {
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);
  const cardBg = token.colorFillAlter;

  const row = (emoji: string, node: ReactNode) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.5, flexShrink: 0, opacity: 0.9 }}>
        {emoji}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>{node}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 320 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          gap: GAP,
          padding: '10px 12px',
          borderRadius: 8,
          background: cardBg,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Button
          type="link"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setExpanded((v) => !v)}
          style={{
            padding: 0,
            height: 'auto',
            alignSelf: 'flex-start',
            fontSize: 12,
            color: token.colorTextSecondary,
          }}
        >
          {expanded ? 'Свернуть' : 'Развернуть'}
        </Button>

        {row(
          '🔥',
          <Typography.Text
            strong
            style={{
              fontSize: 13,
              display: 'block',
              lineHeight: 1.35,
              ...(expanded
                ? {}
                : {
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }),
            }}
            title={rec.title}
          >
            {rec.title}
          </Typography.Text>,
        )}

        {expanded ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: GAP, marginTop: 2 }}>
            {row(
              '📝',
              <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}>
                {rec.description}
              </Typography.Paragraph>,
            )}
            {row(
              '⚙️',
              <Typography.Text style={{ fontSize: 12, lineHeight: 1.45, display: 'block' }}>{rec.action}</Typography.Text>,
            )}
            {rec.risk
              ? row(
                  '⚠️',
                  <Typography.Text
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
                )
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
