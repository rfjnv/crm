import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSupabaseAuth } from '../../middleware/requireSupabaseAuth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { supabaseAuthController } from './supabase-auth.controller';
import { createSupabaseUserDto, supabaseExchangeDto } from './supabase-auth.dto';

const router = Router();

router.get('/config', asyncHandler(supabaseAuthController.config.bind(supabaseAuthController)));

router.post(
  '/exchange',
  validate(supabaseExchangeDto),
  asyncHandler(supabaseAuthController.exchange.bind(supabaseAuthController)),
);

router.use(authenticate);
router.use(requireSupabaseAuth);

router.get('/users', asyncHandler(supabaseAuthController.listUsers.bind(supabaseAuthController)));

router.post(
  '/users',
  validate(createSupabaseUserDto),
  asyncHandler(supabaseAuthController.createUser.bind(supabaseAuthController)),
);

router.delete(
  '/users/:id',
  asyncHandler(supabaseAuthController.deleteUser.bind(supabaseAuthController)),
);

export default router;
