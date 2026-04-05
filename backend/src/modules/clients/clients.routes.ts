import { Router } from 'express';
import { clientsController } from './clients.controller';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { createClientDto, updateClientDto, createClientNoteDto, updateClientNoteDto } from './clients.dto';
import { authorize } from '../../middleware/authorize';

const router = Router();

router.use(authenticate);

router.get('/', asyncHandler(clientsController.findAll.bind(clientsController)));
router.get('/:id', asyncHandler(clientsController.findById.bind(clientsController)));
router.post('/', validate(createClientDto), asyncHandler(clientsController.create.bind(clientsController)));
router.patch('/:id', requirePermission('edit_client'), validate(updateClientDto), asyncHandler(clientsController.update.bind(clientsController)));
router.post('/normalize-phones', authorize('SUPER_ADMIN'), asyncHandler(clientsController.normalizePhones.bind(clientsController)));
router.patch('/:id/archive', asyncHandler(clientsController.archive.bind(clientsController)));
router.get('/:id/history', asyncHandler(clientsController.getHistory.bind(clientsController)));
router.get('/:id/payments', asyncHandler(clientsController.getPayments.bind(clientsController)));
router.get('/:id/analytics', asyncHandler(clientsController.getAnalytics.bind(clientsController)));

router.get('/:id/notes', asyncHandler(clientsController.listNotes.bind(clientsController)));
router.post('/:id/notes', validate(createClientNoteDto), asyncHandler(clientsController.createNote.bind(clientsController)));
router.patch(
  '/:id/notes/:noteId',
  validate(updateClientNoteDto),
  asyncHandler(clientsController.updateNote.bind(clientsController)),
);
router.delete('/:id/notes/:noteId', asyncHandler(clientsController.deleteNote.bind(clientsController)));
router.post(
  '/:id/notes/:noteId/restore',
  authorize('SUPER_ADMIN'),
  asyncHandler(clientsController.restoreNote.bind(clientsController)),
);

export default router;
