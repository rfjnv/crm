import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  ip?: string;
  userAgent?: string;
  deviceId?: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext(ctx: RequestContext, fn: () => void): void {
  als.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}
