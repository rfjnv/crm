import { Button, Dropdown, Slider, Space, Typography, theme } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined } from '@ant-design/icons';
import { APP_BUTTON } from './ui/AppClassNames';
import { MAX_SCALE, MIN_SCALE, SCALE_STEP, useUiScaleStore } from '../store/uiScaleStore';

const PRESETS = [0.6, 0.7, 0.8, 0.9, 1] as const;

/**
 * Масштаб интерфейса для устройств без браузерного зума — прежде всего для
 * настенной панели, где CRM открыта без адресной строки и меню браузера.
 */
export default function UiScaleControl() {
  const scale = useUiScaleStore((s) => s.scale);
  const setScale = useUiScaleStore((s) => s.setScale);
  const step = useUiScaleStore((s) => s.step);
  const { token: tk } = theme.useToken();

  const panel = (
    <div
      style={{
        background: tk.colorBgElevated,
        borderRadius: 10,
        boxShadow: tk.boxShadowSecondary,
        padding: '14px 16px',
        width: 240,
      }}
    >
      <Typography.Text strong style={{ fontSize: 13 }}>Масштаб интерфейса</Typography.Text>
      <Slider
        min={MIN_SCALE}
        max={MAX_SCALE}
        step={SCALE_STEP}
        value={scale}
        onChange={setScale}
        tooltip={{ formatter: (v) => `${Math.round((v ?? 1) * 100)}%` }}
      />
      <Space wrap size={4}>
        {PRESETS.map((preset) => (
          <Button
            key={preset}
            size="small"
            className={APP_BUTTON}
            type={scale === preset ? 'primary' : 'default'}
            onClick={() => setScale(preset)}
          >
            {Math.round(preset * 100)}%
          </Button>
        ))}
      </Space>
    </div>
  );

  return (
    <Space size={2}>
      <Button
        type="text"
        className={APP_BUTTON}
        icon={<ZoomOutOutlined />}
        onClick={() => step(-SCALE_STEP)}
        disabled={scale <= MIN_SCALE}
        title="Уменьшить масштаб"
      />
      <Dropdown popupRender={() => panel} trigger={['click']} placement="bottomRight">
        <Button type="text" className={APP_BUTTON} style={{ minWidth: 48 }}>
          {Math.round(scale * 100)}%
        </Button>
      </Dropdown>
      <Button
        type="text"
        className={APP_BUTTON}
        icon={<ZoomInOutlined />}
        onClick={() => step(SCALE_STEP)}
        disabled={scale >= MAX_SCALE}
        title="Увеличить масштаб"
      />
    </Space>
  );
}
