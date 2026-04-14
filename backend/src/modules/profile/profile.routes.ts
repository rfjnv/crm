import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../lib/asyncHandler';
import { validate } from '../../middleware/validate';
import { profileController } from './profile.controller';
import { updateProfileDto } from './profile.dto';

const router = Router();

router.use(authenticate);

router.patch('/', validate(updateProfileDto), asyncHandler(profileController.patchProfile.bind(profileController)));

router.get('/sessions', asyncHandler(profileController.listSessions.bind(profileController)));

router.delete(
  '/sessions/:sessionId',
  asyncHandler(profileController.revokeSession.bind(profileController)),
);

router.get('/daily-report', asyncHandler(profileController.dailyReport.bind(profileController)));

router.get('/medal-history', asyncHandler(profileController.listMedalHistory.bind(profileController)));

router.get('/monthly-goal', asyncHandler(profileController.monthlyGoal.bind(profileController)));

export default router;
