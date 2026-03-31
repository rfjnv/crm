/**
 * Per-client reconciliation: CRM payments vs Excel payments for 2026
 * Shows which clients have missing payments
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';

const prisma = new PrismaClient();

const MONTH_NAMES = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'PAYME', 'TERMINAL'] as const;

type Row = (string | number | undefined | null)[];

function numVal(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normClient(name: string): string {
  let s = name.toLowerCase().trim();
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  // transliterate common Latin to Cyrillic
  const map: Record<string, string> = {
    sh: 'ш', ch: 'ч', zh: 'ж', yo: 'ё', yu: 'ю', ya: 'я',
    a: 'а', b: 'б', v: 'в', g: 'г', d: 'д', e: 'е', z: 'з',
    i: 'и', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п',
    r: 'р', s: 'с', t: 'т', u: 'у', f: 'ф', h: 'х', c: 'ц',
    y: 'й', x: 'кс', w: 'в', j: 'ж', q: 'к',
  };
  // digraphs first
  for (const [lat, cyr] of Object.entries(map).filter(([k]) => k.length > 1)) {
    s = s.replaceAll(lat, cyr);
  }
  for (const [lat, cyr] of Object.entries(map).filter(([k]) => k.length === 1)) {
    s = s.replaceAll(lat, cyr);
  }
  // remove legal prefixes
  s = s.replace(/\b(ооо|ип|мчж|llc|ooo)\b/g, '');
  const tokens = s.split(/\s+/).filter(Boolean).sort();
  return tokens.join(' ');
}

function getSheetLayout(ws: XLSX.WorkSheet) {
  const ref = ws['!ref'];
  const totalCols = ref ? XLSX.utils.decode_range(ref).e.c + 1 : 28;
  const paymentStartCol = totalCols - 17;
  const paymentCols = PAYMENT_METHODS.map((method, i) => ({
    index: paymentStartCol + i * 3 + 1,
    method,
  }));
  return { paymentCols, totalCols };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const excelFile = path.join(projectRoot, 'analytics_2026-03-12.xlsx');

  // Read Excel: per-client per-month payments
  const wb = XLSX.readFile(excelFile);
  const excelClients = new Map<string, {
    rawName: string;
    months: Map<number, { payments: number; byMethod: Record<string, number>; dealAmount: number }>;
    totalPayments: number;
    totalDeals: number;
  }>();

  for (const sheetName of wb.SheetNames) {
    const sheetLower = sheetName.toLowerCase().trim();
    let monthIdx = -1;
    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (sheetLower.startsWith(MONTH_NAMES[i])) { monthIdx = i; break; }
    }
    if (monthIdx < 0) continue;
    const month = monthIdx + 1;

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as Row[];
    const layout = getSheetLayout(ws);

    for (let r = 3; r < data.length; r++) {
      const row = data[r];
      if (!row || !row.length) continue;
      const rawName = String(row[1] || '').trim();
      if (!rawName) continue;
      const opType = String(row[9] || '').trim().toLowerCase();
      if (opType === 'обмен') continue;

      const key = normClient(rawName);
      if (!excelClients.has(key)) {
        excelClients.set(key, { rawName, months: new Map(), totalPayments: 0, totalDeals: 0 });
      }
      const client = excelClients.get(key)!;
      if (!client.months.has(month)) {
        client.months.set(month, { payments: 0, byMethod: {}, dealAmount: 0 });
      }
      const mdata = client.months.get(month)!;

      // Deal amount
      const lineAmt = numVal(row[8]);
      const qty = numVal(row[5]);
      const price = numVal(row[7]);
      const amt = lineAmt > 0 ? lineAmt : (qty > 0 && price > 0 ? qty * price : 0);
      mdata.dealAmount += amt;
      client.totalDeals += amt;

      // Payments
      for (const pc of layout.paymentCols) {
        const pAmt = numVal(row[pc.index]);
        if (pAmt > 0) {
          mdata.payments += pAmt;
          mdata.byMethod[pc.method] = (mdata.byMethod[pc.method] || 0) + pAmt;
          client.totalPayments += pAmt;
        }
      }
    }
  }

  // Get CRM clients
  const crmClients = await prisma.client.findMany({
    select: { id: true, companyName: true },
  });
  const crmClientMap = new Map<string, { id: string; raw: string }>();
  for (const c of crmClients) {
    crmClientMap.set(normClient(c.companyName), { id: c.id, raw: c.companyName });
  }

  // Match Excel to CRM
  type MatchedClient = {
    excelKey: string;
    excelName: string;
    crmId: string;
    crmName: string;
    excelPayments: number;
    crmPayments: number;
    diff: number;
    monthDetails: { month: number; excelPay: number; crmPay: number; diff: number }[];
  };
  const matched: MatchedClient[] = [];
  const unmatched: { key: string; name: string; total: number }[] = [];

  for (const [key, edata] of excelClients) {
    const crmMatch = crmClientMap.get(key);
    if (!crmMatch) {
      // Try prefix match
      let bestMatch: { id: string; raw: string; key: string } | null = null;
      let bestLen = 0;
      for (const [ckey, cdata] of crmClientMap) {
        if (ckey.startsWith(key) || key.startsWith(ckey)) {
          const overlap = Math.min(ckey.length, key.length);
          if (overlap > bestLen && overlap >= 3) {
            bestMatch = { ...cdata, key: ckey };
            bestLen = overlap;
          }
        }
      }
      if (!bestMatch) {
        if (edata.totalPayments > 0) {
          unmatched.push({ key, name: edata.rawName, total: edata.totalPayments });
        }
        continue;
      }

      // Get CRM payments for matched client
      const crmPayRaw = await prisma.$queryRaw<{ month: number; total: string }[]>(
        Prisma.sql`SELECT EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
          SUM(p.amount)::text as total
        FROM payments p
        JOIN deals d ON d.id = p.deal_id
        WHERE d.client_id = ${bestMatch.id}
          AND p.paid_at >= '2025-12-31T19:00:00Z' AND p.paid_at < '2026-12-31T19:00:00Z'
          AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
        GROUP BY 1`
      );
      const crmPayByMonth = new Map(crmPayRaw.map(r => [r.month, Number(r.total)]));
      let totalCrm = 0;
      const monthDetails: MatchedClient['monthDetails'] = [];
      for (const [month, mdata] of edata.months) {
        const crmPay = crmPayByMonth.get(month) || 0;
        totalCrm += crmPay;
        monthDetails.push({ month, excelPay: mdata.payments, crmPay, diff: crmPay - mdata.payments });
      }
      matched.push({
        excelKey: key, excelName: edata.rawName, crmId: bestMatch.id, crmName: bestMatch.raw,
        excelPayments: edata.totalPayments, crmPayments: totalCrm,
        diff: totalCrm - edata.totalPayments, monthDetails,
      });
      continue;
    }

    // Exact match
    const crmPayRaw = await prisma.$queryRaw<{ month: number; total: string }[]>(
      Prisma.sql`SELECT EXTRACT(MONTH FROM (p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tashkent')::int as month,
        SUM(p.amount)::text as total
      FROM payments p
      JOIN deals d ON d.id = p.deal_id
      WHERE d.client_id = ${crmMatch.id}
        AND p.paid_at >= '2025-12-31T19:00:00Z' AND p.paid_at < '2026-12-31T19:00:00Z'
        AND (p.note IS NULL OR p.note NOT LIKE 'Сверка%')
      GROUP BY 1`
    );
    const crmPayByMonth = new Map(crmPayRaw.map(r => [r.month, Number(r.total)]));
    let totalCrm = 0;
    const monthDetails: MatchedClient['monthDetails'] = [];
    for (const [month, mdata] of edata.months) {
      const crmPay = crmPayByMonth.get(month) || 0;
      totalCrm += crmPay;
      monthDetails.push({ month, excelPay: mdata.payments, crmPay, diff: crmPay - mdata.payments });
    }
    matched.push({
      excelKey: key, excelName: edata.rawName, crmId: crmMatch.id, crmName: crmMatch.raw,
      excelPayments: edata.totalPayments, crmPayments: totalCrm,
      diff: totalCrm - edata.totalPayments, monthDetails,
    });
  }

  // Sort by absolute diff descending
  matched.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  PER-CLIENT RECONCILIATION: CRM vs Excel (2026)');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Show clients with mismatches
  const withDiff = matched.filter(m => Math.abs(m.diff) > 100);
  const withDeficit = withDiff.filter(m => m.diff < -100);
  const withSurplus = withDiff.filter(m => m.diff > 100);

  let totalDeficit = 0;
  let totalSurplus = 0;

  console.log(`Clients with deficit (CRM < Excel): ${withDeficit.length}`);
  console.log('─'.repeat(90));
  for (const m of withDeficit.slice(0, 40)) {
    totalDeficit += m.diff;
    console.log(`  ${m.crmName.substring(0, 28).padEnd(28)} | Excel: ${fmt(m.excelPayments).padStart(14)} | CRM: ${fmt(m.crmPayments).padStart(14)} | Diff: ${fmt(m.diff).padStart(14)}`);
    for (const md of m.monthDetails) {
      if (Math.abs(md.diff) > 100) {
        const mName = MONTH_NAMES[md.month - 1].substring(0, 3);
        console.log(`    ${mName}: Excel=${fmt(md.excelPay).padStart(12)} CRM=${fmt(md.crmPay).padStart(12)} diff=${fmt(md.diff).padStart(12)}`);
      }
    }
  }
  console.log(`\n  TOTAL DEFICIT: ${fmt(totalDeficit)}`);

  console.log(`\nClients with surplus (CRM > Excel): ${withSurplus.length}`);
  console.log('─'.repeat(90));
  for (const m of withSurplus.slice(0, 20)) {
    totalSurplus += m.diff;
    console.log(`  ${m.crmName.substring(0, 28).padEnd(28)} | Excel: ${fmt(m.excelPayments).padStart(14)} | CRM: ${fmt(m.crmPayments).padStart(14)} | Diff: ${fmt(m.diff).padStart(14)}`);
  }
  console.log(`\n  TOTAL SURPLUS: ${fmt(totalSurplus)}`);

  console.log(`\nClients OK (diff < 100): ${matched.length - withDiff.length}`);
  console.log(`Unmatched Excel clients: ${unmatched.length}`);
  if (unmatched.length > 0) {
    let unmatchedTotal = 0;
    for (const u of unmatched.sort((a, b) => b.total - a.total).slice(0, 15)) {
      unmatchedTotal += u.total;
      console.log(`  ${u.name.padEnd(30)} payments: ${fmt(u.total)}`);
    }
    console.log(`  TOTAL UNMATCHED: ${fmt(unmatchedTotal)}`);
  }

  console.log(`\n  NET DIFFERENCE: ${fmt(totalDeficit + totalSurplus)} (deficit + surplus)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
