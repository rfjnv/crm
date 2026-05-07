import prisma from '../../lib/prisma';
import type { CreateWorkerReviewDto, UpdateWorkerReviewDto } from './worker-reviews.dto';

const reviewerSelect = { id: true, fullName: true, role: true };
const managerSelect = { id: true, fullName: true, role: true };

export const workerReviewsService = {
  async findAll(managerId?: string, period?: string) {
    return prisma.workerReview.findMany({
      where: {
        ...(managerId ? { managerId } : {}),
        ...(period ? { period } : {}),
      },
      include: {
        manager: { select: managerSelect },
        reviewer: { select: reviewerSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findSummaries() {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        role: true,
        reviewsReceived: {
          select: { id: true, rating: true, comment: true, period: true, createdAt: true,
            reviewer: { select: reviewerSelect } },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    return users.map((u: typeof users[number]) => {
      const reviews = u.reviewsReceived;
      const avg = reviews.length
        ? reviews.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / reviews.length
        : null;
      return {
        id: u.id,
        fullName: u.fullName,
        role: u.role,
        avgRating: avg ? Math.round(avg * 10) / 10 : null,
        reviewCount: reviews.length,
        latestReview: reviews[0] ?? null,
        reviews,
      };
    });
  },

  async create(reviewerId: string, dto: CreateWorkerReviewDto) {
    return prisma.workerReview.create({
      data: {
        managerId: dto.managerId,
        reviewerId,
        rating: dto.rating,
        comment: dto.comment ?? null,
        period: dto.period,
      },
      include: {
        manager: { select: managerSelect },
        reviewer: { select: reviewerSelect },
      },
    });
  },

  async update(id: string, dto: UpdateWorkerReviewDto) {
    return prisma.workerReview.update({
      where: { id },
      data: {
        ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
      include: {
        manager: { select: managerSelect },
        reviewer: { select: reviewerSelect },
      },
    });
  },

  async delete(id: string) {
    return prisma.workerReview.delete({ where: { id } });
  },

  async findById(id: string) {
    return prisma.workerReview.findUnique({ where: { id } });
  },
};
