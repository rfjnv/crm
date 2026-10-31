/**
 * Анализ продаж по категориям: текущий период против того же периода год назад.
 * Чистые функции — SQL и HTTP в category-analysis.routes.ts.
 */

export type PeriodKind = 'ytd' | 'r12' | 'custom';

export interface DateRange {
  from: string; // YYYY-MM-DD, включительно
  to: string;
}

export interface Periods {
  kind: PeriodKind;
  cur: DateRange;
  prev: DateRange;
}

/** Строка сделки, уже сжатая до сделка × товар × день. */
export interface SaleLine {
  dealId: string;
  day: string;
  productId: string;
  clientId: string;
  managerId: string;
  own: boolean;
  rev: number;
  qty: number;
}

export interface ProductInfo {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string;
  stock: number;
  minStock: number;
  isActive: boolean;
}

export const NO_CATEGORY = 'Без категории';
export const OTHER_KEY = '__other__';
const TOP_MONTHLY_PRODUCTS = 8;

// ── Периоды ──

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/** Та же дата год назад; 29 февраля → 28 февраля. */
export function shiftYear(day: string, years: number): string {
  const d = parse(day);
  const y = d.getUTCFullYear() + years;
  const m = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay))));
}

export function addDays(day: string, n: number): string {
  const d = parse(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/**
 * ytd — с 1 января по сегодня; r12 — с этого дня год назад по сегодня;
 * custom — from..to. Прошлый период — те же даты годом раньше.
 */
export function resolvePeriods(kind: PeriodKind, today: string, from?: string, to?: string): Periods {
  let cur: DateRange;
  if (kind === 'custom' && from && to && from <= to) cur = { from, to };
  else if (kind === 'r12') cur = { from: shiftYear(today, -1), to: today };
  else {
    kind = kind === 'custom' ? 'ytd' : kind;
    cur = { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
  // r12 и прошлый r12 стыкуются без перекрытия: прошлый кончается за день до начала текущего
  const prev = kind === 'r12'
    ? { from: shiftYear(cur.from, -1), to: addDays(cur.from, -1) }
    : { from: shiftYear(cur.from, -1), to: shiftYear(cur.to, -1) };
  return { kind, cur, prev };
}

/** Месяцы YYYY-MM от from до to включительно. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ── Агрегаты ──

interface Acc {
  rev: number;
  qty: number;
  deals: Set<string>;
  clients: Map<string, number>;
}
const acc = (): Acc => ({ rev: 0, qty: 0, deals: new Set(), clients: new Map() });
function add(a: Acc, l: SaleLine) {
  a.rev += l.rev;
  a.qty += l.qty;
  a.deals.add(l.dealId);
  a.clients.set(l.clientId, (a.clients.get(l.clientId) ?? 0) + l.rev);
}

/** Клиенты, которые пришли (нет в прошлом) и ушли (нет в текущем), с их выручкой. */
function churn(cur: Acc, prev: Acc) {
  let newClients = 0, revNew = 0, lostClients = 0, revLost = 0;
  for (const [id, v] of cur.clients) if (!prev.clients.has(id)) { newClients++; revNew += v; }
  for (const [id, v] of prev.clients) if (!cur.clients.has(id)) { lostClients++; revLost += v; }
  return { newClients, revNew, lostClients, revLost };
}

const pctChange = (cur: number, prev: number) => (prev > 0 ? (cur / prev - 1) * 100 : null);
const round = (v: number) => Math.round(v);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export interface Totals {
  rev: number; revPrev: number; revChange: number | null;
  orders: number; ordersPrev: number;
  clients: number; clientsPrev: number;
  products: number; productsPrev: number;
  avgOrder: number; avgOrderPrev: number;
  newClients: number; revNew: number; lostClients: number; revLost: number;
}

function totalsOf(cur: Acc, prev: Acc, products: number, productsPrev: number): Totals {
  const ch = churn(cur, prev);
  return {
    rev: round(cur.rev), revPrev: round(prev.rev), revChange: pctChange(cur.rev, prev.rev),
    orders: cur.deals.size, ordersPrev: prev.deals.size,
    clients: cur.clients.size, clientsPrev: prev.clients.size,
    products, productsPrev,
    avgOrder: cur.deals.size ? round(cur.rev / cur.deals.size) : 0,
    avgOrderPrev: prev.deals.size ? round(prev.rev / prev.deals.size) : 0,
    newClients: ch.newClients, revNew: round(ch.revNew), lostClients: ch.lostClients, revLost: round(ch.revLost),
  };
}

export interface CategoryRow extends Totals {
  name: string;
  share: number;
  /** Товары категории с остатком ≤ 0, которые продавались год назад. */
  outOfStock: number;
  /** Недобор этих товаров к прошлому году. */
  lostToStockout: number;
}

export type StockStatus = 'out' | 'low' | 'ok' | 'over' | 'dead' | 'none';

export interface ProductRow {
  id: string; name: string; sku: string; unit: string; category: string;
  rev: number; revPrev: number; revChange: number | null;
  qty: number; qtyPrev: number;
  price: number | null; pricePrev: number | null; priceChange: number | null;
  clients: number; clientsPrev: number; orders: number; ordersPrev: number;
  share: number;
  abc: 'A' | 'B' | 'C' | null;
  xyz: 'X' | 'Y' | 'Z' | 'NEW' | null;
  cv: number | null;
  volumeEffect: number; priceEffect: number;
  stock: number; minStock: number;
  avgMonthlyQty: number;
  coverMonths: number | null;
  stockStatus: StockStatus;
  lastSale: string | null;
  monthly: number[];
}

export type ClientStatus = 'new' | 'lost' | 'up' | 'down' | 'flat';

export interface ClientRow {
  id: string;
  rev: number; revPrev: number; revChange: number | null;
  orders: number; ordersPrev: number;
  products: number;
  lastBuy: string | null;
  status: ClientStatus;
  managerId: string;
  own: boolean;
}

export interface ManagerRow {
  id: string;
  rev: number; revPrev: number; revChange: number | null;
  clients: number; clientsPrev: number;
  orders: number;
}

/** Клиент × товар внутри категории: кто что и сколько купил. */
export interface ClientProductRow {
  clientId: string;
  productId: string;
  qty: number; qtyPrev: number;
  rev: number; revPrev: number;
  orders: number;
  lastBuy: string | null;
}

export interface PriceVolume {
  /** Больше или меньше штук/кг у товаров, что продавались в обоих периодах. */
  volume: number;
  /** Изменение цены у тех же товаров. */
  price: number;
  /** Товары, которых год назад не было в продажах. */
  added: number;
  /** Товары, которые в этом периоде не продавались. */
  dropped: number;
}

export interface Analysis {
  periods: Periods;
  months: string[];
  curMonths: string[];
  totals: Totals;
  categories: CategoryRow[];
  /** Без категории — по категориям; внутри категории — по товарам (топ + «прочие»). */
  monthly: { month: string; key: string; rev: number }[];
  products: ProductRow[];
  clients: ClientRow[];
  managers: ManagerRow[];
  /** Только внутри категории. */
  clientProducts: ClientProductRow[];
  priceVolume: PriceVolume;
}

export interface AnalysisInput {
  periods: Periods;
  lines: SaleLine[];
  products: ProductInfo[];
  /** Количество за последние 90 дней — для запаса склада в месяцах. */
  qty90: Map<string, number>;
  /** Последняя продажа товара за всё время. */
  lastSale: Map<string, string>;
  category: string | null;
  excludeOwn: boolean;
}

function abcClasses(rows: { id: string; rev: number }[]): Map<string, 'A' | 'B' | 'C'> {
  const out = new Map<string, 'A' | 'B' | 'C'>();
  const total = rows.reduce((s, r) => s + Math.max(0, r.rev), 0);
  if (total <= 0) return out;
  let before = 0;
  for (const r of [...rows].filter((x) => x.rev > 0).sort((a, b) => b.rev - a.rev)) {
    const share = before / total;
    out.set(r.id, share < 0.8 ? 'A' : share < 0.95 ? 'B' : 'C');
    before += r.rev;
  }
  return out;
}

function xyzOf(monthlyQty: number[]): { xyz: 'X' | 'Y' | 'Z' | 'NEW' | null; cv: number | null } {
  const active = monthlyQty.filter((q) => q > 0).length;
  if (active === 0) return { xyz: null, cv: null };
  if (active < 3) return { xyz: 'NEW', cv: null };
  const mean = monthlyQty.reduce((s, q) => s + q, 0) / monthlyQty.length;
  const sd = Math.sqrt(monthlyQty.reduce((s, q) => s + (q - mean) ** 2, 0) / monthlyQty.length);
  const cv = mean > 0 ? sd / mean : null;
  if (cv == null) return { xyz: 'Z', cv };
  return { xyz: cv <= 0.1 ? 'X' : cv <= 0.25 ? 'Y' : 'Z', cv };
}

/** Остаток ≤ 0 у товара, который продавался в любом из периодов или за 90 дней, — «нет на складе». */
function stockStatusOf(stock: number, avgMonthly: number, soldNow: boolean, soldBefore: boolean): { status: StockStatus; cover: number | null } {
  if (stock <= 0) return { status: soldNow || soldBefore || avgMonthly > 0 ? 'out' : 'none', cover: 0 };
  if (avgMonthly <= 0) return { status: soldNow ? 'over' : 'dead', cover: null };
  const cover = stock / avgMonthly;
  return { status: cover < 1 ? 'low' : cover > 6 ? 'over' : 'ok', cover };
}

export function buildAnalysis(input: AnalysisInput): Analysis {
  const { periods, products, qty90, lastSale, category, excludeOwn } = input;
  const months = monthsBetween(periods.prev.from.slice(0, 7) < periods.cur.from.slice(0, 7) ? periods.prev.from : periods.cur.from, periods.cur.to);
  const curMonths = monthsBetween(periods.cur.from, periods.cur.to);
  const info = new Map(products.map((p) => [p.id, p]));
  const catOf = (pid: string) => info.get(pid)?.category || NO_CATEGORY;

  const lines = excludeOwn ? input.lines.filter((l) => !l.own) : input.lines;
  const side = (l: SaleLine): 'cur' | 'prev' | null =>
    l.day >= periods.cur.from && l.day <= periods.cur.to ? 'cur'
      : l.day >= periods.prev.from && l.day <= periods.prev.to ? 'prev' : null;

  // Категории — всегда все, чтобы было из чего выбрать
  const catAcc = new Map<string, { cur: Acc; prev: Acc; pc: Set<string>; pp: Set<string> }>();
  for (const l of lines) {
    const s = side(l);
    if (!s) continue;
    const c = catOf(l.productId);
    let a = catAcc.get(c);
    if (!a) { a = { cur: acc(), prev: acc(), pc: new Set(), pp: new Set() }; catAcc.set(c, a); }
    add(a[s], l);
    (s === 'cur' ? a.pc : a.pp).add(l.productId);
  }

  const scoped = category ? lines.filter((l) => catOf(l.productId) === category) : lines;
  const tCur = acc(), tPrev = acc();
  const prod = new Map<string, { cur: Acc; prev: Acc; mQty: Map<string, number>; mRev: Map<string, number> }>();
  const cli = new Map<string, { cur: Acc; prev: Acc; products: Set<string>; lastManager: string; lastDay: string; own: boolean }>();
  const man = new Map<string, { cur: Acc; prev: Acc }>();
  const monthly = new Map<string, number>();
  const cp = new Map<string, { qty: number; qtyPrev: number; rev: number; revPrev: number; deals: Set<string>; lastDay: string }>();

  for (const l of scoped) {
    const s = side(l);
    const month = l.day.slice(0, 7);
    if (month >= months[0]) {
      const key = category ? l.productId : catOf(l.productId);
      monthly.set(`${month}|${key}`, (monthly.get(`${month}|${key}`) ?? 0) + l.rev);
    }
    if (!s) continue;
    add(s === 'cur' ? tCur : tPrev, l);

    let p = prod.get(l.productId);
    if (!p) { p = { cur: acc(), prev: acc(), mQty: new Map(), mRev: new Map() }; prod.set(l.productId, p); }
    add(p[s], l);
    if (s === 'cur') {
      p.mQty.set(month, (p.mQty.get(month) ?? 0) + l.qty);
      p.mRev.set(month, (p.mRev.get(month) ?? 0) + l.rev);
    }

    let c = cli.get(l.clientId);
    if (!c) { c = { cur: acc(), prev: acc(), products: new Set(), lastManager: l.managerId, lastDay: '', own: l.own }; cli.set(l.clientId, c); }
    add(c[s], l);
    if (s === 'cur') c.products.add(l.productId);
    if (l.day >= c.lastDay) { c.lastDay = l.day; c.lastManager = l.managerId; }

    let m = man.get(l.managerId);
    if (!m) { m = { cur: acc(), prev: acc() }; man.set(l.managerId, m); }
    add(m[s], l);

    if (category) {
      const k = `${l.clientId}|${l.productId}`;
      let x = cp.get(k);
      if (!x) { x = { qty: 0, qtyPrev: 0, rev: 0, revPrev: 0, deals: new Set(), lastDay: '' }; cp.set(k, x); }
      if (s === 'cur') {
        x.qty += l.qty; x.rev += l.rev; x.deals.add(l.dealId);
        if (l.day > x.lastDay) x.lastDay = l.day;
      } else { x.qtyPrev += l.qty; x.revPrev += l.rev; }
    }
  }

  // Товары: все, что продавались в одном из периодов, плюс лежащие на складе без продаж (в категории)
  const productIds = new Set(prod.keys());
  if (category) for (const p of products) if (p.category === category && p.isActive && p.stock > 0) productIds.add(p.id);

  const totalCur = tCur.rev;
  const abc = abcClasses([...prod].map(([id, p]) => ({ id, rev: p.cur.rev })));
  const pv: PriceVolume = { volume: 0, price: 0, added: 0, dropped: 0 };

  const productRows: ProductRow[] = [...productIds].map((id) => {
    const p = prod.get(id) ?? { cur: acc(), prev: acc(), mQty: new Map(), mRev: new Map() };
    const pi = info.get(id);
    const price = p.cur.qty > 0 ? p.cur.rev / p.cur.qty : null;
    const pricePrev = p.prev.qty > 0 ? p.prev.rev / p.prev.qty : null;
    let volumeEffect = 0, priceEffect = 0;
    if (p.cur.rev > 0 && p.prev.rev > 0) {
      if (price != null && pricePrev != null) {
        volumeEffect = (p.cur.qty - p.prev.qty) * pricePrev;
        priceEffect = (price - pricePrev) * p.cur.qty;
      } else volumeEffect = p.cur.rev - p.prev.rev;
      pv.volume += volumeEffect; pv.price += priceEffect;
    } else if (p.cur.rev > 0) { volumeEffect = p.cur.rev; pv.added += p.cur.rev; }
    else if (p.prev.rev > 0) { volumeEffect = -p.prev.rev; pv.dropped -= p.prev.rev; }

    const mQty = curMonths.map((m) => p.mQty.get(m) ?? 0);
    const { xyz, cv } = xyzOf(mQty);
    const avgMonthlyQty = (qty90.get(id) ?? 0) / 3;
    const stock = pi?.stock ?? 0;
    const st = stockStatusOf(stock, avgMonthlyQty, p.cur.rev > 0, p.prev.rev > 0);
    return {
      id, name: pi?.name ?? '—', sku: pi?.sku ?? '', unit: pi?.unit ?? '', category: pi?.category || NO_CATEGORY,
      rev: round(p.cur.rev), revPrev: round(p.prev.rev), revChange: pctChange(p.cur.rev, p.prev.rev),
      qty: round3(p.cur.qty), qtyPrev: round3(p.prev.qty),
      price: price != null ? round(price) : null, pricePrev: pricePrev != null ? round(pricePrev) : null,
      priceChange: price != null && pricePrev != null ? pctChange(price, pricePrev) : null,
      clients: p.cur.clients.size, clientsPrev: p.prev.clients.size,
      orders: p.cur.deals.size, ordersPrev: p.prev.deals.size,
      share: totalCur > 0 ? p.cur.rev / totalCur : 0,
      abc: abc.get(id) ?? null, xyz, cv: cv != null ? Math.round(cv * 100) / 100 : null,
      volumeEffect: round(volumeEffect), priceEffect: round(priceEffect),
      stock: round3(stock), minStock: round3(pi?.minStock ?? 0),
      avgMonthlyQty: round3(avgMonthlyQty),
      coverMonths: st.cover != null ? Math.round(st.cover * 10) / 10 : null,
      stockStatus: st.status,
      lastSale: lastSale.get(id) ?? null,
      monthly: curMonths.map((m) => round(p.mRev.get(m) ?? 0)),
    };
  }).sort((a, b) => b.rev - a.rev || b.revPrev - a.revPrev);

  // Недобор из-за нуля на складе: товары с остатком ≤ 0, что продавались год назад
  const perProduct = new Map<string, { cur: number; prev: number }>();
  for (const l of lines) {
    const s = side(l);
    if (!s) continue;
    const v = perProduct.get(l.productId) ?? { cur: 0, prev: 0 };
    v[s] += l.rev;
    perProduct.set(l.productId, v);
  }
  const stockoutByCat = new Map<string, { items: number; lost: number }>();
  for (const [pid, v] of perProduct) {
    const pi = info.get(pid);
    if (!pi || pi.stock > 0 || v.prev <= 0) continue;
    const s = stockoutByCat.get(catOf(pid)) ?? { items: 0, lost: 0 };
    s.items++;
    s.lost += Math.max(0, v.prev - v.cur);
    stockoutByCat.set(catOf(pid), s);
  }

  const categoryRows: CategoryRow[] = [...catAcc].map(([name, a]) => {
    const so = stockoutByCat.get(name);
    return {
      name,
      ...totalsOf(a.cur, a.prev, a.pc.size, a.pp.size),
      share: 0,
      outOfStock: so?.items ?? 0,
      lostToStockout: round(so?.lost ?? 0),
    };
  });
  const catTotal = categoryRows.reduce((s, c) => s + c.rev, 0);
  for (const c of categoryRows) c.share = catTotal > 0 ? c.rev / catTotal : 0;
  categoryRows.sort((a, b) => b.rev - a.rev || b.revPrev - a.revPrev);

  const clientRows: ClientRow[] = [...cli].map(([id, c]) => {
    const ch = pctChange(c.cur.rev, c.prev.rev);
    const status: ClientStatus = c.prev.rev <= 0 ? 'new' : c.cur.rev <= 0 ? 'lost'
      : ch != null && ch > 10 ? 'up' : ch != null && ch < -10 ? 'down' : 'flat';
    return {
      id, rev: round(c.cur.rev), revPrev: round(c.prev.rev), revChange: ch,
      orders: c.cur.deals.size, ordersPrev: c.prev.deals.size,
      products: c.products.size, lastBuy: c.lastDay || null, status, managerId: c.lastManager, own: c.own,
    };
  }).sort((a, b) => b.rev - a.rev || b.revPrev - a.revPrev);

  const managerRows: ManagerRow[] = [...man].map(([id, m]) => ({
    id, rev: round(m.cur.rev), revPrev: round(m.prev.rev), revChange: pctChange(m.cur.rev, m.prev.rev),
    clients: m.cur.clients.size, clientsPrev: m.prev.clients.size, orders: m.cur.deals.size,
  })).sort((a, b) => b.rev - a.rev);

  // Внутри категории помесячно — крупнейшие товары, остальные одной строкой
  let monthlyRows = [...monthly].map(([k, rev]) => { const [month, key] = k.split('|'); return { month, key, rev }; });
  if (category) {
    const top = new Set(productRows.filter((p) => p.rev > 0 || p.revPrev > 0)
      .sort((a, b) => (b.rev + b.revPrev) - (a.rev + a.revPrev)).slice(0, TOP_MONTHLY_PRODUCTS).map((p) => p.id));
    const folded = new Map<string, number>();
    for (const r of monthlyRows) {
      const k = `${r.month}|${top.has(r.key) ? r.key : OTHER_KEY}`;
      folded.set(k, (folded.get(k) ?? 0) + r.rev);
    }
    monthlyRows = [...folded].map(([k, rev]) => { const [month, key] = k.split('|'); return { month, key, rev }; });
  }
  monthlyRows = monthlyRows.map((r) => ({ ...r, rev: round(r.rev) })).sort((a, b) => a.month.localeCompare(b.month));

  return {
    periods, months, curMonths,
    totals: totalsOf(tCur, tPrev, [...prod.values()].filter((p) => p.cur.rev > 0).length, [...prod.values()].filter((p) => p.prev.rev > 0).length),
    categories: categoryRows,
    monthly: monthlyRows,
    products: productRows,
    clients: clientRows,
    managers: managerRows,
    clientProducts: [...cp].map(([k, x]) => {
      const [clientId, productId] = k.split('|');
      return {
        clientId, productId,
        qty: round3(x.qty), qtyPrev: round3(x.qtyPrev), rev: round(x.rev), revPrev: round(x.revPrev),
        orders: x.deals.size, lastBuy: x.lastDay || null,
      };
    }).sort((a, b) => b.rev - a.rev || b.revPrev - a.revPrev),
    priceVolume: { volume: round(pv.volume), price: round(pv.price), added: round(pv.added), dropped: round(pv.dropped) },
  };
}
