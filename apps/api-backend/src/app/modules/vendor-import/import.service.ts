import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { extname } from 'path';
import * as ExcelJS from 'exceljs';
import { ImportBatchStatus, ImportEntity, Prisma } from '@prisma/client';
import { PrismaService } from '@water-supply-crm/database';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import { CACHE_KEYS, CacheInvalidationService } from '@water-supply-crm/caching';
import type { AuthUser } from '@water-supply-crm/types';
import { StorageService } from '../../common/storage/storage.service';
import { paginate } from '../../common/helpers/paginate';
import { AuditService } from '../audit/audit.service';
import { getDefinition, listDefinitions } from './definitions/registry';
import { ALLOWED_UPLOAD_EXTENSIONS, IMPORT_LIMITS } from './import.constants';
import { ImportError } from './import.types';
import type { ImportMapping, PlanSummary, RawRow } from './import.types';
import { headerFingerprint, suggestMapping } from './pipeline/column-mapper';
import { parseImportFile } from './pipeline/file-parser';
import { computePlanHash } from './pipeline/plan';
import type { ExecuteImportDto, ImportListQueryDto, ImportRowsQueryDto, SaveMappingDto, UploadImportDto } from './dto/import.dto';
import { SKIP_ROW_VALUE } from './definitions/customers-opening.definition';

const DRAFT_STATUSES: ImportBatchStatus[] = ['UPLOADED', 'MAPPED'];
const REVERTIBLE_STATUSES: ImportBatchStatus[] = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_REVERTED'];
/** A QUEUED/EXECUTING batch untouched this long is considered dead and may be resumed. */
const STALE_RUN_MS = 5 * 60 * 1000;
const WRITE_CHUNK = 250;
const SAMPLE_ROWS = 10;

export interface BatchSummary {
  plan?: PlanSummary;
  progress?: { created: number; skipped: number; failed: number; pending: number };
  revert?: { state: 'RUNNING' | 'DONE'; startedAt: string; reverted?: number; skipped?: number; byReason?: Record<string, number> };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Cells starting with = + - @ would be executed as formulas by Excel — neutralise them. */
function safeCell(v: unknown): ExcelJS.CellValue {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return `'${v}`;
  return (v ?? null) as ExcelJS.CellValue;
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly cache: CacheInvalidationService,
    @InjectQueue(QUEUE_NAMES.VENDOR_IMPORT) private readonly queue: Queue,
  ) {}

  // ── helpers ───────────────────────────────────────────────────────────────

  async batchOrThrow(vendorId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, vendorId } });
    if (!batch) throw new ImportError('NOT_FOUND', 'Import not found.', 404);
    return batch;
  }

  private async headersOf(batchId: string): Promise<string[]> {
    const first = await this.prisma.importRow.findFirst({ where: { batchId }, orderBy: { rowNumber: 'asc' }, select: { raw: true } });
    return first ? Object.keys(first.raw as RawRow) : [];
  }

  private async activeProducts(vendorId: string) {
    return this.prisma.product.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, name: true, basePrice: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── catalogue ─────────────────────────────────────────────────────────────

  entities() {
    return listDefinitions();
  }

  async buildTemplate(entity: string): Promise<Buffer> {
    const def = getDefinition(entity);
    const { headers, example } = def.templateSample();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(def.label.slice(0, 30));
    ws.addRow(headers).font = { bold: true };
    ws.addRow(example);
    ws.columns.forEach((c) => (c.width = 20));

    const help = wb.addWorksheet('Instructions');
    help.addRow(['Column', 'Required', 'Notes']).font = { bold: true };
    for (const f of def.fields) help.addRow([f.label, f.required ? 'Yes' : 'No', f.help ?? '']);
    help.addRow([]);
    help.addRow(['You do not have to use this template — upload your own Excel and map its columns in the next step.']);
    help.columns = [{ width: 32 }, { width: 10 }, { width: 70 }];
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── upload ────────────────────────────────────────────────────────────────

  async createBatch(user: AuthUser, entity: string, file: Express.Multer.File | undefined, dto: UploadImportDto) {
    const def = getDefinition(entity);
    if (!file) throw new ImportError('NO_FILE', 'No file was uploaded.', 400);
    const ext = extname(file.originalname).toLowerCase();
    if (!(ALLOWED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ImportError('UNSUPPORTED_TYPE', 'Only .xlsx and .csv files are supported.', 400);
    }
    if (file.size > IMPORT_LIMITS.maxFileBytes) {
      throw new ImportError('FILE_TOO_LARGE', `The file is larger than ${Math.round(IMPORT_LIMITS.maxFileBytes / 1024 / 1024)} MB.`, 400);
    }

    const parsed = await parseImportFile(file.buffer, ext, { sheetName: dto.sheetName, headerRowIndex: dto.headerRow });
    const sha = createHash('sha256').update(file.buffer).digest('hex');

    let key: string;
    try {
      ({ key } = await this.storage.upload('imports', file.buffer, file.originalname, file.mimetype, user.vendorId));
    } catch (e) {
      this.logger.error(`import upload to storage failed (vendor ${user.vendorId}): ${(e as Error).message}`);
      throw new ImportError('STORAGE_UNAVAILABLE', 'File storage is unavailable right now. Please try again shortly.', 503);
    }

    const batch = await this.prisma.importBatch.create({
      data: {
        vendorId: user.vendorId,
        entity: def.entity,
        status: 'UPLOADED',
        sourceFileKey: key,
        sourceFileName: file.originalname.slice(0, 200),
        sourceFileSize: file.size,
        sourceFileSha256: sha,
        sheetName: parsed.sheetName,
        headerRowIndex: parsed.headerRowIndex,
        rowCount: parsed.rows.length,
        createdById: user.userId,
        createdByName: user.name,
      },
    });

    try {
      for (let i = 0; i < parsed.rows.length; i += 1000) {
        await this.prisma.importRow.createMany({
          data: parsed.rows.slice(i, i + 1000).map((r) => ({ batchId: batch.id, rowNumber: r.rowNumber, raw: json(r.values) })),
        });
      }
    } catch (e) {
      await this.prisma.importBatch.delete({ where: { id: batch.id } }).catch(() => undefined);
      throw e;
    }

    if (dto.replaceBatchId) await this.discardDraft(user.vendorId, dto.replaceBatchId).catch(() => undefined);

    await this.audit.log({
      vendorId: user.vendorId,
      userId: user.userId,
      userName: user.name,
      action: 'IMPORT_UPLOADED',
      entity: 'ImportBatch',
      entityId: batch.id,
      changes: { after: { entity: def.entity, fileName: batch.sourceFileName, rows: batch.rowCount } },
    });

    return { ...(await this.wizard(user.vendorId, batch.id)), sheets: parsed.sheets };
  }

  /** Everything the wizard needs for a draft batch (also used to resume after a refresh). */
  async wizard(vendorId: string, id: string) {
    const batch = await this.batchOrThrow(vendorId, id);
    const def = getDefinition(batch.entity);
    const headers = await this.headersOf(batch.id);
    const sampleRows = (
      await this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: 'asc' }, take: SAMPLE_ROWS, select: { rowNumber: true, raw: true } })
    ).map((r) => ({ rowNumber: r.rowNumber, values: r.raw as RawRow }));

    const fingerprint = headerFingerprint(headers);
    const profile =
      (await this.prisma.importMappingProfile.findFirst({
        where: { vendorId, entity: batch.entity, fingerprint },
        orderBy: { lastUsedAt: { sort: 'desc', nulls: 'last' } },
      })) ??
      (await this.prisma.importMappingProfile.findFirst({ where: { isSystem: true, entity: batch.entity, fingerprint } }));

    const suggestions = suggestMapping({
      headers,
      sampleRows: sampleRows.map((r) => r.values),
      fields: def.fields,
      profileColumns: profile ? (profile.columnMap as Record<string, string | null>) : undefined,
    });

    const duplicate = await this.prisma.importBatch.findFirst({
      where: { vendorId, sourceFileSha256: batch.sourceFileSha256, id: { not: id }, status: { in: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_REVERTED'] } },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true, createdByName: true },
    });

    return {
      batch,
      headers,
      sampleRows,
      suggestions,
      matchedProfile: profile
        ? { id: profile.id, name: profile.name, isSystem: profile.isSystem, valueMaps: profile.valueMaps, optionDefaults: profile.optionDefaults }
        : null,
      fields: def.fields,
      activeProducts: await this.activeProducts(vendorId),
      duplicateOf: duplicate,
    };
  }

  // ── mapping → normalize → validate → plan ────────────────────────────────

  async columnValues(vendorId: string, id: string, header: string) {
    await this.batchOrThrow(vendorId, id);
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id }, select: { raw: true } });
    const counts = new Map<string, { value: string; count: number }>();
    for (const r of rows) {
      const v = (r.raw as RawRow)[header];
      if (v === null || v === undefined || v === '') continue;
      const text = String(v).trim();
      const k = text.toLowerCase();
      const e = counts.get(k);
      if (e) e.count++;
      else counts.set(k, { value: text, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 50);
  }

  async saveMapping(user: AuthUser, id: string, dto: SaveMappingDto) {
    const { vendorId } = user;
    const batch = await this.batchOrThrow(vendorId, id);
    if (!DRAFT_STATUSES.includes(batch.status)) {
      throw new ImportError('NOT_EDITABLE', 'This import can no longer be changed.', 409);
    }
    const def = getDefinition(batch.entity);
    const headers = await this.headersOf(id);

    // ── validate the mapping itself ──
    const columns: Record<string, string | null> = {};
    const seenFields = new Set<string>();
    for (const [header, key] of Object.entries(dto.columns ?? {})) {
      if (!headers.includes(header)) throw new ImportError('INVALID_MAPPING', `Column "${header}" is not in the file.`);
      if (!key) continue;
      if (!def.fields.some((f) => f.key === key)) throw new ImportError('INVALID_MAPPING', `Unknown field "${key}".`);
      if (seenFields.has(key)) throw new ImportError('FIELD_MAPPED_TWICE', `More than one column is mapped to "${key}".`);
      seenFields.add(key);
      columns[header] = key;
    }
    for (const req of def.requiredMappings()) {
      if (!req.anyOf.some((k) => seenFields.has(k))) throw new ImportError('REQUIRED_FIELD_UNMAPPED', req.message);
    }

    const valueMaps: ImportMapping['valueMaps'] = {};
    for (const [fieldKey, map] of Object.entries(dto.valueMaps ?? {})) {
      const f = def.fields.find((x) => x.key === fieldKey);
      if (!f?.enumValues || !seenFields.has(fieldKey)) continue;
      const allowed = new Set([...f.enumValues.map((e) => e.value), SKIP_ROW_VALUE]);
      valueMaps[fieldKey] = {};
      for (const [fileValue, target] of Object.entries(map ?? {})) {
        if (!allowed.has(target)) throw new ImportError('INVALID_MAPPING', `"${target}" is not a valid choice for ${f.label}.`);
        valueMaps[fieldKey][fileValue.trim().toLowerCase()] = target;
      }
    }
    const mapping: ImportMapping = { columns, valueMaps };

    const options = def.parseOptions(dto.options, {
      mappedFieldKeys: seenFields,
      activeProducts: await this.activeProducts(vendorId),
    });

    // ── normalize → validate → plan (the single path Preview and Execute both consume) ──
    const rows = await this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: 'asc' }, select: { id: true, rowNumber: true, raw: true } });
    const normalized = rows.map((r) => ({ id: r.id, rowNumber: r.rowNumber, ...def.normalizeRow(r.raw as RawRow, mapping, options) }));
    const ctx = await def.loadContext(this.prisma, vendorId, options);
    const planned = def.validateAndPlan(
      normalized.map((n) => ({ rowNumber: n.rowNumber, normalized: n.normalized, issues: n.issues })),
      ctx,
      options,
    );
    const plan = def.summarize(planned);
    const planHash = computePlanHash(planned, mapping, options);

    const idByRow = new Map(normalized.map((n) => [n.rowNumber, n.id]));
    for (let i = 0; i < planned.length; i += WRITE_CHUNK) {
      await this.prisma.$transaction(
        planned.slice(i, i + WRITE_CHUNK).map((p) =>
          this.prisma.importRow.update({
            where: { id: idByRow.get(p.rowNumber) as string },
            data: {
              normalized: p.normalized ? json(p.normalized) : Prisma.JsonNull,
              issues: p.issues.length ? json(p.issues) : Prisma.JsonNull,
              action: p.action,
              result: 'PENDING',
              resultCode: null,
              resultMessage: null,
            },
          }),
        ),
      );
    }

    // ── saved mapping profile ──
    let profileId: string | null = null;
    const fingerprint = headerFingerprint(headers);
    if (dto.saveProfileAs?.trim()) {
      const name = dto.saveProfileAs.trim();
      const data = {
        fingerprint,
        columnMap: json(columns),
        valueMaps: json(valueMaps),
        optionDefaults: json({
          balanceSign: options.balanceSign,
          codeStrategy: options.codeStrategy,
          defaultPaymentType: options.defaultPaymentType,
          areaIntoAddress: options.areaIntoAddress,
        }),
        lastUsedAt: new Date(),
      };
      const existing = await this.prisma.importMappingProfile.findFirst({ where: { vendorId, entity: batch.entity, name } });
      const saved = existing
        ? await this.prisma.importMappingProfile.update({ where: { id: existing.id }, data })
        : await this.prisma.importMappingProfile.create({ data: { ...data, vendorId, entity: batch.entity, name, createdById: user.userId } });
      profileId = saved.id;
    }

    const summary: BatchSummary = { plan };
    await this.prisma.importBatch.update({
      where: { id },
      data: {
        status: 'MAPPED',
        mapping: json(mapping),
        options: json(options),
        summary: json(summary),
        planHash,
        plannedAt: new Date(),
        profileId,
      },
    });

    return { planHash, summary: plan, options };
  }

  // ── reading ───────────────────────────────────────────────────────────────

  async list(vendorId: string, q: ImportListQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.ImportBatchWhereInput = {
      vendorId,
      ...(q.entity ? { entity: q.entity as ImportEntity } : {}),
      ...(q.status ? { status: q.status as ImportBatchStatus } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.importBatch.count({ where }),
      this.prisma.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    return paginate(data, total, page, limit);
  }

  async get(vendorId: string, id: string) {
    const batch = await this.batchOrThrow(vendorId, id);
    const draft = DRAFT_STATUSES.includes(batch.status);
    return { batch, wizard: draft ? await this.wizard(vendorId, id) : null };
  }

  async rows(vendorId: string, id: string, q: ImportRowsQueryDto) {
    await this.batchOrThrow(vendorId, id);
    const page = q.page ?? 1;
    const limit = q.limit ?? 50;
    const where: Prisma.ImportRowWhereInput = { batchId: id };
    if (q.action) where.action = q.action as never;
    if (q.result) where.result = q.result as never;
    if (q.severity) where.issues = { array_contains: [{ severity: q.severity }] };
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [
        { normalized: { path: ['name'], string_contains: s, mode: 'insensitive' } as never },
        { normalized: { path: ['customerCode'], string_contains: s, mode: 'insensitive' } as never },
        { normalized: { path: ['phoneNumber'], string_contains: s } as never },
      ];
    }
    const [total, data] = await Promise.all([
      this.prisma.importRow.count({ where }),
      this.prisma.importRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    return paginate(data, total, page, limit);
  }

  async sourceUrl(vendorId: string, id: string) {
    const batch = await this.batchOrThrow(vendorId, id);
    if (!batch.sourceFileKey) throw new ImportError('SOURCE_PURGED', 'The original file is no longer stored.', 404);
    return { signedUrl: await this.storage.getSignedUrl(batch.sourceFileKey), fileName: batch.sourceFileName };
  }

  async report(vendorId: string, id: string): Promise<{ buffer: Buffer; fileName: string }> {
    const batch = await this.batchOrThrow(vendorId, id);
    const headers = await this.headersOf(id);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Import report');
    ws.addRow(['Row', 'Outcome', 'Problems / notes', ...headers]).font = { bold: true };

    const outcomeText = (action: string | null, result: string) => {
      if (result === 'CREATED') return 'Created';
      if (result === 'FAILED') return 'Failed';
      if (result === 'SKIPPED') return 'Skipped';
      if (result === 'REVERTED') return 'Reverted';
      if (result === 'REVERT_SKIPPED') return 'Created (revert skipped)';
      return action === 'CREATE' ? 'Will be created' : action === 'SKIP_EXISTING' ? 'Skipped — already exists' : action === 'SKIP_INVALID' ? 'Skipped — has errors' : 'Not planned';
    };

    let cursor = 0;
    for (;;) {
      const chunk = await this.prisma.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: 'asc' }, skip: cursor, take: 1000 });
      if (!chunk.length) break;
      cursor += chunk.length;
      for (const r of chunk) {
        const issues = ((r.issues as { severity: string; message: string }[] | null) ?? []).map((i) => `${i.severity === 'ERROR' ? 'Error' : 'Warning'}: ${i.message}`);
        if (r.resultMessage) issues.push(r.resultMessage);
        const raw = r.raw as RawRow;
        ws.addRow([r.rowNumber, outcomeText(r.action, r.result), issues.join(' | '), ...headers.map((h) => safeCell(raw[h]))]);
      }
    }
    ws.columns.forEach((c, i) => (c.width = i < 3 ? (i === 2 ? 60 : 22) : 18));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `import-report-${batch.id.slice(0, 8)}.xlsx` };
  }

  // ── profiles ──────────────────────────────────────────────────────────────

  profiles(vendorId: string, entity?: string) {
    return this.prisma.importMappingProfile.findMany({
      where: { vendorId, ...(entity ? { entity: entity as ImportEntity } : {}) },
      orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
  }

  async deleteProfile(vendorId: string, id: string) {
    const res = await this.prisma.importMappingProfile.deleteMany({ where: { id, vendorId } });
    if (!res.count) throw new ImportError('NOT_FOUND', 'Mapping not found.', 404);
    return { deleted: true };
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  private async discardDraft(vendorId: string, id: string) {
    const batch = await this.prisma.importBatch.findFirst({ where: { id, vendorId } });
    if (!batch || !DRAFT_STATUSES.includes(batch.status)) return;
    await this.prisma.importRow.deleteMany({ where: { batchId: id } });
    await this.prisma.importBatch.update({ where: { id }, data: { status: 'CANCELLED', completedAt: new Date() } });
  }

  async cancel(user: AuthUser, id: string) {
    const batch = await this.batchOrThrow(user.vendorId, id);
    if (!DRAFT_STATUSES.includes(batch.status)) throw new ImportError('NOT_EDITABLE', 'Only a draft import can be cancelled.', 409);
    await this.discardDraft(user.vendorId, id);
    await this.audit.log({ vendorId: user.vendorId, userId: user.userId, userName: user.name, action: 'IMPORT_CANCELLED', entity: 'ImportBatch', entityId: id });
    return { cancelled: true };
  }

  async execute(user: AuthUser, id: string, dto: ExecuteImportDto) {
    const { vendorId } = user;
    const batch = await this.batchOrThrow(vendorId, id);
    const summary = (batch.summary as BatchSummary | null) ?? {};
    const stale = (batch.status === 'QUEUED' || batch.status === 'EXECUTING') && Date.now() - batch.updatedAt.getTime() > STALE_RUN_MS;
    const resuming = batch.status === 'FAILED' || stale;

    if (!(batch.status === 'MAPPED' || resuming)) {
      throw new ImportError(
        batch.status === 'QUEUED' || batch.status === 'EXECUTING' ? 'IMPORT_ALREADY_RUNNING' : 'NOT_EXECUTABLE',
        batch.status === 'QUEUED' || batch.status === 'EXECUTING' ? 'This import is already running.' : 'This import cannot be run in its current state.',
        409,
      );
    }
    if (!resuming) {
      if (!batch.planHash || dto.planHash !== batch.planHash) {
        throw new ImportError('PLAN_STALE', 'The preview is out of date. Review the plan again before importing.', 409);
      }
      if (!summary.plan || summary.plan.create === 0) throw new ImportError('NOTHING_TO_IMPORT', 'There is nothing to import — no valid new customers in this file.', 422);
      if (summary.plan.rowsWithWarnings > 0 && !dto.acknowledgeWarnings) {
        throw new ImportError('WARNINGS_NOT_ACKNOWLEDGED', 'Confirm that you reviewed the warnings.', 422);
      }
      const dup = await this.prisma.importBatch.findFirst({
        where: { vendorId, sourceFileSha256: batch.sourceFileSha256, id: { not: id }, status: { in: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'PARTIALLY_REVERTED'] } },
        select: { id: true },
      });
      if (dup && !dto.acknowledgeDuplicateFile) {
        throw new ImportError('DUPLICATE_FILE', 'This exact file was already imported. Confirm to run it again (existing customers will be skipped).', 409);
      }
    }

    const other = await this.prisma.importBatch.findFirst({
      where: {
        vendorId,
        id: { not: id },
        OR: [
          { status: { in: ['QUEUED', 'EXECUTING'] }, updatedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
        ],
      },
      select: { id: true },
    });
    if (other) throw new ImportError('IMPORT_ALREADY_RUNNING', 'Another import is running for this vendor. Wait for it to finish.', 409);

    // Atomic claim: only one caller can move the batch to QUEUED.
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id, vendorId, status: batch.status, updatedAt: batch.updatedAt },
      data: { status: 'QUEUED', errorCode: null, errorMessage: null },
    });
    if (!claimed.count) throw new ImportError('IMPORT_ALREADY_RUNNING', 'This import is already running.', 409);

    const job = await this.queue.add(
      JOB_NAMES.VENDOR_IMPORT_EXECUTE,
      { batchId: id, vendorId, userId: user.userId, userName: user.name },
      { jobId: `${id}-${Date.now()}`, attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
    );
    await this.prisma.importBatch.update({ where: { id }, data: { jobId: String(job.id) } });
    await this.audit.log({
      vendorId,
      userId: user.userId,
      userName: user.name,
      action: resuming ? 'IMPORT_RESUMED' : 'IMPORT_QUEUED',
      entity: 'ImportBatch',
      entityId: id,
      changes: { after: { plan: summary.plan } },
    });
    return { batchId: id, status: 'QUEUED' as const };
  }

  // ── revert ────────────────────────────────────────────────────────────────

  private async createdRows(batchId: string) {
    const rows = await this.prisma.importRow.findMany({
      where: { batchId, result: 'CREATED', entityId: { not: null } },
      select: { id: true, entityId: true, appliedSnapshot: true },
      orderBy: { rowNumber: 'asc' },
    });
    return rows.map((r) => ({ rowId: r.id, entityId: r.entityId as string, appliedSnapshot: r.appliedSnapshot }));
  }

  async revertPreview(vendorId: string, id: string) {
    const batch = await this.batchOrThrow(vendorId, id);
    if (!REVERTIBLE_STATUSES.includes(batch.status)) throw new ImportError('NOT_REVERTIBLE', 'This import cannot be reverted.', 409);
    const rows = await this.createdRows(id);
    const outcomes = await getDefinition(batch.entity).revertRows(this.prisma, vendorId, rows, true);
    const blocked: Record<string, { count: number; message: string }> = {};
    let revertible = 0;
    for (const o of outcomes) {
      if (o.result === 'REVERTED') revertible++;
      else {
        const k = o.resultCode ?? 'BLOCKED';
        blocked[k] = { count: (blocked[k]?.count ?? 0) + 1, message: o.resultMessage ?? '' };
      }
    }
    return { revertible, blocked: Object.entries(blocked).map(([reason, v]) => ({ reason, ...v })), total: rows.length };
  }

  async revert(user: AuthUser, id: string) {
    const batch = await this.batchOrThrow(user.vendorId, id);
    if (!REVERTIBLE_STATUSES.includes(batch.status)) throw new ImportError('NOT_REVERTIBLE', 'This import cannot be reverted.', 409);
    const summary = (batch.summary as BatchSummary | null) ?? {};
    if (summary.revert?.state === 'RUNNING' && Date.now() - batch.updatedAt.getTime() < STALE_RUN_MS) {
      throw new ImportError('REVERT_ALREADY_RUNNING', 'A revert is already running for this import.', 409);
    }
    await this.prisma.importBatch.update({
      where: { id },
      data: { summary: json({ ...summary, revert: { state: 'RUNNING', startedAt: new Date().toISOString() } }) },
    });
    await this.queue.add(
      JOB_NAMES.VENDOR_IMPORT_REVERT,
      { batchId: id, vendorId: user.vendorId, userId: user.userId, userName: user.name },
      { jobId: `${id}-revert-${Date.now()}`, attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } },
    );
    await this.audit.log({ vendorId: user.vendorId, userId: user.userId, userName: user.name, action: 'IMPORT_REVERT_QUEUED', entity: 'ImportBatch', entityId: id });
    return { batchId: id, revert: 'RUNNING' as const };
  }

  /** Called by the executor once a vendor's customer data changed. */
  async invalidateVendorCaches(vendorId: string) {
    await Promise.all([CACHE_KEYS.CUSTOMERS, CACHE_KEYS.WALLETS, CACHE_KEYS.DASHBOARD].map((k) => this.cache.invalidateVendorEntity(vendorId, k)));
  }
}
