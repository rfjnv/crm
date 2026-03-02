/**
 * Update product stock from warehouse Excel file.
 * Run: cd backend && npx tsx src/scripts/update-stock.ts [file]
 * Default file: ../остаток 02 (3).xlsx
 *
 * Strategy: DB products have SHORT informal names from deal history.
 * Excel has LONG formal names with format column. We match using multiple
 * heuristics: format-based, category-specific, and manual overrides.
 */

import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import path from 'path';

const prisma = new PrismaClient();

// ─── Helpers ───

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

// ─── Types ───

interface ExcelProduct {
  name: string;
  format: string;
  unit: string;
  stock: number;
  key: string;
}

interface DbProduct {
  id: string;
  name: string;
  format: string | null;
  unit: string;
  stock: number;
  sku: string;
}

interface MatchResult {
  dbProduct: DbProduct;
  excelProduct: ExcelProduct;
  method: string;
}

// ─── Matching engine ───

function buildExcelIndex(products: ExcelProduct[]) {
  // Index by normalized format
  const byFormat = new Map<string, ExcelProduct[]>();
  // Index by name+format key
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

function matchDbToExcel(
  db: DbProduct,
  excelProducts: ExcelProduct[],
  index: ReturnType<typeof buildExcelIndex>,
): { excel: ExcelProduct; method: string } | null {
  const dbName = lo(db.name);

  // ─── Strategy 1: Direct format match ───
  // DB product name === Excel format (case insensitive)
  const formatMatches = index.byFormat.get(dbName);
  if (formatMatches && formatMatches.length === 1) {
    return { excel: formatMatches[0], method: 'format-direct' };
  }
  if (formatMatches && formatMatches.length > 1) {
    // Multiple matches — disambiguate
    // For self-adhesive paper: plain name → белая, "ок" suffix → красная, "турк" → Турция
    const white = formatMatches.find(p => lo(p.name).includes('белая'));
    if (white) return { excel: white, method: 'format-white' };
    return { excel: formatMatches[0], method: 'format-first' };
  }

  // ─── Strategy 2: Self-adhesive paper with suffix ───
  // DB: "50*70 ок" → Excel format "50*70" + name "красная"
  // DB: "50*70 турк" → Excel format "50*70" + name "Турция"
  // DB: "50*70 ок б/н" → Excel format "50*70 б/н" + name "красная"
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
      // If no format match, try looking for it by name pattern
      const allSamo = excelProducts.filter(p => lo(p.name).includes('самоклеющаяся'));
      const base2 = dbName.slice(0, -pat.suffix.length);
      const samoMatch = allSamo.find(p =>
        lo(p.name).includes(pat.nameFilter) && lo(p.format) === base2,
      );
      if (samoMatch) return { excel: samoMatch, method: 'samoklej-fallback' };
    }
  }

  // ─── Strategy 3: Foil (фольга) ───
  // DB: "фольга золото 120" → Excel: "Фольга для тиснения 64см*120м" format="золото"
  // DB: "фольга золото 120 сарик" → Excel: format="золото (сарик)"
  // DB: "фольга серебро 360" → Excel: format="серебро" + name "360м"
  if (dbName.startsWith('фольга ')) {
    const foilExcels = excelProducts.filter(p => lo(p.name).includes('фольга'));

    // Try to build expected DB name from each Excel foil and match
    for (const fe of foilExcels) {
      const sizeMatch = fe.name.match(/(\d+)м$/);
      const size = sizeMatch ? sizeMatch[1] : '';
      const color = lo(fe.format);

      // Build expected DB name variants
      // Variant 1: "фольга <color> <size>" (e.g., "фольга золото 120")
      // Variant 2: "фольга <color>" without size (e.g., "фольга кизил")
      // Variant 3: "фольга <baseColor> <size> <extra>" for (сарик) format
      const expectedWithSize = 'фольга ' + color + (size ? ' ' + size : '');
      const expectedNoSize = 'фольга ' + color;

      if (lo(expectedWithSize) === dbName) {
        return { excel: fe, method: 'foil' };
      }
      if (size && lo(expectedNoSize) === dbName) {
        return { excel: fe, method: 'foil-nosize' };
      }

      // Handle "(сарик)" format: Excel format="золото (сарик)" → DB "фольга золото 120 сарик"
      const sarikMatch = color.match(/^(.+?)\s*\((.+)\)$/);
      if (sarikMatch) {
        const baseColor = sarikMatch[1].trim();
        const extra = sarikMatch[2].trim();
        const expectedSarik = 'фольга ' + baseColor + (size ? ' ' + size : '') + ' ' + extra;
        if (lo(expectedSarik) === dbName) {
          return { excel: fe, method: 'foil-sarik' };
        }
      }
    }

    // Try special matches
    if (dbName === 'фольга гологорамма') {
      const galagram = excelProducts.find(p => lo(p.name).includes('галаграмма'));
      if (galagram) return { excel: galagram, method: 'foil-holo' };
    }
    if (dbName === 'фольга жемчук') {
      const jemchuk = excelProducts.find(p => lo(p.format) === 'жемчук');
      if (jemchuk) return { excel: jemchuk, method: 'foil-color' };
    }
    if (dbName === 'фольга цвет') {
      const cvet = excelProducts.find(p => lo(p.format) === 'цветная');
      if (cvet) return { excel: cvet, method: 'foil-color' };
    }
  }

  // ─── Strategy 4: Lamination (лам) ───
  // DB: "лам84" → Excel: "Ламинационная пленка ф:3000м (глянцевая)" format="84"
  // DB: "лам84 матт" → Excel: "Ламинационная пленка ф:3000м (матовая)" format="84мат"
  // DB: "лам50 софтач" → Excel: "soft touch" format="50"
  // DB: "лам 50 голд" → Excel: metallic format="50 Gold"
  // DB: "лам 50 силвер" → Excel: metallic format="50 Silver"
  if (dbName.startsWith('лам')) {
    const rest = dbName.slice(3).trim(); // after "лам"

    // Metallic gold/silver: "лам 50 голд" → format "50 Gold", "лам 62 голд" → "62 Gold"
    const metalMatch = rest.match(/^(\d+)\s+(голд|силвер)$/);
    if (metalMatch) {
      const size = metalMatch[1];
      const type = metalMatch[2] === 'голд' ? 'gold' : 'silver';
      const excl = excelProducts.find(p =>
        lo(p.name).includes('металлическ') &&
        lo(p.format).includes(size) &&
        lo(p.format).includes(type),
      );
      if (excl) return { excel: excl, method: 'lam-metal' };
    }

    // Soft touch: "лам50 софтач" → format "50" + name "Soft touch"
    if (rest.includes('софтач')) {
      const size = rest.replace('софтач', '').trim();
      const excl = excelProducts.find(p =>
        lo(p.name).includes('soft touch') && lo(p.format) === size,
      );
      if (excl) return { excel: excl, method: 'lam-softtouch' };
    }

    // Matte: "лам84 матт" → format "84мат" or "84 мат"
    if (rest.includes('матт') || rest.includes('мат')) {
      const size = rest.replace(/матт?/, '').trim();
      const fmtKey = size + 'мат';
      const excl = excelProducts.find(p =>
        lo(p.name).includes('ламинационная') &&
        lo(p.name).includes('матов') &&
        lo(p.format).replace(/\s/g, '') === fmtKey,
      );
      if (excl) return { excel: excl, method: 'lam-matte' };
    }

    // Glossy: "лам84" → format "84" + name "глянцевая"
    const sizeOnly = rest.match(/^(\d+)$/);
    if (sizeOnly) {
      const size = sizeOnly[1];
      const excl = excelProducts.find(p =>
        lo(p.name).includes('ламинационная') &&
        lo(p.name).includes('глянцев') &&
        lo(p.format) === size,
      );
      if (excl) return { excel: excl, method: 'lam-glossy' };
    }

    // Holographic: "лам47 матт" could also be just matte, already handled
  }

  // ─── Strategy 5: Coated paper (мел) ───
  // DB: "мел250" → Excel: "Мелованная бумага... р=250гр/м2 ф:70*100" format="250гр (70*100)"
  // DB: "мел250 62*88" → Мелованная бумага... format containing "250" and "62*88"
  // DB: "мел250 62*94" → format containing "250" and "62*94"
  // DB: "мел105 матт" → Excel name "МАТТ" + format with "105"
  if (dbName.startsWith('мел')) {
    const rest = dbName.slice(3).trim();
    const melMatch = rest.match(/^(\d+)(?:\s+(.+))?$/);
    if (melMatch) {
      const weight = melMatch[1];
      const extra = melMatch[2] || '';

      const melExcels = excelProducts.filter(p => lo(p.name).includes('мелованная'));

      if (extra === 'матт') {
        // Matte: name contains "МАТТ" + format contains weight
        const excl = melExcels.find(p =>
          lo(p.name).includes('матт') && lo(p.format).includes(weight),
        );
        if (excl) return { excel: excl, method: 'mel-matte' };
      } else if (extra) {
        // Has format like "62*88", "62*94"
        const excl = melExcels.find(p => {
          const fmt = lo(p.format);
          return fmt.includes(weight) && (fmt.includes(extra) || lo(p.name).includes(extra));
        });
        if (excl) return { excel: excl, method: 'mel-format' };
      } else {
        // Just weight, e.g., "мел200", "мел300"
        // Match by weight in format, 70*100 default format, EXCLUDE матт
        const excl = melExcels.find(p => {
          const fmt = lo(p.format);
          const nameL = lo(p.name);
          return fmt.includes(weight) &&
            (fmt.includes('70*100') || fmt.includes('70х100')) &&
            !nameL.includes('матт') && !fmt.includes('матт');
        });
        if (excl) return { excel: excl, method: 'mel-weight' };
      }
    }
  }

  // ─── Strategy 6: Cardboard (кар/картон) ───
  // DB: "кар250 китай" → Excel: format "Китай 250гр (70*100)"
  // DB: "кар250 индия" → Excel: format "Индия 250гр (70*100)"
  // DB: "кар300 62*94" → Excel: format "62*94" for "Целлюлозный... р=300гр"
  // DB: "картон рул 250*62" → Excel: "Целлюлозный... в рулонах р=250гр ф 62см"
  // DB: "кар210 рул" → similar
  // DB: "кар230 китай" → Excel: листах + "Китай" + 230гр
  if (dbName.startsWith('кар') || dbName.startsWith('картон')) {
    const kartExcels = excelProducts.filter(p => lo(p.name).includes('картон') || lo(p.name).includes('целлюлозн'));

    // "картон рул XXX*YY" → "Целлюлозный... в рулонах р=XXXгр ф YYсм"
    const rulMatch = dbName.match(/картон рул (\d+)\*(\d+)(?:\s+(.+))?/);
    if (rulMatch) {
      const weight = rulMatch[1];
      const width = rulMatch[2];
      const extra = rulMatch[3] || '';
      const excl = kartExcels.find(p =>
        lo(p.name).includes('рулон') &&
        lo(p.name).includes(weight) &&
        lo(p.name).includes(width),
      );
      if (excl) return { excel: excl, method: 'karton-rul' };
    }

    // "кар300 62*94" → sheets with 300гр + format "62*94"
    // Also handles "кар270 62*94" etc.
    const karFmtMatch = dbName.match(/кар(\d+)\s+(\d+\*\d+)/);
    if (karFmtMatch) {
      const weight = karFmtMatch[1];
      const fmt = karFmtMatch[2];
      const excl = kartExcels.find(p =>
        lo(p.name).includes(weight) && lo(p.format) === fmt,
      );
      if (excl) return { excel: excl, method: 'kar-fmt' };
    }

    // "кар250 китай" → sheets with 250гр + format containing "Китай" + weight
    // "кар210 рул" → cardboard in rolls  with 210гр
    const karOriginMatch = dbName.match(/кар(\d+)\s+(китай|индия)/);
    if (karOriginMatch) {
      const weight = karOriginMatch[1];
      const origin = karOriginMatch[2];
      const excl = kartExcels.find(p => {
        const fmt = lo(p.format);
        return fmt.includes(origin) && fmt.includes(weight);
      });
      if (excl) return { excel: excl, method: 'kar-origin' };
    }

    // "кар210 рул" / "кар230 рул" etc → cardboard in rolls, match by weight
    const karRulMatch = dbName.match(/кар(\d+)\s+рул/);
    if (karRulMatch) {
      const weight = karRulMatch[1];
      const excl = kartExcels.find(p =>
        lo(p.name).includes('рулон') && lo(p.name).includes(weight),
      );
      if (excl) return { excel: excl, method: 'kar-rul' };
    }
  }

  // ─── Strategy 7: UV lacquer ───
  // DB: "уф лак 50" → Excel: "Полигр,бесцв,краска PI- 50" format="PI 50"
  // DB: "уф лак 125" → format="PI 125"
  // DB: "уф лак 180" → format="PI 180"
  // DB: "уф лак 250" → format="PI 250"
  // DB: "уф лак 400" → format="PI 400А"
  // DB: "уф лак эмбосс" → format="emboss"
  if (dbName.startsWith('уф лак')) {
    const rest = dbName.slice(6).trim();
    if (rest === 'эмбосс') {
      const excl = excelProducts.find(p => lo(p.format) === 'emboss');
      if (excl) return { excel: excl, method: 'uv-emboss' };
    } else {
      const excl = excelProducts.find(p =>
        lo(p.format).startsWith('pi ') && lo(p.format).includes(rest),
      );
      if (excl) return { excel: excl, method: 'uv-lac' };
    }
  }

  // ─── Strategy 8: Offset ink (краска) ───
  // DB: "краска фокус кизил" → Excel: "офсетный краска Focus Proces" format="кизил"
  // DB: "краска повер кизил" → Excel: "офсетный краска Power Proces" format="кизил"
  // DB: "краска иновацион кизил" → Excel: "офсетный краска INNOVATION" format="кизил"
  // DB: "краска оптимум сарик" - may not be in Excel
  if (dbName.startsWith('краска ')) {
    const rest = dbName.slice(7);
    // Parse: brand + color
    const parts = rest.split(/\s+/);
    if (parts.length >= 2) {
      const brand = parts[0]; // фокус, повер, иновацион, оптимум
      const color = parts.slice(1).join(' '); // кизил, кора, кук, сарик

      const brandMap: Record<string, string> = {
        'фокус': 'focus',
        'повер': 'power',
        'иновацион': 'innovation',
        'оптимум': 'optim',
      };
      const excelBrand = brandMap[brand] || brand;

      const excl = excelProducts.find(p =>
        lo(p.name).includes('краска') &&
        lo(p.name).includes(excelBrand) &&
        lo(p.format) === color,
      );
      if (excl) return { excel: excl, method: 'ink' };
    }
  }

  // ─── Strategy 9: Pantone ───
  // DB: "пантон gold 871" → Excel: "пантон" format="Gold 871"
  // DB: "пантон silver" → format="Silver 877"
  // DB: "пантон black" → format="Black"
  // DB: "пантон trans white" → format="Transparent white"
  // DB: "пантон opaqi" → format="Opaque white"
  // DB: "пантон proces" → format="Process blue"
  // DB: "пантон radomin" → format="Rhodamine red"
  if (dbName.startsWith('пантон ')) {
    const rest = dbName.slice(7).trim();
    const pantExcels = excelProducts.filter(p => lo(p.name).includes('пантон'));

    // Try direct format match (case insensitive)
    let excl = pantExcels.find(p => lo(p.format) === rest);
    if (excl) return { excel: excl, method: 'pantone-direct' };

    // Partial match rules
    const pantMap: Record<string, string> = {
      'trans white': 'transparent white',
      'opaqi': 'opaque white',
      'proces': 'process blue',
      'radomin': 'rhodamine red',
      'silver': 'silver 877',
      'warm': 'warm red',
      'reflex': 'reflex blue',
      'rubin': 'rubin red',
    };
    const mapped = pantMap[rest];
    if (mapped) {
      excl = pantExcels.find(p => lo(p.format) === mapped);
      if (excl) return { excel: excl, method: 'pantone-map' };
    }
  }

  // ─── Strategy 10: VD lacquer ───
  // DB: "вд лак" → Excel: "Водно-дисперсионный лак глянцевый"
  // DB: "вд лак матт" → Excel: "Водно-дисперсионный лак матт"
  if (dbName === 'вд лак') {
    const excl = excelProducts.find(p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('глянцев'));
    if (excl) return { excel: excl, method: 'vd-gloss' };
  }
  if (dbName === 'вд лак матт') {
    const excl = excelProducts.find(p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('матт'));
    if (excl) return { excel: excl, method: 'vd-matte' };
  }

  // ─── Strategy 11: Offset lacquer ───
  // DB: "офсет лак" → Excel: "офсетный лак" format="глянц"
  // DB: "офсет лак мат" → Excel: "офсетный лак" format="мат"? (may not exist)
  if (dbName === 'офсет лак') {
    const excl = excelProducts.find(p => lo(p.name).includes('офсетный лак') || lo(p.name).includes('офсетн') && lo(p.name).includes('лак'));
    if (excl) return { excel: excl, method: 'offset-lac' };
  }

  // ─── Strategy 12: Rubber blankets (рез) ───
  // DB: "рез 52*44" → Excel: "Офсетное полотно" format="520*440"
  // DB: "рез 772*627" → format="772*627"
  // DB: "рез 78" → format="78"
  // DB: "рез 106" → format="106"
  if (dbName.startsWith('рез')) {
    const rest = dbName.slice(3).trim();
    const rezExcels = excelProducts.filter(p => lo(p.name).includes('офсетное полотно'));

    // Direct format match
    let excl = rezExcels.find(p => lo(p.format) === rest);
    if (excl) return { excel: excl, method: 'rez-direct' };

    // "рез 135" or "рез145" → format "1350" (meters)
    if (rest === '135' || rest === '145') {
      excl = rezExcels.find(p => lo(p.format) === rest + '0');
      if (excl) return { excel: excl, method: 'rez-meters' };
    }
    const dimMatch = rest.match(/^(\d+)\*(\d+)$/);
    if (dimMatch) {
      const expanded = (parseInt(dimMatch[1]) * 10) + '*' + (parseInt(dimMatch[2]) * 10);
      excl = rezExcels.find(p => lo(p.format) === expanded);
      if (excl) return { excel: excl, method: 'rez-expanded' };
    }
  }

  // ─── Strategy 13: Offset plates (пластины) ───
  // DB: "1050*795" → Excel: "Офсетная пластина UV СТР" format="1050*795"
  // DB: "1050*795 стр" → Excel: "Офсетная пластина СТР" format="1050*795"
  // DB: "890*608 стр" → Excel: "Офсетная пластина СТР" format="890*608"
  // DB: "1280*1060" → Excel: "Офсетная пластина UV СТР" format="1280*1060"
  {
    const plateExcels = excelProducts.filter(p => lo(p.name).includes('офсетная пластина'));
    if (plateExcels.length > 0) {
      // "XXX*YYY стр" → non-UV plate
      const strMatch = dbName.match(/^(\d+\*\d+)\s+стр$/);
      if (strMatch) {
        const fmt = strMatch[1];
        const excl = plateExcels.find(p =>
          !lo(p.name).includes('uv') && lo(p.format) === fmt,
        );
        if (excl) return { excel: excl, method: 'plate-str' };
      }

      // "XXX*YYY" (no стр) → UV plate (or any plate)
      const plainMatch = dbName.match(/^(\d+\*\d+)$/);
      if (plainMatch) {
        const fmt = plainMatch[1];
        // Prefer UV plate
        let excl = plateExcels.find(p => lo(p.name).includes('uv') && lo(p.format) === fmt);
        if (!excl) excl = plateExcels.find(p => lo(p.format) === fmt);
        if (excl) return { excel: excl, method: 'plate-uv' };
      }

      // With parentheses: "510*400 (0,15)" → format="510*400(0,15)"
      const parenMatch = dbName.match(/^(\d+\*\d+)\s*\((.+)\)$/);
      if (parenMatch) {
        const fmt = parenMatch[1] + '(' + parenMatch[2] + ')';
        const fmtSpaced = parenMatch[1] + ' (' + parenMatch[2] + ')';
        let excl = plateExcels.find(p => {
          const f = lo(p.format).replace(/\s/g, '');
          return f === fmt.replace(/\s/g, '');
        });
        if (excl) return { excel: excl, method: 'plate-paren' };
      }
    }
  }

  // ─── Strategy 14: Metal combs (мет греб) ───
  // DB: "мет греб 1/4" → Excel: "Металлическая грибенка 1/4 (6,4мм)" format="1*4(ок)"
  // DB: "мет греб 3/8 кора" → format="3*8(кора)"
  // DB: "мет греб 5/16 силвер" → format="5*16(силвер)?" — may not exist
  if (dbName.startsWith('мет греб')) {
    const rest = dbName.slice(8).trim();
    const combExcels = excelProducts.filter(p => lo(p.name).includes('грибенк') || lo(p.name).includes('гребенк'));

    // Parse: "1/4" or "3/8 кора" or "5/16 силвер"
    const combMatch = rest.match(/^(\d+)\/(\d+)(?:\s+(.+))?$/);
    if (combMatch) {
      const num = combMatch[1];
      const den = combMatch[2];
      const color = combMatch[3] || 'ок'; // default = ок (white/standard)
      // Excel format: "1*4(ок)", "3*8(кора)", etc.
      const fmtKey = num + '*' + den + '(' + color + ')';
      let excl = combExcels.find(p => lo(p.format).replace(/\s/g, '') === fmtKey);
      if (excl) return { excel: excl, method: 'comb' };

      // Also try name-based matching
      const fraction = num + '/' + den;
      excl = combExcels.find(p =>
        lo(p.name).includes(fraction) && lo(p.format).includes(color),
      );
      if (excl) return { excel: excl, method: 'comb-name' };
    }
  }

  // ─── Strategy 15: Specific product names ───
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
    'биговка': p => lo(p.name).includes('биговальн') && lo(p.format) === '0,3*1,3', // default
    'марзан 138': p => lo(p.name).includes('марзан') && lo(p.format).includes('1380'),
    'марзан 72': p => lo(p.name).includes('марзан') && lo(p.format).includes('720'),
    'марзан 95': p => lo(p.name).includes('марзан') && lo(p.format).includes('95'),
    'ригель 32': p => lo(p.name).includes('ригель') && lo(p.name).includes('бел') && lo(p.format) === '32',
    'ригель 32 кора': p => lo(p.name).includes('ригель') && lo(p.name).includes('черн') && lo(p.format) === '32',
    'самоклей рулон фассон': p => lo(p.name).includes('самоклеющаяся') && lo(p.name).includes('рулон') && lo(p.format).includes('bj 993'),
    'рулон кесиш': p => lo(p.name).includes('самоклеющаяся') && lo(p.name).includes('рулон') && lo(p.format).includes('китай') && !lo(p.name).includes('ненси'),
    'чехол': p => lo(p.name).includes('чехол') && lo(p.format) === '64',
    'картон': p => false, // generic, skip
    'проявитель стр тек': p => lo(p.name).includes('проявитель') && lo(p.format).includes('стр') && lo(p.format).includes('teknova'),
    'проявитель 1+9': p => lo(p.name).includes('проявитель') && lo(p.format).includes('1+9') && lo(p.format).includes('uv'),
    'бесцветний лак': p => lo(p.name).includes('водно-дисперсионный') && lo(p.name).includes('высоко'),
  };

  if (specificMap[dbName]) {
    const excl = excelProducts.find(specificMap[dbName]);
    if (excl) return { excel: excl, method: 'specific' };
  }

  return null;
}

// ─── Main ───

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');

  console.log('='.repeat(60));
  console.log('  STOCK UPDATE FROM EXCEL' + (DRY_RUN ? ' (DRY RUN)' : ''));
  console.log('='.repeat(60));

  const fileArg = process.argv[2] || '../остаток 02 (3).xlsx';
  const filePath = path.resolve(process.cwd(), fileArg);
  console.log('\nFile:', filePath);

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Parse Excel products (last occurrence wins for stock)
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
    const key = lo(name) + '|||' + lo(format);
    excelMap.set(key, { name, format, unit, stock, key });
  }

  const excelProducts = Array.from(excelMap.values());
  console.log('Unique Excel products:', excelProducts.length);

  const index = buildExcelIndex(excelProducts);

  // Load DB products (only IMPORT- ones, skip manually created)
  const dbProducts: DbProduct[] = (await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, format: true, unit: true, stock: true, sku: true },
    orderBy: { name: 'asc' },
  })).map(p => ({
    ...p,
    format: p.format,
    stock: Number(p.stock),
  }));

  console.log('Active DB products:', dbProducts.length);

  // Match
  const matches: MatchResult[] = [];
  const unmatched: DbProduct[] = [];
  const matchedExcelKeys = new Set<string>();

  for (const dbp of dbProducts) {
    // Skip non-import products (manually created ones like Визитки, Баннеры, test)
    if (!dbp.sku.startsWith('IMPORT-')) continue;

    const result = matchDbToExcel(dbp, excelProducts, index);
    if (result) {
      matches.push({ dbProduct: dbp, excelProduct: result.excel, method: result.method });
      matchedExcelKeys.add(result.excel.key);
    } else {
      unmatched.push(dbp);
    }
  }

  // Report matches
  console.log('\n--- MATCHED PRODUCTS ---');
  let updated = 0;
  let unchanged = 0;

  for (const m of matches) {
    const oldStock = m.dbProduct.stock;
    const newStock = m.excelProduct.stock;
    const changed = Math.abs(oldStock - newStock) > 0.001;

    if (changed) {
      console.log(`  ✓ [${m.method}] "${m.dbProduct.name}" → ${oldStock} → ${newStock} (${m.excelProduct.name.substring(0, 40)})`);
      if (!DRY_RUN) {
        await prisma.product.update({
          where: { id: m.dbProduct.id },
          data: { stock: newStock },
        });
      }
      updated++;
    } else {
      unchanged++;
    }
  }

  // Report unmatched DB products
  console.log(`\n--- UNMATCHED DB PRODUCTS (${unmatched.length}) ---`);
  for (const u of unmatched) {
    console.log(`  ✗ "${u.name}" (${u.sku})`);
  }

  // Report unmatched Excel products (not mapped to any DB product)
  const unmatchedExcel = excelProducts.filter(p => !matchedExcelKeys.has(p.key));
  console.log(`\n--- UNMATCHED EXCEL PRODUCTS (${unmatchedExcel.length}) ---`);
  for (const ue of unmatchedExcel) {
    console.log(`  ✗ "${ue.name.substring(0, 50)}" fmt="${ue.format}" stock=${ue.stock}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log(`  Matched: ${matches.length} / ${dbProducts.filter(p => p.sku.startsWith('IMPORT-')).length} DB products`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Unmatched DB: ${unmatched.length}`);
  console.log(`  Unmatched Excel: ${unmatchedExcel.length}`);
  console.log('='.repeat(60));
}

main()
  .catch((err) => {
    console.error('Stock update failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
