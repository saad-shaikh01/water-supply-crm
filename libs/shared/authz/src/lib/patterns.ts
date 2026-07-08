/**
 * Wildcard permission patterns + the core matcher.
 *
 * A *grant* (role permission or override) may be an exact permission or a wildcard:
 *   - `*`            → every permission (super-admin)
 *   - `resource:*`   → every action on that resource (incl. its `:page`)
 *   - `resource:act` → one exact permission
 *
 * A *check* is always an exact `Permission` (you ask `can('customers:update')`,
 * never `can('customers:*')`). The matcher is framework-agnostic and pure.
 */
import {
  isPermission,
  splitPermission,
  PERMISSION_CATALOG,
  PERMISSIONS,
  RESOURCES,
  type Permission,
  type Resource,
} from './permissions';

/** `*` — grants everything. */
export type GlobalWildcard = '*';
/** `resource:*` — grants every action on one resource. */
export type ResourceWildcard = `${Resource}:*`;
/** Anything storable as a grant: an exact permission or a wildcard. */
export type PermissionPattern = Permission | GlobalWildcard | ResourceWildcard;

const RESOURCE_SET: ReadonlySet<string> = new Set(RESOURCES);

/** Runtime guard: is the value a valid grant pattern (exact or wildcard)? */
export function isPermissionPattern(value: unknown): value is PermissionPattern {
  if (typeof value !== 'string') return false;
  if (value === '*') return true;
  if (value.endsWith(':*')) return RESOURCE_SET.has(value.slice(0, -2));
  return isPermission(value);
}

/** Does a single grant pattern satisfy an exact required permission? */
export function patternMatches(pattern: PermissionPattern, required: Permission): boolean {
  if (pattern === '*') return true;
  if (pattern === required) return true;
  if (pattern.endsWith(':*')) {
    return required.startsWith(`${pattern.slice(0, -2)}:`);
  }
  return false;
}

/**
 * Does any granted pattern satisfy the required permission? Wildcard-aware.
 * O(1) for a `Set` of concrete/wildcard grants; O(n) for other iterables.
 */
export function hasPermission(
  granted: Iterable<PermissionPattern>,
  required: Permission,
): boolean {
  if (granted instanceof Set) {
    if (granted.has('*')) return true;
    if (granted.has(required)) return true;
    const [resource] = splitPermission(required);
    return granted.has(`${resource}:*` as PermissionPattern);
  }
  for (const pattern of granted) {
    if (patternMatches(pattern, required)) return true;
  }
  return false;
}

/** True if any of the required permissions is granted. */
export function hasAnyPermission(
  granted: Iterable<PermissionPattern>,
  required: readonly Permission[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.some((r) => hasPermission(set, r));
}

/** True only if every required permission is granted. */
export function hasAllPermissions(
  granted: Iterable<PermissionPattern>,
  required: readonly Permission[],
): boolean {
  const set = granted instanceof Set ? granted : new Set(granted);
  return required.every((r) => hasPermission(set, r));
}

/**
 * Expand a grant pattern into the concrete catalog permissions it covers.
 *
 * Total by design: unknown resources or stale/renamed permission strings (which can
 * survive in the DB across catalog changes) expand to `[]` instead of throwing, so the
 * resolver never breaks on stale data. The result is always a subset of the catalog.
 */
export function expandPattern(pattern: PermissionPattern): Permission[] {
  if (pattern === '*') return [...PERMISSIONS];
  if (pattern.endsWith(':*')) {
    const resource = pattern.slice(0, -2);
    if (!RESOURCE_SET.has(resource)) return []; // unknown/stale resource → ignore
    return PERMISSION_CATALOG[resource as Resource].actions.map(
      (a) => `${resource}:${a}` as Permission,
    );
  }
  // Exact permission — keep only if it still exists in the catalog.
  return isPermission(pattern) ? [pattern] : [];
}
