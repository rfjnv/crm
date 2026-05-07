import prisma from '../../lib/prisma';
import type { CreateWorkerReviewDto, UpdateWorkerReviewDto } from './worker-reviews.dto';

const reviewerSelect = { id: true, fullName: true, role: true };
const managerSelect  = { id: true, fullName: true, role: true };

export const workerReviewsService = {
  async findAll(managerId?: string, period?: string) {
    return prisma.workerReview.findMany({
      where: {
        ...(managerId ? { managerId } : {}),
        ...(period    ? { period }    : {}),
      },
      include: {
        manager:  { select: managerSelect },
        reviewer: { select: reviewerSelect },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findSummaries() {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true, fullName: true, role: true,
        reviewsReceived: {
          select: {
            id: true, rating: true, comment: true,
            period: true, createdAt: true,
            reviewer: { select: reviewerSelect },
          },
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
        avgRating: avg != null ? Math.round(avg * 10) / 10 : null,
        reviewCount: reviews.length,
        latestReview: reviews[0] ?? null,
        reviews,
      };
    });
  },

  async getAnalytics() {
    const summaries = await this.findSummaries();

    const today     = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    // Rank active workers by avg rating
    const ranked = [...summaries]
      .filter(s => s.reviewCount > 0)
      .sort((a, b) => (b.avgRating ?? 0) - (a.avgRating ?? 0));

    const teamAvg = ranked.length
      ? Math.round(ranked.reduce((s, w) => s + (w.avgRating ?? 0), 0) / ranked.length * 10) / 10
      : 0;

    const totalReviews = summaries.reduce((s, w) => s + w.reviewCount, 0);

    // Enrich each worker
    const workers = summaries.map(w => {
      const reviews = w.reviews;
      const rank = ranked.findIndex(r => r.id === w.id);

      // Sparkline: last 10 reviews, chronological
      const sparkline = reviews
        .slice(0, 10)
        .reverse()
        .map((r: { period: string; rating: number }) => ({ date: r.period, rating: r.rating }));

      // Trend: avg last 3 vs prev 3
      type ReviewLike = { rating: number };
      const last3 = reviews.slice(0, 3) as ReviewLike[];
      const prev3 = reviews.slice(3, 6) as ReviewLike[];
      let trend: 'rising' | 'falling' | 'stable' | 'new' | null = null;
      let trendDelta = 0;
      if (reviews.length === 0) {
        trend = null;
      } else if (reviews.length < 3) {
        trend = 'new';
      } else if (prev3.length > 0) {
        const avgLast = last3.reduce((s, r) => s + r.rating, 0) / last3.length;
        const avgPrev = prev3.reduce((s, r) => s + r.rating, 0) / prev3.length;
        trendDelta = Math.round((avgLast - avgPrev) * 10) / 10;
        trend = trendDelta > 0.2 ? 'rising' : trendDelta < -0.2 ? 'falling' : 'stable';
      } else {
        trend = 'stable';
      }

      // Badge priority
      let badge: string | null = null;
      const latestPeriod = (reviews[0] as { period: string } | undefined)?.period;
      const latestRating = (reviews[0] as { rating: number } | undefined)?.rating ?? 0;
      if (rank === 0 && w.reviewCount > 0)                              badge = 'leader';
      else if (latestPeriod === today     && latestRating === 5)         badge = 'peak_today';
      else if (latestPeriod === yesterday && latestRating >= 4)          badge = 'peak_yesterday';
      else if (trend === 'rising')                                        badge = 'rising';
      else if (trend === 'falling')                                       badge = 'falling';
      else if (trend === 'stable' && w.reviewCount >= 5)                 badge = 'stable';

      return {
        ...w,
        rank: rank >= 0 ? rank + 1 : null,
        sparkline,
        trend,
        trendDelta,
        badge,
      };
    });

    // Chart data: all reviews → grouped by date + worker name
    const allReviews = await prisma.workerReview.findMany({
      include: { manager: { select: { id: true, fullName: true } } },
      orderBy: { period: 'asc' },
    });

    type DateWorkerMap = Map<string, Map<string, number[]>>;
    const dateMap: DateWorkerMap = new Map();
    for (const r of allReviews) {
      if (!dateMap.has(r.period)) dateMap.set(r.period, new Map());
      const wMap = dateMap.get(r.period)!;
      if (!wMap.has(r.manager.fullName)) wMap.set(r.manager.fullName, []);
      wMap.get(r.manager.fullName)!.push(r.rating);
    }

    const chartData: { date: string; worker: string; rating: number }[] = [];
    for (const [date, wMap] of dateMap) {
      for (const [worker, ratings] of wMap) {
        chartData.push({
          date,
          worker,
          rating: Math.round(ratings.reduce((s, v) => s + v, 0) / ratings.length * 10) / 10,
        });
      }
    }

    return {
      workers,
      teamAvg,
      topWorker: ranked[0] ?? null,
      totalReviews,
      chartData,
    };
  },

  async create(reviewerId: string, dto: CreateWorkerReviewDto) {
    return prisma.workerReview.create({
      data: {
        managerId:  dto.managerId,
        reviewerId,
        rating:     dto.rating,
        comment:    dto.comment ?? null,
        period:     dto.period,
      },
      include: {
        manager:  { select: managerSelect },
        reviewer: { select: reviewerSelect },
      },
    });
  },

  async update(id: string, dto: UpdateWorkerReviewDto) {
    return prisma.workerReview.update({
      where: { id },
      data: {
        ...(dto.rating  !== undefined ? { rating:  dto.rating  } : {}),
        ...(dto.comment !== undefined ? { comment: dto.comment } : {}),
      },
      include: {
        manager:  { select: managerSelect },
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
