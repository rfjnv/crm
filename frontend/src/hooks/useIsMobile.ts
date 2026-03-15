import { Grid } from 'antd';

const { useBreakpoint } = Grid;

export function useIsMobile(): boolean {
  const screens = useBreakpoint();
  return !screens.md;
}
