import type { MobileTelephonySettings } from '@prisma/client';
import prisma from '../../lib/prisma';

const CACHE_MS = 60_000;
let cached: { value: MobileTelephonySettings; at: number } | null = null;

/** Настройки мобильной телефонии (одна строка). Кешируются на минуту — читаются на каждом звонке. */
export async function getMobileSettings(): Promise<MobileTelephonySettings> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = await prisma.mobileTelephonySettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  cached = { value, at: Date.now() };
  return value;
}

export async function updateMobileSettings(
  data: Partial<Omit<MobileTelephonySettings, 'id' | 'updatedAt'>>,
): Promise<MobileTelephonySettings> {
  const value = await prisma.mobileTelephonySettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...data },
    update: data,
  });
  cached = { value, at: Date.now() };
  return value;
}
