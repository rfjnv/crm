import type { PostgrestError } from '@supabase/supabase-js';

export function isMissingCmsTableError(error: PostgrestError | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST205'
    || msg.includes('schema cache')
    || msg.includes('could not find the table')
  );
}

export const CMS_SCHEMA_HINT =
  'Таблицы CMS не созданы в Supabase. Откройте Dashboard → SQL → New query, выполните файл docs/supabase-cms-schema.sql из репозитория CRM (или Polygraph-Business/supabase/schema.sql), затем обновите страницу.';
