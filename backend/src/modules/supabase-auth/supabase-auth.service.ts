import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { getSupabaseAdmin, getSupabasePublic } from '../../lib/supabase';
import { isSupabaseConfigured } from '../../lib/config';
import { authService } from '../auth/auth.service';

export type SupabaseAuthUserDto = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  banned: boolean;
};

function mapUser(u: {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  banned_until?: string | null;
}): SupabaseAuthUserDto {
  return {
    id: u.id,
    email: u.email ?? '',
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    banned: Boolean(u.banned_until),
  };
}

export class SupabaseAuthService {
  assertConfigured(): void {
    if (!isSupabaseConfigured) {
      throw new AppError(503, 'Supabase Auth не настроен на сервере');
    }
  }

  async verifyAccessToken(accessToken: string) {
    this.assertConfigured();
    const { data, error } = await getSupabasePublic().auth.getUser(accessToken);
    if (error || !data.user) {
      throw new AppError(401, 'Недействительная сессия Supabase');
    }
    return data.user;
  }

  async exchangeSession(accessToken: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.verifyAccessToken(accessToken);
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      throw new AppError(400, 'У аккаунта Supabase нет email');
    }

    const login = email;

    let dbUser = await prisma.user.findUnique({ where: { login } });
    if (!dbUser) {
      const passwordHash = await hashPassword(randomUUID());
      dbUser = await prisma.user.create({
        data: {
          login,
          password: passwordHash,
          fullName: email.split('@')[0] || 'Admin',
          role: Role.ADMIN,
          permissions: [],
          isActive: true,
        },
      });
    } else if (!dbUser.isActive) {
      throw new AppError(403, 'Учётная запись CRM деактивирована');
    }

    const tokens = await authService.createSessionForUser(
      dbUser.id,
      dbUser.role,
      dbUser.permissions as string[],
      meta,
      { supabaseUserId: user.id },
    );

    const profile = await authService.getMe(dbUser.id);
    return {
      ...tokens,
      user: {
        ...profile,
        supabaseUserId: user.id,
        authSource: 'supabase' as const,
      },
    };
  }

  async listUsers(): Promise<SupabaseAuthUserDto[]> {
    this.assertConfigured();
    const admin = getSupabaseAdmin();
    const all: SupabaseAuthUserDto[] = [];
    let page = 1;
    const perPage = 200;

    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw new AppError(500, error.message);
      const users = data.users ?? [];
      for (const u of users) {
        all.push(mapUser(u as Parameters<typeof mapUser>[0]));
      }
      if (users.length < perPage) break;
      page += 1;
    }

    return all.sort((a, b) => a.email.localeCompare(b.email));
  }

  async createUser(email: string, password: string): Promise<SupabaseAuthUserDto> {
    this.assertConfigured();
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    });
    if (error) throw new AppError(400, error.message);
    if (!data.user) throw new AppError(500, 'Пользователь не создан');
    return mapUser(data.user as Parameters<typeof mapUser>[0]);
  }

  async deleteUser(userId: string, currentSupabaseUserId?: string): Promise<void> {
    this.assertConfigured();
    if (currentSupabaseUserId && userId === currentSupabaseUserId) {
      throw new AppError(400, 'Нельзя удалить свой аккаунт');
    }
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(userId);
    if (error) throw new AppError(400, error.message);
  }
}

export const supabaseAuthService = new SupabaseAuthService();
