import client from './client';
import type { BlockingHolidayCalendarResponse } from '../types';

export const foreignTradeApi = {
  getBlockingEvents: (params: { from?: string; to?: string; countries?: string[] }) =>
    client
      .get<BlockingHolidayCalendarResponse>('/foreign-trade/blocking-events', {
        params: {
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          ...(params.countries?.length ? { country: params.countries.join(',') } : {}),
        },
      })
      .then((r) => r.data),
};
