import { useEffect, useState } from 'react';
import { MOBILE_BREAKPOINT_FALLBACK } from '../utils/mobileBreakpoint';

/**
 * Страница замера экрана: `/viewport`.
 *
 * Нужна для настенной панели и WebView Telegram, где нет ни консоли, ни
 * инструментов разработчика. Открывается без авторизации — снять цифры можно
 * до входа в систему. Свёрстана крупно и без Ant Design намеренно: показания
 * не должны зависеть от того, что именно в интерфейсе поехало.
 */

interface Metrics {
  cssWidth: number;
  cssHeight: number;
  screenWidth: number;
  screenHeight: number;
  dpr: number;
  visualScale: number | null;
  physicalWidth: number;
  layout: string;
  userAgent: string;
}

function read(): Metrics {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const breakpoint = parseInt(MOBILE_BREAKPOINT_FALLBACK, 10);
  return {
    cssWidth,
    cssHeight: window.innerHeight,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    dpr,
    visualScale: window.visualViewport?.scale ?? null,
    physicalWidth: Math.round(cssWidth * dpr),
    layout: cssWidth <= breakpoint ? `мобильная (≤ ${breakpoint}px)` : `десктопная (> ${breakpoint}px)`,
    userAgent: navigator.userAgent,
  };
}

export default function ViewportInfoPage() {
  const [m, setM] = useState<Metrics>(read);

  useEffect(() => {
    const update = () => setM(read());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  const rows: [string, string, boolean?][] = [
    ['Ширина окна (CSS)', `${m.cssWidth} px`, true],
    ['Высота окна (CSS)', `${m.cssHeight} px`, true],
    ['Раскладка приложения', m.layout, true],
    ['Плотность пикселей', `${m.dpr}`],
    ['Физическое разрешение', `${m.physicalWidth} × ${Math.round(m.cssHeight * m.dpr)} px`],
    ['Экран устройства', `${m.screenWidth} × ${m.screenHeight} px`],
    ['Масштаб (pinch)', m.visualScale != null ? String(m.visualScale) : 'недоступно'],
  ];

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: '#1f1f1f', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 26, margin: '0 0 4px' }}>Параметры экрана</h1>
      <p style={{ margin: '0 0 20px', color: '#595959', fontSize: 15 }}>
        Покажите эти цифры разработчику. Главная строка — «Ширина окна (CSS)».
      </p>

      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 700, fontSize: 17 }}>
        <tbody>
          {rows.map(([label, value, highlight]) => (
            <tr key={label} style={{ background: highlight ? '#e6f4ff' : undefined }}>
              <td style={{ padding: '10px 12px', border: '1px solid #d9d9d9', color: '#595959' }}>{label}</td>
              <td style={{ padding: '10px 12px', border: '1px solid #d9d9d9', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 16, margin: '24px 0 6px' }}>Браузер</h2>
      <pre style={{
        margin: 0, padding: 12, background: '#f5f5f5', borderRadius: 8, fontSize: 12,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: 700,
      }}>
        {m.userAgent}
      </pre>
    </div>
  );
}
