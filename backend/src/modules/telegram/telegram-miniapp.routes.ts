import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { getFirstName } from '../../lib/name-utils';
import { rateLimiter } from '../../middleware/rateLimiter';
import { requireTelegramMiniAppUser } from './telegram-miniapp.auth';
import { telegramCustomerBotService } from './telegram.customer-bot.service';
import { telegramCustomerService } from './telegram.customer.service';
import { Lang, customerStatusLabel, t } from './telegram.customer-i18n';
import {
  CUSTOMER_MANAGER_FILTER,
  buildCustomerClientFilter,
  createCustomerOrder,
  formatOrderMoney,
  getBusinessHoursStatus,
  normalizeCustomerPhone,
  notifyManagerAboutOrder,
} from './telegram-order.service';

/**
 * API мини-аппы клиентского бота. Аутентификация — только по подписи Telegram initData,
 * никаких JWT: пользователь мини-аппы это Telegram-аккаунт, а не сотрудник CRM.
 */

const router = Router();

/** Псевдо-категория для товаров без category в базе. */
const NO_CATEGORY_KEY = '__none__';

const langOf = (raw: unknown): Lang => (raw === 'uz' ? 'uz' : 'ru');

/** Ярлык уже протух, если badgeUntil в прошлом — тогда товар считается без ярлыка. */
function activeBadge(badge: string | null, badgeUntil: Date | null): string | null {
  if (!badge) return null;
  if (badgeUntil && badgeUntil.getTime() < Date.now()) return null;
  return badge;
}

function productWhere(category?: string, search?: string) {
  const where: Record<string, unknown> = {
    isActive: true,
    salePrice: { not: null },
    // Нулевой остаток скрывает товар, но ярлык «скоро в наличии» возвращает его в витрину
    AND: [{
      OR: [
        { stock: { gt: 0 } },
        { badge: 'SOON', OR: [{ badgeUntil: null }, { badgeUntil: { gt: new Date() } }] },
      ],
    }],
  };

  if (category) {
    where.category = category === NO_CATEGORY_KEY ? null : category;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

router.use(requireTelegramMiniAppUser);

/** Стартовые данные: язык, часы работы, менеджеры, категории, известный профиль клиента. */
router.get('/bootstrap', async (req, res, next) => {
  try {
    const chatId = req.tgUser!.id;

    const [pref, managers, categoryRows, client] = await Promise.all([
      prisma.telegramCustomerPreference.findUnique({ where: { chatId: String(chatId) } }),
      prisma.user.findMany({
        where: CUSTOMER_MANAGER_FILTER,
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.product.groupBy({
        by: ['category'],
        where: productWhere(),
        _count: { _all: true },
      }),
      prisma.client.findFirst({
        where: { isArchived: false, ...buildCustomerClientFilter(null, chatId) },
        select: { companyName: true, contactName: true, phone: true, managerId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const lang = langOf(pref?.language ?? (req.tgUser!.languageCode === 'uz' ? 'uz' : 'ru'));

    // Обложка категории — первый товар с фото, чтобы плитки не были пустыми.
    const covers = await prisma.product.findMany({
      where: { ...productWhere(), imageUrl: { not: null } },
      select: { category: true, imageUrl: true },
      orderBy: { updatedAt: 'desc' },
    });
    const coverByCategory = new Map<string, string>();
    for (const row of covers) {
      const key = row.category ?? NO_CATEGORY_KEY;
      if (!coverByCategory.has(key) && row.imageUrl) coverByCategory.set(key, row.imageUrl);
    }

    const categories = categoryRows
      .map((row) => ({
        key: row.category ?? NO_CATEGORY_KEY,
        name: row.category ?? '',
        count: row._count._all,
        imageUrl: coverByCategory.get(row.category ?? NO_CATEGORY_KEY) ?? null,
      }))
      .sort((a, b) => a.key.localeCompare(b.key, 'ru'));

    res.json({
      lang,
      user: {
        firstName: req.tgUser!.firstName ?? null,
        username: req.tgUser!.username ?? null,
      },
      hours: getBusinessHoursStatus(),
      managers: managers.map((manager) => ({
        id: manager.id,
        name: getFirstName(manager.fullName),
        fullName: manager.fullName,
      })),
      categories,
      totalProducts: categoryRows.reduce((sum, row) => sum + row._count._all, 0),
      profile: client
        ? {
          name: client.contactName || client.companyName,
          phone: client.phone,
          managerId: client.managerId,
        }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

/** Каталог: витрина с фото, ценой и остатком. */
router.get('/products', async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' && req.query.category ? req.query.category : undefined;
    const search = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 60) : undefined;
    const limit = Math.min(Number(req.query.limit) || 24, 60);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = productWhere(category, search);

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          category: true,
          salePrice: true,
          stock: true,
          imageUrl: true,
          description: true,
          postTextRu: true,
          postTextUz: true,
          badge: true,
          badgeUntil: true,
        },
        orderBy: [{ imageUrl: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
        skip: offset,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    res.json({
      total,
      offset,
      limit,
      items: products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        category: product.category,
        price: Number(product.salePrice ?? 0),
        stock: Number(product.stock),
        badge: activeBadge(product.badge, product.badgeUntil),
        imageUrl: product.imageUrl,
        descriptionRu: product.description || product.postTextRu || null,
        descriptionUz: product.postTextUz || product.description || null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** История заказов клиента (по тегу чата или телефону). */
router.get('/orders', async (req, res, next) => {
  try {
    const chatId = req.tgUser!.id;
    const phone = typeof req.query.phone === 'string' ? normalizeCustomerPhone(req.query.phone) : null;
    const lang = langOf(req.query.lang);

    const deals = await prisma.deal.findMany({
      where: {
        isArchived: false,
        client: buildCustomerClientFilter(phone, chatId),
      },
      select: {
        id: true,
        title: true,
        amount: true,
        status: true,
        createdAt: true,
        manager: { select: { fullName: true } },
        items: {
          select: {
            requestedQty: true,
            price: true,
            product: { select: { name: true, unit: true, imageUrl: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({
      items: deals.map((deal) => ({
        id: deal.id,
        title: deal.title,
        amount: Number(deal.amount),
        status: deal.status,
        statusLabel: customerStatusLabel(lang, deal.status),
        createdAt: deal.createdAt,
        manager: deal.manager ? getFirstName(deal.manager.fullName) : null,
        items: deal.items.map((item) => ({
          name: item.product?.name ?? '',
          unit: item.product?.unit ?? '',
          imageUrl: item.product?.imageUrl ?? null,
          qty: Number(item.requestedQty ?? 0),
          price: Number(item.price ?? 0),
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

const createOrderSchema = z.object({
  managerId: z.string().uuid(),
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  comment: z.string().trim().max(500).optional().nullable(),
  lang: z.enum(['ru', 'uz']).optional(),
  items: z.array(z.object({
    productId: z.string().uuid(),
    qty: z.number().positive().finite(),
  })).min(1).max(40),
});

/** Оформление заказа из мини-аппы — та же сделка в CRM, что и из текстового бота. */
router.post('/orders', rateLimiter(60 * 1000, 6), async (req, res, next) => {
  try {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_ORDER');
    }

    const chatId = req.tgUser!.id;
    const lang = langOf(parsed.data.lang);
    const phone = normalizeCustomerPhone(parsed.data.phone);
    if (!phone) {
      res.status(400).json({ error: 'PHONE_INVALID', message: t(lang, 'checkout.phoneInvalid') });
      return;
    }

    const result = await createCustomerOrder({
      chatId,
      customerName: parsed.data.customerName,
      phone,
      managerId: parsed.data.managerId,
      items: parsed.data.items,
      comment: parsed.data.comment ?? null,
      source: 'miniapp',
    });

    if (!result.ok) {
      const messages: Record<string, string> = {
        CLOSED: t(lang, 'hours.closed', { reason: '' }).trim(),
        MANAGER_UNAVAILABLE: t(lang, 'manager.unavailable'),
        PRODUCT_UNAVAILABLE: t(lang, 'qty.productUnavailable'),
        EMPTY_CART: t(lang, 'checkout.missingData'),
        OUT_OF_STOCK: t(lang, 'checkout.missingData'),
      };

      if (result.reason === 'OUT_OF_STOCK') {
        messages.OUT_OF_STOCK = t(lang, 'qty.outOfStock', {
          name: result.product.name,
          stock: result.product.stock,
        });
      }

      res.status(409).json({
        error: result.reason,
        message: messages[result.reason],
        hours: result.reason === 'CLOSED' ? result.hours : undefined,
      });
      return;
    }

    const bot = telegramCustomerBotService.getBot();
    if (bot) {
      await notifyManagerAboutOrder(bot, result.manager, result.dealId, chatId, {
        customerName: parsed.data.customerName,
        phone,
        lines: result.lines,
        comment: parsed.data.comment ?? null,
      });

      // Дублируем подтверждение в чат: заказ должен остаться в переписке, а не только в мини-аппе.
      await bot.sendMessage(
        chatId,
        [
          `<b>${t(lang, 'checkout.success.title')}</b>`,
          '',
          t(lang, 'checkout.success.manager', { name: getFirstName(result.manager.fullName) }),
          t(lang, 'cart.total', { total: formatOrderMoney(result.totalAmount) }),
          t(lang, 'checkout.success.status', { status: customerStatusLabel(lang, 'NEW') }),
          t(lang, 'checkout.success.note'),
        ].join('\n'),
        { parse_mode: 'HTML' },
      ).catch(() => {});
    }

    res.json({
      ok: true,
      dealId: result.dealId,
      totalAmount: result.totalAmount,
      manager: getFirstName(result.manager.fullName),
      statusLabel: customerStatusLabel(lang, 'NEW'),
    });
  } catch (err) {
    next(err);
  }
});

/** Язык мини-аппы и бота — общий, чтобы клиент не переключал его дважды. */
router.post('/language', async (req, res, next) => {
  try {
    const lang = langOf(req.body?.lang);
    const chatId = String(req.tgUser!.id);
    await prisma.telegramCustomerPreference.upsert({
      where: { chatId },
      create: { chatId, language: lang },
      update: { language: lang },
    });
    telegramCustomerService.syncSessionLanguage(req.tgUser!.id, lang);
    res.json({ lang });
  } catch (err) {
    next(err);
  }
});

export default router;
