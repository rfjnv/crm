import prisma from './src/lib/prisma';

const Tashkent = 'Asia/Tashkent';

async function check() {
  // Check monthly clients for 2026
  const monthlyClients = await prisma.$queryRaw<
    { month: number; client_count: bigint }[]
  >`
    WITH monthly_clients AS (
      SELECT DISTINCT d.client_id,
        EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${Tashkent})::int as month
      FROM deals d
      WHERE EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${Tashkent})::int = 2026
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
    )
    SELECT month, COUNT(DISTINCT client_id) as client_count
    FROM monthly_clients
    GROUP BY month
    ORDER BY month
  `;

  console.log('\n=== Monthly Active Clients ===');
  for (const row of monthlyClients) {
    console.log(`Month ${row.month}: ${row.client_count} clients`);
  }

  // Check March→April retention
  const retention = await prisma.$queryRaw<
    { month: number; total_clients: string; retained_clients: string }[]
  >`
    WITH monthly_clients AS (
      SELECT DISTINCT d.client_id, EXTRACT(MONTH FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${Tashkent})::int as month
      FROM deals d
      WHERE EXTRACT(YEAR FROM (d.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${Tashkent})::int = 2026
        AND d.is_archived = false
        AND d.status NOT IN ('CANCELED','REJECTED')
    )
    SELECT a.month,
      COUNT(DISTINCT a.client_id)::text as total_clients,
      COUNT(DISTINCT b.client_id)::text as retained_clients
    FROM monthly_clients a
    LEFT JOIN monthly_clients b ON a.client_id = b.client_id AND b.month = a.month + 1
    WHERE a.month < 12
    GROUP BY a.month
    ORDER BY a.month
  `;

  console.log('\n=== Retention (current logic) ===');
  for (const row of retention) {
    const rate = Number(row.total_clients) > 0
      ? Math.round((Number(row.retained_clients) / Number(row.total_clients)) * 100)
      : 0;
    console.log(`Month ${row.month}: ${row.total_clients} clients, ${row.retained_clients} retained (${rate}%)`);
  }

  process.exit(0);
}

check().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
