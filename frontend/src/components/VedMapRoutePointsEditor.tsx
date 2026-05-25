import { Button, List, Select, Space, Tag, Typography } from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { displayCountryEnglish } from '../constants/vedMapCountries';
import type { SupplierSite } from '../types';

type Props = {
  siteIds: string[];
  sites: SupplierSite[];
  onChange: (ids: string[]) => void;
  showPicker?: boolean;
};

export default function VedMapRoutePointsEditor({
  siteIds,
  sites,
  onChange,
  showPicker = true,
}: Props) {
  const move = (index: number, delta: number) => {
    const next = [...siteIds];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const remove = (id: string) => onChange(siteIds.filter((x) => x !== id));

  const ordered = siteIds
    .map((id) => sites.find((s) => s.id === id))
    .filter((s): s is SupplierSite => !!s);

  const availableToAdd = sites.filter((s) => !siteIds.includes(s.id));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {showPicker && availableToAdd.length > 0 && (
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="Add point to route"
          style={{ width: '100%' }}
          value={null}
          onChange={(id: string) => onChange([...siteIds, id])}
          options={availableToAdd.map((s) => ({
            value: s.id,
            label: `${s.name} — ${displayCountryEnglish(s.country) || '—'}`,
          }))}
        />
      )}
      {ordered.length === 0 ? (
        <Typography.Text type="secondary">
          Add at least 2 points (from the list or by clicking markers on the map).
        </Typography.Text>
      ) : (
        <List
          size="small"
          dataSource={ordered}
          renderItem={(site, index) => (
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
                  disabled={index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                />,
                <Button
                  key="del"
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(site.id)}
                />,
              ]}
            >
              <Space size={6}>
                <Tag color="blue">{index + 1}</Tag>
                <span>{site.name}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {displayCountryEnglish(site.country) || '—'}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Space>
  );
}
