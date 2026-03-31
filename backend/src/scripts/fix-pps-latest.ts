import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

const TARGET_CLIENT = 'ппс';
const DEBT_MARKS = new Set(['к', 'н/к', 'п/к', 'ф', 'пп']);

function norm(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function numVal(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const excelPath = path.resolve(process.cwd(), '../analytics_2026-03-18.xlsx');
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[wb.SheetNames.length - 1]];
  const range = XLSX.utils.decode_range(ws['!ref']!);
  const closingCol = range.e.c + 1 - 2;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];

  let targetDebt = 0;
  let lastExcelDate = new Date();

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i] || [];
    const clientName = norm(row[1]);
    if (clientName !== TARGET_CLIENT) continue;
    const mark = norm(row[9]);
    if (!DEBT_MARKS.has(mark)) continue;
    targetDebt += numVal(row[closingCol]);

    const dateRaw = row[0];
    if (typeof dateRaw === 'number') {
      const d = XLSX.SSF.parse_date_code(dateRaw);
      if (d) lastExcelDate = new Date(Date.UTC(d.y, d.m - 1, d.d));
    } else if (dateRaw) {
      const d = new Date(String(dateRaw));
      if (!isNaN(d.getTime())) lastExcelDate = d;
    }
  }

  const client = await prisma.client.findFirst({
    where: { companyName: { equals: TARGET_CLIENT, mode: 'insensitive' } },
    select: { id: true, companyName: true },
  });

  if (!client) throw new Error(`Client "${TARGET_CLIENT}" not found`);

  const deals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
    },
    select: { id: true, amount: true, paidAmount: true, paymentStatus: true, managerId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const currentDebt = deals.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);
  let diff = currentDebt - targetDebt;

  console.log(`Client: ${client.companyName}`);
  console.log(`Current debt: ${currentDebt}`);
  console.log(`Target debt (Excel): ${targetDebt}`);
  console.log(`Diff to fix: ${diff}`);

  if (Math.abs(diff) <= 1) {
    console.log('Already aligned.');
    return;
  }

  // If CRM debt is higher than Excel, add missing payments across unpaid deals.
  if (diff > 0) {
    await prisma.$transaction(async (tx) => {
      let remaining = diff;
      for (const deal of deals) {
        if (remaining <= 0) break;
        const dealDebt = Number(deal.amount) - Number(deal.paidAmount);
        if (dealDebt <= 0) continue;

        const apply = Math.min(remaining, dealDebt);
        remaining -= apply;
        const newPaid = Number(deal.paidAmount) + apply;
        const newStatus = newPaid >= Number(deal.amount) ? 'PAID' : 'PARTIAL';

        await tx.deal.update({
          where: { id: deal.id },
          data: { paidAmount: newPaid, paymentStatus: newStatus },
        });

        await tx.payment.create({
          data: {
            dealId: deal.id,
            clientId: client.id,
            amount: apply,
            method: 'TRANSFER',
            paidAt: lastExcelDate,
            createdBy: deal.managerId,
          },
        });
      }
    });
  } else {
    // If CRM debt is lower than Excel, add one debt correction deal.
    const addDebt = Math.abs(diff);
    const managerId = deals[0]?.managerId;
    if (!managerId) throw new Error('No manager found for correction deal');

    await prisma.deal.create({
      data: {
        title: `${client.companyName} — Сверка`,
        status: 'IN_PROGRESS',
        amount: addDebt,
        paidAmount: 0,
        paymentStatus: 'UNPAID',
        paymentType: 'FULL',
        paymentMethod: 'TRANSFER',
        clientId: client.id,
        managerId,
        createdAt: lastExcelDate,
      },
    });
  }

  const finalDeals = await prisma.deal.findMany({
    where: {
      clientId: client.id,
      isArchived: false,
      status: { notIn: ['CANCELED', 'REJECTED'] },
    },
    select: { amount: true, paidAmount: true },
  });
  const finalDebt = finalDeals.reduce((s, d) => s + (Number(d.amount) - Number(d.paidAmount)), 0);
  console.log(`Final debt: ${finalDebt}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

