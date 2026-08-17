/**
 * All tunables for the location-history pipeline (breadcrumb throttling, stop
 * detection, retention) live here as env-var overrides with sane defaults —
 * NOT hardcoded in the services that use them. Change behavior by setting the
 * env var (no code change, no redeploy of logic), e.g. in .env / .env.prod:
 *
 *   TRACKING_BREADCRUMB_RETENTION_DAYS=30
 *
 * Read once at module load — a process restart picks up new values, matching
 * how the rest of this codebase reads process.env directly (no @nestjs/config).
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const TRACKING_CONFIG = {
  /** Raw breadcrumb rows older than this are purged nightly. Stops/summaries are unaffected — kept forever. */
  breadcrumbRetentionDays: envInt('TRACKING_BREADCRUMB_RETENTION_DAYS', 7),

  /** Minimum distance (meters) from the last stored breadcrumb before a new one is written. */
  movementThresholdMeters: envInt('TRACKING_MOVEMENT_THRESHOLD_METERS', 40),

  /** Even with no movement, write a breadcrumb at least this often (seconds) — keeps a "still here" heartbeat for stop-detection. */
  heartbeatIntervalSeconds: envInt('TRACKING_HEARTBEAT_INTERVAL_SECONDS', 90),

  /** Points within this radius (meters) of each other are considered part of the same stop cluster. */
  stopRadiusMeters: envInt('TRACKING_STOP_RADIUS_METERS', 60),

  /** A cluster must span at least this long (seconds) to count as a stop, not just a red light / slow-down. */
  stopMinDurationSeconds: envInt('TRACKING_STOP_MIN_DURATION_SECONDS', 180),

  /** Window (seconds) either side of a stop to look for a matching DailySheetItem.deliveredAt. */
  deliveryMatchWindowSeconds: envInt('TRACKING_DELIVERY_MATCH_WINDOW_SECONDS', 120),

  /** Max distance (meters) between a stop and a customer's saved location to count as a delivery match. */
  deliveryMatchRadiusMeters: envInt('TRACKING_DELIVERY_MATCH_RADIUS_METERS', 80),
} as const;
