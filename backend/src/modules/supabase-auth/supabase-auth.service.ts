import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { getSupabaseAdmin, getSupabasePublic, parseSupabaseRole, type SupabaseAuthRole } from '../../lib/supabase';
import { isSupabaseConfigured } from '../../lib/config';
import { authService } from '../auth/auth.service';

export type SupabaseAuthUserDto = {
  id: string;
  email: string;
  role: SupabaseAuthRole | null;
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
  user_metadata?: Record<string, unknown>;
}): SupabaseAuthUserDto {
  return {
    id: u.id,
    email: u.email ?? '',
    role: parseSupabaseRole(u.user_metadata),
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
    const role = parseSupabaseRole(data.user.user_metadata as Record<string, unknown>);
    if (!role) {
      const meta = data.user.user_metadata as Record<string, unknown> | undefined;
      const hint = meta?.role != null
        ? ` Сейчас в metadata: role="${String(meta.role)}". Нужно: "superadmin" или "admin".`
        : ' В Supabase → Authentication → Users → Edit → User Metadata добавьте: {"role":"superadmin"}';
      throw new AppError(403, `У пользователя нет роли admin или superadmin.${hint}`);
    }
    return { user: data.user, role };
  }

  async exchangeSession(accessToken: string, meta: { ip?: string; userAgent?: string }) {
    const { user, role } = await this.verifyAccessToken(accessToken);
    const email = user.email?.trim().toLowerCase();
    if (!email) {
      throw new AppError(400, 'У аккаунта Supabase нет email');
    }

    const prismaRole: Role = role === 'superadmin' ? 'SUPER_ADMIN' : 'ADMIN';
    const login = email;

    let dbUser = await prisma.user.findUnique({ where: { login } });
    if (!dbUser) {
      const passwordHash = await hashPassword(randomUUID());
      dbUser = await prisma.user.create({
        data: {
          login,
          password: passwordHash,
          fullName: email.split('@')[0] || 'Admin',
          role: prismaRole,
          permissions: [],
          isActive: true,
        },
      });
    } else if (!dbUser.isActive) {
      throw new AppError(403, 'Учётная запись CRM деактивирована');
    } else if (dbUser.role !== prismaRole && (dbUser.role === 'SUPER_ADMIN' || dbUser.role === 'ADMIN')) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { role: prismaRole },
      });
      dbUser = { ...dbUser, role: prismaRole };
    }

    const tokens = await authService.createSessionForUser(
      dbUser.id,
      dbUser.role,
      dbUser.permissions as string[],
      meta,
      { supabaseRole: role, supabaseUserId: user.id },
    );

    const profile = await authService.getMe(dbUser.id);
    return {
      ...tokens,
      user: {
        ...profile,
        supabaseRole: role,
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
        const role = parseSupabaseRole(u.user_metadata as Record<string, unknown>);
        if (role) all.push(mapUser(u as Parameters<typeof mapUser>[0]));
      }
      if (users.length < perPage) break;
      page += 1;
    }

    return all.sort((a, b) => a.email.localeCompare(b.email));
  }

  async createUser(email: string, password: string, role: SupabaseAuthRole): Promise<SupabaseAuthUserDto> {
    this.assertConfigured();
    const { data, error } = await getSupabaseAdmin().auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { role },
    });
    if (error) throw new AppError(400, error.message);
    if (!data.user) throw new AppError(500, 'Пользователь не создан');
    return mapUser(data.user as Parameters<typeof mapUser>[0]);
  }

  async updateRole(userId: string, role: SupabaseAuthRole): Promise<SupabaseAuthUserDto> {
    this.assertConfigured();
    const { data, error } = await getSupabaseAdmin().auth.admin.updateUserById(userId, {
      user_metadata: { role },
    });
    if (error) throw new AppError(400, error.message);
    if (!data.user) throw new AppError(404, 'Пользователь не найден');
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
