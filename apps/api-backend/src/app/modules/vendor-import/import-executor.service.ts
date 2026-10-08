import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { AuditService } from '../audit/audit.service';
import type { ExecOutcome } from './definitions/import-definition';
import { getDefinition } from './definitions/registry';
import { IMPORT_EXEC_CHUNK } from './import.constants';
import type { BatchSummary } from './import.service';
import { ImportService } from './import.service';

export interface ImportJobData {
  batchId: string;
  vendorId: string;
  userId?: string;
  userName?: string;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * The only stage that writes domain tables (design doc §5.5). Runs inside the BullMQ worker.
 *
 *  - Rows go in file order, chunks of 100, but EACH ROW is its own transaction: one bad row
 *    never rolls back its neighbours.
 *  - The domain write and the `ImportRow` result commit in the same transaction, so a PENDING
 *    row is guaranteed to have created nothing — which is what makes Resume idempotent.
 *  - Progress is persisted per chunk (also acts as the heartbeat that `execute` uses to detect
 *    a dead run).
 */
@Injectable()
export class ImportExecutorService {
  private readonly logger = new Logger(ImportExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly imports: ImportService,
  ) {}

  private async progress(batchId: string, base: BatchSummary) {
    const grouped = await this.prisma.importRow.groupBy({ by: ['result'], where: { batchId, action: 'CREATE' }, _count: true });
    const n = (r: string) => grouped.find((g) => g.result === r)?._count ?? 0;
    const progress = { created: n('CREATED') + n('REVERTED') + n('REVERT_SKIPPED'), skipped: n('SKIPPED'), failed: n('FAILED'), pending: n('PENDING') };
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { summary: json({ ...base, progress }) } });
    return progress;
  }

  async run(data: ImportJobData): Promise<void> {
    const { batchId, vendorId } = data;
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, vendorId } });
    if (!batch) return;

    // Claim — a duplicate/stalled delivery of the same job cannot double-run.
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id: batchId, status: 'QUEUED' },
      data: { status: 'EXECUTING', startedAt: batch.startedAt ?? new Date() },
    });
    if (!claimed.count) return;

    try {
      const def = getDefinition(batch.entity);
      const options = batch.options as never;
      const base = (batch.summary as BatchSummary | null) ?? {};

      const pending = await this.prisma.importRow.findMany({
        where: { batchId, action: 'CREATE', result: { in: ['PENDING', 'FAILED'] } },
        orderBy: { rowNumber: 'asc' },
        select: { id: true, rowNumber: true, normalized: true },
      });
      const execRows = pending.map((r) => ({ rowNumber: r.rowNumber, normalized: r.normalized as never }));
      const exec = await def.prepareExecution(this.prisma, vendorId, execRows, options);

      for (let i = 0; i < pending.length; i += IMPORT_EXEC_CHUNK) {
        for (const row of pending.slice(i, i + IMPORT_EXEC_CHUNK)) {
          const write = (db: Prisma.TransactionClient | PrismaService, o: ExecOutcome) =>
            db.importRow.update({
              where: { id: row.id },
              data: {
                result: o.result,
                resultCode: o.resultCode ?? null,
                resultMessage: o.resultMessage ?? null,
                entityType: o.entityType ?? null,
                entityId: o.entityId ?? null,
                appliedSnapshot: o.appliedSnapshot ?? Prisma.JsonNull,
              },
            });
          const outcome = await def.executeRow(
            this.prisma,
            vendorId,
            { rowNumber: row.rowNumber, normalized: row.normalized as never },
            exec,
            options,
            async (tx, o) => {
              await write(tx, o);
            },
          );
          if (outcome.cause) {
            const c = outcome.cause as { code?: string; message?: string };
            this.logger.error(
              `import ${batchId} row ${row.rowNumber} ${outcome.resultCode}: ${c.code ?? ''} ${(c.message ?? '').split('\n').pop()}`,
            );
          }
          if (outcome.result !== 'CREATED') {
            // Guarded: if the row's transaction actually committed (the client can see a timeout after
            // the DB committed), its in-transaction CREATED record must not be overwritten by FAILED.
            await this.prisma.importRow.updateMany({
              where: { id: row.id, result: { in: ['PENDING', 'FAILED'] } },
              data: {
                result: outcome.result,
                resultCode: outcome.resultCode ?? null,
                resultMessage: outcome.resultMessage ?? null,
              },
            });
          }
        }
        await this.progress(batchId, base);
      }

      const p = await this.progress(batchId, base);
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: p.failed > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED', completedAt: new Date() },
      });
      await this.imports.invalidateVendorCaches(vendorId);
      await this.audit.log({
        vendorId,
        userId: data.userId,
        userName: data.userName,
        action: 'IMPORT_COMPLETED',
        entity: 'ImportBatch',
        entityId: batchId,
        changes: { after: { entity: batch.entity, ...p, plan: base.plan } },
      });
    } catch (e) {
      this.logger.error(`import ${batchId} failed: ${(e as Error).message}`, (e as Error).stack);
      await this.markFailed(batchId, 'INFRA_ERROR');
    }
  }

  async runRevert(data: ImportJobData): Promise<void> {
    const { batchId, vendorId } = data;
    const batch = await this.prisma.importBatch.findFirst({ where: { id: batchId, vendorId } });
    if (!batch) return;
    const def = getDefinition(batch.entity);
    const base = (batch.summary as BatchSummary | null) ?? {};

    try {
      const created = await this.prisma.importRow.findMany({
        where: { batchId, result: 'CREATED', entityId: { not: null } },
        select: { id: true, entityId: true, appliedSnapshot: true },
        orderBy: { rowNumber: 'asc' },
      });
      const outcomes = await def.revertRows(
        this.prisma,
        vendorId,
        created.map((r) => ({ rowId: r.id, entityId: r.entityId as string, appliedSnapshot: r.appliedSnapshot })),
        false,
      );

      const byReason: Record<string, number> = {};
      for (let i = 0; i < outcomes.length; i += 250) {
        await this.prisma.$transaction(
          outcomes.slice(i, i + 250).map((o) =>
            this.prisma.importRow.update({
              where: { id: o.rowId },
              data: { result: o.result, resultCode: o.resultCode ?? null, resultMessage: o.resultMessage ?? null },
            }),
          ),
        );
      }
      for (const o of outcomes) if (o.result === 'REVERT_SKIPPED') byReason[o.resultCode ?? 'BLOCKED'] = (byReason[o.resultCode ?? 'BLOCKED'] ?? 0) + 1;
      const reverted = outcomes.filter((o) => o.result === 'REVERTED').length;
      const skipped = outcomes.length - reverted;
      const stillCreated = await this.prisma.importRow.count({ where: { batchId, result: { in: ['CREATED', 'REVERT_SKIPPED'] } } });

      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: {
          status: stillCreated === 0 ? 'REVERTED' : 'PARTIALLY_REVERTED',
          revertedAt: new Date(),
          revertedById: data.userId ?? null,
          summary: json({ ...base, revert: { state: 'DONE', startedAt: base.revert?.startedAt ?? new Date().toISOString(), reverted, skipped, byReason } }),
        },
      });
      await this.imports.invalidateVendorCaches(vendorId);
      await this.audit.log({
        vendorId,
        userId: data.userId,
        userName: data.userName,
        action: 'IMPORT_REVERTED',
        entity: 'ImportBatch',
        entityId: batchId,
        changes: { after: { reverted, skipped, byReason } },
      });
    } catch (e) {
      this.logger.error(`import revert ${batchId} failed: ${(e as Error).message}`, (e as Error).stack);
      const { revert: _drop, ...rest } = base;
      void _drop;
      await this.prisma.importBatch.update({ where: { id: batchId }, data: { summary: json(rest) } }).catch(() => undefined);
    }
  }

  /** Execute-job failure that the loop itself could not handle (crash, stall, infra). */
  async markFailed(batchId: string, code: string) {
    await this.prisma.importBatch.updateMany({
      where: { id: batchId, status: { in: ['QUEUED', 'EXECUTING'] } },
      data: {
        status: 'FAILED',
        errorCode: code,
        errorMessage: 'The import was interrupted. Rows already imported are kept — press Resume to continue.',
      },
    });
  }
}
