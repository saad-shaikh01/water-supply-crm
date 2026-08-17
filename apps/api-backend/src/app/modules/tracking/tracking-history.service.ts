import { Injectable } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import { TRACKING_CONFIG } from './tracking.config';
import { localDayStart, addDays, parseLocalDateOnly } from '../../common/helpers/date.util';
import { analyzeRoute, matchStopsToDeliveries, type MatchedStop } from './route-analysis.util';

export interface RouteHistoryPoint {
  latitude: number;
  longitude: number;
  speed: number | null;
  bearing: number | null;
  recordedAt: string;
}

export interface RouteHistoryStop {
  id: string | null; // null when computed live (day not yet persisted by the nightly job)
  latitude: number;
  longitude: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  stopType: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedDeliveryItemId: string | null;
}

export interface RouteHistoryDelivery {
  id: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  latitude: number;
  longitude: number;
  deliveredAt: string;
  status: string;
}

export interface RouteHistorySummary {
  startedAt: string | null;
  endedAt: string | null;
  totalDistanceMeters: number;
  movingDurationSeconds: number;
  stopDurationSeconds: number;
  stopsCount: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  pointsCount: number;
  /** true once the nightly job has permanently persisted this day; false = computed live from raw breadcrumbs (today, or a day the job hasn't reached yet) and may shift slightly on a later look. */
  isFinal: boolean;
}

export interface RouteHistoryResponse {
  driver: { id: string; name: string };
  date: string;
  /** false once raw breadcrumbs for this day have aged past the retention window — polyline can't be redrawn, but stops/summary (permanent) still are. */
  pointsAvailable: boolean;
  points: RouteHistoryPoint[];
  stops: RouteHistoryStop[];
  deliveries: RouteHistoryDelivery[];
  summary: RouteHistorySummary | null;
}

@Injectable()
export class TrackingHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async getDriverRouteHistory(
    vendorId: string,
    driverId: string,
    dateStr: string,
  ): Promise<RouteHistoryResponse | null> {
    const driver = await this.prisma.user.findFirst({
      where: { id: driverId, vendorId },
      select: { id: true, name: true },
    });
    if (!driver) return null;

    const day = parseLocalDateOnly(dateStr);
    const dayEnd = addDays(day, 1);
    const todayStart = localDayStart(new Date());
    const retentionCutoff = addDays(todayStart, -TRACKING_CONFIG.breadcrumbRetentionDays);
    const pointsAvailable = day >= retentionCutoff;

    const rawPoints = pointsAvailable
      ? await this.prisma.driverLocationHistory.findMany({
          where: { driverId, vendorId, recordedAt: { gte: day, lt: dayEnd } },
          orderBy: { recordedAt: 'asc' },
          select: { latitude: true, longitude: true, speed: true, bearing: true, recordedAt: true },
        })
      : [];

    const [persistedSummary, persistedStops] = await Promise.all([
      this.prisma.driverRouteSummary.findUnique({ where: { driverId_date: { driverId, date: day } } }),
      this.prisma.driverStop.findMany({ where: { driverId, date: day }, orderBy: { startedAt: 'asc' } }),
    ]);

    let summary: RouteHistorySummary | null = null;
    let stops: RouteHistoryStop[] = [];

    if (persistedSummary) {
      summary = {
        startedAt: persistedSummary.startedAt?.toISOString() ?? null,
        endedAt: persistedSummary.endedAt?.toISOString() ?? null,
        totalDistanceMeters: persistedSummary.totalDistanceMeters,
        movingDurationSeconds: persistedSummary.movingDurationSeconds,
        stopDurationSeconds: persistedSummary.stopDurationSeconds,
        stopsCount: persistedSummary.stopsCount,
        avgSpeedKmh: persistedSummary.avgSpeedKmh,
        maxSpeedKmh: persistedSummary.maxSpeedKmh,
        pointsCount: persistedSummary.pointsCount,
        isFinal: true,
      };
      stops = persistedStops.map((s) => ({
        id: s.id,
        latitude: s.latitude,
        longitude: s.longitude,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt.toISOString(),
        durationSeconds: s.durationSeconds,
        stopType: s.stopType,
        matchedCustomerId: s.matchedCustomerId,
        matchedCustomerName: s.matchedCustomerName,
        matchedDeliveryItemId: s.matchedDeliveryItemId,
      }));
    } else if (rawPoints.length) {
      // Day not yet processed by the nightly job (typically "today", or a
      // recent day the job hasn't reached) — compute live from raw
      // breadcrumbs. Not persisted here; the nightly job remains the single
      // writer for permanent history, so this never races/duplicates it.
      const stats = analyzeRoute(rawPoints);
      if (stats) {
        const matched: MatchedStop[] = await matchStopsToDeliveries(this.prisma, vendorId, driverId, day, stats.stops);
        summary = {
          startedAt: stats.startedAt.toISOString(),
          endedAt: stats.endedAt.toISOString(),
          totalDistanceMeters: stats.totalDistanceMeters,
          movingDurationSeconds: stats.movingDurationSeconds,
          stopDurationSeconds: stats.stopDurationSeconds,
          stopsCount: stats.stopsCount,
          avgSpeedKmh: stats.avgSpeedKmh,
          maxSpeedKmh: stats.maxSpeedKmh,
          pointsCount: stats.pointsCount,
          isFinal: false,
        };
        stops = matched.map((s) => ({
          id: null,
          latitude: s.latitude,
          longitude: s.longitude,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt.toISOString(),
          durationSeconds: s.durationSeconds,
          stopType: s.stopType,
          matchedCustomerId: s.matchedCustomerId,
          matchedCustomerName: s.matchedCustomerName,
          matchedDeliveryItemId: s.matchedDeliveryItemId,
        }));
      }
    }

    const deliveryItems = await this.prisma.dailySheetItem.findMany({
      where: {
        dailySheet: { driverId, vendorId, date: { gte: day, lt: dayEnd } },
        deliveredAt: { not: null },
      },
      orderBy: { deliveredAt: 'asc' },
      select: {
        id: true,
        deliveredAt: true,
        status: true,
        customer: { select: { id: true, name: true, customerCode: true, latitude: true, longitude: true } },
      },
    });

    const deliveries: RouteHistoryDelivery[] = deliveryItems
      .filter((item) => item.customer.latitude != null && item.customer.longitude != null && item.deliveredAt)
      .map((item) => ({
        id: item.id,
        customerId: item.customer.id,
        customerName: item.customer.name,
        customerCode: item.customer.customerCode,
        latitude: item.customer.latitude as number,
        longitude: item.customer.longitude as number,
        deliveredAt: (item.deliveredAt as Date).toISOString(),
        status: item.status,
      }));

    return {
      driver,
      date: dateStr,
      pointsAvailable,
      points: rawPoints.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        speed: p.speed,
        bearing: p.bearing,
        recordedAt: p.recordedAt.toISOString(),
      })),
      stops,
      deliveries,
      summary,
    };
  }
}
