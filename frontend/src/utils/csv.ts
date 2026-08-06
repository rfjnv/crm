/**
 * Выгрузка таблицы в CSV, открываемый Excel без плясок с кодировкой.
 *
 * Разделитель — точка с запятой: русская локаль Excel считает запятую десятичным
 * знаком и складывает всю строку в одну ячейку. BOM нужен, чтобы кириллица
 * не превратилась в кракозябры.
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  // Кавычки, перевод строки и сам разделитель требуют обрамления.
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
): void {
  const lines = [
    headers.map(escapeCell).join(';'),
    ...rows.map((r) => r.map(escapeCell).join(';')),
  ];
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
