import { Client } from 'pg';
import { gzipSync } from 'zlib';
import { config } from '../../lib/config';
import { telegramService } from '../telegram/telegram.service';

/**
 * Полный дамп данных (без схемы — схема уже версионируется в git через prisma/schema.prisma
 * и восстанавливается через `prisma db push`/`migrate deploy`). Каждую ночь упаковывается
 * в один gzip-JSON и отправляется в Telegram — на случай взлома/потери базы.
 *
 * Восстановление: распаковать gzip → JSON вида { tableName: rows[] }, для каждой таблицы
 * временно `SET session_replication_role = replica;` (чтобы обойти FK-порядок) и вставить
 * строки, затем вернуть `SET session_replication_role = DEFAULT;`.
 */

interface BackupResult {
  ok: boolean;
  buffer?: Buffer;
  filename?: string;
  tableCount?: number;
  rowCount?: number;
  error?: string;
}

async function dumpAllTables(): Promise<{ data: Record<string, unknown[]>; tableCount: number; rowCount: number }> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const tablesRes = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );

    const data: Record<string, unknown[]> = {};
    let rowCount = 0;
    for (const { table_name } of tablesRes.rows) {
      const rows = await client.query(`SELECT * FROM "${table_name}"`);
      data[table_name] = rows.rows;
      rowCount += rows.rows.length;
    }

    return { data, tableCount: tablesRes.rows.length, rowCount };
  } finally {
    await client.end();
  }
}

export async function generateDatabaseBackup(): Promise<BackupResult> {
  try {
    const { data, tableCount, rowCount } = await dumpAllTables();
    const json = JSON.stringify({ generatedAt: new Date().toISOString(), tables: data });
    const buffer = gzipSync(Buffer.from(json, 'utf-8'));
    const ymd = new Date().toISOString().slice(0, 10);
    return { ok: true, buffer, filename: `crm-backup-${ymd}.json.gz`, tableCount, rowCount };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const MAX_TELEGRAM_FILE_BYTES = 49 * 1024 * 1024; // держим запас ниже лимита в 50MB

export async function runAndSendDailyBackup(): Promise<{ ok: boolean; error?: string }> {
  const chatId = config.telegram.backupChatId;
  if (!chatId) {
    console.warn('[db-backup] TELEGRAM_BACKUP_CHAT_ID не задан — бэкап пропущен');
    return { ok: false, error: 'TELEGRAM_BACKUP_CHAT_ID не задан' };
  }

  const result = await generateDatabaseBackup();

  if (!result.ok || !result.buffer || !result.filename) {
    await telegramService
      .sendGroupHtmlMessage(chatId, `❌ <b>Бэкап базы не удался</b>\n${result.error ?? 'неизвестная ошибка'}`)
      .catch(() => {});
    return { ok: false, error: result.error };
  }

  if (result.buffer.byteLength > MAX_TELEGRAM_FILE_BYTES) {
    const mb = (result.buffer.byteLength / 1024 / 1024).toFixed(1);
    await telegramService
      .sendGroupHtmlMessage(
        chatId,
        `⚠️ <b>Бэкап базы слишком большой для Telegram</b>\nРазмер: ${mb}MB (лимит 50MB). Нужен другой способ доставки — сообщите разработчику.`,
      )
      .catch(() => {});
    return { ok: false, error: `Backup too large: ${mb}MB` };
  }

  const mb = (result.buffer.byteLength / 1024 / 1024).toFixed(2);
  const caption = `📦 Бэкап базы CRM\nТаблиц: ${result.tableCount} · Строк: ${result.rowCount} · Размер: ${mb}MB`;
  const sent = await telegramService.sendGroupDocument(chatId, result.buffer, result.filename, caption);

  if (!sent) {
    return { ok: false, error: 'Не удалось отправить файл в Telegram' };
  }
  return { ok: true };
}
