import jwt from 'jsonwebtoken';
import { config } from './config';

export interface AccessTokenPayload {
  userId: string;
  role: string;
  permissions: string[];
  /** Уровень доступа к деньгам — подставляется из БД в authenticate, в токене не хранится */
  moneyAccess?: 'FULL' | 'NO_STRATEGIC' | 'NONE';
  /** До когда открыта себестоимость по ПИН — из сессии в authenticate, в токене не хранится */
  costUnlockedUntil?: Date | null;
  /** ID refresh-сессии (для «текущее устройство» в списке сеансов) */
  sessionId?: string;
  /** ID пользователя Supabase (вход по email) */
  supabaseUserId?: string;
}

export interface RefreshTokenPayload {
  sessionId: string;
  userId: string;
}

/**
 * Пропуск суперадмина живёт 15 минут и продлевается; у остальных — бессрочный, чтобы
 * сотрудника не выкидывало из CRM, когда браузер режет стороннюю cookie продления
 * (сайт и API на разных доменах). Бессрочный пропуск отзывается вместе с сессией входа
 * и деактивацией пользователя — это проверяет authenticate.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  const options: jwt.SignOptions = payload.role === 'SUPER_ADMIN'
    ? { expiresIn: config.jwt.accessExpiresIn } as jwt.SignOptions
    : {};
  return jwt.sign(payload, config.jwt.accessSecret, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload;
}
