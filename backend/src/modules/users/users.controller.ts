import { Request, Response } from 'express';
import { usersService } from './users.service';
import { AppError } from '../../lib/errors';
import { monthlyGoalQueryDto } from './users.dto';

export class UsersController {
  async findAll(req: Request, res: Response): Promise<void> {
    const raw = req.query.includeInactive;
    const includeInactive = raw === 'true' || raw === '1';
    if (includeInactive && req.user!.role !== 'ADMIN' && req.user!.role !== 'SUPER_ADMIN') {
      throw new AppError(403, 'Полный список пользователей доступен только администраторам');
    }
    const users = await usersService.findAll({ includeInactive });
    res.json(users);
  }

  async create(req: Request, res: Response): Promise<void> {
    const user = await usersService.create(req.body, req.user!.userId as string);
    res.status(201).json(user);
  }

  async update(req: Request, res: Response): Promise<void> {
    const user = await usersService.update(req.params.id as string, req.body, req.user!.userId as string);
    res.json(user);
  }

  async deactivate(req: Request, res: Response): Promise<void> {
    const user = await usersService.deactivate(req.params.id as string, req.user!.userId as string);
    res.json(user);
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    const result = await usersService.deleteUser(req.params.id as string, req.user!.userId as string);
    res.json(result);
  }

  async activate(req: Request, res: Response): Promise<void> {
    const user = await usersService.activate(req.params.id as string, req.user!.userId as string);
    res.json(user);
  }

  async listMedalHistory(req: Request, res: Response): Promise<void> {
    const rows = await usersService.listMedalHistory(req.params.id as string, req.user!);
    res.json(rows);
  }

  async removeMedalHistoryEntry(req: Request, res: Response): Promise<void> {
    const result = await usersService.removeMedalHistoryEntry(
      req.params.entryId as string,
      req.params.id as string,
      req.user!.userId,
    );
    res.json(result);
  }

  async upsertMonthlyGoal(req: Request, res: Response): Promise<void> {
    const result = await usersService.upsertMonthlyGoal(
      req.params.id as string,
      req.body,
      req.user!.userId as string,
    );
    res.json(result);
  }

  async getMonthlyGoal(req: Request, res: Response): Promise<void> {
    const parsed = monthlyGoalQueryDto.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'Некорректные параметры периода');
    }
    const actor = req.user!;
    const targetId = req.params.id as string;
    const canManage = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    if (!canManage && actor.userId !== targetId) {
      throw new AppError(403, 'Нет доступа к целям пользователя');
    }
    const result = await usersService.getMonthlyGoalProgress(
      targetId,
      parsed.data.year,
      parsed.data.month,
    );
    res.json(result);
  }

  async listMonthlyGoals(req: Request, res: Response): Promise<void> {
    const parsed = monthlyGoalQueryDto.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'Некорректные параметры периода');
    }
    const rows = await usersService.listMonthlyGoalsForPeriod(parsed.data.year, parsed.data.month);
    res.json(rows);
  }
}

export const usersController = new UsersController();
