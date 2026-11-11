export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface DiffEntry {
  path: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => v !== null && typeof v === 'object';

function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isContainer(a) || !isContainer(b)) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

const join = (path: string, key: string | number, parentIsArray: boolean) =>
  parentIsArray ? `${path}[${key}]` : path ? `${path}.${key}` : String(key);

/** Emit one entry per leaf of a value that exists on one side only. */
function flatten(path: string, value: unknown, kind: 'added' | 'removed', out: DiffEntry[]): void {
  const push = (v: unknown) =>
    out.push({ path: path || '(root)', kind, before: kind === 'removed' ? v : undefined, after: kind === 'added' ? v : undefined });
  if (!isContainer(value)) return void push(value);
  const isArr = Array.isArray(value);
  const keys = isArr ? value.map((_, i) => i) : Object.keys(value);
  if (keys.length === 0) return void push(value);
  for (const k of keys) flatten(join(path, k, isArr), (value as Record<string | number, unknown>)[k], kind, out);
}

function walk(path: string, a: unknown, b: unknown, out: DiffEntry[]): void {
  if (a === undefined && b === undefined) return;
  if (a === undefined) return flatten(path, b, 'added', out);
  if (b === undefined) return flatten(path, a, 'removed', out);
  if (isContainer(a) && isContainer(b) && Array.isArray(a) === Array.isArray(b)) {
    const isArr = Array.isArray(a);
    const keys = isArr
      ? Array.from({ length: Math.max((a as unknown[]).length, (b as unknown[]).length) }, (_, i) => i)
      : [...new Set([...Object.keys(a), ...Object.keys(b)])];
    if (keys.length === 0) return void out.push({ path: path || '(root)', kind: 'same', before: a, after: b });
    for (const k of keys) {
      walk(join(path, k, isArr), (a as Record<string | number, unknown>)[k], (b as Record<string | number, unknown>)[k], out);
    }
    return;
  }
  out.push({ path: path || '(root)', kind: sameJson(a, b) ? 'same' : 'changed', before: a, after: b });
}

/**
 * Flat, path-addressed diff of two JSON values. `null`/`undefined` at the top
 * level means "absent" (CREATE has no before, DELETE has no after).
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk('', before ?? undefined, after ?? undefined, out);
  return out;
}

export function formatDiffValue(v: unknown): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
