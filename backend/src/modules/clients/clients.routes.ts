import { Router } from 'express';
import { clientsController } from './clients.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createClientDto, updateClientDto } from './clients.dto';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(clientsController.findAll.bind(clientsController)));
router.get('/:id', asyncHandler(clientsController.findById.bind(clientsController)));
router.post('/', validate(createClientDto), asyncHandler(clientsController.create.bind(clientsController)));
router.patch('/:id', validate(updateClientDto), asyncHandler(clientsController.update.bind(clientsController)));
router.patch('/:id/archive', asyncHandler(clientsController.archive.bind(clientsController)));
router.get('/:id/history', asyncHandler(clientsController.getHistory.bind(clientsController)));
router.get('/:id/payments', asyncHandler(clientsController.getPayments.bind(clientsController)));
router.get('/:id/analytics', asyncHandler(clientsController.getAnalytics.bind(clientsController)));

export default router;
