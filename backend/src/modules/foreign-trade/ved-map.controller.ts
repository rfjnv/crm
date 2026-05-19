import { Request, Response } from 'express';
import { vedMapService } from './ved-map.service';

export class VedMapController {
  async listSites(req: Request, res: Response): Promise<void> {
    const supplierId = (req.query.supplierId as string | undefined)?.trim() || undefined;
    const siteType = (req.query.siteType as string | undefined)?.trim() || undefined;
    const includeArchivedSuppliers = req.query.includeArchivedSuppliers === 'true';
    const sites = await vedMapService.listSites({ supplierId, siteType, includeArchivedSuppliers });
    res.json(sites);
  }

  async createSite(req: Request, res: Response): Promise<void> {
    const site = await vedMapService.createSite(req.body);
    res.status(201).json(site);
  }

  async updateSite(req: Request, res: Response): Promise<void> {
    const site = await vedMapService.updateSite(req.params.id as string, req.body);
    res.json(site);
  }

  async deleteSite(req: Request, res: Response): Promise<void> {
    await vedMapService.deleteSite(req.params.id as string);
    res.status(204).send();
  }

  async listRoutes(req: Request, res: Response): Promise<void> {
    const supplierId = (req.query.supplierId as string | undefined)?.trim() || undefined;
    const routes = await vedMapService.listRoutes({ supplierId });
    res.json(routes);
  }

  async createRoute(req: Request, res: Response): Promise<void> {
    const route = await vedMapService.createRoute(req.body, req.user!.userId);
    res.status(201).json(route);
  }

  async updateRoute(req: Request, res: Response): Promise<void> {
    const route = await vedMapService.updateRoute(req.params.id as string, req.body);
    res.json(route);
  }

  async deleteRoute(req: Request, res: Response): Promise<void> {
    await vedMapService.deleteRoute(req.params.id as string);
    res.status(204).send();
  }
}

export const vedMapController = new VedMapController();
