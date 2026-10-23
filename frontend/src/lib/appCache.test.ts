// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';
import { setupAppCache } from './appCache';

function fakeBridge(initial: string | null = null) {
  let stored = initial;
  return {
    read: vi.fn(() => stored),
    write: vi.fn((data: string) => { stored = data; }),
    clear: vi.fn(() => { stored = null; }),
    get stored() { return stored; },
  };
}

const user = (id: string) => ({ id, login: id, fullName: id, permissions: [] }) as unknown as User;

describe('setupAppCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({ user: user('u1'), accessToken: 't' });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.PolygraphNative;
  });

  it('does nothing in a regular browser', () => {
    const qc = new QueryClient();
    setupAppCache(qc);
    expect(qc.getDefaultOptions().queries?.gcTime).toBeUndefined();
  });

  it('saves successful queries and restores them for the same user', async () => {
    const bridge = fakeBridge();
    window.PolygraphNative = bridge;
    const qc = new QueryClient();
    setupAppCache(qc);
    await qc.fetchQuery({ queryKey: ['clients'], queryFn: () => [{ id: 1 }] });
    vi.advanceTimersByTime(3_000);
    expect(bridge.write).toHaveBeenCalledOnce();

    const restored = new QueryClient();
    window.PolygraphNative = fakeBridge(bridge.stored);
    setupAppCache(restored);
    expect(restored.getQueryData(['clients'])).toEqual([{ id: 1 }]);
  });

  it('ignores and clears a snapshot of another user', async () => {
    const bridge = fakeBridge();
    window.PolygraphNative = bridge;
    const qc = new QueryClient();
    setupAppCache(qc);
    await qc.fetchQuery({ queryKey: ['clients'], queryFn: () => [1] });
    vi.advanceTimersByTime(3_000);
    const saved = bridge.stored;

    useAuthStore.setState({ user: user('u2') });
    const other = fakeBridge(saved);
    window.PolygraphNative = other;
    const next = new QueryClient();
    setupAppCache(next);
    expect(next.getQueryData(['clients'])).toBeUndefined();
    expect(other.clear).toHaveBeenCalled();
  });

  it('wipes the cache on logout', async () => {
    const bridge = fakeBridge();
    window.PolygraphNative = bridge;
    const qc = new QueryClient();
    setupAppCache(qc);
    await qc.fetchQuery({ queryKey: ['clients'], queryFn: () => [1] });
    useAuthStore.getState().logout();
    expect(bridge.clear).toHaveBeenCalled();
    expect(qc.getQueryData(['clients'])).toBeUndefined();
  });
});
