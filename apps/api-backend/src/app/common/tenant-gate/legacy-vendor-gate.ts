import { Logger } from '@nestjs/common';

/**
 * P0 stop-gap for the single-tenant -> multi-vendor transition (see
 * docs/features/multi-vendor-branding-and-whatsapp.md, §8 P0 and §11).
 *
 * Until each vendor has its own WhatsApp account (P2) and its own branding (P1), only the
 * vendors in WHATSAPP_ALLOWED_VENDOR_IDS ("legacy" vendors — Blue Ice / Dasani) may send via the
 * platform WhatsApp number or print Dasani's company/bank details on customer documents.
 *
 * WHATSAPP_GUARD_MODE:
 *   shadow  (DEFAULT — also when unset/invalid) log "would block" decisions, block NOTHING
 *   enforce block every vendor that is not in the allow-list (fail-closed, incl. missing vendorId)
 *   off     kill switch — gate disabled, legacy behaviour everywhere
 *
 * Defaulting to shadow means deploying this code without touching the env changes nothing.
 * Env is read at call time (no caching) so it can be flipped by restarting with a new value.
 */
export type GateMode = 'off' | 'shadow' | 'enforce';

const logger = new Logger('LegacyVendorGate');
const LOG_THROTTLE_MS = 60_000;
const lastLogged = new Map<string, number>();

export function gateMode(): GateMode {
  const raw = (process.env['WHATSAPP_GUARD_MODE'] ?? '').trim().toLowerCase();
  return raw === 'enforce' || raw === 'off' ? raw : 'shadow';
}

export function allowedVendorIds(): Set<string> {
  return new Set(
    (process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** True when the vendor is in the allow-list (the only vendors that may use the Dasani identity / platform number). */
export function isLegacyVendor(vendorId?: string | null): boolean {
  return !!vendorId && allowedVendorIds().has(vendorId);
}

/** Pure decision (no logging): would the gate stop this vendor in the current mode? Only `enforce` ever stops. */
export function isBlocked(vendorId?: string | null): boolean {
  return gateMode() === 'enforce' && !isLegacyVendor(vendorId);
}

/** Same decision as `isBlocked`, plus throttled logging of what shadow mode WOULD have blocked. */
export function evaluateGate(vendorId: string | null | undefined, feature: string): { blocked: boolean } {
  const mode = gateMode();
  if (mode === 'off' || isLegacyVendor(vendorId)) return { blocked: false };

  const key = `${feature}:${vendorId ?? 'MISSING_VENDOR_ID'}`;
  const now = Date.now();
  const due = now - (lastLogged.get(key) ?? 0) >= LOG_THROTTLE_MS;
  if (mode === 'shadow') {
    if (due) {
      lastLogged.set(key, now);
      logger.warn(`[shadow] would BLOCK ${feature} for vendor=${vendorId ?? 'MISSING_VENDOR_ID'} (not in WHATSAPP_ALLOWED_VENDOR_IDS)`);
    }
    return { blocked: false };
  }

  // enforce
  if (due) {
    lastLogged.set(key, now);
    logger.warn(`BLOCKED ${feature} for vendor=${vendorId ?? 'MISSING_VENDOR_ID'} (not in WHATSAPP_ALLOWED_VENDOR_IDS)`);
  }
  return { blocked: true };
}

/** Startup sanity check — call once from a module's onModuleInit. */
export function logGateStartup(): void {
  const mode = gateMode();
  const ids = allowedVendorIds();
  if (mode === 'enforce' && ids.size === 0) {
    logger.error('WHATSAPP_GUARD_MODE=enforce but WHATSAPP_ALLOWED_VENDOR_IDS is empty — EVERY vendor (incl. Blue Ice) will be blocked!');
  } else {
    logger.log(`WhatsApp/branding gate mode=${mode}, allowed vendors=${ids.size}`);
  }
}

/** Test helper. */
export function resetGateLogThrottle(): void {
  lastLogged.clear();
}
