import { Request, Response } from 'express';
import { usersService } from './users.service';

export class UsersController {
  async findAll(_req: Request, res: Response): Promise<void> {
    const users = await usersService.findAll();
    res.json(users);
  }

  async create(req: Request, res: Response): Promise<void> {
    const user = await usersService.create(req.body, req.user!.userId as string);
    res.status(201).json(user);
  }

  async update(req: Request, res: Response): Promise<void> {
    const user = await usersService.update(req.params.id as string, req.body, req.user!.userId as string);
    res.json(user);
  }

  async deactivate(req: Request, res: Response): Promise<void> {
    const user = await usersService.deactivate(req.params.id as string, req.user!.userId as string);
    res.json(user);
  }

  async deleteUser(req: Request, res: Response): Promise<void> {
    const result = await usersService.deleteUser(req.params.id as string, req.user!.userId as string);
    res.json(result);
  }

  async activate(req: Request, res: Response): Promise<void> {
    const user = await usersService.activate(req.params.id as string, req.user!.userId as string);
    res.json(user);
  }
}

export const usersController = new UsersController();
