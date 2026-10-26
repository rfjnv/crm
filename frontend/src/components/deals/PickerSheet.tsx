import { useMemo, useState, type ReactNode } from 'react';
import { Drawer, Input } from 'antd';
import { Check, MagnifyingGlass } from '@phosphor-icons/react';
import { matchesSearch } from '../../utils/translit';
import './PickerSheet.css';

export interface PickerRow {
  id: string;
  /** Текст, по которому ищем (название, артикул, телефон…) */
  haystack: string;
  /** Для фильтра-«таблеток» */
  group?: string | null;
  disabled?: boolean;
  render: ReactNode;
}

interface Props {
  open: boolean;
  title: string;
  placeholder: string;
  rows: PickerRow[];
  /** Уже выбранные — с галочкой (повторно не добавляются) */
  selected?: Set<string>;
  /** Несколько подряд: лист не закрывается, есть «Готово» */
  multi?: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
  emptyText?: string;
}

/** Сколько строк показываем за раз: на тысячах клиентов телефон не должен тормозить. */
const LIMIT = 120;

/**
 * Выбор из длинного списка на телефоне — лист снизу с поиском (латиницей тоже) и фильтром
 * по группам, вместо выпадающего Select с мелкими строками.
 */
export default function PickerSheet({
  open, title, placeholder, rows, selected, multi, onPick, onClose, emptyText = 'Ничего не нашлось',
}: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.group && set.add(r.group));
    return [...set].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (!group || r.group === group) && (!query.trim() || matchesSearch(r.haystack, query))),
    [rows, group, query],
  );
  const shown = filtered.slice(0, LIMIT);

  const close = () => {
    setQuery('');
    onClose();
  };

  return (
    <Drawer
      rootClassName="picker-sheet"
      placement="bottom"
      open={open}
      onClose={close}
      height="88%"
      closable={false}
      title={null}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
      destroyOnHidden
    >
      <div className="picker-sheet__grab" aria-hidden />
      <div className="picker-sheet__head">
        <b>{title}</b>
        <button type="button" className="picker-sheet__done" onClick={close}>{multi ? 'Готово' : 'Закрыть'}</button>
      </div>
      <div className="picker-sheet__search">
        <Input
          autoFocus={false}
          allowClear
          prefix={<MagnifyingGlass size={17} />}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {groups.length > 1 && (
        <div className="picker-sheet__groups">
          <button type="button" className={!group ? 'is-on' : ''} onClick={() => setGroup(null)}>Все</button>
          {groups.map((g) => (
            <button key={g} type="button" className={group === g ? 'is-on' : ''} onClick={() => setGroup(g)}>{g}</button>
          ))}
        </div>
      )}
      <div className="picker-sheet__list">
        {shown.map((r) => {
          const isSel = selected?.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              className={`picker-sheet__row${isSel ? ' is-selected' : ''}`}
              disabled={r.disabled && !isSel}
              onClick={() => {
                if (isSel) return;
                onPick(r.id);
                if (!multi) close();
              }}
            >
              {isSel && <span className="picker-sheet__check"><Check size={13} weight="bold" /></span>}
              <span className="picker-sheet__body">{r.render}</span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="picker-sheet__empty">{emptyText}</div>}
        {filtered.length > LIMIT && (
          <div className="picker-sheet__empty">Показаны первые {LIMIT} из {filtered.length} — уточните поиск</div>
        )}
      </div>
    </Drawer>
  );
}
