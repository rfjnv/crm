import prisma from './src/lib/prisma';

async function checkColumns() {
  try {
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='deals' AND column_name LIKE 'transfer%'
    `;
    
    console.log('Transfer columns in DB:');
    console.log(result);
    
    if (result && Array.isArray(result) && result.length > 0) {
      console.log('✅ Migration success! Columns exist.');
    } else {
      console.log('❌ Migration NOT applied. Transfer columns missing!');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkColumns();
