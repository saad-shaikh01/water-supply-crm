import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { VEHICLE_SERVICE_TYPE_LABELS, VEHICLE_DOCUMENT_TYPE_LABELS } from '@water-supply-crm/types';
import { InAppNotificationService } from '../notifications/in-app-notification.service';
import { NotificationService } from '../notifications/notification.service';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';

const DOCUMENT_EXPIRY_TYPE = 'VEHICLE_DOCUMENT_EXPIRY';
const MAINTENANCE_DUE_TYPE = 'VEHICLE_MAINTENANCE_DUE';
// Re-notify cadence — an unresolved overdue item stays actionable, not a one-shot
// alert, but shouldn't spam every single night either (plan doc §13).
const DOCUMENT_RENOTIFY_DAYS = 7;
const MAINTENANCE_RENOTIFY_DAYS = 3;

const SWEEP_CRON = '15 0 * * *'; // 00:15 AM, right after daily-sheet auto-generation
const SWEEP_TZ = 'Asia/Karachi';
const SWEEP_JOB_ID = 'fleet-notification-sweep';

/**
 * Nightly sweep — document expiry + maintenance due/overdue (plan doc §7.10/§13,
 * Phase 1 scope). Delivered via the existing InAppNotificationService + FCM,
 * exactly the pattern already used by daily-sheet.service.ts's edit-request
 * broadcast — no new notification transport. De-dup reuses InAppNotification
 * itself (skip if one for the same type+entityId was created within the
 * re-notify window) rather than adding new tracking schema. Scheduling follows
 * the house convention exactly (upsertJobScheduler, never add({repeat}) — see
 * daily-sheet.service.ts's own comment on why).
 */
@Injectable()
export class FleetNotificationService implements OnModuleInit {
  private readonly logger = new Logger(FleetNotificationService.name);

  constructor(
    private prisma: PrismaService,
    private inAppNotifications: InAppNotificationService,
    private notifications: NotificationService,
    private maintenance: VehicleMaintenanceService,
    @InjectQueue(QUEUE_NAMES.FLEET_NOTIFICATIONS)
    private fleetQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      await this.fleetQueue.upsertJobScheduler(
        SWEEP_JOB_ID,
        { pattern: SWEEP_CRON, tz: SWEEP_TZ },
        { name: JOB_NAMES.FLEET_NOTIFICATION_SWEEP, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      this.logger.log(`Fleet notification sweep scheduled (${SWEEP_CRON} ${SWEEP_TZ})`);
    } catch (err) {
      this.logger.error(
        `Failed to schedule fleet notification sweep: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  async sweepAllVendors(): Promise<void> {
    const vendors = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { id: true } });
    let succeeded = 0;
    let failed = 0;
    for (const vendor of vendors) {
      try {
        await this.sweepVendor(vendor.id);
        succeeded++;
      } catch (err) {
        failed++;
        this.logger.error(`Fleet notification sweep failed for vendor ${vendor.id}`, (err as Error)?.stack);
      }
    }
    this.logger.log(`Fleet notification sweep complete: ${succeeded} succeeded, ${failed} failed`);
  }

  async sweepVendor(vendorId: string): Promise<{ documentAlerts: number; maintenanceAlerts: number }> {
    const [documentAlerts, maintenanceAlerts] = await Promise.all([
      this.sweepDocumentExpiries(vendorId),
      this.sweepMaintenanceDue(vendorId),
    ]);
    return { documentAlerts, maintenanceAlerts };
  }

  private async sweepDocumentExpiries(vendorId: string): Promise<number> {
    const documents = await this.prisma.vehicleDocument.findMany({
      where: { vendorId, isActive: true, expiryDate: { not: null } },
      include: { vehicle: { select: { id: true, plateNumber: true } } },
    });

    const now = Date.now();
    let sent = 0;
    for (const doc of documents) {
      if (!doc.expiryDate) continue;
      const daysUntilExpiry = Math.floor((doc.expiryDate.getTime() - now) / (24 * 60 * 60 * 1000));
      if (daysUntilExpiry > doc.reminderDaysBefore) continue;

      const alreadyNotified = await this.recentlyNotified(vendorId, DOCUMENT_EXPIRY_TYPE, doc.id, DOCUMENT_RENOTIFY_DAYS);
      if (alreadyNotified) continue;

      const label = VEHICLE_DOCUMENT_TYPE_LABELS[doc.type];
      const title =
        daysUntilExpiry < 0
          ? `${label} EXPIRED — ${doc.vehicle.plateNumber}`
          : `${label} expiring soon — ${doc.vehicle.plateNumber}`;
      const message =
        daysUntilExpiry < 0
          ? `${label} for ${doc.vehicle.plateNumber} expired ${Math.abs(daysUntilExpiry)} day(s) ago.`
          : `${label} for ${doc.vehicle.plateNumber} expires in ${daysUntilExpiry} day(s).`;

      await this.notifyAdmins(vendorId, DOCUMENT_EXPIRY_TYPE, doc.id, title, message);
      sent++;
    }
    return sent;
  }

  private async sweepMaintenanceDue(vendorId: string): Promise<number> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, plateNumber: true },
    });

    let sent = 0;
    for (const vehicle of vehicles) {
      const statuses = await this.maintenance.getStatusForVehicle(vendorId, vehicle.id);
      for (const status of statuses) {
        if (status.urgency !== 'DUE' && status.urgency !== 'OVERDUE') continue;

        const entityId = `${vehicle.id}:${status.serviceType}`;
        const alreadyNotified = await this.recentlyNotified(
          vendorId,
          MAINTENANCE_DUE_TYPE,
          entityId,
          MAINTENANCE_RENOTIFY_DAYS,
        );
        if (alreadyNotified) continue;

        const label = VEHICLE_SERVICE_TYPE_LABELS[status.serviceType];
        const title = `${status.urgency === 'OVERDUE' ? 'Overdue' : 'Due soon'}: ${label} — ${vehicle.plateNumber}`;
        const message =
          status.kmRemaining != null && status.kmRemaining <= 0
            ? `${label} for ${vehicle.plateNumber} is overdue by ${Math.abs(status.kmRemaining)} km.`
            : status.daysRemaining != null && status.daysRemaining <= 0
              ? `${label} for ${vehicle.plateNumber} is overdue by ${Math.abs(status.daysRemaining)} day(s).`
              : `${label} for ${vehicle.plateNumber} is coming up soon.`;

        await this.notifyAdmins(vendorId, MAINTENANCE_DUE_TYPE, entityId, title, message);
        sent++;
      }
    }
    return sent;
  }

  private async recentlyNotified(
    vendorId: string,
    type: string,
    entityId: string,
    withinDays: number,
  ): Promise<boolean> {
    const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000);
    const existing = await this.prisma.inAppNotification.findFirst({
      where: { vendorId, type, entityId, createdAt: { gte: since } },
      select: { id: true },
    });
    return !!existing;
  }

  private async notifyAdmins(vendorId: string, type: string, entityId: string, title: string, message: string) {
    const adminUsers = await this.prisma.user.findMany({
      where: { vendorId, role: { in: ['VENDOR_ADMIN', 'STAFF'] }, isActive: true },
      select: { id: true },
    });

    await Promise.all(
      adminUsers.map(async (admin) => {
        await this.inAppNotifications.create({ userId: admin.id, vendorId, type, title, message, entityId });
        await this.notifications.queueFcm(admin.id, title, message, { type, entityId });
      }),
    );
  }
}
