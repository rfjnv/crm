import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
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
  if (!provided) {
    throw new AppError(401, 'Неверный internal token');
  }
  // timingSafeEqual prevents timing attacks on token comparison
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.alloc(expectedBuf.length);
  providedBuf.write(provided.slice(0, expectedBuf.length));
  if (!timingSafeEqual(expectedBuf, providedBuf) || provided.length !== expected.length) {
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

function formatSum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReportHtml(
  sendDateDisplay: string,
  report: Awaited<ReturnType<typeof closedDealsReportService.buildReport>>,
): string {
  const lines: string[] = [];
  lines.push('📊 <b>Ежедневный отчёт закрытых сделок</b>');
  lines.push(`🗓 Дата: ${escapeHtml(sendDateDisplay)}`);
  lines.push('');
  lines.push('<b>Итого за день:</b>');
  lines.push(`• Позиций: ${report.rowCount}`);
  lines.push(`• Клиентов: ${report.clientsCount}`);
  lines.push(`• Сумма продаж: ${formatSum(report.totalLineAmount)} сум`);
  if (report.totalDebtAmount > 0) {
    lines.push(`• Остаток долга: ${formatSum(report.totalDebtAmount)} сум`);
  }

  if (report.managerBreakdown.length > 0) {
    lines.push('');
    lines.push('<b>По менеджерам:</b>');
    for (const m of report.managerBreakdown) {
      lines.push(
        `• ${escapeHtml(m.managerName)} — ${m.dealsCount} сдел., ${m.clientsCount} клиент(ов), ${formatSum(m.totalAmount)} сум`,
      );
    }
  }

  if (report.paymentMethodBreakdown.length > 0) {
    lines.push('');
    lines.push('<b>По способу оплаты:</b>');
    for (const p of report.paymentMethodBreakdown) {
      lines.push(`• ${escapeHtml(p.method)}: ${p.count} шт., ${formatSum(p.totalAmount)} сум`);
    }
  }

  lines.push('');
  lines.push('📎 Полная таблица — во вложении');

  return lines.join('\n');
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

  const { from, to } = closedDealsReportService.getTodayRange();
  const report = await closedDealsReportService.buildReport(from, to);
  const sendDate = closedDealsReportService.getTodayTashkentYmd();
  const sendDateDisplay = formatDdMmYyyyByTashkent(sendDate);
  const fileName = `${sendDateDisplay}.xlsx`;

  let sent = false;
  if (report.rowCount > 0) {
    const html = buildReportHtml(sendDateDisplay, report);
    const messageSent = await telegramService.sendGroupHtmlMessage(chatId, html);
    const docSent = await telegramService.sendGroupDocument(chatId, report.xlsxBuffer, fileName);
    sent = messageSent !== null && docSent;
  } else {
    const html = `📊 <b>Ежедневный отчёт закрытых сделок</b>\n🗓 Дата: ${sendDateDisplay}\n\nСегодня закрытых сделок нет.`;
    sent = (await telegramService.sendGroupHtmlMessage(chatId, html)) !== null;
  }
  const fileSize = report.xlsxBuffer.length;

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
