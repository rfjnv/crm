import { Router } from 'express';
import { poaController } from './power-of-attorney.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createPoaDto, updatePoaDto } from './power-of-attorney.dto';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(poaController.findAll.bind(poaController)));
router.get('/:id', asyncHandler(poaController.findById.bind(poaController)));
router.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(createPoaDto), asyncHandler(poaController.create.bind(poaController)));
router.patch('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(updatePoaDto), asyncHandler(poaController.update.bind(poaController)));
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), asyncHandler(poaController.delete.bind(poaController)));
router.get('/:id/print', asyncHandler(poaController.print.bind(poaController)));

export default router;
