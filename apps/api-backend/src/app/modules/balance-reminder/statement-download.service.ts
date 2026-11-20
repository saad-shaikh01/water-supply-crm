import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { zipSync } from 'fflate';
import { PrismaService } from '@water-supply-crm/database';
import { BalanceReminderService } from './balance-reminder.service';
import { StatementDownloadPreviewDto, StatementDownloadStartDto } from './dto/schedule-reminder.dto';

/**
 * Download customers' statement PDFs (one PDF, or a ZIP) to the operator's browser.
 *
 * Deliberately separate from the WhatsApp send flow: nothing is sent, no
 * ReminderSendLog row is written, no cooldown is read or set, and phone validity
 * is irrelevant. The only customers left out are INACTIVE ones.
 *
 * Rendering many PDFs can take a minute, so the work runs as a short-lived
 * background job (state + resulting file live in Redis for JOB_TTL_SECONDS) that
 * the browser polls — a single long HTTP request would hit proxy timeouts.
 */

/** Hard ceiling per download — keeps memory / render time bounded. Narrow by van/day/type for more. */
export const STATEMENT_DOWNLOAD_MAX_CUSTOMERS = 300;
/** PDFs rendered in parallel — each is a handful of DB queries + a PDFKit render. */
const CONCURRENCY = 4;
const JOB_TTL_SECONDS = 30 * 60;
/** Safety net: releases the one-job-per-vendor lock if the process dies mid-job. */
const ACTIVE_LOCK_TTL_SECONDS = 10 * 60;

const metaKey = (vendorId: string, jobId: string) => `statement-download:meta:${vendorId}:${jobId}`;
const fileKey = (vendorId: string, jobId: string) => `statement-download:file:${vendorId}:${jobId}`;
const activeKey = (vendorId: string) => `statement-download:active:${vendorId}`;

export interface FailedStatement {
  customerId: string;
  name: string;
  customerCode: string;
  reason: string;
}

export interface StatementDownloadStatus {
  jobId: string;
  state: 'running' | 'done' | 'failed';
  month: string;
  total: number;
  processed: number;
  generated: number;
  failed: FailedStatement[];
  /** Set when state === 'done' and at least one PDF was produced. */
  file?: { name: string; contentType: 'application/pdf' | 'application/zip' } | null;
  error?: string;
}

@Injectable()
export class StatementDownloadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StatementDownloadService.name);
  private redis!: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reminders: BalanceReminderService,
  ) {}

  onModuleInit() {
    this.redis = new Redis(process.env['REDIS_URL'] || 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  /** Which customers a download would cover (active only) + the inactive ones left out. */
  async preview(vendorId: string, dto: StatementDownloadPreviewDto) {
    const month = dto.month ?? this.currentMonth();
    const isEligible = dto.mode === 'eligible';

    const where = isEligible
      ? {
          vendorId,
          ...(dto.paymentType ? { paymentType: dto.paymentType } : {}),
          ...this.reminders.scheduleFilter(dto.vanId, dto.dayOfWeek),
        }
      : { vendorId, id: { in: dto.customerIds ?? [] } };

    const rows = await this.prisma.customer.findMany({
      where,
      select: {
        id: true, name: true, customerCode: true, phoneNumber: true,
        financialBalance: true, isActive: true, paymentType: true,
      },
      orderBy: { name: 'asc' },
    });

    const shape = (c: (typeof rows)[number]) => ({
      customerId: c.id,
      name: c.name,
      customerCode: c.customerCode,
      phone: c.phoneNumber,
      balance: c.financialBalance,
      paymentType: c.paymentType as string,
    });
    const included = rows.filter((c) => c.isActive);
    const inactive = rows.filter((c) => !c.isActive);

    return {
      month,
      limit: STATEMENT_DOWNLOAD_MAX_CUSTOMERS,
      total: included.length,
      overLimit: included.length > STATEMENT_DOWNLOAD_MAX_CUSTOMERS,
      customers: included.map(shape),
      skippedInactive: inactive.map(shape),
    };
  }

  /** Start the background render. Returns immediately; poll getStatus(). */
  async start(vendorId: string, dto: StatementDownloadStartDto) {
    const ids = Array.from(new Set(dto.customerIds));
    if (ids.length > STATEMENT_DOWNLOAD_MAX_CUSTOMERS) {
      throw new BadRequestException(
        `At most ${STATEMENT_DOWNLOAD_MAX_CUSTOMERS} statements can be downloaded at once — narrow the selection (van / delivery day / customer type) and download in parts.`,
      );
    }
    const month = dto.month ?? this.currentMonth();

    // Re-check server-side: only this vendor's ACTIVE customers, whatever the client sent.
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: ids }, vendorId, isActive: true },
      select: { id: true, name: true, customerCode: true },
      orderBy: { name: 'asc' },
    });
    if (customers.length === 0) throw new BadRequestException('No active customers to download statements for.');

    const jobId = randomUUID();
    const locked = await this.redis.set(activeKey(vendorId), jobId, 'EX', ACTIVE_LOCK_TTL_SECONDS, 'NX');
    if (!locked) {
      throw new ConflictException('A statement download is already being prepared. Wait for it to finish, then try again.');
    }

    const status: StatementDownloadStatus = {
      jobId, state: 'running', month, total: customers.length, processed: 0, generated: 0, failed: [], file: null,
    };
    await this.saveStatus(vendorId, status);

    // Fire and forget — progress is reported through the Redis status key.
    void this.run(vendorId, status, customers).catch((err) => {
      this.logger.error(`Statement download job ${jobId} crashed: ${err}`);
    });

    return { jobId, total: customers.length, month };
  }

  async getStatus(vendorId: string, jobId: string): Promise<StatementDownloadStatus> {
    const raw = await this.redis.get(metaKey(vendorId, jobId));
    if (!raw) throw new NotFoundException('Download not found or expired. Please start it again.');
    return JSON.parse(raw) as StatementDownloadStatus;
  }

  async getFile(vendorId: string, jobId: string): Promise<{ buffer: Buffer; name: string; contentType: string }> {
    const status = await this.getStatus(vendorId, jobId);
    if (status.state !== 'done' || !status.file) throw new NotFoundException('No file is available for this download.');
    const buffer = await this.redis.getBuffer(fileKey(vendorId, jobId));
    if (!buffer) throw new NotFoundException('Download expired. Please start it again.');
    return { buffer, name: status.file.name, contentType: status.file.contentType };
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private async run(
    vendorId: string,
    status: StatementDownloadStatus,
    customers: Array<{ id: string; name: string; customerCode: string }>,
  ) {
    const pdfs: Array<{ name: string; buffer: Buffer }> = [];
    try {
      for (let i = 0; i < customers.length; i += CONCURRENCY) {
        const batch = customers.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (c) => ({ c, pdf: await this.reminders.generateStatementPdf(vendorId, c.id, status.month) })),
        );
        for (const { c, pdf } of results) {
          if (pdf) {
            pdfs.push({ name: pdf.filename, buffer: pdf.buffer });
            status.generated++;
          } else {
            status.failed.push({
              customerId: c.id, name: c.name, customerCode: c.customerCode,
              reason: 'Statement PDF could not be generated',
            });
          }
          status.processed++;
        }
        await this.saveStatus(vendorId, status);
      }

      if (pdfs.length > 0) {
        const { buffer, file } = this.pack(pdfs, status);
        await this.redis.set(fileKey(vendorId, status.jobId), buffer, 'EX', JOB_TTL_SECONDS);
        status.file = file;
      }
      status.state = 'done';
    } catch (err) {
      this.logger.error(`Statement download job ${status.jobId} failed: ${err}`);
      status.state = 'failed';
      status.error = 'Something went wrong while preparing the statements. Please try again.';
    } finally {
      await this.saveStatus(vendorId, status).catch(() => undefined);
      await this.redis.del(activeKey(vendorId)).catch(() => undefined);
    }
  }

  /** One PDF → served as-is. Several → ZIP (+ NOT_GENERATED.txt when some failed). */
  private pack(pdfs: Array<{ name: string; buffer: Buffer }>, status: StatementDownloadStatus) {
    if (pdfs.length === 1 && status.failed.length === 0) {
      return { buffer: pdfs[0].buffer, file: { name: pdfs[0].name, contentType: 'application/pdf' as const } };
    }

    const entries: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const p of pdfs) {
      let name = p.name;
      for (let n = 2; used.has(name); n++) name = p.name.replace(/\.pdf$/i, `_${n}.pdf`);
      used.add(name);
      entries[name] = new Uint8Array(p.buffer);
    }
    if (status.failed.length > 0) {
      const lines = [
        'These customers\' statements could NOT be generated and are not in this ZIP.',
        'Their statements were not sent to them on WhatsApp either - this was a download only.',
        '',
        ...status.failed.map((f) => `${f.customerCode}  ${f.name}  -  ${f.reason}`),
        '',
      ];
      entries['NOT_GENERATED.txt'] = new TextEncoder().encode(lines.join('\r\n'));
    }

    // PDFs are already deflate-compressed internally — level 0 (store) is fast and loses little.
    const zipped = zipSync(entries, { level: 0 });
    return {
      buffer: Buffer.from(zipped),
      file: { name: `Statements_${status.month}.zip`, contentType: 'application/zip' as const },
    };
  }

  private async saveStatus(vendorId: string, status: StatementDownloadStatus) {
    await this.redis.set(metaKey(vendorId, status.jobId), JSON.stringify(status), 'EX', JOB_TTL_SECONDS);
  }

  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }
}
