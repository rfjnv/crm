import { Request, Response } from 'express';
import { settingsService } from './settings.service';

export class SettingsController {
  async getCompanySettings(_req: Request, res: Response): Promise<void> {
    const settings = await settingsService.getCompanySettings();
    res.json(settings);
  }

  async updateCompanySettings(req: Request, res: Response): Promise<void> {
    const settings = await settingsService.updateCompanySettings(req.body);
    res.json(settings);
  }

  async uploadLogo(req: Request, res: Response): Promise<void> {
    if (!req.file) {
      res.status(400).json({ error: 'Файл не предоставлен' });
      return;
    }
    const settings = await settingsService.updateLogo(req.file.path);
    res.json(settings);
  }
}

export const settingsController = new SettingsController();
