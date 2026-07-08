/**
 * Effective-permission resolver — the layered merge defined in rbac-design.md §3.1:
 *
 *   effective = ( ∪ role grants )
 *             ∪ ( ALLOW overrides, not expired )   // additive per-user
 *             − ( DENY  overrides, not expired )   // subtractive, DENY always wins
 *
 * Wildcards are expanded against the frozen catalog *before* subtraction, so a DENY
 * reliably removes a permission even when the role granted it via `*` or `resource:*`.
 * The result is a concrete, deduplicated, sorted `Permission[]` — cache-friendly,
 * safe to send to the client, and O(1) to check via `createPermissionChecker`.
 *
 * Pure and deterministic: no clock reads unless `now` is omitted, no I/O, no framework.
 */
import type { Permission } from './permissions';
import { expandPattern, hasPermission, type PermissionPattern } from './patterns';

export type OverrideEffect = 'ALLOW' | 'DENY';

/** A per-user override row (shape mirrors the future `UserPermissionOverride`). */
export interface PermissionOverrideInput {
  permission: PermissionPattern;
  effect: OverrideEffect;
  /** null/undefined = permanent. Past dates are ignored. */
  expiresAt?: Date | string | null;
}

export interface ResolveInput {
  /** The user's role grants (may include wildcards). */
  rolePermissions: Iterable<PermissionPattern>;
  /** Optional per-user overrides. */
  overrides?: Iterable<PermissionOverrideInput>;
  /** Reference time for expiry checks (defaults to now). Inject for deterministic tests. */
  now?: Date;
}

function isExpired(expiresAt: Date | string | null | undefined, now: Date): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return at.getTime() <= now.getTime();
}

/**
 * Resolve a user's effective concrete permission set. See module docs for the rules.
 */
export function resolveEffectivePermissions(input: ResolveInput): Permission[] {
  const { rolePermissions, overrides = [], now = new Date() } = input;

  const effective = new Set<Permission>();

  // 1. Role grants (expanded).
  for (const grant of rolePermissions) {
    for (const p of expandPattern(grant)) effective.add(p);
  }

  // Filter expired overrides once; keep declaration order otherwise irrelevant
  // because ALLOW is applied fully before DENY (DENY wins deterministically).
  const active: PermissionOverrideInput[] = [];
  for (const o of overrides) {
    if (!isExpired(o.expiresAt, now)) active.push(o);
  }

  // 2. ALLOW overrides (additive).
  for (const o of active) {
    if (o.effect === 'ALLOW') for (const p of expandPattern(o.permission)) effective.add(p);
  }

  // 3. DENY overrides (subtractive, always wins).
  for (const o of active) {
    if (o.effect === 'DENY') for (const p of expandPattern(o.permission)) effective.delete(p);
  }

  return [...effective].sort();
}

/**
 * Build an O(1) checker over an already-resolved (concrete) permission set.
 * Wildcard-aware, so it is also safe to pass a raw pattern set if ever needed.
 */
export function createPermissionChecker(
  effective: Iterable<PermissionPattern>,
): (required: Permission) => boolean {
  const set = effective instanceof Set ? effective : new Set(effective);
  return (required: Permission) => hasPermission(set, required);
}
