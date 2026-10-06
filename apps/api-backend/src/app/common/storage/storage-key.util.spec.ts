import { BadRequestException } from '@nestjs/common';
import { assertOwnedStorageKey, assertOwnedStorageKeys, isOwnedStorageKey } from './storage-key.util';

/**
 * Audit finding M3: storage keys come back from the client inside DTOs and are later signed for download,
 * so a key must be under the expected prefix AND the caller's own vendor segment.
 */
const A = 'vendor-a';
const B = 'vendor-b';

describe('isOwnedStorageKey', () => {
  it('accepts the caller\'s own vendor-scoped key', () => {
    expect(isOwnedStorageKey(`damage-photos/${A}/3f2a.jpg`, ['damage-photos'], A)).toBe(true);
  });

  it('rejects another vendor\'s vendor-scoped key', () => {
    expect(isOwnedStorageKey(`damage-photos/${B}/3f2a.jpg`, ['damage-photos'], A)).toBe(false);
  });

  it('accepts a legacy key (no vendor segment) under the right prefix — until the backfill', () => {
    expect(isOwnedStorageKey('damage-photos/3f2a.jpg', ['damage-photos'], A)).toBe(true);
  });

  it('rejects a key under the wrong prefix (cannot attach a payment screenshot as a damage photo)', () => {
    expect(isOwnedStorageKey(`payment-screenshots/${A}/3f2a.jpg`, ['damage-photos'], A)).toBe(false);
    expect(isOwnedStorageKey('payment-screenshots/3f2a.jpg', ['damage-photos'], A)).toBe(false);
  });

  it('rejects arbitrary bucket paths, traversal and malformed keys', () => {
    for (const key of [
      'whatsapp-session/creds.json',
      'db-backups/2026-10-05.sql.gz',
      `damage-photos/${A}/../${B}/x.jpg`,
      `damage-photos/${A}/sub/x.jpg`,
      `/damage-photos/${A}/x.jpg`,
      `damage-photos//x.jpg`,
      `damage-photos\\${A}\\x.jpg`,
      `damage-photos/${A}/`,
      'damage-photos/',
      '',
      'x'.repeat(400),
    ]) {
      expect(isOwnedStorageKey(key, ['damage-photos'], A)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    for (const key of [undefined, null, 42, {}, ['damage-photos/x.jpg']]) {
      expect(isOwnedStorageKey(key, ['damage-photos'], A)).toBe(false);
    }
  });

  it('honours several allowed prefixes', () => {
    const prefixes = ['delivery-photos', 'fleet-photos', 'damage-photos'];
    expect(isOwnedStorageKey(`fleet-photos/${A}/x.jpg`, prefixes, A)).toBe(true);
    expect(isOwnedStorageKey(`office-cash-remittance/${A}/x.jpg`, prefixes, A)).toBe(false);
  });
});

describe('assertOwnedStorageKey(s)', () => {
  it('throws a 400 naming the field for a foreign key', () => {
    expect(() => assertOwnedStorageKey(`fleet-photos/${B}/x.jpg`, ['fleet-photos'], A, 'receiptPhotoKey')).toThrow(
      BadRequestException,
    );
    expect(() => assertOwnedStorageKey(`fleet-photos/${B}/x.jpg`, ['fleet-photos'], A, 'receiptPhotoKey')).toThrow(
      /receiptPhotoKey/,
    );
  });

  it('passes for an own key and for an empty / missing list', () => {
    expect(() => assertOwnedStorageKey(`fleet-photos/${A}/x.jpg`, ['fleet-photos'], A)).not.toThrow();
    expect(() => assertOwnedStorageKeys(undefined, ['fleet-photos'], A)).not.toThrow();
    expect(() => assertOwnedStorageKeys([], ['fleet-photos'], A)).not.toThrow();
  });

  it('one foreign key in a list fails the whole list', () => {
    expect(() =>
      assertOwnedStorageKeys([`damage-photos/${A}/ok.jpg`, `damage-photos/${B}/stolen.jpg`], ['damage-photos'], A),
    ).toThrow(BadRequestException);
  });
});
