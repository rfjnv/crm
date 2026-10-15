import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { CallsTodayStats } from '../../api/calls.api';
import { formatCount } from '../../utils/currency';
import { getFirstName } from '../../lib/name-utils';
import './KpiExtras.css';

/** «2 ч 14 мин», «35 мин», «—». */
function talkTime(sec: number): string {
  if (sec < 60) return sec > 0 ? '< 1 мин' : '—';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h === 0) return `${m} мин`;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

const MANAGER_ROWS = 6;

/**
 * KPI «Звонки сегодня»: исходящие (сколько дозвонились) и входящие (сколько пропущено) с базой
 * «вчера», время в разговоре; руководителю — те же цифры по менеджерам, клик — его звонки за сегодня.
 */
export default function CallsKpi({ stats }: { stats: CallsTodayStats }) {
  const navigate = useNavigate();
  const { today, yesterday } = stats;
  const from = dayjs().format('YYYY-MM-DD');
  const managers = stats.managers ?? [];
  const go = (to: string) => (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(to);
  };

  return (
    <div className="kpi-calls">
      <div className="kpi-calls__totals">
        <div className="kpi-calls__stat">
          <span className="kpi-calls__label">Исходящие</span>
          <span className="kpi-calls__value">{formatCount(today.outgoing)}</span>
          <span className="kpi-foot__text">
            дозвонились {formatCount(today.outgoingConnected)} · вчера {formatCount(yesterday.outgoing)}
          </span>
        </div>
        <div className="kpi-calls__stat">
          <span className="kpi-calls__label">Входящие</span>
          <span className="kpi-calls__value">{formatCount(today.incoming)}</span>
          <span className="kpi-foot__text">
            {today.incomingMissed > 0 && <span className="kpi-foot__text--risk">пропущено {formatCount(today.incomingMissed)} · </span>}
            вчера {formatCount(yesterday.incoming)}
          </span>
        </div>
        <div className="kpi-calls__stat">
          <span className="kpi-calls__label">В разговоре</span>
          <span className="kpi-calls__value">{talkTime(today.talkSec)}</span>
          <span className="kpi-foot__text">вчера {talkTime(yesterday.talkSec)}</span>
        </div>
      </div>

      {managers.length > 0 && (
        <div className="kpi-calls__managers">
          <div className="kpi-calls__row kpi-calls__row--head">
            <span>Менеджер</span>
            <span>Исх.</span>
            <span>Дозв.</span>
            <span>Вх.</span>
            <span>Проп.</span>
            <span>Время</span>
          </div>
          {managers.slice(0, MANAGER_ROWS).map((m) => (
            <button
              key={m.managerId}
              type="button"
              className="kpi-calls__row"
              title="Звонки менеджера за сегодня"
              onClick={go(`/calls?managerId=${m.managerId}&from=${from}`)}
            >
              <span className="kpi-calls__name">{getFirstName(m.managerName) || m.managerName}</span>
              <span>{formatCount(m.outgoing)}</span>
              <span>{formatCount(m.outgoingConnected)}</span>
              <span>{formatCount(m.incoming)}</span>
              <span className={m.incomingMissed > 0 ? 'kpi-foot__text--risk' : undefined}>{formatCount(m.incomingMissed)}</span>
              <span>{talkTime(m.talkSec)}</span>
            </button>
          ))}
          {managers.length > MANAGER_ROWS && (
            <button type="button" className="kpi-stages__item" onClick={go('/calls')}>
              + ещё {managers.length - MANAGER_ROWS} — все звонки
            </button>
          )}
        </div>
      )}
    </div>
  );
}
