import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { contractsController } from './contracts.controller';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { AppError } from '../../lib/errors';
import { createContractDto, updateContractDto, deleteContractDto } from './contracts.dto';

const router = Router();

/** Validate file magic bytes to prevent MIME-type spoofing */
function checkMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return true;
  // ZIP: 50 4B 03 04
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return true;
  return false;
}

function validateFileBytes(req: Request, _res: Response, next: NextFunction): void {
  if (!req.file) return next();
  if (!checkMagicBytes(req.file.buffer)) {
    return next(new AppError(400, 'Файл повреждён или его тип не соответствует содержимому'));
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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
router.post('/:id/attachments', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), upload.single('file'), validateFileBytes, asyncHandler(contractsController.uploadAttachment.bind(contractsController)));
router.delete('/:id/attachments/:attachmentId', authorize('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT'), asyncHandler(contractsController.deleteAttachment.bind(contractsController)));

// Print PDF
router.get('/:id/print', asyncHandler(contractsController.printContract.bind(contractsController)));

// Deletion
router.delete('/:id/hard', authorize('SUPER_ADMIN'), asyncHandler(contractsController.hardDelete.bind(contractsController)));
router.delete('/:id', authorize('SUPER_ADMIN', 'ADMIN'), validate(deleteContractDto), asyncHandler(contractsController.softDelete.bind(contractsController)));

export default router;
