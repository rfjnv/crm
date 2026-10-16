import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, message } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import { CaretDown, CaretRight, Check, Phone, PhoneIncoming, PhoneX } from '@phosphor-icons/react';
import dayjs from 'dayjs';
import { callsApi, type MissedGroup, type MissedSummary } from '../../api/calls.api';
import { formatUzPhone } from '../../utils/phone';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useThemeStore } from '../../store/themeStore';
import { apiErrorMessage } from './callsUi';
import './MissedCallsWidget.css';

/** «45 мин», «1 ч 20 мин», «3 ч». */
function minutesLabel(min: number): string {
  if (min < 1) return '< 1 мин';
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Цвет ожидания: до 30 мин спокойно, до 2 ч — жёлтый, дольше — красный. */
function waitTone(min: number): 'calm' | 'warn' | 'risk' {
  if (min >= 120) return 'risk';
  if (min >= 30) return 'warn';
  return 'calm';
}

/** Текущее время, обновляется раз в минуту — таймеры «ждёт …» идут сами. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const who = (g: MissedGroup) => g.client?.companyName ?? (formatUzPhone(g.phone) || 'Скрытый номер');
const minsSince = (iso: string, now: number) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));

function handledText(g: MissedGroup): string {
  if (!g.handledAt) return 'отработан';
  const at = dayjs(g.handledAt).format('HH:mm');
  const after = minutesLabel(Math.max(0, Math.round((new Date(g.handledAt).getTime() - new Date(g.firstAt).getTime()) / 60_000)));
  if (g.handledVia === 'client') return `клиент перезвонил сам в ${at} · через ${after}`;
  if (g.handledVia === 'manual') return `отмечено «перезвонил» в ${at} · через ${after}`;
  return `перезвонили в ${at} · через ${after}`;
}

/**
 * Главная: «Пропущенные сегодня». Менеджер видит, кто ждёт звонка (с таймером), звонит
 * в одно нажатие; отработанные свёрнуты. Руководитель — итог и менеджеров с раскрытием.
 * Отработку сервер ставит сам по следующему разговору с номером; кнопка — для остального.
 */
export default function MissedCallsWidget() {
  const { data } = useQuery({ queryKey: ['calls-missed'], queryFn: callsApi.missed, refetchInterval: 60_000 });
  const now = useNow();
  const isMobile = useIsMobile();
  const modern = useThemeStore((s) => s.design) === 'modern';

  if (!data || data.items.length === 0) return null;

  const pending = data.items.filter((g) => !g.handled);
  const leader = data.scope === 'all' && !!data.managers;

  // Отступы — как у соседних карточек главной; на телефоне — общий ритм секций.
  // В классическом дизайне под заголовком линия — от неё нужен воздух.
  const pad = isMobile ? 16 : 20;
  const card = (
    <Card
      className="missed-widget"
      bordered={false}
      style={{ marginTop: isMobile ? 0 : 16 }}
      styles={{ header: { padding: `0 ${pad}px` }, body: { padding: `${modern ? (isMobile ? 4 : 8) : 16}px ${pad}px ${pad}px` } }}
      title={(
        <span className="missed-widget__title">
          Пропущенные сегодня
          {pending.length > 0 && <span className="missed-widget__badge">{pending.length}</span>}
        </span>
      )}
      extra={<Link to="/calls?missedOnly=1">Все звонки</Link>}
    >
      <Summary data={data} />
      {leader ? <LeaderView data={data} now={now} /> : <OwnView items={data.items} now={now} />}
    </Card>
  );
  return isMobile ? <div className="section">{card}</div> : card;
}

function Summary({ data }: { data: MissedSummary }) {
  const s = data.stats;
  if (!s) return null;
  if (s.pendingCount === 0) {
    return (
      <div className="missed-sum missed-sum--done">
        <Check size={16} weight="bold" />
        Все перезвонены
        {s.avgReactionMin != null && <span className="missed-sum__muted">· среднее время реакции {minutesLabel(s.avgReactionMin)}</span>}
      </div>
    );
  }
  const cells = [
    { label: 'Пропущено', value: String(s.missedCount) },
    { label: 'Ждут звонка', value: String(s.pendingCount), tone: 'warn' },
    { label: 'Дольше 2 ч', value: s.overdueCount ? String(s.overdueCount) : '—', tone: s.overdueCount ? 'risk' : undefined },
    { label: 'Реакция в среднем', value: s.avgReactionMin != null ? minutesLabel(s.avgReactionMin) : '—' },
  ];
  return (
    <div className="missed-sum">
      {cells.map((c) => (
        <div key={c.label} className="missed-sum__cell" data-tone={c.tone}>
          <span className="missed-sum__value">{c.value}</span>
          <span className="missed-sum__label">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function OwnView({ items, now }: { items: MissedGroup[]; now: number }) {
  const [showDone, setShowDone] = useState(false);
  const pending = items.filter((g) => !g.handled);
  const done = items.filter((g) => g.handled);
  return (
    <div className="missed-list">
      {pending.map((g) => <PendingRow key={g.callId} g={g} now={now} actions />)}
      {done.length > 0 && (
        <>
          <button type="button" className="missed-fold" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            {showDone ? <CaretDown size={14} /> : <CaretRight size={14} />}
            Отработано · {done.length}
          </button>
          {showDone && done.map((g) => <DoneRow key={g.callId} g={g} />)}
        </>
      )}
    </div>
  );
}

function PendingRow({ g, now, actions }: { g: MissedGroup; now: number; actions?: boolean }) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const wait = minsSince(g.firstAt, now);
  const tone = waitTone(wait);
  const calledBack = useMutation({
    mutationFn: () => callsApi.calledBack(g.callId),
    onSuccess: () => {
      message.success('Отмечено: перезвонили');
      queryClient.invalidateQueries({ queryKey: ['calls-missed'] });
      queryClient.invalidateQueries({ queryKey: ['calls'] });
    },
    onError: (err) => message.error(apiErrorMessage(err)),
  });
  const phone = formatUzPhone(g.phone);

  const copyPhone = async () => {
    try {
      await navigator.clipboard.writeText(g.phone ?? '');
      message.success(`Номер скопирован: ${phone}`);
    } catch {
      message.info(phone);
    }
  };

  return (
    <div className="missed-row" data-tone={tone}>
      <span className="missed-row__icon"><PhoneX size={16} weight="bold" /></span>
      <div className="missed-row__main">
        <Link to={`/calls?call=${g.callId}`} className="missed-row__who">{who(g)}</Link>
        <div className="missed-row__sub">
          {g.client && phone ? `${phone} · ` : ''}
          звонил в {dayjs(g.lastAt).format('HH:mm')}
          {g.missedCount > 1 && <span className="missed-row__times">×{g.missedCount}</span>}
        </div>
      </div>
      <span className="missed-row__wait" title="Сколько ждёт с первого пропущенного">ждёт {minutesLabel(wait)}</span>
      {actions && (
        <div className="missed-row__actions">
          {g.phone && (isMobile ? (
            <a className="missed-btn missed-btn--primary" href={`tel:${g.phone}`} aria-label={`Позвонить ${phone}`}>
              <Phone size={15} weight="bold" />
              <span>Позвонить</span>
            </a>
          ) : (
            <button type="button" className="missed-btn missed-btn--primary" onClick={copyPhone} title="Скопировать номер, чтобы набрать">
              <Phone size={15} weight="bold" />
              <span>{phone}</span>
            </button>
          ))}
          <button
            type="button"
            className="missed-btn"
            disabled={calledBack.isPending}
            onClick={() => calledBack.mutate()}
            title="Связались другим способом — отметить вручную"
          >
            <Check size={15} weight="bold" />
            <span>Перезвонил</span>
          </button>
        </div>
      )}
    </div>
  );
}

function DoneRow({ g }: { g: MissedGroup }) {
  return (
    <div className="missed-row missed-row--done">
      <span className="missed-row__icon">{g.handledVia === 'client' ? <PhoneIncoming size={16} weight="bold" /> : <Check size={16} weight="bold" />}</span>
      <div className="missed-row__main">
        <Link to={`/calls?call=${g.callId}`} className="missed-row__who">{who(g)}</Link>
        <div className="missed-row__sub">
          звонил в {dayjs(g.lastAt).format('HH:mm')}
          {g.missedCount > 1 && <span className="missed-row__times">×{g.missedCount}</span>}
          {' · '}{handledText(g)}
        </div>
      </div>
    </div>
  );
}

function LeaderView({ data, now }: { data: MissedSummary; now: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const today = dayjs().format('YYYY-MM-DD');
  return (
    <div className="missed-list">
      {data.managers!.map((m) => {
        const groups = data.items.filter((i) => i.managerId === m.managerId);
        const total = groups.length;
        const handled = m.handledCount ?? groups.filter((g) => g.handled).length;
        const oldest = m.oldestPendingAt ? minsSince(m.oldestPendingAt, now) : null;
        const waiting = groups.filter((g) => !g.handled);
        const expanded = open === m.managerId;
        const callsLink = `/calls?missedOnly=1&managerId=${m.managerId}&from=${today}`;
        return (
          <div key={m.managerId} className="missed-mgr">
            <button
              type="button"
              className="missed-mgr__row"
              data-tone={oldest != null ? waitTone(oldest) : 'ok'}
              aria-expanded={waiting.length ? expanded : undefined}
              onClick={() => (waiting.length ? setOpen(expanded ? null : m.managerId) : navigate(callsLink))}
            >
              <span className="missed-mgr__caret">
                {waiting.length ? (expanded ? <CaretDown size={14} /> : <CaretRight size={14} />) : null}
              </span>
              <span className="missed-mgr__name">{m.managerName}</span>
              <span className="missed-mgr__progress" title={`Отработано ${handled} из ${total}`}>
                <span className="missed-mgr__bar"><span style={{ width: `${total ? (handled / total) * 100 : 0}%` }} /></span>
                <span className="missed-mgr__ratio">{handled}/{total}</span>
              </span>
              <span className="missed-mgr__state">
                {m.pendingCount > 0
                  ? <>ждут {m.pendingCount}{oldest != null && <> · дольше всех {minutesLabel(oldest)}</>}</>
                  : 'все перезвонены'}
              </span>
              <span className="missed-mgr__avg" title="Среднее время от пропущенного до отработки">
                {m.avgReactionMin != null ? `реакция ${minutesLabel(m.avgReactionMin)}` : ''}
              </span>
            </button>
            {expanded && (
              <div className="missed-mgr__items">
                {waiting.map((g) => <PendingRow key={g.callId} g={g} now={now} />)}
                <Link className="missed-mgr__all" to={callsLink}>
                  Все пропущенные менеджера <CaretRight size={12} />
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
