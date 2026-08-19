import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import Redis from 'ioredis';
import { PrismaService } from '@water-supply-crm/database';
import { UpdateLocationDto } from './dto/update-location.dto';
import { TRACKING_CONFIG } from './tracking.config';
import { haversineMeters } from '../../common/helpers/geo.util';

export interface DriverLocation {
  driverId: string;
  driverName: string;
  vendorId: string;
  vanId?: string;
  dailySheetId?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  bearing?: number;
  status?: string;
  updatedAt: string;
  /** Derived at read time — not stored */
  freshness?: 'LIVE' | 'STALE' | 'OFFLINE';
  /** Seconds since last update — derived at read time */
  lastSeenSeconds?: number;
}

/** Thresholds for freshness classification */
const FRESHNESS_LIVE_SECONDS = 60;       // < 60 s → LIVE
const FRESHNESS_STALE_SECONDS = 5 * 60; // 60–300 s → STALE, >300 s → OFFLINE

/**
 * Grace period for the "missing location" safety net. The live Redis key
 * (5 min TTL) can expire even while GPS is genuinely on — mobile browsers
 * throttle/suspend `watchPosition` + heartbeat timers once a tab is
 * backgrounded or the screen locks, so a short gap is normal, not a blind
 * trip. Only flag a driver once they've been silent (per DB last-known,
 * which the live key's expiry doesn't affect) longer than this window.
 */
const MISSING_LOCATION_GRACE_SECONDS = 15 * 60;

export interface LocationEvent {
  vendorId: string;
  data: DriverLocation;
}

const TRACKING_CHANNEL = 'tracking:location';
const LOCATION_KEY_PREFIX = 'tracking:driver:';
const LOCATION_TTL_SECONDS = 5 * 60; // 5 minutes — live stream only

/** Cache of the last *written* breadcrumb per driver — decides whether the next ping is worth persisting. Long TTL: a stale/expired entry just costs one extra breadcrumb, never incorrect data. */
const LAST_BREADCRUMB_KEY_PREFIX = 'tracking:breadcrumb:last:';
const LAST_BREADCRUMB_TTL_SECONDS = 24 * 60 * 60;

interface LastBreadcrumb {
  latitude: number;
  longitude: number;
  recordedAt: string;
}

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);

  /** Publisher client — used for SET/GET/SCAN/PUBLISH */
  private publisher: Redis;
  /** Dedicated subscriber client — must not issue regular Redis commands */
  private subscriber: Redis;

  /** Broadcasts incoming location events to all SSE subscribers on this instance */
  readonly locationEvents$ = new Subject<LocationEvent>();

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

    this.publisher = new Redis(redisUrl);
    this.subscriber = new Redis(redisUrl);

    this.subscriber.subscribe(TRACKING_CHANNEL, (err) => {
      if (err) {
        this.logger.error(`Redis subscribe error: ${err.message}`);
      } else {
        this.logger.log('Tracking: subscribed to Redis channel');
      }
    });

    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const event: LocationEvent = JSON.parse(message);
        this.locationEvents$.next(event);
      } catch {
        this.logger.warn('Tracking: failed to parse message');
      }
    });

    this.publisher.on('error', (e) => this.logger.error(`Tracking publisher error: ${e.message}`));
    this.subscriber.on('error', (e) => this.logger.error(`Tracking subscriber error: ${e.message}`));
  }

  async onModuleDestroy() {
    this.locationEvents$.complete();
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  /**
   * Driver pushes GPS location.
   * 1. Derives vanId/dailySheetId from the driver's open daily sheet (server-side).
   * 2. Upserts DB last-known record (persistent, survives Redis TTL expiry).
   * 3. Stores in Redis with TTL (live stream path — fast expiry for presence).
   * 4. Publishes to all instances via Redis Pub/Sub (SSE fanout).
   */
  async updateLocation(
    driverId: string,
    driverName: string,
    vendorId: string,
    dto: UpdateLocationDto,
    vanId?: string,
    dailySheetId?: string,
  ): Promise<void> {
    const now = new Date();
    const status = dto.status ?? 'ONLINE';

    // Server-side context derivation: find today's open sheet for this driver
    if (!vanId || !dailySheetId) {
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const activeSheet = await this.prisma.dailySheet.findFirst({
        where: { driverId, vendorId, isClosed: false, date: { gte: todayStart } },
        select: { id: true, vanId: true },
        orderBy: { date: 'desc' },
      });
      if (activeSheet) {
        vanId = vanId ?? activeSheet.vanId;
        dailySheetId = dailySheetId ?? activeSheet.id;
      }
    }

    const location: DriverLocation = {
      driverId,
      driverName,
      vendorId,
      vanId,
      dailySheetId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      speed: dto.speed,
      bearing: dto.bearing,
      status,
      updatedAt: now.toISOString(),
    };

    // ── 1. Persist to DB (upsert by driverId) ─────────────────────────────
    await this.prisma.driverLastLocation.upsert({
      where: { driverId },
      update: {
        vendorId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: dto.speed ?? null,
        bearing: dto.bearing ?? null,
        status,
        vanId: vanId ?? null,
        dailySheetId: dailySheetId ?? null,
        lastSeenAt: now,
      },
      create: {
        driverId,
        vendorId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: dto.speed ?? null,
        bearing: dto.bearing ?? null,
        status,
        vanId: vanId ?? null,
        dailySheetId: dailySheetId ?? null,
        lastSeenAt: now,
      },
    });

    // ── 2. Redis live stream (auto-expires, used for presence detection) ───
    await this.publisher.set(
      `${LOCATION_KEY_PREFIX}${driverId}`,
      JSON.stringify(location),
      'EX',
      LOCATION_TTL_SECONDS,
    );

    // ── 3. Pub/Sub fanout to all running instances ─────────────────────────
    const event: LocationEvent = { vendorId, data: location };
    await this.publisher.publish(TRACKING_CHANNEL, JSON.stringify(event));

    // ── 4. Throttled breadcrumb for history/playback (not every ping) ──────
    await this.maybeWriteBreadcrumb(driverId, vendorId, vanId, dailySheetId, dto, now);
  }

  /**
   * Persists a DriverLocationHistory row only when the driver has moved past
   * TRACKING_CONFIG.movementThresholdMeters since the last stored breadcrumb,
   * or TRACKING_CONFIG.heartbeatIntervalSeconds has elapsed with no movement
   * (so a stationary driver still leaves a "still here" trail for stop
   * detection). This keeps row growth to a small multiple of actual route
   * complexity instead of one row per ~8s GPS ping.
   */
  private async maybeWriteBreadcrumb(
    driverId: string,
    vendorId: string,
    vanId: string | undefined,
    dailySheetId: string | undefined,
    dto: UpdateLocationDto,
    now: Date,
  ): Promise<void> {
    const cacheKey = `${LAST_BREADCRUMB_KEY_PREFIX}${driverId}`;
    const cached = await this.publisher.get(cacheKey);

    if (cached) {
      try {
        const last: LastBreadcrumb = JSON.parse(cached);
        const distance = haversineMeters(last.latitude, last.longitude, dto.latitude, dto.longitude);
        const elapsedSeconds = (now.getTime() - new Date(last.recordedAt).getTime()) / 1000;
        if (
          distance < TRACKING_CONFIG.movementThresholdMeters &&
          elapsedSeconds < TRACKING_CONFIG.heartbeatIntervalSeconds
        ) {
          return; // too close in space and time — skip, live tracking already has the current fix
        }
      } catch {
        // corrupted cache entry — fall through and write a fresh breadcrumb
      }
    }

    await this.prisma.driverLocationHistory.create({
      data: {
        driverId,
        vendorId,
        vanId: vanId ?? null,
        dailySheetId: dailySheetId ?? null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: dto.speed ?? null,
        bearing: dto.bearing ?? null,
        recordedAt: now,
      },
    });

    const next: LastBreadcrumb = { latitude: dto.latitude, longitude: dto.longitude, recordedAt: now.toISOString() };
    await this.publisher.set(cacheKey, JSON.stringify(next), 'EX', LAST_BREADCRUMB_TTL_SECONDS);
  }

  /**
   * Explicitly mark driver offline (e.g. when daily sheet is closed).
   * Removes the Redis live key and signals dashboards to remove the marker.
   * Does NOT delete the DB record — last-known stays for audit/ops.
   */
  async removeDriver(driverId: string, vendorId: string): Promise<void> {
    await this.publisher.del(`${LOCATION_KEY_PREFIX}${driverId}`);

    const event: LocationEvent = {
      vendorId,
      data: {
        driverId,
        vendorId,
        driverName: '',
        latitude: 0,
        longitude: 0,
        status: 'offline',
        updatedAt: new Date().toISOString(),
      },
    };
    await this.publisher.publish(TRACKING_CHANNEL, JSON.stringify(event));
  }

  /**
   * Get a snapshot of all active drivers for a vendor.
   * Sources: Redis live keys (unexpired). Freshness metadata derived at read time.
   * Ordering: LIVE first, then STALE, then OFFLINE; within each group sorted by driverName.
   */
  async getActiveDrivers(vendorId: string): Promise<DriverLocation[]> {
    const keys = await this.scanKeys(`${LOCATION_KEY_PREFIX}*`);
    if (!keys.length) return [];

    const values = await this.publisher.mget(...keys);
    const result: DriverLocation[] = [];

    for (const val of values) {
      if (!val) continue;
      try {
        const loc: DriverLocation = JSON.parse(val);
        if (loc.vendorId === vendorId) result.push(this.addFreshness(loc));
      } catch {
        // skip corrupted entries
      }
    }

    // Deterministic ordering: LIVE → STALE → OFFLINE, then alphabetical within each group
    const freshnessOrder: Record<string, number> = { LIVE: 0, STALE: 1, OFFLINE: 2 };
    result.sort((a, b) => {
      const fa = freshnessOrder[a.freshness ?? 'OFFLINE'] ?? 2;
      const fb = freshnessOrder[b.freshness ?? 'OFFLINE'] ?? 2;
      if (fa !== fb) return fa - fb;
      return (a.driverName ?? '').localeCompare(b.driverName ?? '');
    });

    return result;
  }

  /**
   * Get the last known location for a single driver from Redis.
   * Returns null if the key has expired.
   */
  async getDriverLocationFromRedis(driverId: string): Promise<DriverLocation | null> {
    const val = await this.publisher.get(`${LOCATION_KEY_PREFIX}${driverId}`);
    if (!val) return null;
    try {
      return this.addFreshness(JSON.parse(val));
    } catch {
      return null;
    }
  }

  /**
   * Get the persisted last-known location for a driver from DB.
   * Used as fallback when Redis key has expired.
   */
  async getDriverLocationFromDb(driverId: string): Promise<DriverLocation | null> {
    const record = await this.prisma.driverLastLocation.findUnique({
      where: { driverId },
      include: { driver: { select: { name: true } } },
    });
    if (!record) return null;

    return this.addFreshness({
      driverId: record.driverId,
      driverName: record.driver.name,
      vendorId: record.vendorId,
      vanId: record.vanId ?? undefined,
      dailySheetId: record.dailySheetId ?? undefined,
      latitude: record.latitude,
      longitude: record.longitude,
      speed: record.speed ?? undefined,
      bearing: record.bearing ?? undefined,
      status: record.status,
      updatedAt: record.lastSeenAt.toISOString(),
    });
  }

  /**
   * Get a driver's location: Redis (live) first, DB (last-known) as fallback.
   * Always returns freshness metadata. Returns null only if no record exists at all.
   */
  async getDriverLocationResilient(driverId: string, vendorId: string): Promise<DriverLocation | null> {
    const live = await this.getDriverLocationFromRedis(driverId);
    if (live) return live;
    const persisted = await this.getDriverLocationFromDb(driverId);
    if (!persisted || persisted.vendorId !== vendorId) return null;
    return persisted;
  }

  /** @deprecated Use getDriverLocationFromRedis — kept for internal compat */
  async getDriverLocation(driverId: string): Promise<DriverLocation | null> {
    return this.getDriverLocationFromRedis(driverId);
  }

  /**
   * Derives freshness metadata from updatedAt and attaches it to the location.
   * Called on every read path (Redis snapshot, DB fallback, getActiveDrivers).
   */
  private addFreshness(loc: DriverLocation): DriverLocation {
    const lastSeenSeconds = Math.floor(
      (Date.now() - new Date(loc.updatedAt).getTime()) / 1000,
    );
    let freshness: 'LIVE' | 'STALE' | 'OFFLINE';
    if (lastSeenSeconds < FRESHNESS_LIVE_SECONDS) {
      freshness = 'LIVE';
    } else if (lastSeenSeconds < FRESHNESS_STALE_SECONDS) {
      freshness = 'STALE';
    } else {
      freshness = 'OFFLINE';
    }
    return { ...loc, freshness, lastSeenSeconds };
  }

  /**
   * Safety-net for the location-permission gate on trip start (dashboard/tracking
   * plan): drivers currently mid-trip (an open sheet with an active, un-checked-in
   * load) whose live Redis key is gone AND who haven't reported to the DB
   * last-known record in the last MISSING_LOCATION_GRACE_SECONDS either.
   *
   * The live key alone is too trigger-happy: it expires after 5 min the moment
   * a phone's screen locks or the tab backgrounds (mobile browsers throttle
   * `watchPosition`/heartbeat timers there), which is a normal short gap, not
   * a blind trip. The DB last-known record isn't subject to that TTL, so it's
   * used as the grace-period fallback — only a driver silent past the grace
   * window (or who never reported at all this trip) gets surfaced here.
   */
  async getMissingLocationDrivers(vendorId: string): Promise<
    {
      driverId: string;
      driverName: string;
      vanPlate: string | null;
      dailySheetId: string;
      tripStartedAt: string;
      lastSeenAt: string | null;
    }[]
  > {
    const activeSheets = await this.prisma.dailySheet.findMany({
      where: { vendorId, isClosed: false, loads: { some: { endedAt: null } } },
      select: {
        id: true,
        driverId: true,
        driver: { select: { name: true } },
        van: { select: { plateNumber: true } },
        loads: { where: { endedAt: null }, select: { startedAt: true }, take: 1, orderBy: { startedAt: 'desc' } },
      },
    });
    if (!activeSheets.length) return [];

    const liveKeys = await this.scanKeys(`${LOCATION_KEY_PREFIX}*`);
    const liveDriverIds = new Set(liveKeys.map((k) => k.slice(LOCATION_KEY_PREFIX.length)));

    const candidates = activeSheets.filter((s) => !liveDriverIds.has(s.driverId));
    if (!candidates.length) return [];

    const lastLocations = await this.prisma.driverLastLocation.findMany({
      where: { driverId: { in: candidates.map((s) => s.driverId) } },
      select: { driverId: true, lastSeenAt: true },
    });
    const lastSeenMap = new Map(lastLocations.map((l) => [l.driverId, l.lastSeenAt]));

    const now = Date.now();
    return candidates
      .filter((s) => {
        const lastSeen = lastSeenMap.get(s.driverId);
        if (!lastSeen) return true; // never reported this trip at all — always flag
        return (now - lastSeen.getTime()) / 1000 >= MISSING_LOCATION_GRACE_SECONDS;
      })
      .map((s) => ({
        driverId: s.driverId,
        driverName: s.driver.name,
        vanPlate: s.van?.plateNumber ?? null,
        dailySheetId: s.id,
        tripStartedAt: s.loads[0]?.startedAt.toISOString() ?? '',
        lastSeenAt: lastSeenMap.get(s.driverId)?.toISOString() ?? null,
      }));
  }

  /** Safe Redis key scan using cursor-based SCAN instead of KEYS */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.publisher.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
