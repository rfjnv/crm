export const EMPLOYEE_ROLE_LABELS: Record<string, string> = {
  OPERATOR: 'Оператор',
  MANAGER: 'Менеджер',
  HR: 'HR',
  ACCOUNTANT: 'Бухгалтер',
  FOREIGN_TRADE: 'ВЭД',
  WAREHOUSE: 'Склад',
  WAREHOUSE_MANAGER: 'Зав. складом',
  DRIVER: 'Водитель',
  LOADER: 'Грузчик',
};

/** Критерии оценки HR в карточке сотрудника (1–5). Те же ключи — на сервере. */
export const REVIEW_CRITERIA = [
  { key: 'discipline', label: 'Дисциплина', hint: 'приходит вовремя, соблюдает правила, держит слово' },
  { key: 'quality', label: 'Качество работы', hint: 'делает без ошибок и переделок' },
  { key: 'initiative', label: 'Инициатива', hint: 'сам предлагает и берёт задачи, не ждёт напоминаний' },
  { key: 'teamwork', label: 'Командность', hint: 'помогает коллегам, без конфликтов' },
] as const;
