/**
 * Vendor data wipe — planner.
 *
 * Pure (no DB): turns the Prisma datamodel into the SQL needed to remove every row that belongs to
 * ONE vendor, in a foreign-key-safe order. It is derived from the schema instead of a hand-kept
 * table list, so a newly added vendor table is picked up automatically (and the spec fails if
 * the planner cannot place it).
 *
 * What a vendor "owns":
 *   1. any model with a `vendorId` column (rows where vendorId = :vendor), and
 *   2. any model that has a REQUIRED relation to an owned model (rows whose parent is owned) —
 *      e.g. DailySheetItem -> DailySheet, BottleWallet -> Customer.
 *
 * What survives ("keep"): the Vendor row itself, its branding, its roles + role permissions, its
 * WhatsApp sender, and the VENDOR_ADMIN login(s) — so the vendor can be set up again and the same
 * admin can sign in. Everything else, including every other user, is removed.
 */

export interface DmmfFieldLike {
  name: string;
  kind: string;
  type: string;
  isRequired: boolean;
  relationFromFields?: readonly string[];
  relationToFields?: readonly string[];
}
export interface DmmfModelLike {
  name: string;
  fields: readonly DmmfFieldLike[];
}

/** Models (and the rows of them) that a wipe never touches. */
export const KEEP_MODELS: ReadonlySet<string> = new Set([
  'Vendor',
  'VendorBranding',
  'Role',
  'RolePermission',
  'WhatsAppAccount',
  'WhatsAppTemplate',
]);

/** Extra row filter for models that are only PARTLY wiped. `a` is the table alias. */
const PARTIAL_SCOPE: Record<string, (a: string) => string> = {
  User: (a) => `${a}."role" <> 'VENDOR_ADMIN'`,
};

export interface WipeStep {
  model: string;
  sql: string;
}

export interface WipePlan {
  /** Models whose rows are (at least partly) removed, in the order they are deleted. */
  deleteOrder: string[];
  /** `SELECT COUNT(*)` per owned model — the preview. Parameter $1 = vendor id. */
  countSteps: WipeStep[];
  /** UPDATE ... SET fk = NULL statements that break reference cycles / free kept rows. Run first. */
  nullifySteps: WipeStep[];
  /** DELETE statements, children before parents. */
  deleteSteps: WipeStep[];
  /** Models that are deliberately left alone. */
  kept: string[];
}

const MAX_SCOPE_DEPTH = 8;

export function planVendorWipe(models: readonly DmmfModelLike[]): WipePlan {
  const byName = new Map(models.map((m) => [m.name, m]));
  const owningFks = (m: DmmfModelLike) => m.fields.filter((f) => f.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0);
  const hasDirectVendorId = (m: DmmfModelLike) => m.fields.some((f) => f.name === 'vendorId' && f.kind === 'scalar');

  for (const m of models) {
    for (const f of owningFks(m)) {
      if ((f.relationFromFields?.length ?? 0) > 1 || (f.relationToFields?.length ?? 0) > 1) {
        throw new Error(`Vendor wipe: composite foreign key ${m.name}.${f.name} is not supported by the planner`);
      }
    }
  }

  // ── ownership (fixpoint) ──
  const owned = new Set<string>();
  for (const m of models) if (!KEEP_MODELS.has(m.name) && m.name !== 'Vendor' && hasDirectVendorId(m)) owned.add(m.name);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of models) {
      if (owned.has(m.name) || KEEP_MODELS.has(m.name) || m.name === 'Vendor') continue;
      if (owningFks(m).some((f) => f.isRequired && owned.has(f.type))) {
        owned.add(m.name);
        changed = true;
      }
    }
  }

  // ── row scope: SQL boolean over alias `a` selecting this vendor's rows of a model ──
  const scope = (name: string, alias: string, depth = 0): string => {
    if (depth > MAX_SCOPE_DEPTH) throw new Error(`Vendor wipe: ownership chain of ${name} is too deep / cyclic`);
    const m = byName.get(name) as DmmfModelLike;
    if (hasDirectVendorId(m)) {
      const extra = PARTIAL_SCOPE[name];
      return `${alias}."vendorId" = $1${extra ? ` AND ${extra(alias)}` : ''}`;
    }
    const parts = owningFks(m)
      .filter((f) => f.isRequired && owned.has(f.type))
      .map((f) => {
        const pAlias = `s${depth + 1}`;
        const from = (f.relationFromFields as readonly string[])[0];
        const to = (f.relationToFields as readonly string[])[0];
        return `${alias}."${from}" IN (SELECT ${pAlias}."${to}" FROM "${f.type}" ${pAlias} WHERE ${scope(f.type, pAlias, depth + 1)})`;
      });
    return parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0];
  };

  // ── foreign-key graph among owned models: child -> parent ──
  type Edge = { child: string; parent: string; field: DmmfFieldLike };
  const edges: Edge[] = [];
  for (const m of models) {
    if (!owned.has(m.name)) continue;
    for (const f of owningFks(m)) if (owned.has(f.type)) edges.push({ child: m.name, parent: f.type, field: f });
  }

  // strongly connected components (Tarjan) — edges inside one are reference cycles
  const adj = new Map<string, string[]>();
  for (const n of owned) adj.set(n, []);
  for (const e of edges) adj.get(e.child)?.push(e.parent);
  const comp = new Map<string, number>();
  {
    let index = 0;
    let c = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const visit = (v: string) => {
      idx.set(v, index);
      low.set(v, index);
      index++;
      stack.push(v);
      onStack.add(v);
      for (const w of adj.get(v) ?? []) {
        if (!idx.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v) as number, low.get(w) as number));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v) as number, idx.get(w) as number));
        }
      }
      if (low.get(v) === idx.get(v)) {
        for (;;) {
          const w = stack.pop() as string;
          onStack.delete(w);
          comp.set(w, c);
          if (w === v) break;
        }
        c++;
      }
    };
    for (const n of owned) if (!idx.has(n)) visit(n);
  }

  // ── nullify: optional FKs that sit on a cycle, plus FKs of rows that SURVIVE ──
  const nullifySteps: WipeStep[] = [];
  const nullified = new Set<Edge>();
  for (const e of edges) {
    if (e.field.isRequired || comp.get(e.child) !== comp.get(e.parent)) continue;
    nullified.add(e);
    const from = (e.field.relationFromFields as readonly string[])[0];
    nullifySteps.push({
      model: e.child,
      sql: `UPDATE "${e.child}" a SET "${from}" = NULL WHERE a."${from}" IS NOT NULL AND ${scope(e.child, 'a')}`,
    });
  }
  // Rows that stay (kept models, and the admin users of a partly-wiped model) must not keep pointing at rows that go.
  for (const m of models) {
    const partial = owned.has(m.name) && PARTIAL_SCOPE[m.name] !== undefined;
    if (owned.has(m.name) && !partial) continue;
    if (m.name === 'Vendor') continue;
    for (const f of owningFks(m)) {
      if (!owned.has(f.type)) continue;
      if (f.isRequired) {
        throw new Error(`Vendor wipe: kept model ${m.name}.${f.name} requires wiped model ${f.type} — decide how to treat it in the planner`);
      }
      const from = (f.relationFromFields as readonly string[])[0];
      const to = (f.relationToFields as readonly string[])[0];
      nullifySteps.push({
        model: m.name,
        sql: `UPDATE "${m.name}" a SET "${from}" = NULL WHERE a."${from}" IN (SELECT s1."${to}" FROM "${f.type}" s1 WHERE ${scope(f.type, 's1', 1)})`,
      });
    }
  }

  // ── delete order: a model goes only after every model that references it ──
  const children = new Map<string, Set<string>>();
  for (const n of owned) children.set(n, new Set());
  for (const e of edges) if (!nullified.has(e) && e.child !== e.parent) children.get(e.parent)?.add(e.child);
  for (const e of edges) {
    if (e.child === e.parent && e.field.isRequired) throw new Error(`Vendor wipe: ${e.child}.${e.field.name} is a required self-reference`);
  }
  const deleteOrder: string[] = [];
  const done = new Set<string>();
  const remaining = new Set(owned);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((n) => [...(children.get(n) as Set<string>)].every((c) => done.has(c))).sort();
    if (ready.length === 0) {
      throw new Error(`Vendor wipe: unresolved reference cycle among: ${[...remaining].sort().join(', ')}`);
    }
    for (const n of ready) {
      deleteOrder.push(n);
      done.add(n);
      remaining.delete(n);
    }
  }

  const countSteps = [...owned].sort().map((n) => ({ model: n, sql: `SELECT COUNT(*)::int AS n FROM "${n}" a WHERE ${scope(n, 'a')}` }));
  const deleteSteps = deleteOrder.map((n) => ({ model: n, sql: `DELETE FROM "${n}" a WHERE ${scope(n, 'a')}` }));
  const kept = models.map((m) => m.name).filter((n) => !owned.has(n) || PARTIAL_SCOPE[n]).sort();

  return { deleteOrder, countSteps, nullifySteps, deleteSteps, kept };
}
