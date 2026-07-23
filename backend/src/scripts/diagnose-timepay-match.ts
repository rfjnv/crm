/**
 * Диагностика несовпадений синка TimePay: для заданных имён сравнивает
 *  - сырую запись из сегодняшнего /terminals/v6/dashboard/list/ (id, full_name, check_in/out)
 *  - текущую запись пользователя в CRM (id, fullName, timepayEmployeeId, isActive)
 * и явно печатает, совпадает ли id.
 *
 * Запуск на проде: npm run diagnose-timepay -- "Dilshod" "Jahongir" "Бахром Махмудов" ...
 * Без аргументов — берёт список имён, присланных пользователем 2026-07-23.
 */
import { PrismaClient } from '@prisma/client';
import { fetchDashboardList } from '../modules/timepay/timepay.client';
import { tashkentTodayYmd } from '../modules/timepay/timepay.service';

const prisma = new PrismaClient();

const DEFAULT_NAMES = [
  'Dilshod',
  'Jahongir',
  'Бахром Махмудов',
  'Дилмурод',
  'Дилноза Эргашева',
  'Жавлон',
  'Кобилжон Комилжонов',
  'Нурмухаммад Гуломов',
  'Орифжонов Оятилло',
  'Улугбек',
  'Фарангиз Солохиддинова',
];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_NAMES;

  const integration = await prisma.timePayIntegration.findUnique({ where: { id: 'singleton' } });
  if (!integration?.accessToken) {
    console.error('Токен TimePay не настроен.');
    process.exit(1);
  }

  const dateYmd = tashkentTodayYmd();
  console.log(`Дата: ${dateYmd}\n`);

  const entries = await fetchDashboardList(integration.accessToken, { date: dateYmd });
  console.log(`Всего записей в дашборде TimePay за сегодня: ${entries.length}\n`);

  const allCrmUsers = await prisma.user.findMany({
    select: { id: true, login: true, fullName: true, isActive: true, timepayEmployeeId: true },
  });

  for (const name of names) {
    console.log(`\n=== ${name} ===`);

    const tpMatches = entries.filter((e) => {
      const full = (e as Record<string, unknown>).full_name;
      return typeof full === 'string' && norm(full).includes(norm(name));
    });
    if (tpMatches.length === 0) {
      console.log('  TimePay: НЕТ записи с таким именем в сегодняшнем дашборде');
    } else {
      for (const e of tpMatches) {
        console.log(
          `  TimePay: id=${(e as Record<string, unknown>).id} full_name="${(e as Record<string, unknown>).full_name}" check_in=${(e as Record<string, unknown>).check_in} check_out=${(e as Record<string, unknown>).check_out}`,
        );
      }
    }

    const crmMatches = allCrmUsers.filter((u) => norm(u.fullName).includes(norm(name)));
    if (crmMatches.length === 0) {
      console.log('  CRM: пользователь с таким именем не найден');
    } else {
      for (const u of crmMatches) {
        console.log(
          `  CRM: id=${u.id} login=${u.login} fullName="${u.fullName}" isActive=${u.isActive} timepayEmployeeId=${u.timepayEmployeeId ?? 'НЕ ЗАДАН'}`,
        );
      }
    }

    if (tpMatches.length === 1 && crmMatches.length === 1) {
      const tpId = String((tpMatches[0] as Record<string, unknown>).id);
      const crmId = crmMatches[0].timepayEmployeeId;
      console.log(
        crmId === tpId
          ? '  -> ID СОВПАДАЕТ, должен был матчиться по ID'
          : `  -> ID НЕ СОВПАДАЕТ: TimePay=${tpId}, CRM=${crmId ?? 'null'}`,
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
