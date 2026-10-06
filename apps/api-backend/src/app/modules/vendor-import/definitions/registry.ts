import type { ImportEntity } from '@prisma/client';
import { ImportError } from '../import.types';
import type { ImportDefinition } from './import-definition';
import { customersOpeningDefinition } from './customers-opening.definition';

/**
 * Entity registry — the extension seam (design doc §3, §12). Adding an importable entity =
 * implement `ImportDefinition` + add an `ImportEntity` enum value + register it here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDefinition = ImportDefinition<any, any, any, any>;

const DEFINITIONS: Partial<Record<ImportEntity, AnyDefinition>> = {
  CUSTOMERS_OPENING: customersOpeningDefinition,
};

export function getDefinition(entity: string): AnyDefinition {
  const def = DEFINITIONS[entity as ImportEntity];
  if (!def) throw new ImportError('UNKNOWN_ENTITY', `"${entity}" is not an importable entity.`, 404);
  return def;
}

export function listDefinitions(): { entity: ImportEntity; label: string }[] {
  return (Object.entries(DEFINITIONS) as [ImportEntity, AnyDefinition][]).map(([entity, d]) => ({ entity, label: d.label }));
}
