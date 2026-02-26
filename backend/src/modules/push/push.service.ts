import webpush from 'web-push';
import { Role } from '@prisma/client';
import prisma from '../../lib/prisma';
import { config } from '../../lib/config';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(
    config.vapid.subject,
    config.vapid.publicKey,
    config.vapid.privateKey,
  );
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  severity?: 'INFO' | 'WARNING' | 'URGENT';
}

export class PushService {
  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ) {
    return prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent || null,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent || null,
      },
    });
  }

  async unsubscribe(endpoint: string) {
    return prisma.pushSubscription.deleteMany({
      where: { endpoint },
    });
  }

  async sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!config.vapid.publicKey || !config.vapid.privateKey) return;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    const jsonPayload = JSON.stringify(payload);

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            jsonPayload,
            { TTL: 60 * 60 },
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            console.error(`Push failed for sub ${sub.id}:`, statusCode || (err as Error).message);
          }
        }
      }),
    );
  }

  async sendPushToRole(role: Role, payload: PushPayload): Promise<void> {
    if (!config.vapid.publicKey || !config.vapid.privateKey) return;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { user: { role, isActive: true } },
    });

    const jsonPayload = JSON.stringify(payload);

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            jsonPayload,
            { TTL: 60 * 60 },
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            console.error(`Push failed for sub ${sub.id}:`, statusCode || (err as Error).message);
          }
        }
      }),
    );
  }

  async sendPushToRoles(roles: Role[], payload: PushPayload): Promise<void> {
    if (!config.vapid.publicKey || !config.vapid.privateKey) return;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { user: { role: { in: roles }, isActive: true } },
    });

    const jsonPayload = JSON.stringify(payload);

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            jsonPayload,
            { TTL: 60 * 60 },
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410 || statusCode === 404) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          } else {
            console.error(`Push failed for sub ${sub.id}:`, statusCode || (err as Error).message);
          }
        }
      }),
    );
  }
}

export const pushService = new PushService();
