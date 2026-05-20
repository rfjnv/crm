import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSupabaseAuth } from '../../middleware/requireSupabaseAuth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../lib/asyncHandler';
import { siteCmsController } from './site-cms.controller';
import { saveBlogDto, saveContentDto, saveProductsDto, saveServicesDto } from './site-cms.dto';

const router = Router();

router.use(authenticate);
router.use(requireSupabaseAuth);

router.get('/status', asyncHandler(siteCmsController.status.bind(siteCmsController)));

router.get('/content', asyncHandler(siteCmsController.listContent.bind(siteCmsController)));
router.put('/content', validate(saveContentDto), asyncHandler(siteCmsController.saveContent.bind(siteCmsController)));

router.get('/products', asyncHandler(siteCmsController.listProducts.bind(siteCmsController)));
router.put('/products', validate(saveProductsDto), asyncHandler(siteCmsController.saveProducts.bind(siteCmsController)));
router.delete('/products/:id', asyncHandler(siteCmsController.deleteProduct.bind(siteCmsController)));

router.get('/services', asyncHandler(siteCmsController.listServices.bind(siteCmsController)));
router.put('/services', validate(saveServicesDto), asyncHandler(siteCmsController.saveServices.bind(siteCmsController)));
router.delete('/services/:id', asyncHandler(siteCmsController.deleteService.bind(siteCmsController)));

router.get('/blog', asyncHandler(siteCmsController.listBlog.bind(siteCmsController)));
router.put('/blog', validate(saveBlogDto), asyncHandler(siteCmsController.saveBlog.bind(siteCmsController)));
router.delete('/blog/:id', asyncHandler(siteCmsController.deleteBlogPost.bind(siteCmsController)));

router.get('/inquiries', asyncHandler(siteCmsController.listInquiries.bind(siteCmsController)));

router.post('/upload', siteCmsController.uploadImage);

export default router;
