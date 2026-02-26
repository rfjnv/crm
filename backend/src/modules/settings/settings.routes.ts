import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { settingsController } from './settings.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { updateCompanySettingsDto } from './settings.dto';
import { generateStorageName } from '../../lib/uploadSecurity';

const router = Router();

const logoDir = path.resolve(process.cwd(), 'uploads', 'settings');

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true });
    }
    cb(null, logoDir);
  },
  filename: (_req, file, cb) => {
    cb(null, generateStorageName(file.originalname));
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимы только файлы JPG, PNG, SVG'));
    }
  },
});

router.use(authenticate);

router.get('/company', asyncHandler(settingsController.getCompanySettings.bind(settingsController)));
router.put('/company', authorize('SUPER_ADMIN', 'ADMIN'), validate(updateCompanySettingsDto), asyncHandler(settingsController.updateCompanySettings.bind(settingsController)));
router.post('/company/logo', authorize('SUPER_ADMIN', 'ADMIN'), uploadLogo.single('logo'), asyncHandler(settingsController.uploadLogo.bind(settingsController)));

export default router;
