import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, MiddlewareConsumer, NestMiddleware, RequestMethod } from '@nestjs/common';

/**
 * Per-request context carrying the accounting-period lock-override reason (P4).
 *
 * WHY ALS: the override reason arrives as an HTTP header, but the ledger writers
 * that must honour it (manual cash-in, remittance, fuel top-up, standalone crew
 * cash, direct cash expense …) are deep service methods that were written — and
 * are called from many places — without a request parameter. `CashLedgerPeriodGuard`
 * reads the header value from this store, so no call site changes.
 *
 * The middleware runs BEFORE the JWT auth guard, so `req.user` is not yet set
 * when the store is created. We therefore keep the `req` object itself and read
 * `req.user` lazily (`getLockOverrideContext()?.req?.user`) — by the time a
 * writer runs, the global JwtAuthGuard has populated it (the same place
 * `@CurrentUser()` reads it from).
 *
 * Outside an HTTP request (scripts, BullMQ jobs, cron) there is no store, so
 * `getLockOverrideContext()` is `undefined` and NOTHING can ever override a
 * closed period.
 */
export interface LockOverrideContext {
  /** The Express request (for lazy `req.user`). `any` — no Express type dependency here. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  req: any;
  /** Trimmed `X-Lock-Override-Reason` header (max 500 chars), or null when absent / blank. */
  overrideReason: string | null;
}

export const LOCK_OVERRIDE_HEADER_NAME = 'x-lock-override-reason';
export const LOCK_OVERRIDE_REASON_MAX = 500;

const storage = new AsyncLocalStorage<LockOverrideContext>();

/** The current request's context, or `undefined` outside an HTTP request. */
export function getLockOverrideContext(): LockOverrideContext | undefined {
  return storage.getStore();
}

/** Run `fn` inside a context (used by the middleware; also handy in tests / scripts). */
export function runWithLockOverrideContext<T>(ctx: LockOverrideContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Normalises the raw header value: first value if repeated, PERCENT-DECODED (the
 * dashboard sends the reason encodeURIComponent-ed because header values must be
 * ASCII; a plain ASCII value from another client, or malformed % sequences, fall
 * back to the raw text), trimmed, capped, blank -> null.
 */
export function parseLockOverrideHeader(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const trimmed = decoded.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, LOCK_OVERRIDE_REASON_MAX);
}

/** Registered for all routes in `AppModule.configure`. */
@Injectable()
export class LockOverrideMiddleware implements NestMiddleware {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  use(req: any, _res: any, next: () => void): void {
    const overrideReason = parseLockOverrideHeader(req?.headers?.[LOCK_OVERRIDE_HEADER_NAME]);
    storage.run({ req, overrideReason }, next);
  }
}

/**
 * Registers the middleware for ALL routes/methods. `{*splat}` is the Nest 11 /
 * Express 5 (path-to-regexp v8) wildcard, and also matches the bare root.
 * Shared by `AppModule.configure` and the spec so the real wiring is what is tested.
 */
export function applyLockOverrideMiddleware(consumer: MiddlewareConsumer): void {
  consumer.apply(LockOverrideMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
}
