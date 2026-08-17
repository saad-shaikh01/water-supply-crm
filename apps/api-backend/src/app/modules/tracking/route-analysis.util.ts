import type { PrismaService } from '@water-supply-crm/database';
import { TRACKING_CONFIG } from './tracking.config';
import { haversineMeters } from '../../common/helpers/geo.util';
import { addDays } from '../../common/helpers/date.util';

/**
 * Pure route-geometry analysis shared by both the nightly persist path
 * (tracking-summary.service.ts) and the on-demand read path
 * (tracking-history.service.ts, for "today" or any day the nightly job
 * hasn't summarized yet) — one algorithm, two callers, never duplicated.
 */

export interface BreadcrumbPoint {
  latitude: number;
  longitude: number;
  speed?: number | null;
  recordedAt: Date;
}

export interface DetectedStop {
  latitude: number;
  longitude: number;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
}

export interface RouteStats {
  totalDistanceMeters: number;
  movingDurationSeconds: number;
  stopDurationSeconds: number;
  stopsCount: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  startedAt: Date;
  endedAt: Date;
  pointsCount: number;
  stops: DetectedStop[];
}

export interface MatchedStop extends DetectedStop {
  stopType: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  matchedDeliveryItemId: string | null;
}

/**
 * Classic stay-point extraction: for each point i, extend a window forward
 * while every point stays within stopRadiusMeters of point i. If the window
 * spans at least stopMinDurationSeconds, it's a stop (centroid = mean of the
 * window); scanning resumes after the window. Otherwise slide forward by one.
 */
export function detectStops(points: BreadcrumbPoint[]): DetectedStop[] {
  const stops: DetectedStop[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    while (
      j < points.length &&
      haversineMeters(points[i].latitude, points[i].longitude, points[j].latitude, points[j].longitude) <=
        TRACKING_CONFIG.stopRadiusMeters
    ) {
      j++;
    }
    const windowEnd = j - 1; // last index still within radius of i
    const durationSeconds = (points[windowEnd].recordedAt.getTime() - points[i].recordedAt.getTime()) / 1000;

    if (windowEnd > i && durationSeconds >= TRACKING_CONFIG.stopMinDurationSeconds) {
      const window = points.slice(i, windowEnd + 1);
      stops.push({
        latitude: window.reduce((s, p) => s + p.latitude, 0) / window.length,
        longitude: window.reduce((s, p) => s + p.longitude, 0) / window.length,
        startedAt: points[i].recordedAt,
        endedAt: points[windowEnd].recordedAt,
        durationSeconds: Math.round(durationSeconds),
      });
      i = windowEnd + 1;
    } else {
      i++;
    }
  }
  return stops;
}

export function analyzeRoute(points: BreadcrumbPoint[]): RouteStats | null {
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];

  let totalDistanceMeters = 0;
  let maxSpeedKmh: number | null = null;
  for (let i = 1; i < points.length; i++) {
    totalDistanceMeters += haversineMeters(
      points[i - 1].latitude, points[i - 1].longitude,
      points[i].latitude, points[i].longitude,
    );
  }
  for (const p of points) {
    if (p.speed != null && (maxSpeedKmh == null || p.speed > maxSpeedKmh)) maxSpeedKmh = p.speed;
  }

  const stops = detectStops(points);
  const stopDurationSeconds = stops.reduce((sum, s) => sum + s.durationSeconds, 0);
  const daySpanSeconds = Math.max(0, (last.recordedAt.getTime() - first.recordedAt.getTime()) / 1000);
  const movingDurationSeconds = Math.max(0, Math.round(daySpanSeconds - stopDurationSeconds));
  const avgSpeedKmh = movingDurationSeconds > 0 ? (totalDistanceMeters / 1000) / (movingDurationSeconds / 3600) : null;

  return {
    totalDistanceMeters,
    movingDurationSeconds,
    stopDurationSeconds: Math.round(stopDurationSeconds),
    stopsCount: stops.length,
    avgSpeedKmh,
    maxSpeedKmh,
    startedAt: first.recordedAt,
    endedAt: last.recordedAt,
    pointsCount: points.length,
    stops,
  };
}

/**
 * Matches each detected stop to the nearest completed delivery (DailySheetItem)
 * that lines up in both time (±deliveryMatchWindowSeconds) and space
 * (≤deliveryMatchRadiusMeters), if any. Each delivery is used at most once.
 */
export async function matchStopsToDeliveries(
  prisma: PrismaService,
  vendorId: string,
  driverId: string,
  day: Date,
  stops: DetectedStop[],
): Promise<MatchedStop[]> {
  if (!stops.length) return [];

  const dayEnd = addDays(day, 1);
  const deliveries = await prisma.dailySheetItem.findMany({
    where: {
      dailySheet: { driverId, vendorId, date: { gte: day, lt: dayEnd } },
      deliveredAt: { not: null },
    },
    select: {
      id: true,
      deliveredAt: true,
      customer: { select: { id: true, name: true, customerCode: true, latitude: true, longitude: true } },
    },
  });

  const usedDeliveryIds = new Set<string>();
  const matchWindowMs = TRACKING_CONFIG.deliveryMatchWindowSeconds * 1000;

  return stops.map((stop) => {
    let best: { id: string; distance: number; name: string; customerId: string } | null = null;
    for (const item of deliveries) {
      if (usedDeliveryIds.has(item.id)) continue;
      if (item.customer.latitude == null || item.customer.longitude == null || !item.deliveredAt) continue;
      const delivered = item.deliveredAt.getTime();
      if (delivered < stop.startedAt.getTime() - matchWindowMs || delivered > stop.endedAt.getTime() + matchWindowMs) continue;
      const distance = haversineMeters(stop.latitude, stop.longitude, item.customer.latitude, item.customer.longitude);
      if (distance > TRACKING_CONFIG.deliveryMatchRadiusMeters) continue;
      if (!best || distance < best.distance) {
        best = { id: item.id, distance, name: `${item.customer.name} (${item.customer.customerCode})`, customerId: item.customer.id };
      }
    }
    if (best) usedDeliveryIds.add(best.id);

    return {
      ...stop,
      stopType: best ? 'DELIVERY' : 'UNKNOWN',
      matchedCustomerId: best?.customerId ?? null,
      matchedCustomerName: best?.name ?? null,
      matchedDeliveryItemId: best?.id ?? null,
    };
  });
}
