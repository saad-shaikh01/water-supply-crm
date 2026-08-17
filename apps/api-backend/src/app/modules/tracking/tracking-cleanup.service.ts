import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { TRACKING_CONFIG } from './tracking.config';

/**
 * Nightly retention purge for raw GPS breadcrumbs (DriverLocationHistory
 * only — DriverStop and DriverRouteSummary are permanent and untouched).
 * Runs AFTER tracking-summary.service.ts's sweep (see tracking-scheduler
 * cron times) so every completed day is turned into a permanent stop/summary
 * record before its raw trail is deleted.
 *
 * Retention window is TRACKING_CONFIG.breadcrumbRetentionDays — env-configurable
 * (TRACKING_BREADCRUMB_RETENTION_DAYS), not hardcoded.
 */
@Injectable()
export class TrackingCleanupService {
  private readonly logger = new Logger(TrackingCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeExpiredBreadcrumbs(): Promise<void> {
    const cutoff = new Date(Date.now() - TRACKING_CONFIG.breadcrumbRetentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.driverLocationHistory.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    this.logger.log(
      `Breadcrumb cleanup: purged ${result.count} row(s) older than ${TRACKING_CONFIG.breadcrumbRetentionDays} day(s) (cutoff ${cutoff.toISOString()})`,
    );
  }
}
