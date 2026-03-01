/**
 * Migration: Transfer all _import user data to real accounts, then delete _import users.
 *
 * Run: cd backend && npx tsx src/scripts/migrate-import-users.ts
 *
 * Mapping:
 *   фарход_import  → admin     (existing)
 *   тимур_import   → timur     (existing)
 *   дилноза_import → dilnoza   (existing)
 *   бону_import    → bonu      (create)
 *   фотих_import   → fotix     (create)
 *   дилмурод_import → dilmurod (create)
 *   мадина_import  → madina    (create)
 *   комила_import  → komila    (create)
 *   хадича_import  → xadicha   (create)
 *
 * Tables updated (23 foreign keys):
 *   deals.manager_id, deals.archived_by_id,
 *   clients.manager_id,
 *   payments.created_by, payments.received_by_id,
 *   inventory_movements.created_by,
 *   shipments.shipped_by,
 *   deal_items.confirmed_by,
 *   deal_comments.author_id,
 *   daily_closings.closed_by_id,
 *   audit_logs.user_id,
 *   notifications.user_id, notifications.created_by_user_id,
 *   notification_batches.created_by_user_id,
 *   sessions.user_id,
 *   tasks.assignee_id, tasks.created_by_id, tasks.approved_by_id,
 *   expenses.created_by,
 *   messages.sender_id,
 *   conversation_reads.user_id,
 *   contract_attachments.uploaded_by,
 *   contracts.deleted_by_id,
 *   push_subscriptions.user_id
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password';

const prisma = new PrismaClient();

// All tables with user FK references
const USER_FK_TABLES: { table: string; column: string }[] = [
  { table: 'deals', column: 'manager_id' },
  { table: 'deals', column: 'archived_by_id' },
  { table: 'clients', column: 'manager_id' },
  { table: 'payments', column: 'created_by' },
  { table: 'payments', column: 'received_by_id' },
  { table: 'inventory_movements', column: 'created_by' },
  { table: 'shipments', column: 'shipped_by' },
  { table: 'deal_items', column: 'confirmed_by' },
  { table: 'deal_comments', column: 'author_id' },
  { table: 'daily_closings', column: 'closed_by_id' },
  { table: 'audit_logs', column: 'user_id' },
  { table: 'notifications', column: 'user_id' },
  { table: 'notifications', column: 'created_by_user_id' },
  { table: 'notification_batches', column: 'created_by_user_id' },
  { table: 'sessions', column: 'user_id' },
  { table: 'tasks', column: 'assignee_id' },
  { table: 'tasks', column: 'created_by_id' },
  { table: 'tasks', column: 'approved_by_id' },
  { table: 'expenses', column: 'created_by' },
  { table: 'messages', column: 'sender_id' },
  { table: 'conversation_reads', column: 'user_id' },
  { table: 'contract_attachments', column: 'uploaded_by' },
  { table: 'contracts', column: 'deleted_by_id' },
  { table: 'push_subscriptions', column: 'user_id' },
];

interface MigrationMapping {
  importLogin: string;
  targetLogin: string;
  targetFullName: string;
  createTarget: boolean;
}

const MAPPINGS: MigrationMapping[] = [
  { importLogin: 'фарход_import', targetLogin: 'admin', targetFullName: '', createTarget: false },
  { importLogin: 'тимур_import', targetLogin: 'timur', targetFullName: '', createTarget: false },
  { importLogin: 'дилноза_import', targetLogin: 'dilnoza', targetFullName: '', createTarget: false },
  { importLogin: 'бону_import', targetLogin: 'bonu', targetFullName: 'Bonu', createTarget: true },
  { importLogin: 'фотих_import', targetLogin: 'fotix', targetFullName: 'Fotix', createTarget: true },
  { importLogin: 'дилмурод_import', targetLogin: 'dilmurod', targetFullName: 'Dilmurod', createTarget: true },
  { importLogin: 'мадина_import', targetLogin: 'madina', targetFullName: 'Madina', createTarget: true },
  { importLogin: 'комила_import', targetLogin: 'komila', targetFullName: 'Komila', createTarget: true },
  { importLogin: 'хадича_import', targetLogin: 'xadicha', targetFullName: 'Xadicha', createTarget: true },
];

async function transferUserData(fromId: string, toId: string, fromLogin: string, toLogin: string): Promise<number> {
  let totalUpdated = 0;

  for (const { table, column } of USER_FK_TABLES) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
      toId,
      fromId,
    );
    if (result > 0) {
      console.log(`    ${table}.${column}: ${result} rows updated`);
      totalUpdated += result;
    }
  }

  return totalUpdated;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Migration: _import users → real accounts');
  console.log('═══════════════════════════════════════════════\n');

  const defaultPassword = await hashPassword('changeme2026');

  // Phase 1: Create missing target accounts
  console.log('[Phase 1] Creating missing target accounts...\n');
  for (const m of MAPPINGS) {
    if (!m.createTarget) continue;

    const existing = await prisma.user.findFirst({ where: { login: m.targetLogin } });
    if (existing) {
      console.log(`  ${m.targetLogin} already exists (${existing.id}) — skipping creation`);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        login: m.targetLogin,
        password: defaultPassword,
        fullName: m.targetFullName,
        role: 'MANAGER',
        permissions: ['manage_deals', 'manage_inventory', 'view_all_clients', 'edit_client'],
      },
    });
    console.log(`  Created: ${m.targetLogin} (${m.targetFullName}) → ${user.id}`);
  }

  // Phase 2: Transfer data
  console.log('\n[Phase 2] Transferring data...\n');
  for (const m of MAPPINGS) {
    const importUser = await prisma.user.findFirst({ where: { login: m.importLogin } });
    if (!importUser) {
      console.log(`  SKIP: ${m.importLogin} not found`);
      continue;
    }

    const targetUser = await prisma.user.findFirst({ where: { login: m.targetLogin } });
    if (!targetUser) {
      console.log(`  ERROR: target ${m.targetLogin} not found!`);
      continue;
    }

    console.log(`  ${m.importLogin} (${importUser.id}) → ${m.targetLogin} (${targetUser.id})`);
    const count = await transferUserData(importUser.id, targetUser.id, m.importLogin, m.targetLogin);
    console.log(`    Total: ${count} rows transferred\n`);
  }

  // Phase 3: Verify no data remains on _import users
  console.log('[Phase 3] Verifying transfer...\n');
  let allClear = true;
  for (const m of MAPPINGS) {
    const importUser = await prisma.user.findFirst({ where: { login: m.importLogin } });
    if (!importUser) continue;

    let remaining = 0;
    for (const { table, column } of USER_FK_TABLES) {
      const result = await prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int as count FROM "${table}" WHERE "${column}" = $1`,
        importUser.id,
      );
      remaining += result[0]?.count || 0;
    }

    if (remaining > 0) {
      console.log(`  WARNING: ${m.importLogin} still has ${remaining} references!`);
      allClear = false;
    } else {
      console.log(`  OK: ${m.importLogin} has 0 references`);
    }
  }

  if (!allClear) {
    console.log('\n  Some _import users still have data. Aborting deletion.');
    console.log('  Please investigate and re-run.\n');
    return;
  }

  // Phase 4: Delete _import users
  console.log('\n[Phase 4] Deleting _import accounts...\n');
  for (const m of MAPPINGS) {
    const importUser = await prisma.user.findFirst({ where: { login: m.importLogin } });
    if (!importUser) continue;

    await prisma.user.delete({ where: { id: importUser.id } });
    console.log(`  Deleted: ${m.importLogin} (${importUser.id})`);
  }

  // Phase 5: Summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════\n');

  const finalUsers = await prisma.$queryRaw<any[]>`
    SELECT u.id, u.login, u.full_name, u.role,
      (SELECT COUNT(*)::int FROM deals WHERE manager_id = u.id) as deals,
      (SELECT COUNT(*)::int FROM clients WHERE manager_id = u.id) as clients,
      (SELECT COUNT(*)::int FROM payments WHERE created_by = u.id) as payments
    FROM users u
    ORDER BY u.login
  `;

  console.log('Final user list:');
  for (const u of finalUsers) {
    console.log(`  ${u.login.padEnd(15)} ${u.full_name.padEnd(25)} deals=${u.deals} clients=${u.clients} payments=${u.payments}`);
  }
}

main()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
