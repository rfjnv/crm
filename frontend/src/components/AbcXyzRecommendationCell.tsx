import { useState } from 'react';
import { Typography, Button, theme } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import type { AbcXyzRecommendation } from '../types';

type Props = {
  recommendation: AbcXyzRecommendation;
};

const GAP = 8;
/** Высота свёрнутого блока текста (без футера с кнопкой) */
const COLLAPSED_MAX_HEIGHT_PX = 96;

/**
 * Компактная карточка рекомендации ABC/XYZ: поток сверху вниз, без растягивания на всю строку.
 * «Развернуть» / «Свернуть» переключает высоту контента.
 */
export default function AbcXyzRecommendationCell({ recommendation: rec }: Props) {
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);
  const cardBg = token.colorFillAlter;

  const row = (emoji: string, node: React.ReactNode) => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span aria-hidden style={{ fontSize: 14, lineHeight: 1.5, flexShrink: 0, opacity: 0.92 }}>
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
          padding: '12px 14px',
          borderRadius: 8,
          background: cardBg,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowTertiary,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            gap: GAP,
            maxHeight: expanded ? undefined : COLLAPSED_MAX_HEIGHT_PX,
            overflow: expanded ? 'visible' : 'hidden',
            position: 'relative',
          }}
        >
          {row(
            '🔥',
            <Typography.Text strong style={{ fontSize: 13, display: 'block', lineHeight: 1.4 }}>
              {rec.title}
            </Typography.Text>,
          )}
          {row(
            '📝',
            <Typography.Paragraph
              type="secondary"
              style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}
            >
              {rec.description}
            </Typography.Paragraph>,
          )}
          {row(
            '⚙️',
            <Typography.Text style={{ fontSize: 12, lineHeight: 1.45, display: 'block' }}>
              {rec.action}
            </Typography.Text>,
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

          {!expanded && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 28,
                pointerEvents: 'none',
                background: `linear-gradient(180deg, transparent, ${cardBg})`,
                opacity: 0.95,
              }}
            />
          )}
        </div>

        <div
          style={{
            flexShrink: 0,
            paddingTop: 4,
            marginTop: 2,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
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
              fontSize: 12,
              color: token.colorPrimary,
            }}
          >
            {expanded ? 'Свернуть' : 'Развернуть'}
          </Button>
        </div>
      </div>
    </div>
  );
}
