import {
  allowedVendorIds,
  evaluateGate,
  gateMode,
  isBlocked,
  isLegacyVendor,
  resetGateLogThrottle,
} from './legacy-vendor-gate';

const ENV_KEYS = ['WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS'] as const;

describe('legacy-vendor-gate (P0 stop-gap)', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    ENV_KEYS.forEach((k) => {
      saved[k] = process.env[k];
      delete process.env[k];
    });
    resetGateLogThrottle();
  });
  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it('defaults to shadow when the env is unset or invalid — deploying without env changes nothing', () => {
    expect(gateMode()).toBe('shadow');
    process.env['WHATSAPP_GUARD_MODE'] = 'banana';
    expect(gateMode()).toBe('shadow');
    expect(isBlocked('any-vendor')).toBe(false);
    expect(evaluateGate('any-vendor', 'x').blocked).toBe(false);
    expect(evaluateGate(undefined, 'x').blocked).toBe(false);
  });

  it('parses the allow-list (trims, ignores empties)', () => {
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = ' a , b,,c ';
    expect([...allowedVendorIds()]).toEqual(['a', 'b', 'c']);
    expect(isLegacyVendor('b')).toBe(true);
    expect(isLegacyVendor('z')).toBe(false);
    expect(isLegacyVendor(undefined)).toBe(false);
  });

  it('shadow mode never blocks, even for vendors outside the allow-list', () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'shadow';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    expect(evaluateGate('lorem', 'f').blocked).toBe(false);
    expect(isBlocked('lorem')).toBe(false);
  });

  it('enforce blocks every vendor not in the allow-list and lets the listed one through', () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    expect(evaluateGate('blue-ice', 'f').blocked).toBe(false);
    expect(evaluateGate('lorem', 'f').blocked).toBe(true);
    expect(isBlocked('lorem')).toBe(true);
    expect(isBlocked('blue-ice')).toBe(false);
  });

  it('enforce is fail-closed for a missing vendorId and for an empty allow-list', () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'blue-ice';
    expect(evaluateGate(undefined, 'f').blocked).toBe(true);
    expect(evaluateGate(null, 'f').blocked).toBe(true);
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = '';
    expect(evaluateGate('blue-ice', 'f').blocked).toBe(true);
  });

  it('off is the kill switch — nothing is blocked even with an empty allow-list', () => {
    process.env['WHATSAPP_GUARD_MODE'] = 'off';
    expect(evaluateGate('lorem', 'f').blocked).toBe(false);
    expect(isBlocked('lorem')).toBe(false);
  });

  it('reads the env at call time (no caching)', () => {
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'a';
    process.env['WHATSAPP_GUARD_MODE'] = 'shadow';
    expect(isBlocked('b')).toBe(false);
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    expect(isBlocked('b')).toBe(true);
  });
});
