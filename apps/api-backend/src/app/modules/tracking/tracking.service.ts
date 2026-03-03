import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import Redis from 'ioredis';
import { UpdateLocationDto } from './dto/update-location.dto';

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
}

export interface LocationEvent {
  vendorId: string;
  data: DriverLocation;
}

const TRACKING_CHANNEL = 'tracking:location';
const LOCATION_KEY_PREFIX = 'tracking:driver:';
const LOCATION_TTL_SECONDS = 5 * 60; // 5 minutes

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);

  /** Publisher client — used for SET/GET/SCAN/PUBLISH */
  private publisher: Redis;
  /** Dedicated subscriber client — must not issue regular Redis commands */
  private subscriber: Redis;

  /** Broadcasts incoming location events to all SSE subscribers on this instance */
  readonly locationEvents$ = new Subject<LocationEvent>();

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
   * Stores in Redis (auto-expires after 5 min) and publishes to all instances.
   */
  async updateLocation(
    driverId: string,
    driverName: string,
    vendorId: string,
    dto: UpdateLocationDto,
    vanId?: string,
    dailySheetId?: string,
  ): Promise<void> {
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
      status: dto.status ?? 'ONLINE',
      updatedAt: new Date().toISOString(),
    };

    // Persist latest location — auto-expires so offline drivers disappear
    await this.publisher.set(
      `${LOCATION_KEY_PREFIX}${driverId}`,
      JSON.stringify(location),
      'EX',
      LOCATION_TTL_SECONDS,
    );

    // Fan-out to all running instances via Redis Pub/Sub
    const event: LocationEvent = { vendorId, data: location };
    await this.publisher.publish(TRACKING_CHANNEL, JSON.stringify(event));
  }

  /**
   * Explicitly mark driver offline (e.g. when daily sheet is closed).
   * Sends an 'offline' sentinel so dashboards remove the marker immediately.
   */
  async removeDriver(driverId: string, vendorId: string): Promise<void> {
    await this.publisher.del(`${LOCATION_KEY_PREFIX}${driverId}`);

    // Signal dashboards to remove the marker
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
   * Uses SCAN (not KEYS) to be production-safe on large Redis instances.
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
        if (loc.vendorId === vendorId) result.push(loc);
      } catch {
        // skip corrupted entries
      }
    }

    return result;
  }

  /** Get the last known location for a single driver. */
  async getDriverLocation(driverId: string): Promise<DriverLocation | null> {
    const val = await this.publisher.get(`${LOCATION_KEY_PREFIX}${driverId}`);
    if (!val) return null;
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
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
