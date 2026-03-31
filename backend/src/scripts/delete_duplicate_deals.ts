import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Поиск дубликатов сделок...');

  const deals = await prisma.deal.findMany({
    include: {
      client: true,
      items: true,
    },
    orderBy: { createdAt: 'asc' }, // Сначала самые старые
  });

  // Группируем по clientId + title + amount 
  const grouped = new Map<string, any[]>();
  
  for (const d of deals) {
    if (!d.title || !d.amount) continue;
    // Округляем сумму до целого, чтобы избежать проблем с плавающей точкой
    const amountStr = Number(d.amount).toFixed(0); 
    const key = `${d.clientId}||${d.title.trim().toLowerCase()}||${amountStr}`;
    
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(d);
  }

  let totalDeleted = 0;

  for (const [key, list] of grouped.entries()) {
    if (list.length > 1 && Number(list[0].amount) > 0) {
      console.log(`\nНайдено ${list.length} одинаковых сделок: Клиент = ${list[0].client.companyName}, Название = "${list[0].title}", Сумма = ${list[0].amount}`);
      
      // Оставляем самую первую сделку (самую старую)
      const original = list[0];
      const duplicates = list.slice(1);

      console.log(`  ОРИГИНАЛ: [${original.status}] ID: ${original.id} (Создана: ${original.createdAt})`);

      for (const dup of duplicates) {
        console.log(`  УДАЛЕНИЕ ДУБЛИКАТА: [${dup.status}] ID: ${dup.id} (Создана: ${dup.createdAt})`);
        
        // Транзакция для полного удаления без следов
        await prisma.$transaction(async (tx) => {
          // 1. Удаляем связанные оплаты (payments) (нет onDelete Cascade)
          await tx.payment.deleteMany({ where: { dealId: dup.id } });
          
          // 2. Удаляем движения по складу (inventory_movements) (нет onDelete Cascade)
          await tx.inventoryMovement.deleteMany({ where: { dealId: dup.id } });
          
          // 3. Удаляем сообщения (messages)
          await tx.message.deleteMany({ where: { dealId: dup.id } });
          
          // 4. DealItem, DealComment, Shipment удаляются каскадно, но для надёжности можно:
          await tx.dealItem.deleteMany({ where: { dealId: dup.id } });
          await tx.dealComment.deleteMany({ where: { dealId: dup.id } });
          await tx.shipment.deleteMany({ where: { dealId: dup.id } });
          
          // 5. Удаляем саму сделку
          await tx.deal.delete({ where: { id: dup.id } });
        });
        
        totalDeleted++;
      }
    }
  }

  console.log(`\nГотово! Удалено дубликатов сделок: ${totalDeleted}`);
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
