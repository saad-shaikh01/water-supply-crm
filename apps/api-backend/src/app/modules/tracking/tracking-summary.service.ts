import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { TRACKING_CONFIG } from './tracking.config';
import { localDayStart, addDays } from '../../common/helpers/date.util';
import { analyzeRoute, matchStopsToDeliveries } from './route-analysis.util';

interface DriverBreadcrumbRow {
  driverId: string;
  vanId: string | null;
  dailySheetId: string | null;
  latitude: number;
  longitude: number;
  speed: number | null;
  recordedAt: Date;
}

/**
 * Nightly job: turns that day's throttled GPS breadcrumbs into permanent,
 * queryable history — a route-distance/duration summary plus a list of
 * detected stops (with duration, and matched to a delivery when one lines
 * up in time + space). Runs BEFORE the breadcrumb-cleanup job purges the
 * raw points it read (see tracking-scheduler cron times).
 *
 * Idempotent: DriverRouteSummary's @@unique([driverId, date]) is the
 * "already processed" marker — completed days that already have a summary
 * are skipped, so a nightly re-run (or the next run picking up a day the
 * previous run missed) never double-counts.
 */
@Injectable()
export class TrackingSummaryService {
  private readonly logger = new Logger(TrackingSummaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async summarizeAllVendors(): Promise<void> {
    const vendors = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { id: true } });
    let succeeded = 0;
    let failed = 0;
    for (const vendor of vendors) {
      try {
        const result = await this.summarizeVendor(vendor.id);
        succeeded += result.processed;
      } catch (err) {
        failed++;
        this.logger.error(`Tracking summary failed for vendor ${vendor.id}`, (err as Error)?.stack);
      }
    }
    this.logger.log(`Tracking daily summary complete: ${succeeded} driver-day(s) processed, ${failed} vendor(s) failed`);
  }

  /** Summarizes every completed (non-today), not-yet-summarized driver-day within the retention window for one vendor. */
  async summarizeVendor(vendorId: string): Promise<{ processed: number }> {
    const todayStart = localDayStart(new Date());
    const cutoff = addDays(todayStart, -TRACKING_CONFIG.breadcrumbRetentionDays);

    const points = await this.prisma.driverLocationHistory.findMany({
      where: { vendorId, recordedAt: { gte: cutoff, lt: todayStart } },
      orderBy: [{ driverId: 'asc' }, { recordedAt: 'asc' }],
      select: { driverId: true, vanId: true, dailySheetId: true, latitude: true, longitude: true, speed: true, recordedAt: true },
    });
    if (!points.length) return { processed: 0 };

    // Bucket by driverId + local calendar day
    const buckets = new Map<string, typeof points>();
    for (const p of points) {
      const day = localDayStart(p.recordedAt);
      const key = `${p.driverId}|${day.toISOString()}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(p);
      else buckets.set(key, [p]);
    }

    let processed = 0;
    for (const [key, bucketPoints] of buckets) {
      const [driverId, dayIso] = key.split('|');
      const day = new Date(dayIso);

      const existing = await this.prisma.driverRouteSummary.findUnique({
        where: { driverId_date: { driverId, date: day } },
        select: { id: true },
      });
      if (existing) continue; // already summarized — raw breadcrumbs may already be gone by the time this runs again

      await this.summarizeDriverDay(vendorId, driverId, day, bucketPoints);
      processed++;
    }

    return { processed };
  }

  private async summarizeDriverDay(
    vendorId: string,
    driverId: string,
    day: Date,
    points: DriverBreadcrumbRow[],
  ): Promise<void> {
    const last = points[points.length - 1];
    const stats = analyzeRoute(points);
    if (!stats) return;

    const matchedStops = await matchStopsToDeliveries(this.prisma, vendorId, driverId, day, stats.stops);

    const stopRows = matchedStops.map((stop) => ({
      vendorId,
      driverId,
      vanId: last.vanId,
      dailySheetId: last.dailySheetId,
      date: day,
      latitude: stop.latitude,
      longitude: stop.longitude,
      startedAt: stop.startedAt,
      endedAt: stop.endedAt,
      durationSeconds: stop.durationSeconds,
      stopType: stop.stopType,
      matchedCustomerId: stop.matchedCustomerId,
      matchedCustomerName: stop.matchedCustomerName,
      matchedDeliveryItemId: stop.matchedDeliveryItemId,
    }));

    await this.prisma.$transaction([
      // Idempotent overwrite — safe if this driver-day is ever manually reprocessed.
      this.prisma.driverStop.deleteMany({ where: { driverId, date: day } }),
      ...(stopRows.length ? [this.prisma.driverStop.createMany({ data: stopRows })] : []),
      this.prisma.driverRouteSummary.upsert({
        where: { driverId_date: { driverId, date: day } },
        create: {
          vendorId,
          driverId,
          vanId: last.vanId,
          dailySheetId: last.dailySheetId,
          date: day,
          startedAt: stats.startedAt,
          endedAt: stats.endedAt,
          totalDistanceMeters: stats.totalDistanceMeters,
          movingDurationSeconds: stats.movingDurationSeconds,
          stopDurationSeconds: stats.stopDurationSeconds,
          stopsCount: stats.stopsCount,
          avgSpeedKmh: stats.avgSpeedKmh,
          maxSpeedKmh: stats.maxSpeedKmh,
          pointsCount: stats.pointsCount,
        },
        update: {
          vanId: last.vanId,
          dailySheetId: last.dailySheetId,
          startedAt: stats.startedAt,
          endedAt: stats.endedAt,
          totalDistanceMeters: stats.totalDistanceMeters,
          movingDurationSeconds: stats.movingDurationSeconds,
          stopDurationSeconds: stats.stopDurationSeconds,
          stopsCount: stats.stopsCount,
          avgSpeedKmh: stats.avgSpeedKmh,
          maxSpeedKmh: stats.maxSpeedKmh,
          pointsCount: stats.pointsCount,
        },
      }),
    ]);
  }
}
