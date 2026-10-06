import type { ImportEntity, Prisma } from '@prisma/client';
import type { PrismaService } from '@water-supply-crm/database';
import type {
  ImportFieldDef,
  ImportMapping,
  NormalizedRowResult,
  PlanSummary,
  PlannedRow,
  RawRow,
  RowIssue,
} from '../import.types';

/** Facts the options parser needs about the vendor and about which fields the user mapped. */
export interface OptionsInfo {
  mappedFieldKeys: Set<string>;
  activeProducts: { id: string; name: string; basePrice: number }[];
}

export interface ExecOutcome {
  result: 'CREATED' | 'SKIPPED' | 'FAILED';
  resultCode?: string;
  /** Customer-safe: appears in downloadable reports. */
  resultMessage?: string;
  entityId?: string;
  entityType?: string;
  appliedSnapshot?: Prisma.InputJsonValue;
}

export interface ExecRow<N> {
  rowNumber: number;
  normalized: N;
}

export interface RevertRowInput {
  rowId: string;
  entityId: string;
  appliedSnapshot: unknown;
}

export interface RevertOutcome {
  rowId: string;
  result: 'REVERTED' | 'REVERT_SKIPPED';
  resultCode?: string;
  resultMessage?: string;
}

/**
 * One importable entity (design doc §3, "entity registry"). The pipeline in `ImportService`
 * is entity-agnostic; everything entity-specific lives behind this interface, so a new import
 * type is a new definition, not a new pipeline.
 *
 * Stage ownership: `normalizeRow` = Map/Normalize, `validateAndPlan` = Validate + Plan,
 * `prepareExecution`/`executeRow` = Execute, `revertRows` = History/Revert. Business rules live
 * here — never in the file parser.
 */
export interface ImportDefinition<N = unknown, O = unknown, C = unknown, E = unknown> {
  readonly entity: ImportEntity;
  readonly label: string;
  readonly fields: ImportFieldDef[];

  /** Fields that must be mapped before a plan can be built (any-of groups allowed). */
  requiredMappings(): { anyOf: string[]; message: string }[];

  /** Validate user-supplied options against what was mapped. Throws `ImportError`. */
  parseOptions(raw: unknown, info: OptionsInfo): O;

  normalizeRow(raw: RawRow, mapping: ImportMapping, options: O): NormalizedRowResult<N>;

  loadContext(prisma: PrismaService, vendorId: string, options: O): Promise<C>;

  validateAndPlan(
    rows: { rowNumber: number; normalized: N | null; issues: RowIssue[] }[],
    ctx: C,
    options: O,
  ): PlannedRow<N>[];

  summarize(planned: PlannedRow<N>[]): PlanSummary;

  prepareExecution(prisma: PrismaService, vendorId: string, rows: ExecRow<N>[], options: O): Promise<E>;
  /**
   * Execute ONE row. A successful write must call `record(tx, outcome)` INSIDE its own
   * transaction so the domain write and the `ImportRow` result commit atomically — that is
   * what makes Resume safe (a PENDING row is guaranteed to have created nothing).
   */
  executeRow(
    prisma: PrismaService,
    vendorId: string,
    row: ExecRow<N>,
    exec: E,
    options: O,
    record: (tx: Prisma.TransactionClient, outcome: ExecOutcome) => Promise<void>,
  ): Promise<ExecOutcome>;

  /** Safe revert of untouched created entities (design doc §5.6). */
  revertRows(prisma: PrismaService, vendorId: string, rows: RevertRowInput[], dryRun: boolean): Promise<RevertOutcome[]>;

  /** Column headers + sample row for the downloadable pre-mapped template. */
  templateSample(): { headers: string[]; example: (string | number)[] };
}
