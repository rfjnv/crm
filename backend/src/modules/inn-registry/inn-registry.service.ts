import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/**
 * Сверка ИНН: собираем все ИНН из карточек клиентов и перечислений по сделкам,
 * рядом ставим юр. название (orginfo.uz или вручную) и ищем расхождения.
 */

export type InnIssue =
  /** Не 9 цифр (юрлицо) и не 14 (ПИНФЛ физлица) */
  | 'bad_format'
  /** Записан с пробелами/буквами — в разных местах выглядит по-разному */
  | 'dirty_format'
  /** Нет юр. названия */
  | 'no_name'
  /** Один ИНН записан как «свой» у нескольких клиентов */
  | 'shared_owner'
  /** По этому ИНН платили за нескольких клиентов */
  | 'shared_transfer'
  /** ИНН перечисления — это свой ИНН другого клиента */
  | 'other_client_inn'
  /** У клиента есть перечисления, а своего ИНН в карточке нет */
  | 'client_without_inn'
  /** Юр. название не похоже на название клиента в CRM */
  | 'name_mismatch';

export interface InnClientLink {
  clientId: string;
  companyName: string;
  isArchived: boolean;
  /** ИНН указан в карточке клиента */
  isOwn: boolean;
  /** Своего ИНН в карточке клиента нет */
  clientHasNoInn: boolean;
  dealsCount: number;
  dealsSum: number;
  lastDealAt: string | null;
}

export interface InnRow {
  inn: string;
  rawVariants: string[];
  legalName: string | null;
  address: string | null;
  source: string | null;
  lookupStatus: string | null;
  lookedUpAt: string | null;
  clients: InnClientLink[];
  dealsCount: number;
  dealsSum: number;
  issues: InnIssue[];
}

export function normalizeInn(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

// ─── Сравнение названий ──────────────────────────────────────────────────────

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** Организационно-правовые формы и служебные слова — не участвуют в сравнении. */
const LEGAL_FORM_WORDS = new Set([
  'ooo', 'mchj', 'masuliyati', 'cheklangan', 'jamiyati', 'jamiyat', 'mas', 'xk', 'xususiy', 'korxona', 'korxonasi',
  'ok', 'chp', 'ip', 'yatt', 'ao', 'aj', 'aksiyadorlik', 'tijorat', 'oilaviy', 'qk', 'dk', 'davlat', 'unitar',
  'firma', 'firmasi', 'kompaniyasi', 'company', 'llc', 'group', 'savdo', 'print', 'ltd', 'chastnoe', 'predpriyatie',
  'obshestvo', 'ogranichennoy', 'otvetstvennostyu', 'the', 'and',
]);

function nameTokens(name: string): Set<string> {
  const latin = name
    .toLowerCase()
    .replace(/[ʻʼ'`‘’]/g, '')
    .split('')
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join('')
    // частые варианты написания узбекской латиницы
    .replace(/kh/g, 'x')
    .replace(/h/g, 'x');
  const tokens = latin.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !LEGAL_FORM_WORDS.has(t));
  return new Set(tokens);
}

/** Похожи ли названия: есть хотя бы одно общее значимое слово (или одно входит в другое). */
export function namesLookAlike(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || tb.size === 0) return true; // сравнивать нечего — не поднимаем тревогу
  for (const x of ta) {
    for (const y of tb) {
      if (x === y) return true;
      if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;
    }
  }
  return false;
}

// ─── Сбор и сверка ───────────────────────────────────────────────────────────

export async function buildInnReconciliation(): Promise<{ rows: InnRow[]; summary: Record<InnIssue | 'total', number> }> {
  const [clients, deals, registry] = await Promise.all([
    prisma.client.findMany({
      select: { id: true, companyName: true, inn: true, isArchived: true },
    }),
    prisma.deal.findMany({
      where: { transferInn: { not: null }, isArchived: false },
      select: { clientId: true, transferInn: true, amount: true, createdAt: true },
    }),
    prisma.innRegistry.findMany(),
  ]);

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const registryByInn = new Map(registry.map((r) => [r.inn, r]));

  type Acc = {
    raw: Set<string>;
    links: Map<string, InnClientLink>;
  };
  const byInn = new Map<string, Acc>();

  const linkFor = (inn: string, raw: string, clientId: string): InnClientLink | null => {
    const client = clientById.get(clientId);
    if (!client) return null;
    let acc = byInn.get(inn);
    if (!acc) {
      acc = { raw: new Set(), links: new Map() };
      byInn.set(inn, acc);
    }
    acc.raw.add(raw);
    let link = acc.links.get(clientId);
    if (!link) {
      link = {
        clientId,
        companyName: client.companyName,
        isArchived: client.isArchived,
        isOwn: false,
        clientHasNoInn: !normalizeInn(client.inn),
        dealsCount: 0,
        dealsSum: 0,
        lastDealAt: null,
      };
      acc.links.set(clientId, link);
    }
    return link;
  };

  for (const c of clients) {
    const raw = c.inn?.trim();
    const inn = normalizeInn(raw);
    if (!raw || !inn) continue;
    const link = linkFor(inn, raw, c.id);
    if (link) link.isOwn = true;
  }

  for (const d of deals) {
    const raw = d.transferInn?.trim();
    const inn = normalizeInn(raw);
    if (!raw || !inn) continue;
    const link = linkFor(inn, raw, d.clientId);
    if (!link) continue;
    link.dealsCount += 1;
    link.dealsSum += Number(d.amount);
    const at = d.createdAt.toISOString();
    if (!link.lastDealAt || at > link.lastDealAt) link.lastDealAt = at;
  }

  const ownerCount = new Map<string, number>();
  for (const [inn, acc] of byInn) {
    ownerCount.set(inn, [...acc.links.values()].filter((l) => l.isOwn).length);
  }

  const rows: InnRow[] = [];
  for (const [inn, acc] of byInn) {
    const reg = registryByInn.get(inn);
    const links = [...acc.links.values()].sort((a, b) => Number(b.isOwn) - Number(a.isOwn) || b.dealsSum - a.dealsSum);
    const issues: InnIssue[] = [];

    if (inn.length !== 9 && inn.length !== 14) issues.push('bad_format');
    if ([...acc.raw].some((r) => r !== inn)) issues.push('dirty_format');
    if (!reg?.legalName) issues.push('no_name');
    if ((ownerCount.get(inn) ?? 0) > 1) issues.push('shared_owner');

    const payers = links.filter((l) => l.dealsCount > 0);
    if (payers.length > 1) issues.push('shared_transfer');
    if (payers.some((l) => !l.isOwn) && (ownerCount.get(inn) ?? 0) > 0) issues.push('other_client_inn');
    if (payers.some((l) => l.clientHasNoInn)) issues.push('client_without_inn');
    if (reg?.legalName && links.some((l) => l.isOwn && !namesLookAlike(reg.legalName!, l.companyName))) {
      issues.push('name_mismatch');
    }

    rows.push({
      inn,
      rawVariants: [...acc.raw],
      legalName: reg?.legalName ?? null,
      address: reg?.address ?? null,
      source: reg?.source ?? null,
      lookupStatus: reg?.lookupStatus ?? null,
      lookedUpAt: reg?.lookedUpAt?.toISOString() ?? null,
      clients: links,
      dealsCount: links.reduce((s, l) => s + l.dealsCount, 0),
      dealsSum: links.reduce((s, l) => s + l.dealsSum, 0),
      issues,
    });
  }

  rows.sort((a, b) => b.issues.length - a.issues.length || b.dealsSum - a.dealsSum);

  const summary = { total: rows.length } as Record<InnIssue | 'total', number>;
  for (const r of rows) {
    for (const i of r.issues) summary[i] = (summary[i] ?? 0) + 1;
  }
  return { rows, summary };
}

// ─── Юр. названия ────────────────────────────────────────────────────────────

export async function setLegalName(rawInn: string, legalName: string | null) {
  const inn = normalizeInn(rawInn);
  if (!inn) throw new AppError(400, 'Некорректный ИНН');
  const name = legalName?.trim() || null;
  return prisma.innRegistry.upsert({
    where: { inn },
    create: { inn, legalName: name, source: 'manual' },
    update: { legalName: name, source: 'manual' },
  });
}

export async function getLegalNames(rawInns: string[]): Promise<Record<string, string>> {
  const inns = [...new Set(rawInns.map(normalizeInn).filter(Boolean))];
  if (inns.length === 0) return {};
  const rows = await prisma.innRegistry.findMany({
    where: { inn: { in: inns }, legalName: { not: null } },
    select: { inn: true, legalName: true },
  });
  return Object.fromEntries(rows.map((r) => [r.inn, r.legalName!]));
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Ищет организацию на orginfo.uz по ИНН. null — не найдено. */
export async function fetchFromOrginfo(inn: string): Promise<{ legalName: string; address: string | null } | null> {
  const url = `https://orginfo.uz/ru/search/all/?q=${encodeURIComponent(inn)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (CRM INN check)', 'Accept-Language': 'ru' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`orginfo.uz ответил ${res.status}`);
  const html = await res.text();

  // Карточки результатов: <a ... class="... og-card"> ... <span>ИНН</span> ... <h6 class="card-title">Название</h6> ... <p>адрес</p>
  const cards = html.split(/<a\s[^>]*class="[^"]*og-card[^"]*"/).slice(1);
  for (const card of cards) {
    const body = card.split('</a>')[0];
    const badge = body.match(/<span[^>]*rounded-5[^>]*>\s*([^<]+?)\s*<\/span>/);
    if (!badge || normalizeInn(badge[1]) !== inn) continue;
    const title = body.match(/<h6[^>]*card-title[^>]*>([\s\S]*?)<\/h6>/);
    if (!title) continue;
    const legalName = cleanText(title[1]);
    if (!legalName) continue;
    const addr = body.match(/location\.svg[^>]*>([\s\S]*?)<\/p>/);
    return { legalName, address: addr ? cleanText(addr[1]) || null : null };
  }
  return null;
}

export async function lookupInn(rawInn: string, opts: { overwriteManual?: boolean } = {}) {
  const inn = normalizeInn(rawInn);
  if (!inn) throw new AppError(400, 'Некорректный ИНН');
  const existing = await prisma.innRegistry.findUnique({ where: { inn } });

  let found: Awaited<ReturnType<typeof fetchFromOrginfo>> = null;
  let status: 'found' | 'not_found' | 'error' = 'not_found';
  try {
    found = await fetchFromOrginfo(inn);
    status = found ? 'found' : 'not_found';
  } catch (err) {
    console.warn('[inn-registry] orginfo lookup failed', inn, err instanceof Error ? err.message : err);
    status = 'error';
  }

  // Вписанное вручную не затираем, если об этом прямо не попросили
  const keepManual = existing?.source === 'manual' && existing.legalName && !opts.overwriteManual;
  const now = new Date();
  return prisma.innRegistry.upsert({
    where: { inn },
    create: {
      inn,
      legalName: found?.legalName ?? null,
      address: found?.address ?? null,
      source: found ? 'orginfo' : 'manual',
      lookupStatus: status,
      lookedUpAt: now,
    },
    update: {
      lookupStatus: status,
      lookedUpAt: now,
      ...(found && !keepManual ? { legalName: found.legalName, address: found.address, source: 'orginfo' } : {}),
    },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Подтягивает названия для ИНН без названия (по очереди, с паузой — не долбим сайт).
 * Недавно искавшиеся без результата пропускаем.
 */
export async function lookupMissing(limit: number): Promise<{ checked: number; found: number; left: number }> {
  const { rows } = await buildInnReconciliation();
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const candidates = rows.filter(
    (r) =>
      !r.legalName &&
      (r.inn.length === 9 || r.inn.length === 14) &&
      !(r.lookupStatus === 'not_found' && r.lookedUpAt && Date.parse(r.lookedUpAt) > weekAgo),
  );
  const batch = candidates.slice(0, limit);
  let found = 0;
  for (const r of batch) {
    const res = await lookupInn(r.inn);
    if (res.lookupStatus === 'found') found += 1;
    await sleep(700);
  }
  return { checked: batch.length, found, left: candidates.length - batch.length };
}

/** Без ожидания: новый ИНН из сделки сразу ищем в фоне, чтобы в сверке уже было название. */
export function lookupInBackgroundIfUnknown(rawInn: string | null | undefined): void {
  const inn = normalizeInn(rawInn);
  if (inn.length !== 9 && inn.length !== 14) return;
  void (async () => {
    const existing = await prisma.innRegistry.findUnique({ where: { inn }, select: { inn: true } });
    if (existing) return;
    await lookupInn(inn);
  })().catch((err) => console.warn('[inn-registry] background lookup failed', inn, err));
}
