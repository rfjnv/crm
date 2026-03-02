/**
 * Full verification report: every product match detail
 * Run: cd backend && npx tsx src/scripts/stock-verify.ts
 */
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';

const prisma = new PrismaClient();

function parseStock(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const str = String(value).trim();
  if (!str) return 0;
  const match = str.match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;
  return parseFloat(match[1].replace(',', '.')) || 0;
}
function norm(s: unknown): string {
  if (s == null) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}
function lo(s: string): string {
  return s.toLowerCase().trim();
}

interface ExcelProduct { name: string; format: string; unit: string; stock: number; key: string; rawStock: string; }
interface DbProduct { id: string; name: string; format: string | null; unit: string; stock: number; sku: string; }

// ── Copy of matching engine from update-stock.ts ──

function buildExcelIndex(products: ExcelProduct[]) {
  const byFormat = new Map<string, ExcelProduct[]>();
  const byKey = new Map<string, ExcelProduct>();
  for (const p of products) {
    const fmtKey = lo(p.format);
    if (fmtKey) {
      if (!byFormat.has(fmtKey)) byFormat.set(fmtKey, []);
      byFormat.get(fmtKey)!.push(p);
    }
    byKey.set(p.key, p);
  }
  return { byFormat, byKey };
}

function matchDbToExcel(db: DbProduct, excelProducts: ExcelProduct[], index: ReturnType<typeof buildExcelIndex>): { excel: ExcelProduct; method: string } | null {
  const dbName = lo(db.name);
  const formatMatches = index.byFormat.get(dbName);
  if (formatMatches && formatMatches.length === 1) return { excel: formatMatches[0], method: 'format-direct' };
  if (formatMatches && formatMatches.length > 1) {
    const white = formatMatches.find(p => lo(p.name).includes('белая'));
    if (white) return { excel: white, method: 'format-white' };
    return { excel: formatMatches[0], method: 'format-first' };
  }
  const samokleyPatterns = [
    { suffix: ' ок б/н', baseSuffix: ' б/н', nameFilter: 'красная' },
    { suffix: ' ок', baseSuffix: '', nameFilter: 'красная' },
    { suffix: ' турк', baseSuffix: '', nameFilter: 'турция' },
  ];
  for (const pat of samokleyPatterns) {
    if (dbName.endsWith(pat.suffix)) {
      const base = dbName.slice(0, -pat.suffix.length) + pat.baseSuffix;
      const candidates = index.byFormat.get(base);
      if (candidates) {
        const match = candidates.find(p => lo(p.name).includes(pat.nameFilter));
        if (match) return { excel: match, method: 'samoklej-' + pat.suffix.trim() };
      }
      const allSamo = excelProducts.filter(p => lo(p.name).includes('самоклеющаяся'));
      const base2 = dbName.slice(0, -pat.suffix.length);
      const samoMatch = allSamo.find(p => lo(p.name).includes(pat.nameFilter) && lo(p.format) === base2);
      if (samoMatch) return { excel: samoMatch, method: 'samoklej-fallback' };
    }
  }
  if (dbName.startsWith('фольга ')) {
    const foilExcels = excelProducts.filter(p => lo(p.name).includes('фольга'));
    for (const fe of foilExcels) {
      const sizeMatch = fe.name.match(/(\d+)м$/);
      const size = sizeMatch ? sizeMatch[1] : '';
      const color = lo(fe.format);
      const expectedWithSize = 'фольга ' + color + (size ? ' ' + size : '');
      const expectedNoSize = 'фольга ' + color;
      if (lo(expectedWithSize) === dbName) return { excel: fe, method: 'foil' };
      if (size && lo(expectedNoSize) === dbName) return { excel: fe, method: 'foil-nosize' };
      const sarikMatch = color.match(/^(.+?)\s*\((.+)\)$/);
      if (sarikMatch) {
        const baseColor = sarikMatch[1].trim();
        const extra = sarikMatch[2].trim();
        const expectedSarik = 'фольга ' + baseColor + (size ? ' ' + size : '') + ' ' + extra;
        if (lo(expectedSarik) === dbName) return { excel: fe, method: 'foil-sarik' };
      }
    }
    if (dbName === 'фольга гологорамма') {
      const g = excelProducts.find(p => lo(p.name).includes('галаграмма'));
      if (g) return { excel: g, method: 'foil-holo' };
    }
    if (dbName === 'фольга жемчук') {
      const j = excelProducts.find(p => lo(p.format) === 'жемчук');
      if (j) return { excel: j, method: 'foil-color' };
    }
    if (dbName === 'фольга цвет') {
      const c = excelProducts.find(p => lo(p.format) === 'цветная');
      if (c) return { excel: c, method: 'foil-color' };
    }
  }
  if (dbName.startsWith('лам')) {
    const rest = dbName.slice(3).trim();
    const metalMatch = rest.match(/^(\d+)\s+(голд|силвер)$/);
    if (metalMatch) {
      const size = metalMatch[1]; const type = metalMatch[2] === 'голд' ? 'gold' : 'silver';
      const excl = excelProducts.find(p => lo(p.name).includes('металлическ') && lo(p.format).includes(size) && lo(p.format).includes(type));
      if (excl) return { excel: excl, method: 'lam-metal' };
    }
    if (rest.includes('софтач')) {
      const size = rest.replace('софтач', '').trim();
      const excl = excelProducts.find(p => lo(p.name).includes('soft touch') && lo(p.format) === size);
      if (excl) return { excel: excl, method: 'lam-softtouch' };
    }
    if (rest.includes('матт') || rest.includes('мат')) {
      const size = rest.replace(/матт?/, '').trim();
      const fmtKey = size + 'мат';
      const excl = excelProducts.find(p => lo(p.name).includes('ламинационная') && lo(p.name).includes('матов') && lo(p.format).replace(/\s/g, '') === fmtKey);
      if (excl) return { excel: excl, method: 'lam-matte' };
    }
    const sizeOnly = rest.match(/^(\d+)$/);
    if (sizeOnly) {
      const size = sizeOnly[1];
      const excl = excelProducts.find(p => lo(p.name).includes('ламинационная') && lo(p.name).includes('глянцев') && lo(p.format) === size);
      if (excl) return { excel: excl, method: 'lam-glossy' };
    }
  }
  if (dbName.startsWith('мел')) {
    const rest = dbName.slice(3).trim();
    const melMatch = rest.match(/^(\d+)(?:\s+(.+))?$/);
    if (melMatch) {
      const weight = melMatch[1]; const extra = melMatch[2] || '';
      const melExcels = excelProducts.filter(p => lo(p.name).includes('мелованная'));
      if (extra === 'матт') {
        const excl = melExcels.find(p => lo(p.name).includes('матт') && lo(p.format).includes(weight));
        if (excl) return { excel: excl, method: 'mel-matte' };
      } else if (extra) {
        const excl = melExcels.find(p => { const fmt = lo(p.format); return fmt.includes(weight) && (fmt.includes(extra) || lo(p.name).includes(extra)); });
        if (excl) return { excel: excl, method: 'mel-format' };
      } else {
        const excl = melExcels.find(p => { const fmt = lo(p.format); const nameL = lo(p.name); return fmt.includes(weight) && (fmt.includes('70*100') || fmt.includes('70х100')) && !nameL.includes('матт') && !fmt.includes('матт'); });
        if (excl) return { excel: excl, method: 'mel-weight' };
      }
    }
  }
  if (dbName.startsWith('кар') || dbName.startsWith('картон')) {
    const kartExcels = excelProducts.filter(p => lo(p.name).includes('картон') || lo(p.name).includes('целлюлозн'));
    const rulMatch = dbName.match(/картон рул (\d+)\*(\d+)(?:\s+(.+))?/);
    if (rulMatch) {
      const weight = rulMatch[1]; const width = rulMatch[2];
      const excl = kartExcels.find(p => lo(p.name).includes('рулон') && lo(p.name).includes(weight) && lo(p.name).includes(width));
      if (excl) return { excel: excl, method: 'karton-rul' };
    }
    const karFmtMatch = dbName.match(/кар(\d+)\s+(\d+\*\d+)/);
    if (karFmtMatch) {
      const weight = karFmtMatch[1]; const fmt = karFmtMatch[2];
      const excl = kartExcels.find(p => lo(p.name).includes(weight) && lo(p.format) === fmt);
      if (excl) return { excel: excl, method: 'kar-fmt' };
    }
    const karOriginMatch = dbName.match(/кар(\d+)\s+(китай|индия)/);
    if (karOriginMatch) {
      const weight = karOriginMatch[1]; const origin = karOriginMatch[2];
      const excl = kartExcels.find(p => { const fmt = lo(p.format); return fmt.includes(origin) && fmt.includes(weight); });
      if (excl) return { excel: excl, method: 'kar-origin' };
    }
    const karRulMatch = dbName.match(/кар(\d+)\s+рул/);
    if (karRulMatch) {
      const weight = karRulMatch[1];
      const excl = kartExcels.find(p => lo(p.name).includes('рулон') && lo(p.name).includes(weight));
      if (excl) return { excel: excl, method: 'kar-rul' };
    }
  }
  if (dbName.startsWith('уф лак')) {
    const rest = dbName.slice(6).trim();
    if (rest === 'эмбосс') { const excl = excelProducts.find(p => lo(p.format) === 'emboss'); if (excl) return { excel: excl, method: 'uv-emboss' }; }
    else { const excl = excelProducts.find(p => lo(p.format).startsWith('pi ') && lo(p.format).includes(rest)); if (excl) return { excel: excl, method: 'uv-lac' }; }
  }
  if (dbName.startsWith('краска ')) {
    const rest = dbName.slice(7); const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      const brand = parts[0]; const color = parts.slice(1).join(' ');
      const brandMap: Record<string, string> = { 'фокус': 'focus', 'повер': 'power', 'иновацион': 'innovation', 'оптимум': 'optim' };
      const excelBrand = brandMap[brand] || brand;
      const excl = excelProducts.find(p => lo(p.name).includes('краска') && lo(p.name).includes(excelBrand) && lo(p.format) === color);
      if (excl) return { excel: excl, method: 'ink' };
    }
  }
  if (dbName.startsWith('пантон ')) {
    const rest = dbName.slice(7).trim();
    const pantExcels = excelProducts.filter(p => lo(p.name).includes('пантон'));
    let excl = pantExcels.find(p => lo(p.format) === rest);
    if (excl) return { excel: excl, method: 'pantone-direct' };
    const pantMap: Record<string, string> = { 'trans white': 'transparent white', 'opaqi': 'opaque white', 'proces': 'process blue', 'radomin': 'rhodamine red', 'silver': 'silver 877', 'warm': 'warm red', 'reflex': 'reflex blue', 'rubin': 'rubin red' };
    const mapped = pantMap[rest];
    if (mapped) { excl = pantExcels.find(p => lo(p.format) === mapped); if (excl) return { excel: excl, method: 'pantone-map' }; }
  }
  if (dbName === 'вд лак') { const excl = excelProducts.find(p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('глянцев')); if (excl) return { excel: excl, method: 'vd-gloss' }; }
  if (dbName === 'вд лак матт') { const excl = excelProducts.find(p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('матт')); if (excl) return { excel: excl, method: 'vd-matte' }; }
  if (dbName === 'офсет лак') { const excl = excelProducts.find(p => lo(p.name).includes('офсетный лак') || lo(p.name).includes('офсетн') && lo(p.name).includes('лак')); if (excl) return { excel: excl, method: 'offset-lac' }; }
  if (dbName.startsWith('рез')) {
    const rest = dbName.slice(3).trim();
    const rezExcels = excelProducts.filter(p => lo(p.name).includes('офсетное полотно'));
    let excl = rezExcels.find(p => lo(p.format) === rest);
    if (excl) return { excel: excl, method: 'rez-direct' };
    if (rest === '135' || rest === '145') { excl = rezExcels.find(p => lo(p.format) === rest + '0'); if (excl) return { excel: excl, method: 'rez-meters' }; }
    const dimMatch = rest.match(/^(\d+)\*(\d+)$/);
    if (dimMatch) { const expanded = (parseInt(dimMatch[1]) * 10) + '*' + (parseInt(dimMatch[2]) * 10); excl = rezExcels.find(p => lo(p.format) === expanded); if (excl) return { excel: excl, method: 'rez-expanded' }; }
  }
  {
    const plateExcels = excelProducts.filter(p => lo(p.name).includes('офсетная пластина'));
    if (plateExcels.length > 0) {
      const strMatch = dbName.match(/^(\d+\*\d+)\s+стр$/);
      if (strMatch) { const fmt = strMatch[1]; const excl = plateExcels.find(p => !lo(p.name).includes('uv') && lo(p.format) === fmt); if (excl) return { excel: excl, method: 'plate-str' }; }
      const plainMatch = dbName.match(/^(\d+\*\d+)$/);
      if (plainMatch) { const fmt = plainMatch[1]; let excl = plateExcels.find(p => lo(p.name).includes('uv') && lo(p.format) === fmt); if (!excl) excl = plateExcels.find(p => lo(p.format) === fmt); if (excl) return { excel: excl, method: 'plate-uv' }; }
      const parenMatch = dbName.match(/^(\d+\*\d+)\s*\((.+)\)$/);
      if (parenMatch) { const fmt = parenMatch[1] + '(' + parenMatch[2] + ')'; let excl = plateExcels.find(p => { const f = lo(p.format).replace(/\s/g, ''); return f === fmt.replace(/\s/g, ''); }); if (excl) return { excel: excl, method: 'plate-paren' }; }
    }
  }
  if (dbName.startsWith('мет греб')) {
    const rest = dbName.slice(8).trim();
    const combExcels = excelProducts.filter(p => lo(p.name).includes('грибенк') || lo(p.name).includes('гребенк'));
    const combMatch = rest.match(/^(\d+)\/(\d+)(?:\s+(.+))?$/);
    if (combMatch) {
      const num = combMatch[1]; const den = combMatch[2]; const color = combMatch[3] || 'ок';
      const fmtKey = num + '*' + den + '(' + color + ')';
      let excl = combExcels.find(p => lo(p.format).replace(/\s/g, '') === fmtKey);
      if (excl) return { excel: excl, method: 'comb' };
      const fraction = num + '/' + den;
      excl = combExcels.find(p => lo(p.name).includes(fraction) && lo(p.format).includes(color));
      if (excl) return { excel: excl, method: 'comb-name' };
    }
  }
  const specificMap: Record<string, (p: ExcelProduct) => boolean> = {
    'гум': p => lo(p.name) === 'гум' || lo(p.name).includes('гум'),
    'губка': p => lo(p.name).includes('губк') || lo(p.name).includes('вискозн'),
    'тальк': p => lo(p.name).includes('порошок') || lo(p.name).includes('spray powder'),
    'термоклей': p => lo(p.name).includes('термоклей') && !lo(p.format),
    'термоклей 6092': p => lo(p.name).includes('термоклей') && lo(p.format) === '6092',
    'термоклей 6030 ок': p => lo(p.name).includes('термоклей') && lo(p.format) === '6030',
    'смывка': p => lo(p.name).includes('смывка') && lo(p.name).includes('turquoise'),
    'добавка нова': p => lo(p.name) === 'нова плюс',
    'добавка тек': p => lo(p.name).includes('добавка') && lo(p.name).includes('alfa'),
    'очиститель тек': p => lo(p.name).includes('очиститель') || lo(p.name).includes('novafix'),
    'калибр 0,1': p => lo(p.name).includes('калибров') && lo(p.format) === '0.1',
    'калибр 0,15': p => lo(p.name).includes('калибров') && lo(p.format) === '0.15',
    'калибр 0,2': p => lo(p.name).includes('калибров') && lo(p.format) === '0.2',
    'калибр 0,3': p => lo(p.name).includes('калибров') && lo(p.format) === '0.3',
    'калибр 0,4': p => lo(p.name).includes('калибров') && lo(p.format) === '0.4',
    'калибр 0,5': p => lo(p.name).includes('калибров') && lo(p.format) === '0.5',
    'калька а3': p => lo(p.name).includes('копировальн') && lo(p.format) === 'а3',
    'калька а2': p => lo(p.name).includes('копировальн') && lo(p.format) === 'а2',
    'курсор': p => lo(p.name).includes('курсор'),
    'шолоч': p => lo(p.name).includes('проявитель') && lo(p.name).includes('порошок'),
    'биговка': p => lo(p.name).includes('биговальн') && lo(p.format) === '0,3*1,3',
    'марзан 138': p => lo(p.name).includes('марзан') && lo(p.format).includes('1380'),
    'марзан 72': p => lo(p.name).includes('марзан') && lo(p.format).includes('720'),
    'марзан 95': p => lo(p.name).includes('марзан') && lo(p.format).includes('95'),
    'ригель 32': p => lo(p.name).includes('ригель') && lo(p.name).includes('бел') && lo(p.format) === '32',
    'ригель 32 кора': p => lo(p.name).includes('ригель') && lo(p.name).includes('черн') && lo(p.format) === '32',
    'самоклей рулон фассон': p => lo(p.name).includes('самоклеющаяся') && lo(p.name).includes('рулон') && lo(p.format).includes('bj 993'),
    'рулон кесиш': p => lo(p.name).includes('самоклеющаяся') && lo(p.name).includes('рулон') && lo(p.format).includes('китай') && !lo(p.name).includes('ненси'),
    'чехол': p => lo(p.name).includes('чехол') && lo(p.format) === '64',
    'картон': p => false,
    'проявитель стр тек': p => lo(p.name).includes('проявитель') && lo(p.format).includes('стр') && lo(p.format).includes('teknova'),
    'проявитель 1+9': p => lo(p.name).includes('проявитель') && lo(p.format).includes('1+9') && lo(p.format).includes('uv'),
    'бесцветний лак': p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('высоко'),
  };
  if (specificMap[dbName]) { const excl = excelProducts.find(specificMap[dbName]); if (excl) return { excel: excl, method: 'specific' }; }
  return null;
}

// ── Main ──

async function main() {
  const filePath = path.resolve(__dirname, '../../../остаток 02 (3).xlsx');
  console.log('File:', filePath);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const excelMap = new Map<string, ExcelProduct>();
  for (let i = 3; i < data.length; i++) {
    const row = data[i] as unknown[];
    const rawName = row?.[1];
    if (!rawName) continue;
    const name = norm(rawName);
    if (!name) continue;
    const format = norm(row[2]);
    const unit = norm(row[3]);
    const stock = parseStock(row[7]);
    const rawStock = row[7] != null ? String(row[7]).trim() : '0';
    const key = lo(name) + '|||' + lo(format);
    excelMap.set(key, { name, format, unit, stock, key, rawStock });
  }

  const excelProducts = Array.from(excelMap.values());
  const index = buildExcelIndex(excelProducts);

  const dbProducts: DbProduct[] = (await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, format: true, unit: true, stock: true, sku: true },
    orderBy: { name: 'asc' },
  })).map(p => ({ ...p, format: p.format, stock: Number(p.stock) }));

  // Match
  interface FullMatch {
    db: DbProduct;
    excel: ExcelProduct | null;
    method: string;
    status: 'MATCH' | 'UNMATCHED';
  }

  const results: FullMatch[] = [];
  const matchedExcelKeys = new Set<string>();

  for (const dbp of dbProducts) {
    if (!dbp.sku.startsWith('IMPORT-')) continue;
    const result = matchDbToExcel(dbp, excelProducts, index);
    if (result) {
      results.push({ db: dbp, excel: result.excel, method: result.method, status: 'MATCH' });
      matchedExcelKeys.add(result.excel.key);
    } else {
      results.push({ db: dbp, excel: null, method: '-', status: 'UNMATCHED' });
    }
  }

  // Print full report
  console.log('');
  console.log('='.repeat(140));
  console.log('  ПОЛНЫЙ ВЕРИФИКАЦИОННЫЙ ОТЧЁТ ОСТАТКОВ');
  console.log('='.repeat(140));
  console.log(`  Продуктов в БД (IMPORT): ${results.length}`);
  console.log(`  Продуктов в Excel: ${excelProducts.length}`);
  console.log(`  Совпало: ${results.filter(r => r.status === 'MATCH').length}`);
  console.log(`  Не совпало: ${results.filter(r => r.status === 'UNMATCHED').length}`);
  console.log('='.repeat(140));

  // Section 1: Matched products
  console.log('');
  console.log('─── СОВПАВШИЕ ПРОДУКТЫ ───');
  console.log('');
  console.log(
    '#'.padEnd(5) +
    'БД (name)'.padEnd(28) +
    'Excel (name)'.padEnd(40) +
    'Excel fmt'.padEnd(16) +
    'БД ост.'.padStart(10) +
    'Excel ост.'.padStart(12) +
    'Совпад?'.padStart(10) +
    '  Метод'
  );
  console.log('-'.repeat(140));

  let i = 1;
  let matchOk = 0;
  let matchDiff = 0;

  for (const r of results) {
    if (r.status !== 'MATCH' || !r.excel) continue;
    const dbStock = r.db.stock;
    const exStock = r.excel.stock;
    const same = Math.abs(dbStock - exStock) < 0.01;
    if (same) matchOk++; else matchDiff++;

    console.log(
      String(i).padEnd(5) +
      r.db.name.substring(0, 26).padEnd(28) +
      r.excel.name.substring(0, 38).padEnd(40) +
      r.excel.format.substring(0, 14).padEnd(16) +
      dbStock.toString().padStart(10) +
      exStock.toString().padStart(12) +
      (same ? '  ДА' : '  НЕТ ❌').padStart(10) +
      '  ' + r.method
    );
    i++;
  }

  console.log('-'.repeat(140));
  console.log(`  Совпадает: ${matchOk}  |  Расхождение: ${matchDiff}`);

  // Section 2: Unmatched DB products
  console.log('');
  console.log('─── НЕ НАЙДЕНЫ В EXCEL (продукты из БД) ───');
  console.log('');
  i = 1;
  for (const r of results) {
    if (r.status !== 'UNMATCHED') continue;
    console.log(`  ${String(i).padEnd(4)} "${r.db.name}" (${r.db.sku}) — остаток в БД: ${r.db.stock}`);
    i++;
  }

  // Section 3: Unmatched Excel products
  console.log('');
  console.log('─── НЕ НАЙДЕНЫ В БД (продукты из Excel) ───');
  console.log('');
  i = 1;
  const unmatchedExcel = excelProducts.filter(p => !matchedExcelKeys.has(p.key));
  for (const ue of unmatchedExcel) {
    console.log(`  ${String(i).padEnd(4)} "${ue.name.substring(0, 50)}" fmt="${ue.format}" stock=${ue.stock} ${ue.unit}`);
    i++;
  }

  console.log('');
  console.log('='.repeat(140));
  console.log('  ИТОГО:');
  console.log(`    Совпало: ${results.filter(r => r.status === 'MATCH').length}`);
  console.log(`    БД = Excel: ${matchOk}`);
  console.log(`    Расхождения: ${matchDiff}`);
  console.log(`    Не найдены в Excel: ${results.filter(r => r.status === 'UNMATCHED').length}`);
  console.log(`    Не найдены в БД: ${unmatchedExcel.length}`);
  console.log('='.repeat(140));

  await prisma.$disconnect();
}

main().catch((err) => { console.error('Report failed:', err); process.exit(1); }).finally(() => prisma.$disconnect());
