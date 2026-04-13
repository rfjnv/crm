import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { asyncHandler } from '../../lib/asyncHandler';
import { askQuestionDto } from './ai-assistant.dto';
import { askQuestion } from './ai-assistant.service';

const router = Router();

router.use(authenticate);
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'));

router.post(
  '/ask',
  asyncHandler(async (req: Request, res: Response) => {
    const { question } = askQuestionDto.parse(req.body);
    const result = await askQuestion(question);
    res.json(result);
  }),
);

export default router;
