/**
 * Одноразовое применение сопоставления CRM-пользователь ↔ TimePay employee id,
 * присланного вручную (список сверен человеком, не автоматическим сопоставлением по ФИО).
 *
 * Запуск на проде: npm run set-timepay-ids
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MAPPING: Array<{ crmId: string; timepayId: string }> = [
  { crmId: 'f00a390f-e191-4658-a6d2-e72a9dc8dd85', timepayId: '68989' },
  { crmId: '83722372-a5ff-45d8-9b81-cd4285de0c65', timepayId: '14972' },
  { crmId: '458b4639-720e-4a3a-b46c-34d2aef36660', timepayId: '52611' },
  { crmId: 'd811b9e7-8b1e-442c-8d83-dbb51da56f7f', timepayId: '69412' },
  { crmId: '8ba767dd-52c5-4ea8-a787-268c5f4fca41', timepayId: '8520' },
  { crmId: '8a35d6e3-ecf5-4017-bb16-9c3b7001505f', timepayId: '17576' },
  { crmId: 'e8b9a5d7-d82c-4bff-8cfc-d267c1aec50a', timepayId: '58832' },
  { crmId: 'e3a7b512-a71a-4a55-ac64-d0039476bc08', timepayId: '69081' },
  { crmId: 'd422179a-c962-4cb5-8ddb-6003a830e88f', timepayId: '66819' },
  { crmId: '709455e5-f873-4dfc-9369-39abe527e372', timepayId: '63480' },
  { crmId: 'a8411528-7a56-44c8-be6c-82e08dc5e0c9', timepayId: '14975' },
  { crmId: 'ec8102e5-ce9b-4843-970a-cab266ac00b7', timepayId: '62826' },
];

async function main() {
  let updated = 0;
  let missing = 0;

  for (const { crmId, timepayId } of MAPPING) {
    try {
      const user = await prisma.user.update({
        where: { id: crmId },
        data: { timepayEmployeeId: timepayId },
        select: { fullName: true },
      });
      console.log(`OK  ${crmId} -> timepay ${timepayId} (${user.fullName})`);
      updated += 1;
    } catch (err) {
      console.error(`FAIL ${crmId} -> timepay ${timepayId}:`, err instanceof Error ? err.message : err);
      missing += 1;
    }
  }

  console.log(`\nГотово: обновлено ${updated}, не найдено ${missing}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
