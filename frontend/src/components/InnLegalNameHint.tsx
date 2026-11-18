import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Typography, Spin } from 'antd';
import { innRegistryApi } from '../api/innRegistry.api';

/** Под полем ИНН: юр. название организации, как только введено 9 (или 14) цифр. */
export default function InnLegalNameHint({ inn }: { inn: string }) {
  const digits = inn.replace(/\D/g, '');
  const [debounced, setDebounced] = useState(digits);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(digits), 350);
    return () => clearTimeout(t);
  }, [digits]);
  const valid = /^\d{9}$|^\d{14}$/.test(debounced);
  const { data, isFetching } = useQuery({
    queryKey: ['inn-legal-name', debounced],
    queryFn: () => innRegistryApi.legalName(debounced),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
  });
  if (!digits) return null;
  if (!/^\d{9}$|^\d{14}$/.test(digits)) {
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}>ИНН — 9 цифр (организация) или 14 цифр (ПИНФЛ)</Typography.Text>;
  }
  if (!valid || isFetching) return <Typography.Text type="secondary" style={{ fontSize: 12 }}><Spin size="small" /> ищем организацию…</Typography.Text>;
  if (data?.legalName) return <Typography.Text type="success" strong>{data.legalName}</Typography.Text>;
  return <Typography.Text type="warning" style={{ fontSize: 12 }}>Организация по этому ИНН не найдена — проверьте цифры</Typography.Text>;
}
