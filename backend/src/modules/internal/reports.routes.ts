import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { config } from '../../lib/config';
import { AppError } from '../../lib/errors';
import { closedDealsReportService } from '../analytics/closedDealsReport.service';
import { telegramService } from '../telegram/telegram.service';

const router = Router();
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

function assertInternalToken(req: Request): void {
  const expected = config.reports.internalToken;
  if (!expected) {
    throw new AppError(503, 'INTERNAL_REPORTS_TOKEN не настроен на сервере');
  }
  const provided = String(req.header('x-internal-token') || '');
  if (!provided || provided !== expected) {
    throw new AppError(401, 'Неверный internal token');
  }
}

function formatDdMmYyyyByTashkent(dayYmd: string): string {
  const [y, m, d] = dayYmd.split('-');
  return `${d}-${m}-${y}`;
}

function getTashkentNowHour(): number {
  const nowTashkent = new Date(Date.now() + TASHKENT_OFFSET_MS);
  return nowTashkent.getUTCHours();
}

export async function sendDailyClosedDealsToWarehouse(): Promise<{
  ok: boolean;
  period: { from: string; to: string };
  rows: number;
  fileSize: number;
}> {
  const chatId = config.telegram.groupWarehouseChatId;
  if (!chatId) {
    throw new AppError(400, 'Не задан TELEGRAM_GROUP_WAREHOUSE_CHAT_ID');
  }

  const { from, to } = closedDealsReportService.getYesterdayRange();
  const report = await closedDealsReportService.buildReport(from, to);
  const sendDate = closedDealsReportService.getTodayTashkentYmd();
  const fileName = `${formatDdMmYyyyByTashkent(sendDate)}.csv`;
  const caption = [
    '📊 Ежедневный отчёт закрытых сделок',
    `Период: ${from}`,
    `Строк: ${report.rowCount}`,
    `Сумма: ${Math.round(report.totalLineAmount).toLocaleString('ru-RU')}`,
  ].join('\n');

  const sent = await telegramService.sendGroupDocument(chatId, report.csvBuffer, fileName, caption);
  const fileSize = report.csvBuffer.length;

  console.log(
    `[daily-closed-deals] period=${from} rows=${report.rowCount} bytes=${fileSize} hour_tashkent=${getTashkentNowHour()} telegramSent=${sent}`,
  );

  return {
    ok: sent,
    period: { from, to },
    rows: report.rowCount,
    fileSize,
  };
}

router.post(
  '/send-daily-closed-deals',
  asyncHandler(async (req: Request, res: Response) => {
    assertInternalToken(req);
    const result = await sendDailyClosedDealsToWarehouse();

    res.json({
      ok: result.ok,
      period: result.period,
      rows: result.rows,
      fileSize: result.fileSize,
      sentAt: new Date().toISOString(),
      errors: result.ok ? [] : ['Telegram send failed'],
    });
  }),
);

router.post(
  '/send-now',
  asyncHandler(async (req: Request, res: Response) => {
    assertInternalToken(req);
    const result = await sendDailyClosedDealsToWarehouse();
    res.json({
      ...result,
      sentAt: new Date().toISOString(),
      message: 'Report sent manually',
    });
  }),
);

export { router as internalReportsRoutes };
