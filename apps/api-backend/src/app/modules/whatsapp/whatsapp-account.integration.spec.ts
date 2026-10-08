import { randomUUID } from 'crypto';
import { PrismaService } from '@water-supply-crm/database';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { WhatsAppService } from './whatsapp.service';

/**
 * Real-database test for per-vendor WhatsApp accounts (multi-vendor design doc §3.2/§5, P2).
 * Meta itself is stubbed (no network); everything else — encryption at rest, linking, routing,
 * unique sender ids, FK behaviour — runs against Postgres.
 *
 * Opt-in: set TEST_DATABASE_URL to a THROWAWAY database with the schema applied
 * (migration 20261009010000_add_whatsapp_account). Never falls back to DATABASE_URL.
 *
 *   TEST_DATABASE_URL=postgresql://... npx jest -c jest.config.cts whatsapp-account.integration
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

jest.setTimeout(60000);

const ENV = ['WHATSAPP_TOKEN_KEY', 'WHATSAPP_GUARD_MODE', 'WHATSAPP_ALLOWED_VENDOR_IDS', 'WHATSAPP_ENABLED'] as const;

describeDb('WhatsApp accounts (real Postgres)', () => {
  const RUN = randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '1');
  const saved: Record<string, string | undefined> = {};
  const prisma = new PrismaService({ datasources: { db: { url: TEST_DATABASE_URL ?? 'postgresql://skipped:skipped@localhost:1/skipped' } } });
  const provider = {
    isReady: jest.fn().mockReturnValue(true),
    fetchPhoneNumberInfo: jest.fn(async () => ({ ok: true as const, displayNumber: '+92 300 1111111', verifiedName: 'Lorem', qualityRating: 'GREEN' })),
    sendTemplate: jest.fn().mockResolvedValue(true),
    sendMessage: jest.fn().mockResolvedValue(true),
    sendDocument: jest.fn().mockResolvedValue(true),
    listTemplates: jest.fn(async () => ({ ok: true as const, templates: [] as Array<{ name: string; language: string; category: string | null; status: string; rejectedReason: string | null }> })),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const cache = { get: jest.fn(async () => undefined), set: jest.fn(async () => undefined) };
  const accounts = new WhatsAppAccountService(prisma, provider as never, audit as never, {} as never);
  const whatsapp = new WhatsAppService(provider as never, cache as never, accounts);
  const actor = { userId: 'u-test', name: 'Tester', vendorId: 'x' } as never;

  const vendorIds: string[] = [];
  const mkVendor = async (tag: string) => {
    const v = await prisma.vendor.create({ data: { name: `WA ${tag}`, slug: `wa-${RUN}-${tag}` } });
    vendorIds.push(v.id);
    return v;
  };
  const creds = (n: number) => ({ wabaId: `${RUN}0${n}`, phoneNumberId: `${RUN}1${n}`, accessToken: `EAAB-secret-token-${RUN}-${n}-xxxxxxxxxx` });

  beforeAll(() => {
    ENV.forEach((k) => (saved[k] = process.env[k]));
    process.env['WHATSAPP_TOKEN_KEY'] = Buffer.alloc(32, 3).toString('base64');
    process.env['WHATSAPP_ENABLED'] = 'true';
    delete process.env['WHATSAPP_GUARD_MODE'];
    delete process.env['WHATSAPP_ALLOWED_VENDOR_IDS'];
  });
  afterAll(async () => {
    ENV.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    const accts = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { whatsappAccountId: true } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    await prisma.whatsAppAccount.deleteMany({ where: { id: { in: accts.map((a) => a.whatsappAccountId).filter((x): x is string => !!x) } } });
    await prisma.whatsAppAccount.deleteMany({ where: { phoneNumberId: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  it('stores the token ENCRYPTED, never in clear text, and routes that vendor through it', async () => {
    const v = await mkVendor('a');
    const c = creds(1);
    const view = await accounts.connect(v.id, c, actor);
    expect(view.account).toMatchObject({ status: 'READY', phoneNumberId: c.phoneNumberId, hasToken: true, displayNumber: '+92 300 1111111' });
    expect(JSON.stringify(view)).not.toContain(c.accessToken);

    const row = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { phoneNumberId: c.phoneNumberId } });
    expect(JSON.stringify(row)).not.toContain(c.accessToken);
    expect(row.tokenCipher).toBeTruthy();

    await whatsapp.sendTemplate(v.id, '923001234567', 'balance_reminder', ['A', '1']);
    expect(provider.sendTemplate).toHaveBeenLastCalledWith('923001234567', 'balance_reminder', ['A', '1'], undefined, undefined, { phoneNumberId: c.phoneNumberId, accessToken: c.accessToken });
  });

  it('two vendors cannot register the same Phone Number ID separately; sister brands share via link', async () => {
    const a = await mkVendor('b1');
    const b = await mkVendor('b2');
    const c = creds(2);
    await accounts.connect(a.id, c, actor);
    await expect(accounts.connect(b.id, c, actor)).rejects.toThrow(/already connected/);

    const view = await accounts.linkVendor(b.id, (await prisma.vendor.findUniqueOrThrow({ where: { id: a.id } })).whatsappAccountId as string, actor);
    expect(view.account?.phoneNumberId).toBe(c.phoneNumberId);
    // b now sends via a's sender; a is told it is shared and cannot change it alone
    await whatsapp.sendTemplate(b.id, '923009876543', 't', ['x']);
    expect(provider.sendTemplate).toHaveBeenLastCalledWith('923009876543', 't', ['x'], undefined, undefined, expect.objectContaining({ phoneNumberId: c.phoneNumberId }));
    await expect(accounts.connect(a.id, creds(3), actor)).rejects.toThrow(/shared with other brands/);
  });

  it('a vendor without an account is blocked once the gate enforces — the platform number is never borrowed', async () => {
    const v = await mkVendor('c');
    process.env['WHATSAPP_GUARD_MODE'] = 'enforce';
    process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] = 'someone-else';
    provider.sendTemplate.mockClear();
    expect(await whatsapp.sendTemplate(v.id, '923001112223', 't', ['x'])).toBe(false);
    expect(provider.sendTemplate).not.toHaveBeenCalled();
    delete process.env['WHATSAPP_GUARD_MODE'];
    delete process.env['WHATSAPP_ALLOWED_VENDOR_IDS'];
  });

  it('disconnecting the sole vendor deletes the account row (token gone); a shared account survives for the others', async () => {
    const a = await mkVendor('d1');
    const b = await mkVendor('d2');
    await accounts.connect(a.id, creds(4), actor);
    const accountId = (await prisma.vendor.findUniqueOrThrow({ where: { id: a.id } })).whatsappAccountId as string;
    await accounts.linkVendor(b.id, accountId, actor);

    await accounts.disconnect(b.id, actor, { isSuperAdmin: true });
    expect(await prisma.whatsAppAccount.count({ where: { id: accountId } })).toBe(1);
    expect((await prisma.vendor.findUniqueOrThrow({ where: { id: b.id } })).whatsappAccountId).toBeNull();

    await accounts.disconnect(a.id, actor);
    expect(await prisma.whatsAppAccount.count({ where: { id: accountId } })).toBe(0);
  });

  it('deleting an account row only unlinks its vendors (FK SET NULL) — a vendor is never deleted with it', async () => {
    const v = await mkVendor('e');
    await accounts.connect(v.id, creds(5), actor);
    const accountId = (await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } })).whatsappAccountId as string;
    await prisma.whatsAppAccount.delete({ where: { id: accountId } });
    const after = await prisma.vendor.findUniqueOrThrow({ where: { id: v.id } });
    expect(after.whatsappAccountId).toBeNull();
  });

  it('template sync mirrors Meta; unapproved templates are skipped, approved ones go out under the brand suffix', async () => {
    const v = await mkVendor('g');
    const c = creds(7);
    await accounts.connect(v.id, { ...c, templateSuffix: 'lorem' }, actor);
    provider.listTemplates.mockResolvedValueOnce({
      ok: true,
      templates: [
        { name: 'balance_reminder_lorem', language: 'en', category: 'UTILITY', status: 'APPROVED', rejectedReason: null },
        { name: 'delivery_receipt_lorem', language: 'en', category: 'UTILITY', status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' },
      ],
    });
    const view = await accounts.syncVendorTemplates(v.id, actor);
    expect(view.templateSuffix).toBe('lorem');
    expect(view.items.find((i) => i.name === 'balance_reminder')).toMatchObject({ finalName: 'balance_reminder_lorem', status: 'APPROVED' });
    expect(view.items.find((i) => i.name === 'delivery_receipt')).toMatchObject({ status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' });
    expect(view.items.find((i) => i.name === 'order_approved')!.status).toBe('NOT_FOUND');

    provider.sendTemplate.mockClear();
    expect(await whatsapp.sendTemplate(v.id, '923001110001', 'balance_reminder', ['A', '1'])).toBe(true);
    expect(provider.sendTemplate).toHaveBeenLastCalledWith('923001110001', 'balance_reminder_lorem', ['A', '1'], undefined, undefined, expect.objectContaining({ phoneNumberId: c.phoneNumberId }));
    provider.sendTemplate.mockClear();
    expect(await whatsapp.sendTemplate(v.id, '923001110002', 'delivery_receipt', ['A', 'L1', 'd'])).toBe(false); // rejected on Meta
    expect(await whatsapp.sendTemplate(v.id, '923001110003', 'order_approved', ['A', 'P', '1'])).toBe(false); // never created
    expect(provider.sendTemplate).not.toHaveBeenCalled();

    // a later sync with fewer templates removes the vanished one
    provider.listTemplates.mockResolvedValueOnce({ ok: true, templates: [] });
    await accounts.syncVendorTemplates(v.id, actor);
    expect(await prisma.whatsAppTemplate.count({ where: { account: { phoneNumberId: c.phoneNumberId } } })).toBe(0);
  });

  it('two brands on one WABA must use different template suffixes', async () => {
    const a = await mkVendor('h1');
    const b = await mkVendor('h2');
    const shared = creds(8);
    await accounts.connect(a.id, { ...shared, templateSuffix: undefined }, actor); // plain names
    const second = { ...creds(9), wabaId: shared.wabaId }; // same WABA, another number
    await expect(accounts.connect(b.id, second, actor)).rejects.toThrow(/plain template names/);
    await expect(accounts.connect(b.id, { ...second, templateSuffix: 'dear' }, actor)).resolves.toBeDefined();
    const third = { ...creds(10), wabaId: shared.wabaId };
    const c = await mkVendor('h3');
    await expect(accounts.connect(c.id, { ...third, templateSuffix: 'dear' }, actor)).rejects.toThrow(/already uses the template suffix "dear"/);
  });

  it('health check marks a dead token TOKEN_INVALID in the database', async () => {
    const v = await mkVendor('f');
    const c = creds(6);
    await accounts.connect(v.id, c, actor);
    // the job checks every stored account — only OUR sender gets the dead-token answer
    const original = provider.fetchPhoneNumberInfo.getMockImplementation();
    provider.fetchPhoneNumberInfo.mockImplementation((async ({ phoneNumberId }: { phoneNumberId: string }) =>
      phoneNumberId === c.phoneNumberId ? { ok: false, status: 401, code: 190, message: 'expired' } : { ok: true, displayNumber: '+92', verifiedName: 'x', qualityRating: 'GREEN' }) as never);
    await accounts.runHealthCheck();
    if (original) provider.fetchPhoneNumberInfo.mockImplementation(original);
    const row = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { phoneNumberId: c.phoneNumberId } });
    expect(row.status).toBe('TOKEN_INVALID');
    expect(row.lastHealthError).toBe('expired');
    accounts.invalidate();
    expect((await accounts.getView(v.id)).sending.via).not.toBe('ACCOUNT');
  });
});
