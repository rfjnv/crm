import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const clientsToFixStr = ["ппс", "тимур", "ламинац"];

async function main() {
    console.log('Поиск клиентов...');
    const dbClients = await prisma.client.findMany({
      where: { OR: clientsToFixStr.map(c => ({ companyName: { contains: c, mode: 'insensitive' } })) }
    });
    
    if (dbClients.length === 0) {
        console.log('Клиенты не найдены.');
        return;
    }
    
    for (const client of dbClients) {
        const deals = await prisma.deal.findMany({ where: { clientId: client.id }, select: { id: true }});
        const dealIds = deals.map(d => d.id);
        
        if (dealIds.length > 0) {
            await prisma.payment.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.inventoryMovement.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.dealItem.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.dealComment.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.shipment.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.message.deleteMany({ where: { dealId: { in: dealIds } } });
            await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
            console.log(`УСЕШНО УДАЛЕНО: ${dealIds.length} сделок у клиента ${client.companyName}. База по нему теперь абсолютно пуста.`);
        } else {
            console.log(`У клиента ${client.companyName} уже нет никаких сделок.`);
        }
    }
}

main().finally(() => prisma.$disconnect());
