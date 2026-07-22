/**
 * Восстановление базы из ночного бэкапа (см. modules/backup/db-backup.service.ts).
 *
 * Использование:
 *   npx tsx src/scripts/restore-db-backup.ts <путь-к-файлу.json.gz> [--yes]
 *
 * Файл принимается как в .gz, так и распакованным .json.
 * Схема должна уже существовать (`npx prisma db push`) — бэкап содержит только данные.
 *
 * ВНИМАНИЕ: скрипт ОЧИЩАЕТ таблицы перед вставкой. Запускать только на той базе,
 * которую действительно нужно перезаписать. Без флага --yes только показывает план.
 */
import { readFileSync } from 'fs';
import { gunzipSync } from 'zlib';
import { Client } from 'pg';

interface BackupFile {
  generatedAt: string;
  tables: Record<string, Record<string, unknown>[]>;
}

function loadBackup(path: string): BackupFile {
  const raw = readFileSync(path);
  const json = path.endsWith('.gz') ? gunzipSync(raw).toString('utf-8') : raw.toString('utf-8');
  return JSON.parse(json) as BackupFile;
}

async function main(): Promise<void> {
  const [, , filePath, ...flags] = process.argv;
  const confirmed = flags.includes('--yes');

  if (!filePath) {
    console.error('Укажите путь к файлу бэкапа.\n  npx tsx src/scripts/restore-db-backup.ts backup.json.gz [--yes]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL не задан.');
    process.exit(1);
  }

  const backup = loadBackup(filePath);
  const tableNames = Object.keys(backup.tables);
  const totalRows = tableNames.reduce((s, n) => s + backup.tables[n].length, 0);

  console.log(`Бэкап от: ${backup.generatedAt}`);
  console.log(`Таблиц: ${tableNames.length} | строк: ${totalRows}`);
  console.log(`Цель: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  if (!confirmed) {
    console.log('\nЭто предпросмотр. Данные НЕ изменены.');
    console.log('Для реального восстановления добавьте флаг --yes (существующие данные будут удалены).');
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');
    // Отключаем проверку внешних ключей — иначе пришлось бы вставлять таблицы
    // в строгом топологическом порядке.
    await client.query("SET session_replication_role = 'replica'");

    // Сначала чистим всё, потом вставляем: иначе остатки старых строк смешаются с восстановленными.
    for (const table of tableNames) {
      await client.query(`TRUNCATE TABLE "${table}" CASCADE`);
    }

    let restored = 0;
    for (const table of tableNames) {
      const rows = backup.tables[table];
      if (rows.length === 0) continue;

      const cols = Object.keys(rows[0]);
      const colList = cols.map((c) => `"${c}"`).join(',');
      const CHUNK = 500;

      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const tuples: string[] = [];
        let p = 1;
        for (const row of chunk) {
          tuples.push('(' + cols.map(() => `$${p++}`).join(',') + ')');
          for (const col of cols) {
            const v = row[col];
            // jsonb/массивы приходят объектами — драйверу нужна строка
            params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v);
          }
        }
        await client.query(`INSERT INTO "${table}" (${colList}) VALUES ${tuples.join(',')}`, params);
      }

      restored += rows.length;
      console.log(`  ${table}: ${rows.length}`);
    }

    await client.query("SET session_replication_role = 'origin'");
    await client.query('COMMIT');
    console.log(`\nГотово. Восстановлено строк: ${restored}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nОШИБКА — изменения откачены, база осталась в прежнем состоянии:');
    console.error((error as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
