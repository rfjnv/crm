import { Router } from 'express';
import { contractsController } from './contracts.controller';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createContractDto, updateContractDto } from './contracts.dto';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(contractsController.findAll.bind(contractsController)));
router.get('/:id', asyncHandler(contractsController.findById.bind(contractsController)));
router.post('/', validate(createContractDto), asyncHandler(contractsController.create.bind(contractsController)));
router.patch('/:id', validate(updateContractDto), asyncHandler(contractsController.update.bind(contractsController)));

export default router;
