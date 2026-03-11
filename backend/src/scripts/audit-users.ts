import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.$queryRaw<any[]>`
    SELECT u.id, u.login, u.full_name, u.role, u.is_active,
      (SELECT COUNT(*)::int FROM deals WHERE manager_id = u.id) as deals,
      (SELECT COUNT(*)::int FROM clients WHERE manager_id = u.id) as clients,
      (SELECT COUNT(*)::int FROM payments WHERE created_by = u.id) as payments,
      (SELECT COUNT(*)::int FROM inventory_movements WHERE created_by = u.id) as inv_moves,
      (SELECT COUNT(*)::int FROM shipments WHERE shipped_by = u.id) as shipments,
      (SELECT COUNT(*)::int FROM deal_comments WHERE author_id = u.id) as comments,
      (SELECT COUNT(*)::int FROM tasks WHERE assignee_id = u.id OR created_by_id = u.id) as tasks,
      (SELECT COUNT(*)::int FROM audit_logs WHERE user_id = u.id) as audit_logs,
      (SELECT COUNT(*)::int FROM sessions WHERE user_id = u.id) as sessions,
      (SELECT COUNT(*)::int FROM notifications WHERE user_id = u.id) as notifications,
      (SELECT COUNT(*)::int FROM deal_items WHERE confirmed_by = u.id) as confirmed_items,
      (SELECT COUNT(*)::int FROM expenses WHERE created_by = u.id) as expenses,
      (SELECT COUNT(*)::int FROM deals WHERE archived_by_id = u.id) as archived_deals
    FROM users u
    ORDER BY u.login
  `;

  console.log('\n=== ALL USERS ===\n');
  for (const u of users) {
    const total = u.deals + u.clients + u.payments + u.inv_moves + u.shipments +
                  u.comments + u.tasks + u.audit_logs + u.sessions + u.notifications +
                  u.confirmed_items + u.expenses + u.closings + u.archived_deals;
    console.log(`LOGIN: ${u.login}`);
    console.log(`  ID: ${u.id}`);
    console.log(`  Name: ${u.full_name}, Role: ${u.role}, Active: ${u.is_active}`);
    console.log(`  deals=${u.deals} clients=${u.clients} payments=${u.payments} inv=${u.inv_moves} shipments=${u.shipments}`);
    console.log(`  comments=${u.comments} tasks=${u.tasks} audit=${u.audit_logs} sessions=${u.sessions} notif=${u.notifications}`);
    console.log(`  confirmed_items=${u.confirmed_items} expenses=${u.expenses} closings=${u.closings} archived_deals=${u.archived_deals}`);
    console.log(`  TOTAL REFERENCES: ${total}`);
    console.log('');
  }

  // Find duplicates by name
  console.log('\n=== POTENTIAL DUPLICATES (by full_name) ===\n');
  const nameGroups = new Map<string, any[]>();
  for (const u of users) {
    const key = u.full_name.toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(u);
  }
  for (const [name, group] of nameGroups) {
    if (group.length > 1) {
      console.log(`"${name}" appears ${group.length} times:`);
      for (const u of group) {
        console.log(`  - ${u.login} (${u.id}), deals=${u.deals}, clients=${u.clients}, payments=${u.payments}`);
      }
    }
  }

  // List _import users
  console.log('\n=== _import USERS ===\n');
  const importUsers = users.filter((u: any) => u.login.includes('_import'));
  for (const u of importUsers) {
    const total = u.deals + u.clients + u.payments + u.inv_moves + u.shipments +
                  u.comments + u.tasks + u.audit_logs + u.sessions + u.notifications +
                  u.confirmed_items + u.expenses + u.closings + u.archived_deals;
    console.log(`${u.login} (${u.full_name}) => ${total} total refs (deals=${u.deals}, clients=${u.clients}, payments=${u.payments})`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
