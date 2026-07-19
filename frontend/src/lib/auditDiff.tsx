import { Typography } from 'antd';

export function renderJsonDiff(label: string, data: Record<string, unknown> | null | undefined, bgColor: string) {
  if (!data) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>{label}:</Typography.Text>
      <pre style={{
        fontSize: 11,
        background: bgColor,
        padding: 6,
        borderRadius: 4,
        maxHeight: 200,
        overflow: 'auto',
        margin: '2px 0 0 0',
      }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
