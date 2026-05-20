import { Segmented } from 'antd';
import { SITE_LOCALES, type SiteLocale } from '../../site-admin/types';

type Props = {
  locale: SiteLocale;
  onChange: (locale: SiteLocale) => void;
};

export default function LocaleTabs({ locale, onChange }: Props) {
  return (
    <Segmented
      value={locale}
      onChange={(v) => onChange(v as SiteLocale)}
      options={SITE_LOCALES.map((l) => ({ value: l.value, label: l.label }))}
    />
  );
}
