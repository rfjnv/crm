import { Request, Response } from 'express';
import { AppError } from '../../lib/errors';
import { profileService } from './profile.service';
import { usersService } from '../users/users.service';
import { dailyReportQueryDto } from './profile.dto';
import { monthlyGoalQueryDto } from '../users/users.dto';

export class ProfileController {
  async patchProfile(req: Request, res: Response): Promise<void> {
    const user = await profileService.updateOwnProfile(req.user!.userId, req.body);
    res.json(user);
  }

  async listSessions(req: Request, res: Response): Promise<void> {
    const list = await profileService.listSessions(req.user!.userId, req.user!.sessionId);
    res.json(list);
  }

  async revokeSession(req: Request, res: Response): Promise<void> {
    const result = await profileService.revokeSession(req.user!.userId, req.params.sessionId as string);
    res.json(result);
  }

  async dailyReport(req: Request, res: Response): Promise<void> {
    const parsed = dailyReportQueryDto.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'Параметры from и to обязательны (формат YYYY-MM-DD)');
    }
    const report = await profileService.dailyReport(req.user!.userId, parsed.data.from, parsed.data.to);
    res.json(report);
  }

  async listMedalHistory(req: Request, res: Response): Promise<void> {
    const rows = await usersService.listMedalHistory(req.user!.userId, req.user!);
    res.json(rows);
  }

  async monthlyGoal(req: Request, res: Response): Promise<void> {
    const parsed = monthlyGoalQueryDto.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, 'Некорректные параметры периода');
    }
    const result = await usersService.getMonthlyGoalProgress(
      req.user!.userId,
      parsed.data.year,
      parsed.data.month,
    );
    res.json(result);
  }
}

export const profileController = new ProfileController();
