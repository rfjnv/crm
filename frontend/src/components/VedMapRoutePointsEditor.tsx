import { Button, List, Select, Space, Tag, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { VedMapRouteStop } from '../lib/vedMapRouteStops';
import { newRouteStopKey, routeStopLabel, routeStopSubtitle } from '../lib/vedMapRouteStops';
import type { SupplierSite } from '../types';

type Props = {
  stops: VedMapRouteStop[];
  sites: SupplierSite[];
  onChange: (stops: VedMapRouteStop[]) => void;
  showPicker?: boolean;
};

export default function VedMapRoutePointsEditor({
  stops,
  sites,
  onChange,
  showPicker = true,
}: Props) {
  const move = (index: number, delta: number) => {
    const next = [...stops];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (key: string) => onChange(stops.filter((s) => s.key !== key));

  const usedSiteIds = new Set(
    stops.filter((s): s is VedMapRouteStop & { kind: 'site' } => s.kind === 'site').map((s) => s.siteId),
  );
  const availableToAdd = sites.filter((s) => !usedSiteIds.has(s.id));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {showPicker && availableToAdd.length > 0 && (
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Добавить сохранённую точку"
          style={{ width: '100%' }}
          value={null}
          onChange={(siteId: string) => {
            onChange([...stops, { key: newRouteStopKey(), kind: 'site', siteId }]);
          }}
          options={availableToAdd.map((s) => ({
            value: s.id,
            label: `${s.name} — ${routeStopSubtitle({ key: '', kind: 'site', siteId: s.id }, sites)}`,
          }))}
        />
      )}
      {stops.length === 0 ? (
        <Typography.Text type="secondary">
          Кликайте по карте или по меткам — минимум 2 точки. Порядок меняйте стрелками.
        </Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={stops}
          renderItem={(stop, index) => (
            <List.Item
              style={{ padding: '6px 0' }}
              actions={[
                <Button
                  key="up"
                  type="text"
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                />,
                <Button
                  key="down"
                  type="text"
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={index === stops.length - 1}
                  onClick={() => move(index, 1)}
                />,
                <Button
                  key="del"
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(stop.key)}
                />,
              ]}
            >
              <Space size={6}>
                <Tag color={stop.kind === 'pin' ? 'orange' : 'blue'}>{index + 1}</Tag>
                <span>{routeStopLabel(stop, sites)}</span>
                {stop.kind === 'pin' && <Tag>на карте</Tag>}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {routeStopSubtitle(stop, sites)}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Space>
  );
}
