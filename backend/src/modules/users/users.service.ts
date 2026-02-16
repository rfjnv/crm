import prisma from '../../lib/prisma';
import { hashPassword } from '../../lib/password';
import { AppError } from '../../lib/errors';
import { auditLog } from '../../lib/logger';
import { DEFAULT_PERMISSIONS } from '../../lib/permissions';
import { CreateUserDto, UpdateUserDto } from './users.dto';

const userSelect = {
  id: true,
  login: true,
  fullName: true,
  role: true,
  permissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export class UsersService {
  async findAll() {
    return prisma.user.findMany({
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateUserDto, performedBy: string) {
    const exists = await prisma.user.findUnique({ where: { login: dto.login } });
    if (exists) {
      throw new AppError(409, 'Пользователь с таким логином уже существует');
    }

    const hashed = await hashPassword(dto.password);
    const permissions = dto.permissions ?? DEFAULT_PERMISSIONS[dto.role] ?? [];

    const user = await prisma.user.create({
      data: {
        login: dto.login,
        password: hashed,
        fullName: dto.fullName,
        role: dto.role,
        permissions,
      },
      select: userSelect,
    });

    await auditLog({
      userId: performedBy,
      action: 'CREATE',
      entityType: 'user',
      entityId: user.id,
      after: { login: user.login, fullName: user.fullName, role: user.role, permissions: user.permissions },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    // Protect SUPER_ADMIN from non-SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      const performer = await prisma.user.findUnique({ where: { id: performedBy }, select: { role: true } });
      if (performer?.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Нельзя редактировать суперадминистратора');
      }
    }

    const data: Record<string, unknown> = {};
    if (dto.login !== undefined) data.login = dto.login;
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password !== undefined) data.password = await hashPassword(dto.password);
    if (dto.permissions !== undefined) data.permissions = dto.permissions;

    if (Object.keys(data).length === 0) {
      throw new AppError(400, 'Нет данных для обновления');
    }

    const before = { login: user.login, fullName: user.fullName, role: user.role, isActive: user.isActive, permissions: user.permissions };

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: userSelect,
    });

    await auditLog({
      userId: performedBy,
      action: 'UPDATE',
      entityType: 'user',
      entityId: id,
      before,
      after: { login: updated.login, fullName: updated.fullName, role: updated.role, isActive: updated.isActive, permissions: updated.permissions },
    });

    return updated;
  }

  async deactivate(id: string, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    if (id === performedBy) {
      throw new AppError(400, 'Нельзя деактивировать самого себя');
    }

    // Protect SUPER_ADMIN
    if (user.role === 'SUPER_ADMIN') {
      const performer = await prisma.user.findUnique({ where: { id: performedBy }, select: { role: true } });
      if (performer?.role !== 'SUPER_ADMIN') {
        throw new AppError(403, 'Только суперадминистратор может деактивировать суперадминистратора');
      }
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: userSelect,
    });

    // Revoke all sessions
    await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await auditLog({
      userId: performedBy,
      action: 'ARCHIVE',
      entityType: 'user',
      entityId: id,
      before: { isActive: true },
      after: { isActive: false },
    });

    return updated;
  }

  async activate(id: string, performedBy: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError(404, 'Пользователь не найден');
    }

    if (user.isActive) {
      throw new AppError(400, 'Пользователь уже активен');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: true },
      select: userSelect,
    });

    await auditLog({
      userId: performedBy,
      action: 'RESTORE',
      entityType: 'user',
      entityId: id,
      before: { isActive: false },
      after: { isActive: true },
    });

    return updated;
  }
}

export const usersService = new UsersService();
