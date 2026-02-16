import { randomUUID } from 'crypto';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt';
import { comparePassword, hashToken } from '../../lib/password';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { LoginDto } from './auth.dto';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export class AuthService {
  async login(dto: LoginDto, meta: SessionMeta): Promise<TokenPair> {
    const user = await prisma.user.findUnique({ where: { login: dto.login } });

    if (!user || !user.isActive) {
      await this.logFailedLogin(dto.login);
      throw new AppError(401, 'Неверный логин или пароль');
    }

    const valid = await comparePassword(dto.password, user.password);
    if (!valid) {
      await this.logFailedLogin(dto.login, user.id);
      throw new AppError(401, 'Неверный логин или пароль');
    }

    const tokens = await this.createSession(user.id, user.role, user.permissions, meta);

    await auditLog({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'user',
      entityId: user.id,
    });

    return tokens;
  }

  async refresh(rawRefreshToken: string, meta: SessionMeta): Promise<TokenPair> {
    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new AppError(401, 'Недействительный refresh token');
    }

    const tokenHash = hashToken(rawRefreshToken);

    const session = await prisma.session.findFirst({
      where: {
        id: payload.sessionId,
        refreshTokenHash: tokenHash,
      },
      include: { user: true },
    });

    if (!session) {
      throw new AppError(401, 'Сессия не найдена');
    }

    if (session.revokedAt) {
      // Token reuse detected — revoke all sessions for this user
      await prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppError(401, 'Обнаружено повторное использование токена. Все сессии отозваны.');
    }

    if (session.expiresAt < new Date()) {
      throw new AppError(401, 'Refresh token истёк');
    }

    if (!session.user.isActive) {
      throw new AppError(401, 'Аккаунт деактивирован');
    }

    // Revoke old session
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    // Create new session (rotation)
    const tokens = await this.createSession(
      session.userId,
      session.user.role,
      session.user.permissions,
      meta,
      session.id,
    );

    return tokens;
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken);

    await prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        login: true,
        fullName: true,
        role: true,
        permissions: true,
        isActive: true,
        createdAt: true,
      },
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Пользователь не найден');
    }

    return user;
  }

  private async createSession(
    userId: string,
    role: string,
    permissions: string[],
    meta: SessionMeta,
    replacedBySessionId?: string,
  ): Promise<TokenPair> {
    const sessionId = randomUUID();

    const accessToken = signAccessToken({ userId, role, permissions });
    const refreshToken = signRefreshToken({ sessionId, userId });
    const refreshTokenHash = hashToken(refreshToken);

    await prisma.session.create({
      data: {
        id: sessionId,
        userId,
        refreshTokenHash,
        expiresAt: new Date(Date.now() + config.jwt.refreshExpiresInMs),
        ip: meta.ip,
        userAgent: meta.userAgent,
        ...(replacedBySessionId && { replacedBySessionId }),
      },
    });

    return { accessToken, refreshToken };
  }

  private async logFailedLogin(login: string, userId?: string): Promise<void> {
    if (userId) {
      await auditLog({
        userId,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: userId,
        after: { login },
      });
    }
  }
}

export const authService = new AuthService();
