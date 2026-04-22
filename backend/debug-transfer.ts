import prisma from './src/lib/prisma';

async function checkTransferData() {
  try {
    // Get last 5 deals with TRANSFER payment method
    const deals = await prisma.deal.findMany({
      where: {
        paymentMethod: 'TRANSFER',
      },
      select: {
        id: true,
        title: true,
        status: true,
        paymentMethod: true,
        transferInn: true,
        transferDocuments: true,
        transferType: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });

    console.log('=== DEALS WITH TRANSFER PAYMENT METHOD ===\n');
    deals.forEach((deal) => {
      console.log(`ID: ${deal.id}`);
      console.log(`Title: ${deal.title}`);
      console.log(`Status: ${deal.status}`);
      console.log(`Payment Method: ${deal.paymentMethod}`);
      console.log(`Transfer INN: ${deal.transferInn || 'NULL'}`);
      console.log(`Transfer Documents: ${deal.transferDocuments || 'NULL'}`);
      console.log(`Transfer Type: ${deal.transferType || 'NULL'}`);
      console.log(`Updated: ${deal.updatedAt}`);
      console.log('---\n');
    });

    if (deals.length === 0) {
      console.log('❌ NO DEALS WITH TRANSFER PAYMENT METHOD FOUND!');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkTransferData();
