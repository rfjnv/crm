import { Router } from 'express';
import multer from 'multer';
import { contractsController } from './contracts.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createContractDto, updateContractDto } from './contracts.dto';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/png', 'image/jpg',
      'application/zip', 'application/x-zip-compressed',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимы только файлы PDF, JPG, PNG, ZIP'));
    }
  },
});

router.use(authenticate);

router.get('/', asyncHandler(contractsController.findAll.bind(contractsController)));
router.get('/:id', asyncHandler(contractsController.findById.bind(contractsController)));
router.post('/', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(createContractDto), asyncHandler(contractsController.create.bind(contractsController)));
router.patch('/:id', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), validate(updateContractDto), asyncHandler(contractsController.update.bind(contractsController)));

// Attachments
router.post('/:id/attachments', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), upload.single('file'), asyncHandler(contractsController.uploadAttachment.bind(contractsController)));
router.delete('/:id/attachments/:attachmentId', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), asyncHandler(contractsController.deleteAttachment.bind(contractsController)));

export default router;
