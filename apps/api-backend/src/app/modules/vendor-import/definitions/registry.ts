import type { ImportEntity } from '@prisma/client';
import { IMPORT_LIMITS } from '../import.constants';
import { ImportError } from '../import.types';
import type { ImportDefinition } from './import-definition';
import { customersOpeningDefinition } from './customers-opening.definition';
import { transactionHistoryDefinition } from './transaction-history.definition';

/**
 * Entity registry — the extension seam (design doc §3, §12). Adding an importable entity =
 * implement `ImportDefinition` + add an `ImportEntity` enum value + register it here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDefinition = ImportDefinition<any, any, any, any>;

const DEFINITIONS: Partial<Record<ImportEntity, AnyDefinition>> = {
  CUSTOMERS_OPENING: customersOpeningDefinition,
  TRANSACTION_HISTORY: transactionHistoryDefinition,
};

export function getDefinition(entity: string): AnyDefinition {
  const def = DEFINITIONS[entity as ImportEntity];
  if (!def) throw new ImportError('UNKNOWN_ENTITY', `"${entity}" is not an importable entity.`, 404);
  return def;
}

export function listDefinitions(): { entity: ImportEntity; label: string; accept: string[]; asyncPlan: boolean; maxFileMb: number; maxRows: number }[] {
  return (Object.entries(DEFINITIONS) as [ImportEntity, AnyDefinition][]).map(([entity, d]) => ({
    entity,
    label: d.label,
    accept: ['.xlsx', '.csv', ...(d.htmlFormat ? ['.html', '.htm'] : [])],
    asyncPlan: !!d.asyncPlan,
    maxFileMb: Math.round((d.limits?.maxFileBytes ?? IMPORT_LIMITS.maxFileBytes) / 1024 / 1024),
    maxRows: d.limits?.maxRows ?? IMPORT_LIMITS.maxRows,
  }));
}
