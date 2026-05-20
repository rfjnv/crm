import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSupabaseSuperadmin } from '../../middleware/requireSupabaseSuperadmin';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAuthController } from './supabase-auth.controller';
import {
  createSupabaseUserDto,
  supabaseExchangeDto,
  updateSupabaseUserRoleDto,
} from './supabase-auth.dto';

const router = Router();

router.get('/config', asyncHandler(supabaseAuthController.config.bind(supabaseAuthController)));

router.post(
  '/exchange',
  validate(supabaseExchangeDto),
  asyncHandler(supabaseAuthController.exchange.bind(supabaseAuthController)),
);

router.use(authenticate);
router.use(requireSupabaseSuperadmin);

router.get('/users', asyncHandler(supabaseAuthController.listUsers.bind(supabaseAuthController)));

router.post(
  '/users',
  validate(createSupabaseUserDto),
  asyncHandler(supabaseAuthController.createUser.bind(supabaseAuthController)),
);

router.patch(
  '/users/:id',
  validate(updateSupabaseUserRoleDto),
  asyncHandler(supabaseAuthController.updateRole.bind(supabaseAuthController)),
);

router.delete(
  '/users/:id',
  asyncHandler(supabaseAuthController.deleteUser.bind(supabaseAuthController)),
);

export default router;
