import { Request, Response } from 'express';
import XLSX from 'xlsx';
import { warehouseService } from './warehouse.service';
import { AppError } from '../../lib/errors';
import { uploadImageToStorage, deleteImageFromStorage } from '../../lib/imageStorage';

export class WarehouseController {
  // Products
  async findAllProducts(req: Request, res: Response): Promise<void> {
    const products = await warehouseService.findAllProducts(req.user!.role as any, req.user!.companyId);
    res.json(products);
  }

  /**
   * Остаток склада в .xlsx. CSV тут не годится: Excel в русской локали не делит
   * строку по «;» и портит артикулы вида «0,3*1,3», превращая их в числа и даты.
   *
   * Плёнка идёт отдельным листом: у неё два параллельных остатка (рулоны и кг),
   * и в одной таблице с поштучными товарами колонки читаются как мусор.
   */
  async exportStock(req: Request, res: Response): Promise<void> {
    // Выбранные на экране строки: их выгружаем как есть, включая нулевые остатки.
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const includeZero = req.query.includeZero === '1' || ids.length > 0;
    const products = await warehouseService.findAllProducts(req.user!.role as any, req.user!.companyId);

    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const idSet = new Set(ids);
    const active = ids.length > 0
      ? products.filter((p: any) => idSet.has(p.id))
      : products.filter((p: any) => p.isActive);
    const rollItems = active.filter((p: any) => p.rollStock != null);
    const plainItems = active.filter((p: any) => p.rollStock == null);

    const plainRows = plainItems
      .filter((p: any) => includeZero || num(p.stock) !== 0)
      .map((p: any) => ({
        'Артикул': p.sku,
        'Название': p.name,
        'Категория': p.category ?? '',
        'Формат': p.format ?? '',
        'Страна': p.countryOfOrigin ?? '',
        'Ед. изм.': p.unit,
        'Остаток': num(p.stock),
        'Мин. остаток': num(p.minStock),
        'Цена продажи': p.salePrice == null ? '' : num(p.salePrice),
      }));

    const rollRows = rollItems
      .filter((p: any) => includeZero || num(p.stock) !== 0 || num(p.rollStock) !== 0)
      .map((p: any) => ({
        'Артикул': p.sku,
        'Название': p.name,
        'Формат': p.format ?? '',
        'Страна': p.countryOfOrigin ?? '',
        'Рулоны': num(p.rollStock),
        'Кг': num(p.stock),
        'Цена продажи': p.salePrice == null ? '' : num(p.salePrice),
      }));

    const wb = XLSX.utils.book_new();

    const plainHeader = ['Артикул', 'Название', 'Категория', 'Формат', 'Страна', 'Ед. изм.', 'Остаток', 'Мин. остаток', 'Цена продажи'];
    const wsPlain = XLSX.utils.json_to_sheet(plainRows, { header: plainHeader });
    wsPlain['!cols'] = [{ wch: 22 }, { wch: 46 }, { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsPlain, 'Остаток');

    const rollHeader = ['Артикул', 'Название', 'Формат', 'Страна', 'Рулоны', 'Кг', 'Цена продажи'];
    const wsRoll = XLSX.utils.json_to_sheet(rollRows, { header: rollHeader });
    wsRoll['!cols'] = [{ wch: 22 }, { wch: 46 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsRoll, 'Ламинационная пленка');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const today = new Date().toISOString().slice(0, 10);
    const filename = `Остаток_${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  }

  async getStockAsOf(req: Request, res: Response): Promise<void> {
    const rows = await warehouseService.getStockAsOf(String(req.query.date || ''));
    res.json(rows);
  }

  async findProductById(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.findProductById(req.params.id as string);
    res.json(product);
  }

  async uploadProductImage(req: Request, res: Response): Promise<void> {
    if (!req.file) throw new AppError(400, 'Файл не загружен');
    const previous = await warehouseService.findProductById(req.params.id as string);
    const imageUrl = await uploadImageToStorage(req.file, 'products');
    const product = await warehouseService.updateProduct(req.params.id as string, { imageUrl }, req.user!.userId as string);
    if (previous.imageUrl && previous.imageUrl !== imageUrl) {
      await deleteImageFromStorage(previous.imageUrl);
    }
    res.json({ imageUrl: product.imageUrl });
  }

  async uploadProductPhotos(req: Request, res: Response): Promise<void> {
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) throw new AppError(400, 'Файлы не загружены');
    const urls = await Promise.all(files.map((f) => uploadImageToStorage(f, 'products/posters')));
    const photos = await warehouseService.addProductPhotos(req.params.id as string, urls);
    res.status(201).json(photos);
  }

  async deleteProductPhoto(req: Request, res: Response): Promise<void> {
    await warehouseService.deleteProductPhoto(req.params.id as string, req.params.photoId as string);
    res.json({ success: true });
  }

  async createProduct(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.createProduct(req.body, req.user!.userId as string, req.user!.companyId, req.user!.role as any);
    res.status(201).json(product);
  }

  async updateProduct(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.updateProduct(req.params.id as string, req.body, req.user!.userId as string);
    res.json(product);
  }

  async deleteProduct(req: Request, res: Response): Promise<void> {
    const result = await warehouseService.deleteProduct(req.params.id as string, req.user!.userId as string);
    res.json(result);
  }

  async correctStock(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.correctStock(req.params.id as string, req.body, req.user!.userId as string);
    res.json(product);
  }

  // Movements
  async createMovement(req: Request, res: Response): Promise<void> {
    const movement = await warehouseService.createMovement(req.body, req.user!.userId as string);
    res.status(201).json(movement);
  }

  async getMovements(req: Request, res: Response): Promise<void> {
    const movements = await warehouseService.getMovements({
      productId: req.query.productId as string | undefined,
      type: req.query.type as 'IN' | 'OUT' | 'CORRECTION' | undefined,
      createdBy: req.query.createdBy as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      search: req.query.search as string | undefined,
    });
    res.json(movements);
  }

  async getProductMovements(req: Request, res: Response): Promise<void> {
    const movements = await warehouseService.getProductMovements(req.params.id as string);
    res.json(movements);
  }

  async getProductAnalytics(req: Request, res: Response): Promise<void> {
    const periodParam = req.query.period;
    const isAll =
      typeof periodParam === 'string' && periodParam.trim().toLowerCase() === 'all';
    const parsed = parseInt(String(req.query.periodDays ?? ''), 10);
    const period = isAll
      ? ('all' as const)
      : Number.isFinite(parsed) && parsed > 0
        ? parsed
        : 30;
    const g = req.query.granularity;
    const granularity =
      typeof g === 'string' && g.trim() ? g.trim() : undefined;
    const data = await warehouseService.getProductAnalytics(
      req.params.id as string,
      period,
      granularity,
    );
    res.json(data);
  }

  // Reservations
  async createReservation(req: Request, res: Response): Promise<void> {
    const reservation = await warehouseService.createReservation(req.body, req.user!.userId as string);
    res.status(201).json(reservation);
  }

  async listReservations(req: Request, res: Response): Promise<void> {
    const reservations = await warehouseService.listReservations({
      productId: req.query.productId as string | undefined,
      clientId: req.query.clientId as string | undefined,
      status: req.query.status as 'ACTIVE' | 'CANCELLED' | 'FULFILLED' | 'EXPIRED' | undefined,
    });
    res.json(reservations);
  }

  async getProductReservations(req: Request, res: Response): Promise<void> {
    const reservations = await warehouseService.getProductReservations(req.params.id as string);
    res.json(reservations);
  }

  async cancelReservation(req: Request, res: Response): Promise<void> {
    const reservation = await warehouseService.cancelReservation(req.params.id as string, req.user!.userId as string);
    res.json(reservation);
  }

  async fulfillReservation(req: Request, res: Response): Promise<void> {
    const reservation = await warehouseService.fulfillReservation(req.params.id as string, req.user!.userId as string);
    res.json(reservation);
  }

  async importProductsFromExcel(req: Request, res: Response): Promise<void> {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    const result = await warehouseService.importProductsFromExcel(
      file.buffer,
      req.user!.userId as string,
    );

    res.json(result);
  }

}

export const warehouseController = new WarehouseController();
