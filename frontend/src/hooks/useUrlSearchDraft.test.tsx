// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUrlSearchDraft } from './useUrlSearchDraft';

let navigateRef: ReturnType<typeof useNavigate> | null = null;
let currentSearch = '';
/**
 * В браузере смена URL рендерится как transition, а страница клиентов фильтрует тысячи строк —
 * URL применяется заметно позже записи. Клавиша, нажатая в этот промежуток, раньше откатывалась.
 */
let urlApplyDelayMs = 0;

/** Повторяет связку из ClientsPage: ?q= в URL, запись с replace и сбросом страницы. */
function SearchBox() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    navigateRef = navigate;
    currentSearch = location.search;
  });
  const { draft, setDraft } = useUrlSearchDraft(searchParams.get('q') ?? '', (q) => {
    const apply = () => setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (q) next.set('q', q);
      else next.delete('q');
      next.delete('page');
      return next;
    }, { replace: true });
    if (urlApplyDelayMs) window.setTimeout(apply, urlApplyDelayMs);
    else apply();
  });
  return <input aria-label="search" value={draft} onChange={(e) => setDraft(e.target.value)} />;
}

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <SearchBox />
    </MemoryRouter>,
  );
  return screen.getByLabelText('search') as HTMLInputElement;
}

/** Печатает посимвольно, как человек: каждое нажатие дописывает к тому, что сейчас в поле. */
async function typeSlowly(input: HTMLInputElement, text: string, intervalMs: number) {
  for (const ch of text) {
    act(() => {
      fireEvent.change(input, { target: { value: input.value + ch } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs);
    });
  }
}

const qFromUrl = () => new URLSearchParams(currentSearch).get('q');

describe('useUrlSearchDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    urlApplyDelayMs = 0;
    cleanup();
    vi.useRealTimers();
  });

  it.each([50, 250, 300, 320, 350, 400, 500])('не теряет буквы при наборе с интервалом %i мс', async (interval) => {
    const input = renderAt('/clients');
    await typeSlowly(input, 'алишер', interval);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(input.value).toBe('алишер');
    expect(qFromUrl()).toBe('алишер');
  });

  it.each([50, 250, 300, 320, 350, 400, 500])('не теряет буквы, когда URL применяется с задержкой (интервал %i мс)', async (interval) => {
    urlApplyDelayMs = 40;
    const input = renderAt('/clients');
    await typeSlowly(input, 'алишер', interval);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(input.value).toBe('алишер');
    expect(qFromUrl()).toBe('алишер');
  });

  it('не съедает пробел между словами', async () => {
    const input = renderAt('/clients');
    await typeSlowly(input, 'бекзод ака', 320);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(input.value).toBe('бекзод ака');
    expect(qFromUrl()).toBe('бекзод ака');
  });

  it('берёт начальное значение из URL', () => {
    const input = renderAt('/clients?q=%D0%B1%D0%B0%D0%B5%D0%B7');
    expect(input.value).toBe('баез');
  });

  it('подхватывает запрос при переходе по ссылке и кнопке «назад»', async () => {
    const input = renderAt('/clients?q=old');
    await act(async () => {
      navigateRef!('/clients?q=new');
    });
    expect(input.value).toBe('new');
    await act(async () => {
      navigateRef!(-1);
    });
    expect(input.value).toBe('old');
  });

  it('очистка поля убирает q из URL', async () => {
    const input = renderAt('/clients?q=abc');
    act(() => {
      fireEvent.change(input, { target: { value: '' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(qFromUrl()).toBeNull();
  });
});
