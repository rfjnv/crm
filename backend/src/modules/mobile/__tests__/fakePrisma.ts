import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

/**
 * Минимальный Prisma в памяти для тестов модуля mobile: поддерживает ровно те запросы,
 * которые делает модуль (равенство, in, gt/gte/lt/lte, not: null, AND/OR, фильтр задачи по звонку).
 */

type Row = Record<string, any>;
type Tables = {
  callSession: Row[];
  task: Row[];
  callRecording: Row[];
  mobileDevice: Row[];
  client: Row[];
  callAudit: Row[];
  user: Row[];
  callGroupReport: Row[];
};

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: any, b: any): number {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

function fieldMatches(value: any, cond: any): boolean {
  if (cond === null) return value == null;
  if (cond instanceof Date || typeof cond !== 'object') return same(value, cond);
  for (const [op, arg] of Object.entries(cond)) {
    if (arg === undefined) continue;
    switch (op) {
      case 'in': if (!(arg as any[]).some((a) => same(value, a))) return false; break;
      case 'not': if (arg === null ? value == null : same(value, arg)) return false; break;
      case 'gt': if (value == null || cmp(value, arg) <= 0) return false; break;
      case 'gte': if (value == null || cmp(value, arg) < 0) return false; break;
      case 'lt': if (value == null || cmp(value, arg) >= 0) return false; break;
      case 'lte': if (value == null || cmp(value, arg) > 0) return false; break;
      case 'contains': if (typeof value !== 'string' || !value.includes(arg as string)) return false; break;
      case 'startsWith': if (typeof value !== 'string' || !value.startsWith(arg as string)) return false; break;
      case 'notIn': if ((arg as any[]).some((a) => same(value, a))) return false; break;
      case 'has': if (!Array.isArray(value) || !value.includes(arg)) return false; break;
      default: throw new Error(`fakePrisma: оператор ${op} не поддержан`);
    }
  }
  return true;
}

export function createFakePrisma() {
  const db: Tables = { callSession: [], task: [], callRecording: [], mobileDevice: [], client: [], callAudit: [], user: [], callGroupReport: [] };

  function matches(table: keyof Tables, row: Row, where: any): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === 'AND') {
        if (!(cond as any[]).every((w) => matches(table, row, w))) return false;
      } else if (key === 'OR') {
        if (!(cond as any[]).some((w) => matches(table, row, w))) return false;
      } else if (table === 'task' && key === 'callSession') {
        const s = db.callSession.find((c) => c.id === row.callSessionId);
        if (!s || !matches('callSession', s, cond)) return false;
      } else if (!fieldMatches(row[key], cond)) {
        return false;
      }
    }
    return true;
  }

  function pick(row: Row, select: any): Row {
    if (!select) return { ...row };
    const out: Row = {};
    for (const [k, v] of Object.entries(select)) {
      if (!v) continue;
      if (k === 'manager') {
        const u = db.user.find((x) => x.id === row.managerUserId);
        out.manager = u ? { id: u.id, fullName: u.fullName } : null;
      }
      else if (k === 'client') out.client = db.client.find((c) => c.id === row.clientId) ?? null;
      else if (k === 'tasks') out.tasks = db.task.filter((t) => t.callSessionId === row.id);
      else out[k] = row[k];
    }
    return out;
  }

  function order(rows: Row[], orderBy: any): Row[] {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(orderBy as Record<string, string>);
    return [...rows].sort((a, b) => cmp(a[field], b[field]) * (dir === 'desc' ? -1 : 1));
  }

  const defaults: Record<keyof Tables, () => Row> = {
    callSession: () => ({ deletedAt: null, analysisRequest: null, driveFileId: null, clientId: null, recordingPath: null, transcript: null, auditId: null, rawEvents: null, audioStatus: 'NONE', audioError: null, audioAttempts: 0, calledBackAt: null }),
    task: () => ({ status: 'TODO', description: null, report: null, callSessionId: null }),
    callRecording: () => ({ callSessionId: null }),
    mobileDevice: () => ({ active: true }),
    client: () => ({ isArchived: false }),
    callAudit: () => ({ clientId: null }),
    user: () => ({ isActive: true }),
    callGroupReport: () => ({ status: 'WAITING', result: null, error: null }),
  };

  function model(table: keyof Tables, unique: string[] = []) {
    const rows = () => db[table];
    return {
      findUnique: async ({ where, select }: any) => {
        const r = rows().find((row) => matches(table, row, where));
        return r ? pick(r, select) : null;
      },
      findFirst: async ({ where, select, orderBy }: any = {}) => {
        const r = order(rows().filter((row) => matches(table, row, where)), orderBy)[0];
        return r ? pick(r, select) : null;
      },
      findMany: async ({ where, select, orderBy, take, skip }: any = {}) => {
        let list = order(rows().filter((row) => matches(table, row, where)), orderBy);
        if (skip) list = list.slice(skip);
        if (take) list = list.slice(0, take);
        return list.map((r) => pick(r, select));
      },
      count: async ({ where }: any = {}) => rows().filter((row) => matches(table, row, where)).length,
      create: async ({ data, select }: any) => {
        for (const field of unique) {
          if (data[field] != null && rows().some((r) => r[field] === data[field])) {
            throw new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on ${field}`, { code: 'P2002', clientVersion: 'test' });
          }
        }
        const now = new Date();
        const row = { id: randomUUID(), createdAt: now, updatedAt: now, ...defaults[table](), ...data };
        rows().push(row);
        return pick(row, select);
      },
      update: async ({ where, data, select }: any) => {
        const r = rows().find((row) => matches(table, row, where));
        if (!r) throw new Error(`fakePrisma: ${table} не найден`);
        Object.assign(r, data, { updatedAt: new Date() });
        return pick(r, select);
      },
      updateMany: async ({ where, data }: any) => {
        const list = rows().filter((row) => matches(table, row, where));
        for (const r of list) Object.assign(r, data, { updatedAt: new Date() });
        return { count: list.length };
      },
      deleteMany: async ({ where }: any = {}) => {
        const keep = rows().filter((row) => !matches(table, row, where));
        const count = rows().length - keep.length;
        db[table] = keep;
        return { count };
      },
    };
  }

  const prisma = {
    callSession: model('callSession', ['externalCallId']),
    task: model('task'),
    callRecording: model('callRecording', ['sha256']),
    mobileDevice: model('mobileDevice'),
    client: model('client'),
    callAudit: model('callAudit'),
    user: model('user'),
    callGroupReport: model('callGroupReport'),
    /** Поиск клиента по номеру: как SQL-префильтр — цифры номера встречаются в поле phone */
    $queryRaw: async (sql: Prisma.Sql) => {
      const pattern = String(sql.values[0] ?? '').replace(/%/g, '');
      return db.client
        .filter((c) => !c.isArchived && c.phone && String(c.phone).replace(/\D/g, '').includes(pattern))
        .map((c) => ({ id: c.id, phone: c.phone, managerId: c.managerId, companyName: c.companyName }));
    },
  };

  return { prisma, db };
}
