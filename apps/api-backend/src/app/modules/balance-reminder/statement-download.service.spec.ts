import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { unzipSync, strFromU8 } from 'fflate';
import { StatementDownloadService, STATEMENT_DOWNLOAD_MAX_CUSTOMERS } from './statement-download.service';

/** In-memory stand-in for the slice of ioredis the service uses. */
function makeRedis() {
  const store = new Map<string, string | Buffer>();
  return {
    store,
    set: jest.fn(async (key: string, value: string | Buffer, ...args: any[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => (store.get(key) as string | undefined) ?? null),
    getBuffer: jest.fn(async (key: string) => (store.get(key) as Buffer | undefined) ?? null),
    del: jest.fn(async (key: string) => { store.delete(key); return 1; }),
    quit: jest.fn(),
  };
}

const cust = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `Name ${id}`, customerCode: `C${id}`, phoneNumber: '-', financialBalance: 500,
  isActive: true, paymentType: 'MONTHLY', ...extra,
});

function build(opts: { rows?: any[]; pdfFor?: (id: string) => any } = {}) {
  const prisma = { customer: { findMany: jest.fn(async () => opts.rows ?? []) } };
  const reminders = {
    scheduleFilter: jest.fn(() => ({})),
    generateStatementPdf: jest.fn(async (_v: string, id: string) =>
      opts.pdfFor ? opts.pdfFor(id) : { buffer: Buffer.from(`%PDF-${id}`), filename: `C${id}_Name_${id}_May_2026.pdf` }),
  };
  const svc = new StatementDownloadService(prisma as any, reminders as any);
  const redis = makeRedis();
  (svc as any).redis = redis;
  return { svc, prisma, reminders, redis };
}

/** Wait for the fire-and-forget job to reach a terminal state. */
async function settle(svc: StatementDownloadService, vendorId: string, jobId: string) {
  for (let i = 0; i < 50; i++) {
    const s = await svc.getStatus(vendorId, jobId);
    if (s.state !== 'running') return s;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('job did not finish');
}

describe('StatementDownloadService', () => {
  describe('preview', () => {
    it('includes cooldown / invalid-phone customers and leaves out only inactive ones', async () => {
      const { svc } = build({
        rows: [cust('1', { phoneNumber: '' }), cust('2', { phoneNumber: 'junk' }), cust('3', { isActive: false })],
      });
      const res = await svc.preview('v1', { mode: 'eligible', month: '2026-05' });
      expect(res.customers.map((c) => c.customerId)).toEqual(['1', '2']);
      expect(res.skippedInactive.map((c) => c.customerId)).toEqual(['3']);
      expect(res.overLimit).toBe(false);
    });

    it('scopes explicit modes by vendor + ids and flags over-limit audiences', async () => {
      const rows = Array.from({ length: STATEMENT_DOWNLOAD_MAX_CUSTOMERS + 1 }, (_, i) => cust(String(i)));
      const { svc, prisma } = build({ rows });
      const res = await svc.preview('v1', { mode: 'selected', customerIds: ['a'] });
      expect((prisma.customer.findMany.mock.calls as any[])[0][0].where).toEqual({ vendorId: 'v1', id: { in: ['a'] } });
      expect(res.overLimit).toBe(true);
    });
  });

  describe('start / job', () => {
    it('builds a ZIP with every PDF and never touches WhatsApp-side state', async () => {
      const { svc, redis } = build({ rows: [cust('1'), cust('2')] });
      const { jobId } = await svc.start('v1', { customerIds: ['1', '2'], month: '2026-05' });
      const status = await settle(svc, 'v1', jobId);

      expect(status.state).toBe('done');
      expect(status.generated).toBe(2);
      expect(status.failed).toEqual([]);
      expect(status.file).toEqual({ name: 'Statements_2026-05.zip', contentType: 'application/zip' });

      const file = await svc.getFile('v1', jobId);
      expect(Object.keys(unzipSync(new Uint8Array(file.buffer))).sort()).toEqual([
        'C1_Name_1_May_2026.pdf',
        'C2_Name_2_May_2026.pdf',
      ]);
      // lock released, no cooldown keys written
      expect(redis.store.has('statement-download:active:v1')).toBe(false);
      expect([...redis.store.keys()].some((k) => k.includes('cooldown'))).toBe(false);
    });

    it('serves a lone PDF directly', async () => {
      const { svc } = build({ rows: [cust('1')] });
      const { jobId } = await svc.start('v1', { customerIds: ['1'] });
      await settle(svc, 'v1', jobId);
      const file = await svc.getFile('v1', jobId);
      expect(file.contentType).toBe('application/pdf');
      expect(file.name).toBe('C1_Name_1_May_2026.pdf');
    });

    it('lists failed customers, keeps the rest, and adds NOT_GENERATED.txt to the ZIP', async () => {
      const { svc } = build({
        rows: [cust('1'), cust('2'), cust('3')],
        pdfFor: (id) => (id === '2' ? null : { buffer: Buffer.from('x'), filename: `C${id}.pdf` }),
      });
      const { jobId } = await svc.start('v1', { customerIds: ['1', '2', '3'], month: '2026-05' });
      const status = await settle(svc, 'v1', jobId);

      expect(status.generated).toBe(2);
      expect(status.failed).toEqual([
        { customerId: '2', name: 'Name 2', customerCode: 'C2', reason: 'Statement PDF could not be generated' },
      ]);
      const zip = unzipSync(new Uint8Array((await svc.getFile('v1', jobId)).buffer));
      expect(Object.keys(zip).sort()).toEqual(['C1.pdf', 'C3.pdf', 'NOT_GENERATED.txt']);
      expect(strFromU8(zip['NOT_GENERATED.txt'])).toContain('C2  Name 2');
    });

    it('finishes with no file when every PDF fails', async () => {
      const { svc } = build({ rows: [cust('1')], pdfFor: () => null });
      const { jobId } = await svc.start('v1', { customerIds: ['1'] });
      const status = await settle(svc, 'v1', jobId);
      expect(status.state).toBe('done');
      expect(status.file).toBeNull();
      await expect(svc.getFile('v1', jobId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('only renders ACTIVE customers of this vendor (server-side re-check)', async () => {
      const { svc, prisma } = build({ rows: [cust('1')] });
      await svc.start('v1', { customerIds: ['1', '9'] });
      expect((prisma.customer.findMany.mock.calls as any[])[0][0].where).toEqual({
        id: { in: ['1', '9'] }, vendorId: 'v1', isActive: true,
      });
    });

    it('rejects oversize requests, empty audiences and a second concurrent job', async () => {
      const big = Array.from({ length: STATEMENT_DOWNLOAD_MAX_CUSTOMERS + 1 }, (_, i) => String(i));
      await expect(build().svc.start('v1', { customerIds: big })).rejects.toBeInstanceOf(BadRequestException);
      await expect(build({ rows: [] }).svc.start('v1', { customerIds: ['1'] })).rejects.toBeInstanceOf(BadRequestException);

      const { svc, redis } = build({ rows: [cust('1')] });
      redis.store.set('statement-download:active:v1', 'other-job');
      await expect(svc.start('v1', { customerIds: ['1'] })).rejects.toBeInstanceOf(ConflictException);
    });

    it("never exposes another vendor's job", async () => {
      const { svc } = build({ rows: [cust('1')] });
      const { jobId } = await svc.start('v1', { customerIds: ['1'] });
      await settle(svc, 'v1', jobId);
      await expect(svc.getStatus('v2', jobId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.getFile('v2', jobId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
