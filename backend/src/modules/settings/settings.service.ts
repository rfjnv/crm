import prisma from '../../lib/prisma';
import { UpdateCompanySettingsDto } from './settings.dto';

export class SettingsService {
  async getCompanySettings() {
    let settings = await prisma.companySettings.findUnique({
      where: { id: 'singleton' },
    });

    if (!settings) {
      settings = await prisma.companySettings.create({
        data: { id: 'singleton' },
      });
    }

    return settings;
  }

  async updateCompanySettings(dto: UpdateCompanySettingsDto) {
    const settings = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', ...dto },
      update: dto,
    });

    return settings;
  }

  async updateLogo(logoPath: string) {
    const settings = await prisma.companySettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', logoPath },
      update: { logoPath },
    });

    return settings;
  }
}

export const settingsService = new SettingsService();
