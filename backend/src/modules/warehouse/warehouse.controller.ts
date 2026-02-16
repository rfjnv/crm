import { Request, Response } from 'express';
import { warehouseService } from './warehouse.service';

export class WarehouseController {
  // Products
  async findAllProducts(_req: Request, res: Response): Promise<void> {
    const products = await warehouseService.findAllProducts();
    res.json(products);
  }

  async createProduct(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.createProduct(req.body, req.user!.userId as string);
    res.status(201).json(product);
  }

  async updateProduct(req: Request, res: Response): Promise<void> {
    const product = await warehouseService.updateProduct(req.params.id as string, req.body, req.user!.userId as string);
    res.json(product);
  }

  // Movements
  async createMovement(req: Request, res: Response): Promise<void> {
    const movement = await warehouseService.createMovement(req.body, req.user!.userId as string);
    res.status(201).json(movement);
  }

  async getMovements(req: Request, res: Response): Promise<void> {
    const productId = req.query.productId as string | undefined;
    const movements = await warehouseService.getMovements(productId);
    res.json(movements);
  }

  async getProductMovements(req: Request, res: Response): Promise<void> {
    const movements = await warehouseService.getProductMovements(req.params.id as string);
    res.json(movements);
  }

}

export const warehouseController = new WarehouseController();
