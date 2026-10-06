import { BadRequestException } from '@nestjs/common';

/**
 * Tenant ownership of object-storage keys.
 *
 * Uploads return a key the client later sends back inside another request (a delivery photo, a fuel
 * receipt, a remittance attachment…). The server stores it and later signs a download URL for it, so an
 * unvalidated key lets one vendor attach — and then download — an arbitrary object: another vendor's
 * file, or anything else in the shared bucket. New uploads are written as
 * `<prefix>/<vendorId>/<uuid>.<ext>`; a submitted key must live under the expected prefix AND the
 * caller's own vendor segment.
 */

/**
 * Keys written before vendor segments existed look like `<prefix>/<uuid>.<ext>`. They cannot be tied to
 * a vendor from the key alone, so they are still accepted (under the right prefix) until a backfill moves
 * them — flip this to false after that backfill.
 */
export const LEGACY_UNSCOPED_KEYS_ALLOWED = true;

const MAX_KEY_LENGTH = 300;

export function isOwnedStorageKey(key: unknown, allowedPrefixes: readonly string[], vendorId: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('//')) return false;

  for (const prefix of allowedPrefixes) {
    const own = `${prefix}/${vendorId}/`;
    if (key.startsWith(own)) {
      const rest = key.slice(own.length);
      return rest.length > 0 && !rest.includes('/');
    }
    const head = `${prefix}/`;
    if (key.startsWith(head)) {
      const rest = key.slice(head.length);
      // a single path segment after the prefix = legacy key; anything deeper is another vendor's segment
      if (rest.length > 0 && !rest.includes('/')) return LEGACY_UNSCOPED_KEYS_ALLOWED;
    }
  }
  return false;
}

export function assertOwnedStorageKey(
  key: unknown,
  allowedPrefixes: readonly string[],
  vendorId: string,
  field = 'file key',
): void {
  if (!isOwnedStorageKey(key, allowedPrefixes, vendorId)) {
    throw new BadRequestException(`Invalid ${field}: it was not uploaded through this vendor's upload endpoint.`);
  }
}

export function assertOwnedStorageKeys(
  keys: readonly unknown[] | undefined | null,
  allowedPrefixes: readonly string[],
  vendorId: string,
  field = 'file keys',
): void {
  for (const key of keys ?? []) assertOwnedStorageKey(key, allowedPrefixes, vendorId, field);
}
