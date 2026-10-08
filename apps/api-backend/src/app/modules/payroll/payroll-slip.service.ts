import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PayrollSlipDeliveryStatus, PayrollSlipDispatchStatus } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import type { AuthUser } from '@water-supply-crm/types';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import { isSendablePhone } from '../whatsapp/phone.util';
import { PayrollEntryService } from './payroll-entry.service';
import { SalarySlipPdfService } from './salary-slip-pdf.service';
import { MAX_SLIPS_PER_DISPATCH, type PreviewPayrollSlipsDto, type SendPayrollSlipsDto } from './dto/send-payroll-slips.dto';
import {
  buildSalarySlip,
  classifySlipEntry,
  formatRupees,
  isSlipEligibleStatus,
  normalizePhone,
  SLIP_VERDICT_REASON,
  slipFilename,
  type SlipVerdict,
} from './payroll-slip.util';

/** Randomized pause between consecutive WhatsApp sends — a fixed interval is itself a bot signature. */
export const SLIP_SEND_DELAY_MIN_MS = 5000;
export const SLIP_SEND_DELAY_MAX_MS = 12000;
/** A RUNNING dispatch older than this is treated as dead (worker crash) and no longer blocks a new one. */
export const SLIP_DISPATCH_STALE_MS = 6 * 60 * 60 * 1000;
/** A dispatch still QUEUED this long never reached a worker (e.g. the process died between commit and enqueue). */
export const SLIP_QUEUED_STALE_MS = 15 * 60 * 1000;
/** Stop the batch after this many failed sends in a row (template not approved, bad token, WhatsApp down...). */
export const SLIP_MAX_CONSECUTIVE_FAILURES = 5;

const ACTIVE_DISPATCH_STATUSES: PayrollSlipDispatchStatus[] = [PayrollSlipDispatchStatus.QUEUED, PayrollSlipDispatchStatus.RUNNING];

/** Prisma filter for a dispatch that is genuinely still live (not a dead QUEUED / RUNNING leftover). */
function liveDispatchWhere(now = Date.now()) {
  return {
    OR: [
      { status: PayrollSlipDispatchStatus.QUEUED, createdAt: { gte: new Date(now - SLIP_QUEUED_STALE_MS) } },
      { status: PayrollSlipDispatchStatus.RUNNING, createdAt: { gte: new Date(now - SLIP_DISPATCH_STALE_MS) } },
    ],
  };
}

export interface SlipPreviewItem {
  entryId: string;
  userId: string;
  name: string;
  role: string;
  status: string;
  finalPayable: number;
  verdict: SlipVerdict;
  /** Why the slip cannot be sent (NOT_FINAL / NO_PHONE); null when eligible. */
  reason: string | null;
  alreadySent: { sentAt: Date | null; finalPayable: number; amountChanged: boolean } | null;
}

@Injectable()
export class PayrollSlipService {
  private readonly logger = new Logger(PayrollSlipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollEntries: PayrollEntryService,
    private readonly pdf: SalarySlipPdfService,
    private readonly whatsapp: WhatsAppService,
    @InjectQueue(QUEUE_NAMES.PAYROLL_SLIP_SEND) private readonly slipQueue: Queue,
  ) {}

  // ─── Preview ────────────────────────────────────────────────────────────────

  async preview(user: AuthUser, periodId: string, dto: PreviewPayrollSlipsDto) {
    const { period, items } = await this.classify(user.vendorId, periodId, dto.entryIds);
    return {
      periodId,
      periodLabel: period.periodLabel,
      items,
      counts: this.counts(items),
    };
  }

  // ─── Send (enqueue) ─────────────────────────────────────────────────────────

  async send(user: AuthUser, periodId: string, dto: SendPayrollSlipsDto) {
    const { items, phoneByUser } = await this.classify(user.vendorId, periodId, dto.entryIds);

    await this.assertNoActiveDispatch(this.prisma, user.vendorId); // fast fail before any work

    const notFinal = items.filter((i) => i.verdict === 'NOT_FINAL');
    const noPhone = items.filter((i) => i.verdict === 'NO_PHONE');
    let sendable = items.filter((i) => i.verdict === 'ELIGIBLE');

    const alreadySent = sendable.filter((i) => i.alreadySent);
    const skippedAlreadySent: SlipPreviewItem[] = [];
    if (alreadySent.length > 0) {
      if (dto.skipAlreadySent) {
        skippedAlreadySent.push(...alreadySent);
        sendable = sendable.filter((i) => !i.alreadySent);
      } else if (!dto.confirmResend) {
        throw new ConflictException({
          message: `${alreadySent.length} slip(s) were already sent. Confirm to send them again.`,
          code: 'SLIP_ALREADY_SENT',
          alreadySent: alreadySent.map((i) => ({
            entryId: i.entryId,
            name: i.name,
            sentAt: i.alreadySent?.sentAt ?? null,
            amountChanged: i.alreadySent?.amountChanged ?? false,
          })),
        });
      }
    }

    if (sendable.length > MAX_SLIPS_PER_DISPATCH) {
      throw new BadRequestException(`At most ${MAX_SLIPS_PER_DISPATCH} slips can be sent at once.`);
    }
    if (sendable.length === 0 && noPhone.length === 0) {
      throw new BadRequestException(
        notFinal.length > 0
          ? 'Nothing to send — the selected entries are not approved yet.'
          : 'Nothing to send — every selected slip was already sent.',
      );
    }

    const total = sendable.length + noPhone.length;
    const allDone = sendable.length === 0;

    const dispatch = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent sends of one vendor (double-click / two admins): the lock is held until commit, so
      // the second request re-checks AFTER the first one's dispatch row exists and gets the 409.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'payroll-slip-send:' + user.vendorId}))`;
      await this.assertNoActiveDispatch(tx, user.vendorId);
      const created = await tx.payrollSlipDispatch.create({
        data: {
          vendorId: user.vendorId,
          periodId,
          requestedById: user.userId,
          total,
          skipped: noPhone.length,
          status: allDone ? PayrollSlipDispatchStatus.COMPLETED : PayrollSlipDispatchStatus.QUEUED,
          ...(allDone ? { finishedAt: new Date() } : {}),
        },
      });
      const entryRows = await tx.payrollEntry.findMany({
        where: { id: { in: [...sendable, ...noPhone].map((i) => i.entryId) }, vendorId: user.vendorId },
        select: { id: true, version: true, finalPayable: true },
      });
      const entryById = new Map(entryRows.map((e) => [e.id, e]));
      await tx.payrollSlipDelivery.createMany({
        data: [
          ...sendable.map((i) => ({
            dispatchId: created.id,
            vendorId: user.vendorId,
            periodId,
            payrollEntryId: i.entryId,
            userId: i.userId,
            phone: normalizePhone(phoneByUser.get(i.userId)),
            status: PayrollSlipDeliveryStatus.QUEUED,
            finalPayable: entryById.get(i.entryId)?.finalPayable ?? i.finalPayable,
            entryVersion: entryById.get(i.entryId)?.version ?? 0,
          })),
          ...noPhone.map((i) => ({
            dispatchId: created.id,
            vendorId: user.vendorId,
            periodId,
            payrollEntryId: i.entryId,
            userId: i.userId,
            phone: null,
            status: PayrollSlipDeliveryStatus.SKIPPED_NO_PHONE,
            error: SLIP_VERDICT_REASON.NO_PHONE,
            finalPayable: entryById.get(i.entryId)?.finalPayable ?? i.finalPayable,
            entryVersion: entryById.get(i.entryId)?.version ?? 0,
          })),
        ],
      });
      return created;
    });

    if (!allDone) {
      try {
        // attempts: 1 — no automatic retry. Even if BullMQ re-runs a stalled job, each delivery row is claimed
        // (QUEUED -> SENDING) before its WhatsApp call, so a slip can never be sent twice by a re-run.
        await this.slipQueue.add(
          JOB_NAMES.SEND_PAYROLL_SLIPS,
          { dispatchId: dispatch.id, vendorId: user.vendorId },
          { jobId: `payroll-slip-${dispatch.id}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
        );
      } catch (err) {
        await this.failDispatch(dispatch.id, 'Could not queue the send job.');
        throw err;
      }
    }

    return {
      dispatchId: dispatch.id,
      status: dispatch.status,
      queued: sendable.length,
      skippedNoPhone: noPhone.map((i) => ({ entryId: i.entryId, name: i.name })),
      skippedNotFinal: notFinal.map((i) => ({ entryId: i.entryId, name: i.name, status: i.status })),
      skippedAlreadySent: skippedAlreadySent.map((i) => ({ entryId: i.entryId, name: i.name })),
    };
  }

  // ─── Status / results ───────────────────────────────────────────────────────

  /** Per-entry last slip state for the Monthly Payroll table + the active dispatch's progress. */
  async status(user: AuthUser, periodId: string) {
    await this.requirePeriod(user.vendorId, periodId);

    const [deliveries, entries, dispatches, liveDispatch] = await Promise.all([
      this.prisma.payrollSlipDelivery.findMany({
        where: { vendorId: user.vendorId, periodId },
        orderBy: { createdAt: 'desc' },
        select: { payrollEntryId: true, status: true, error: true, sentAt: true, createdAt: true, finalPayable: true },
      }),
      this.prisma.payrollEntry.findMany({
        where: { vendorId: user.vendorId, periodId },
        select: { id: true, finalPayable: true },
      }),
      this.prisma.payrollSlipDispatch.findMany({
        where: { vendorId: user.vendorId, periodId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      }),
      // The send lock is vendor-wide, so the banner must show a send running for ANY period.
      this.prisma.payrollSlipDispatch.findFirst({
        where: { vendorId: user.vendorId, ...liveDispatchWhere() },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const currentPayable = new Map(entries.map((e) => [e.id, e.finalPayable]));
    const byEntry: Record<
      string,
      {
        last: { status: PayrollSlipDeliveryStatus; error: string | null; at: Date } | null;
        lastSent: { at: Date | null; finalPayable: number; amountChanged: boolean } | null;
      }
    > = {};
    for (const d of deliveries) {
      const slot = (byEntry[d.payrollEntryId] ??= { last: null, lastSent: null });
      if (!slot.last) {
        const abandoned =
          (d.status === PayrollSlipDeliveryStatus.QUEUED || d.status === PayrollSlipDeliveryStatus.SENDING) &&
          Date.now() - d.createdAt.getTime() >= SLIP_DISPATCH_STALE_MS;
        slot.last = abandoned
          ? { status: PayrollSlipDeliveryStatus.FAILED, error: 'Interrupted — this slip was never sent.', at: d.createdAt }
          : { status: d.status, error: d.error, at: d.sentAt ?? d.createdAt };
      }
      if (!slot.lastSent && d.status === PayrollSlipDeliveryStatus.SENT) {
        slot.lastSent = {
          at: d.sentAt,
          finalPayable: d.finalPayable,
          amountChanged: currentPayable.get(d.payrollEntryId) !== d.finalPayable,
        };
      }
    }

    const latest = dispatches[0] ?? null;
    return { activeDispatch: liveDispatch ?? null, latestDispatch: latest, entries: byEntry };
  }

  /** Full per-employee result of one dispatch (names resolved), vendor-scoped. */
  async dispatchDetail(user: AuthUser, dispatchId: string) {
    const dispatch = await this.prisma.payrollSlipDispatch.findFirst({
      where: { id: dispatchId, vendorId: user.vendorId },
      include: { deliveries: { orderBy: { createdAt: 'asc' } } },
    });
    if (!dispatch) throw new NotFoundException('Slip dispatch not found.');
    const users = await this.prisma.user.findMany({
      where: { id: { in: dispatch.deliveries.map((d) => d.userId) }, vendorId: user.vendorId },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const { deliveries, ...rest } = dispatch;
    return {
      ...rest,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        entryId: d.payrollEntryId,
        userId: d.userId,
        name: nameById.get(d.userId) ?? 'Unknown',
        status: d.status,
        error: d.error,
        sentAt: d.sentAt,
        finalPayable: d.finalPayable,
      })),
    };
  }

  /** One employee's slip as a PDF for download (any status — a non-final slip is stamped NOT FINAL). Vendor-scoped. */
  async slipPdf(user: AuthUser, entryId: string): Promise<{ buffer: Buffer; filename: string }> {
    const built = await this.buildSlipForEntry(user.vendorId, entryId);
    if (!built) throw new NotFoundException('Payroll entry not found.');
    return {
      buffer: await this.pdf.generate(built.slip),
      filename: slipFilename(built.slip.employeeName, built.slip.periodLabel),
    };
  }

  // ─── Worker side ────────────────────────────────────────────────────────────

  /**
   * Sends every QUEUED delivery of a dispatch, one at a time. Called by `PayrollSlipProcessor`.
   * Order per slip: connectivity check → send → persist result → randomized delay (never after the last).
   * Every result is written immediately, so a crash/re-run only ever picks up rows still QUEUED.
   */
  async runDispatch(dispatchId: string): Promise<void> {
    const dispatch = await this.prisma.payrollSlipDispatch.findUnique({ where: { id: dispatchId } });
    if (!dispatch || !ACTIVE_DISPATCH_STATUSES.includes(dispatch.status)) return;

    await this.prisma.payrollSlipDispatch.update({
      where: { id: dispatchId },
      data: { status: PayrollSlipDispatchStatus.RUNNING, startedAt: dispatch.startedAt ?? new Date() },
    });

    const rows = await this.prisma.payrollSlipDelivery.findMany({
      where: { dispatchId, status: PayrollSlipDeliveryStatus.QUEUED },
      orderBy: { createdAt: 'asc' },
    });

    let { sent, skipped, failed } = dispatch;
    let aborted = false;
    let consecutiveFailures = 0;

    // A previous run of this job died with a WhatsApp call in flight: whether that message arrived is unknown,
    // so it is NEVER retried automatically — it is reported, and the admin decides.
    const interrupted = await this.prisma.payrollSlipDelivery.updateMany({
      where: { dispatchId, status: PayrollSlipDeliveryStatus.SENDING },
      data: {
        status: PayrollSlipDeliveryStatus.FAILED,
        error: 'Interrupted while sending — it may or may not have been delivered. Check WhatsApp before sending again.',
      },
    });
    failed += interrupted.count;

    try {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // WhatsApp dropped mid-batch — stop instead of burning 5–12s per remaining employee.
        if (!this.whatsapp.isReady()) {
          this.logger.warn(`WhatsApp disconnected mid-batch — aborting dispatch ${dispatchId}, ${rows.length - i} slip(s) remaining`);
          await this.prisma.payrollSlipDelivery.updateMany({
            where: { id: { in: rows.slice(i).map((r) => r.id) }, status: PayrollSlipDeliveryStatus.QUEUED },
            data: { status: PayrollSlipDeliveryStatus.SKIPPED_DISCONNECTED, error: 'WhatsApp disconnected — not sent.' },
          });
          skipped += rows.length - i;
          aborted = true;
          break;
        }

        // Claim the row (QUEUED -> SENDING) so a re-delivered / concurrent run can never send it a second time.
        const claim = await this.prisma.payrollSlipDelivery.updateMany({
          where: { id: row.id, status: PayrollSlipDeliveryStatus.QUEUED },
          data: { status: PayrollSlipDeliveryStatus.SENDING },
        });
        if (claim.count === 0) continue;

        const outcome = await this.sendOne(row);
        await this.prisma.payrollSlipDelivery.update({
          where: { id: row.id },
          data: {
            status: outcome.status,
            error: outcome.error ?? null,
            ...(outcome.status === PayrollSlipDeliveryStatus.SENT ? { sentAt: new Date() } : {}),
            ...(outcome.finalPayable !== undefined
              ? { finalPayable: outcome.finalPayable, entryVersion: outcome.entryVersion }
              : {}),
          },
        });
        if (outcome.status === PayrollSlipDeliveryStatus.SENT) sent++;
        else if (outcome.status === PayrollSlipDeliveryStatus.FAILED) failed++;
        else skipped++;
        await this.prisma.payrollSlipDispatch.update({ where: { id: dispatchId }, data: { sent, skipped, failed } });

        consecutiveFailures = outcome.status === PayrollSlipDeliveryStatus.FAILED ? consecutiveFailures + 1 : 0;
        if (consecutiveFailures >= SLIP_MAX_CONSECUTIVE_FAILURES && i < rows.length - 1) {
          const rest = await this.prisma.payrollSlipDelivery.updateMany({
            where: { id: { in: rows.slice(i + 1).map((r) => r.id) }, status: PayrollSlipDeliveryStatus.QUEUED },
            data: {
              status: PayrollSlipDeliveryStatus.FAILED,
              error: `Not attempted — the batch stopped after ${SLIP_MAX_CONSECUTIVE_FAILURES} failures in a row (check the WhatsApp connection and that the salary_slip template is approved).`,
            },
          });
          failed += rest.count;
          aborted = true;
          this.logger.warn(`Slip dispatch ${dispatchId} stopped after ${SLIP_MAX_CONSECUTIVE_FAILURES} consecutive failures`);
          await this.prisma.payrollSlipDispatch.update({ where: { id: dispatchId }, data: { sent, skipped, failed } });
          break;
        }

        // Pause only after a real send attempt, and never after the last one.
        const attempted =
          outcome.status === PayrollSlipDeliveryStatus.SENT || outcome.status === PayrollSlipDeliveryStatus.FAILED;
        if (attempted && i < rows.length - 1) await this.sendDelay();
      }
    } catch (err) {
      this.logger.error(`Slip dispatch ${dispatchId} crashed: ${(err as Error).message}`);
      await this.failDispatch(dispatchId, (err as Error).message);
      return;
    }

    await this.prisma.payrollSlipDispatch.update({
      where: { id: dispatchId },
      data: {
        status: aborted ? PayrollSlipDispatchStatus.ABORTED : PayrollSlipDispatchStatus.COMPLETED,
        sent,
        skipped,
        failed,
        finishedAt: new Date(),
      },
    });
  }

  /** Builds + sends one slip. Never throws — every failure becomes a FAILED result with a short reason. */
  private async sendOne(row: {
    payrollEntryId: string;
    vendorId: string;
  }): Promise<{ status: PayrollSlipDeliveryStatus; error?: string; finalPayable?: number; entryVersion?: number }> {
    try {
      const built = await this.buildSlipForEntry(row.vendorId, row.payrollEntryId);
      if (!built) return { status: PayrollSlipDeliveryStatus.FAILED, error: 'Payroll entry no longer exists.' };
      const { slip, entry, phone } = built;
      if (!isSlipEligibleStatus(entry.status)) {
        return { status: PayrollSlipDeliveryStatus.FAILED, error: 'Entry is no longer approved — slip not sent.' };
      }
      const snapshot = { finalPayable: entry.finalPayable, entryVersion: entry.version };
      if (!phone) {
        return { status: PayrollSlipDeliveryStatus.SKIPPED_NO_PHONE, error: SLIP_VERDICT_REASON.NO_PHONE, ...snapshot };
      }

      const buffer = await this.pdf.generate(slip);
      const sent = await this.whatsapp.sendTemplate(
        phone,
        CloudTemplateNames.SALARY_SLIP,
        // Meta rejects newlines / tabs / runs of spaces inside a template parameter.
        [slip.employeeName.replace(/\s+/g, ' ').trim(), slip.periodLabel, formatRupees(slip.finalPayable)],
        { buffer, filename: slipFilename(slip.employeeName, slip.periodLabel) },
      );
      return sent
        ? { status: PayrollSlipDeliveryStatus.SENT, ...snapshot }
        : {
            status: PayrollSlipDeliveryStatus.FAILED,
            error: 'Not delivered, or delivery could not be confirmed — WhatsApp not ready, template not approved, number not registered, or a message went to this number less than a minute ago. Check the employee’s WhatsApp before sending again.',
            ...snapshot,
          };
    } catch (err) {
      return { status: PayrollSlipDeliveryStatus.FAILED, error: ((err as Error).message ?? 'Unknown error').slice(0, 300) };
    }
  }

  /**
   * One employee's slip content — ONLY that employee's own data, vendor-scoped. Returns null when the entry
   * is not in this vendor. `phone` is the normalized sendable number or null.
   */
  async buildSlipForEntry(vendorId: string, entryId: string) {
    const entry = await this.prisma.payrollEntry.findFirst({
      where: { id: entryId, vendorId },
      include: { period: true, user: { select: { id: true, name: true, role: true, phoneNumber: true } } },
    });
    if (!entry) return null;

    const [vendor, { attendance }] = await Promise.all([
      this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } }),
      this.payrollEntries.attendanceSummaryFor(vendorId, entry.userId, entry.period),
    ]);

    const slip = buildSalarySlip({
      vendorName: vendor?.name ?? '',
      employee: { name: entry.user.name, role: String(entry.user.role) },
      period: entry.period,
      entry,
      attendance,
    });
    const phone = isSendablePhone(entry.user.phoneNumber) ? normalizePhone(entry.user.phoneNumber) : null;
    return { slip, entry, phone };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async assertNoActiveDispatch(client: Pick<PrismaService, 'payrollSlipDispatch'>, vendorId: string) {
    const active = await client.payrollSlipDispatch.findFirst({
      where: { vendorId, ...liveDispatchWhere() },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({
        message: 'A salary-slip send is already in progress. Wait for it to finish.',
        code: 'SLIP_DISPATCH_ACTIVE',
        dispatchId: active.id,
      });
    }
  }

  private async requirePeriod(vendorId: string, periodId: string) {
    const period = await this.prisma.payrollPeriod.findFirst({
      where: { id: periodId, vendorId },
      select: { id: true, periodLabel: true },
    });
    if (!period) throw new NotFoundException('Payroll period not found.');
    return period;
  }

  /** Loads the period's entries (optionally a subset) and classifies each. Vendor + period scoped. */
  private async classify(vendorId: string, periodId: string, entryIds?: string[]) {
    const period = await this.requirePeriod(vendorId, periodId);
    const wanted = entryIds ? [...new Set(entryIds)] : undefined;

    const entries = await this.prisma.payrollEntry.findMany({
      where: { periodId, vendorId, ...(wanted ? { id: { in: wanted } } : {}) },
      include: { user: { select: { id: true, name: true, role: true, phoneNumber: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    if (wanted && entries.length !== wanted.length) {
      throw new NotFoundException('One or more payroll entries were not found in this period.');
    }

    const lastSent = await this.lastSentByEntry(
      vendorId,
      entries.map((e) => e.id),
    );

    const items: SlipPreviewItem[] = entries.map((e) => {
      const verdict = classifySlipEntry(e, e.user.phoneNumber);
      const sent = lastSent.get(e.id);
      return {
        entryId: e.id,
        userId: e.userId,
        name: e.user.name,
        role: String(e.user.role),
        status: e.status,
        finalPayable: e.finalPayable,
        verdict,
        reason: verdict === 'ELIGIBLE' ? null : SLIP_VERDICT_REASON[verdict],
        alreadySent: sent
          ? { sentAt: sent.sentAt, finalPayable: sent.finalPayable, amountChanged: sent.finalPayable !== e.finalPayable }
          : null,
      };
    });
    return { period, items, phoneByUser: new Map(entries.map((e) => [e.userId, e.user.phoneNumber])) };
  }

  private counts(items: SlipPreviewItem[]) {
    return {
      total: items.length,
      eligible: items.filter((i) => i.verdict === 'ELIGIBLE').length,
      notFinal: items.filter((i) => i.verdict === 'NOT_FINAL').length,
      noPhone: items.filter((i) => i.verdict === 'NO_PHONE').length,
      alreadySent: items.filter((i) => i.verdict === 'ELIGIBLE' && i.alreadySent).length,
    };
  }

  private async lastSentByEntry(vendorId: string, entryIds: string[]) {
    const result = new Map<string, { sentAt: Date | null; finalPayable: number }>();
    if (entryIds.length === 0) return result;
    const rows = await this.prisma.payrollSlipDelivery.findMany({
      where: { vendorId, payrollEntryId: { in: entryIds }, status: PayrollSlipDeliveryStatus.SENT },
      orderBy: { sentAt: 'desc' },
      select: { payrollEntryId: true, sentAt: true, finalPayable: true },
    });
    for (const r of rows) if (!result.has(r.payrollEntryId)) result.set(r.payrollEntryId, r);
    return result;
  }

  private async failDispatch(dispatchId: string, reason: string) {
    await this.prisma.payrollSlipDelivery.updateMany({
      where: { dispatchId, status: PayrollSlipDeliveryStatus.QUEUED },
      data: { status: PayrollSlipDeliveryStatus.FAILED, error: reason },
    });
    const failed = await this.prisma.payrollSlipDelivery.count({ where: { dispatchId, status: PayrollSlipDeliveryStatus.FAILED } });
    await this.prisma.payrollSlipDispatch.update({
      where: { id: dispatchId },
      data: { status: PayrollSlipDispatchStatus.FAILED, failed, finishedAt: new Date() },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Random human-like pause (SLIP_SEND_DELAY_MIN_MS–SLIP_SEND_DELAY_MAX_MS) — never a static interval. */
  protected sendDelay(): Promise<void> {
    const ms = SLIP_SEND_DELAY_MIN_MS + Math.floor(Math.random() * (SLIP_SEND_DELAY_MAX_MS - SLIP_SEND_DELAY_MIN_MS));
    return this.sleep(ms);
  }
}
