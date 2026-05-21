import { Request, Response } from 'express';
import multer from 'multer';
import { siteCmsService } from './site-cms.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export class SiteCmsController {
  async status(_req: Request, res: Response): Promise<void> {
    const result = await siteCmsService.getStatus();
    res.json(result);
  }

  async listContent(req: Request, res: Response): Promise<void> {
    const locale = req.query.locale as string;
    const section = req.query.section as string;
    const data = await siteCmsService.listContent(locale, section);
    res.json(data);
  }

  async saveContent(req: Request, res: Response): Promise<void> {
    const { locale, section, rows } = req.body;
    const data = await siteCmsService.saveContent(locale, section, rows);
    res.json(data);
  }

  async listProducts(req: Request, res: Response): Promise<void> {
    const data = await siteCmsService.listProducts(req.query.locale as string);
    res.json(data);
  }

  async saveProducts(req: Request, res: Response): Promise<void> {
    const { locale, items } = req.body;
    const data = await siteCmsService.saveProducts(locale, items);
    res.json(data);
  }

  async deleteProduct(req: Request, res: Response): Promise<void> {
    await siteCmsService.deleteProduct(req.params.id as string);
    res.json({ message: 'Удалено' });
  }

  async listServices(req: Request, res: Response): Promise<void> {
    const data = await siteCmsService.listServices(req.query.locale as string);
    res.json(data);
  }

  async saveServices(req: Request, res: Response): Promise<void> {
    const { locale, items } = req.body;
    const data = await siteCmsService.saveServices(locale, items);
    res.json(data);
  }

  async deleteService(req: Request, res: Response): Promise<void> {
    await siteCmsService.deleteService(req.params.id as string);
    res.json({ message: 'Удалено' });
  }

  async listBlog(req: Request, res: Response): Promise<void> {
    const data = await siteCmsService.listBlogPosts(req.query.locale as string);
    res.json(data);
  }

  async saveBlog(req: Request, res: Response): Promise<void> {
    const { locale, posts } = req.body;
    const data = await siteCmsService.saveBlogPosts(locale, posts);
    res.json(data);
  }

  async deleteBlogPost(req: Request, res: Response): Promise<void> {
    await siteCmsService.deleteBlogPost(req.params.id as string);
    res.json({ message: 'Удалено' });
  }

  async listInquiries(_req: Request, res: Response): Promise<void> {
    const data = await siteCmsService.listInquiries();
    res.json(data);
  }

  async seedFromDictionaries(_req: Request, res: Response): Promise<void> {
    const result = await siteCmsService.seedFromDictionaries();
    res.json(result);
  }

  uploadImage = [
    upload.single('file'),
    async (req: Request, res: Response): Promise<void> => {
      const file = req.file;
      const folder = (req.body.folder as string) || 'uploads';
      if (!file) {
        res.status(400).json({ error: 'Файл не передан' });
        return;
      }
      const url = await siteCmsService.uploadImage(file.buffer, file.mimetype, folder);
      res.json({ url });
    },
  ];
}

export const siteCmsController = new SiteCmsController();
