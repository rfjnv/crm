// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../../store/authStore';
import type { User } from '../../types';
import { HIDDEN_MONEY } from '../../utils/currency';
import DealStatusTag from '../DealStatusTag';
import EmptyState from './EmptyState';
import Eyebrow from './Eyebrow';
import Money from './Money';
import Section from './Section';
import StatTile, { StatGrid } from './StatTile';
import StatusPill from './StatusPill';

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null });
  delete document.documentElement.dataset.design;
});

/** Примитивы обязаны одинаково рендериться в обоих режимах — стекло только в CSS. */
describe.each(['classic', 'modern'])('примитивы в режиме %s', (design) => {
  const setup = () => {
    document.documentElement.dataset.design = design;
  };

  it('Eyebrow', () => {
    setup();
    render(<Eyebrow>Выручка сегодня</Eyebrow>);
    expect(screen.getByText('Выручка сегодня')).toHaveProperty('className', 'ui-eyebrow');
  });

  it('Section: заголовок, счётчик, действие-ссылка и содержимое', () => {
    setup();
    const { container } = render(
      <MemoryRouter>
        <Section title="Остатки" count={72} action={{ label: 'Все 72', to: '/inventory/warehouse' }}>
          <p>строки</p>
        </Section>
      </MemoryRouter>,
    );
    expect(container.querySelector('section.ui-section')).not.toBeNull();
    expect(screen.getByText('Остатки').className).toContain('ui-eyebrow');
    expect(screen.getByText('72').className).toBe('ui-section__count');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/inventory/warehouse');
    expect(screen.getByText('строки')).toBeTruthy();
  });

  it('Section без заголовка не рисует шапку', () => {
    setup();
    const { container } = render(<Section>текст</Section>);
    expect(container.querySelector('.ui-section__head')).toBeNull();
  });

  it('StatTile hero с дельтой и базой', () => {
    setup();
    const { container } = render(
      <StatTile size="hero" label="Выручка сегодня" value="48,3" base="вчера 42,9 млн" delta={12.5} />,
    );
    expect(container.querySelector('.ui-stat--hero')).not.toBeNull();
    const pill = container.querySelector('.ui-pill');
    expect(pill?.getAttribute('data-tone')).toBe('positive');
    expect(pill?.textContent).toBe('+12,5 %');
    expect(screen.getByText('вчера 42,9 млн').className).toBe('ui-stat__base');
  });

  it('StatTile: delta null — ничего не рисуется и не резервируется', () => {
    setup();
    const { container } = render(<StatTile label="Активные сделки" value="15" delta={null} />);
    expect(container.querySelector('.ui-pill')).toBeNull();
    expect(container.querySelector('.ui-stat__base')).toBeNull();
  });

  it('StatTile row со ссылкой внутри StatGrid list', () => {
    setup();
    const { container } = render(
      <MemoryRouter>
        <StatGrid list>
          <StatTile size="row" label="Закрыто сделок" value="0" base="вчера 3" to="/deals/closed" />
          <StatTile size="row" label="Активные сделки" value="15" />
        </StatGrid>
      </MemoryRouter>,
    );
    expect(container.querySelector('.ui-stat-grid--list')).not.toBeNull();
    expect(container.querySelector('a.ui-stat--row')?.getAttribute('href')).toBe('/deals/closed');
    expect(container.querySelectorAll('.ui-stat--row')).toHaveLength(2);
  });

  it('Money compact и full', () => {
    setup();
    const { container } = render(
      <>
        <Money variant="compact" value={1_897_406_478} />
        <Money value={48_250} />
      </>,
    );
    const compact = container.querySelector('.ui-money--compact');
    expect(compact?.getAttribute('title')).toContain('1 897 406 478');
    expect(compact?.querySelector('.ui-money__value')?.textContent).toBe('1,9');
    expect(compact?.querySelector('.ui-money__unit')?.textContent).toBe('млрд');
    expect(container.querySelector('.ui-money--full .ui-money__value')?.textContent).toBe('48 250');
  });

  it('Money скрывает суммы на уровне NONE и при null', () => {
    setup();
    useAuthStore.setState({ user: { moneyAccess: 'NONE' } as User });
    const { container } = render(
      <>
        <Money variant="compact" value={1000} />
        <Money value={1000} />
      </>,
    );
    const hidden = container.querySelectorAll('.ui-money--hidden');
    expect(hidden).toHaveLength(2);
    hidden.forEach((el) => expect(el.textContent).toBe(HIDDEN_MONEY));
  });

  it('Money: отрицательная сумма помечается', () => {
    setup();
    const { container } = render(<Money value={-500} />);
    expect(container.querySelector('.ui-money--negative .ui-money__value')?.textContent).toBe('−500');
  });

  it('EmptyState — одна строка с действием', () => {
    setup();
    render(<EmptyState action={<button type="button">Показать вчера</button>}>Нет продаж за 13.10</EmptyState>);
    expect(screen.getByText('Нет продаж за 13.10').className).toBe('ui-empty__text');
    expect(screen.getByRole('button').textContent).toBe('Показать вчера');
  });

  it('StatusPill по тону', () => {
    setup();
    render(<StatusPill tone="negative">Блок</StatusPill>);
    expect(screen.getByText('Блок').getAttribute('data-tone')).toBe('negative');
  });

  it('DealStatusTag получает data-tone, цвет классики прежний', () => {
    setup();
    const { container } = render(
      <>
        <DealStatusTag status="CLOSED" />
        <DealStatusTag status="WAITING_FINANCE" />
        <DealStatusTag status="CANCELED" />
        <DealStatusTag status="NEW" />
      </>,
    );
    const tags = [...container.querySelectorAll('.ant-tag')];
    expect(tags.map((t) => t.getAttribute('data-tone'))).toEqual(['positive', 'warning', 'negative', 'neutral']);
    expect(tags[0].className).toContain('ant-tag-success');
  });

  it('примитивы без инлайновых стилей', () => {
    setup();
    const { container } = render(
      <MemoryRouter>
        <Section title="Секция" action={{ label: 'Все', to: '/' }}>
          <StatGrid>
            <StatTile label="A" value={<Money variant="compact" value={12_400_000} />} delta={-3} />
          </StatGrid>
          <EmptyState>пусто</EmptyState>
          <StatusPill>нейтрально</StatusPill>
        </Section>
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
