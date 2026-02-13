import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import * as admin from 'firebase-admin';

@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private enabled = false;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      this.logger.warn('FCM disabled — FIREBASE_* env vars not set');
      return;
    }

    // Avoid re-initializing if already initialized (e.g. hot-reload)
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    }

    this.enabled = true;
    this.logger.log('Firebase Admin SDK initialized');
  }

  async registerToken(userId: string, token: string, platform: string) {
    return this.prisma.fcmToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async deleteToken(token: string) {
    await this.prisma.fcmToken.deleteMany({ where: { token } });
    return { deleted: true };
  }

  async getTokensForUser(userId: string) {
    return this.prisma.fcmToken.findMany({ where: { userId } });
  }

  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.enabled) return { sent: 0, failed: 0 };

    const tokens = await this.prisma.fcmToken.findMany({ where: { userId } });
    let sent = 0;
    let failed = 0;

    for (const t of tokens) {
      try {
        await admin.messaging().send({
          token: t.token,
          notification: { title, body },
          data,
        });
        sent++;
      } catch (err: any) {
        failed++;
        if (err?.errorInfo?.code === 'messaging/registration-token-not-registered') {
          await this.prisma.fcmToken.deleteMany({ where: { token: t.token } });
          this.logger.debug(`Removed stale FCM token for user ${userId}`);
        } else {
          this.logger.warn(`FCM send failed for user ${userId}: ${err?.message}`);
        }
      }
    }

    return { sent, failed };
  }

  async sendToVendorUsers(
    vendorId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    if (!this.enabled) return { sent: 0, failed: 0 };

    const tokens = await this.prisma.fcmToken.findMany({
      where: { user: { vendorId } },
    });

    if (!tokens.length) return { sent: 0, failed: 0 };

    const tokenStrings = tokens.map((t) => t.token);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokenStrings,
      notification: { title, body },
      data,
    });

    // Clean up invalid tokens
    const staleTokens = response.responses
      .map((r, i) => (r.error?.code === 'messaging/registration-token-not-registered' ? tokenStrings[i] : null))
      .filter(Boolean) as string[];

    if (staleTokens.length) {
      await this.prisma.fcmToken.deleteMany({ where: { token: { in: staleTokens } } });
    }

    return { sent: response.successCount, failed: response.failureCount };
  }

  async sendToCustomer(
    customerId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ) {
    if (!this.enabled) return { sent: 0, failed: 0 };

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { userId: true },
    });

    if (!customer?.userId) return { sent: 0, failed: 0 };
    return this.sendToUser(customer.userId, title, body, data);
  }
}
