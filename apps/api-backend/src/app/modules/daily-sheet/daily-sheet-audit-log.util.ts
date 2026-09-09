import type { SheetAuditCategory, SheetAuditLogEntry } from '@water-supply-crm/types';

/**
 * Maps a raw audit `action` string (scoped by the audit source it came from,
 * because e.g. `CREATED` / `REVERSED` mean different things in the CrewCash vs
 * Discrepancy vs Damage tables) to a human label, a coarse category (for filter
 * chips / colour) and the entity kind it acts on. Unknown actions fall back to a
 * title-cased label with `category: 'OTHER'`.
 */
export interface AuditActionMeta {
  label: string;
  category: SheetAuditCategory;
  entity: string;
}

type Source = SheetAuditLogEntry['source'];

// Generic AuditLog.action — the strings written by daily-sheet.service /
// expense.service / communication. These never collide with each other.
const AUDIT_LOG: Record<string, AuditActionMeta> = {
  DELIVERY_SUBMIT: { label: 'Delivery recorded', category: 'CREATE', entity: 'Delivery' },
  DELIVERY_EDIT_OVERRIDE: { label: 'Delivery edited', category: 'EDIT', entity: 'Delivery' },
  DELIVERY_EDIT_UNLOCK: { label: 'Delivery edit unlocked', category: 'OTHER', entity: 'Delivery' },
  COLLECTION_POLICY_ZERO_CASH: { label: 'Recorded with zero cash', category: 'CREATE', entity: 'Delivery' },
  DELIVERY_VOIDED: { label: 'Delivery voided', category: 'VOID', entity: 'Delivery' },
  CLOSED_DELIVERY_CORRECTED: { label: 'Delivery corrected (closed sheet)', category: 'CORRECTION', entity: 'Delivery' },
  ADHOC_DELIVERY_ADDED: { label: 'Ad-hoc delivery added', category: 'CREATE', entity: 'Delivery' },
  CORRECTION_ENTRY_ADDED: { label: 'Missed delivery added (closed sheet)', category: 'CORRECTION', entity: 'Delivery' },
  WALK_IN_DELIVERY_ADDED: { label: 'Walk-in delivery recorded', category: 'CREATE', entity: 'Delivery' },
  CUSTOMER_DELIVERY_MOVED: { label: 'Delivery moved', category: 'MOVE', entity: 'Delivery' },
  RESEND_RECEIPT: { label: 'Receipt re-sent', category: 'OTHER', entity: 'Delivery' },

  CLOSED_TRIP_CHECKIN_CORRECTED: { label: 'Trip check-in corrected', category: 'CORRECTION', entity: 'Trip' },
  TRIP_EDIT_OVERRIDE: { label: 'Trip check-in edited', category: 'EDIT', entity: 'Trip' },
  TRIP_EDIT_UNLOCK: { label: 'Trip edit unlocked', category: 'OTHER', entity: 'Trip' },

  CLOSE: { label: 'Sheet closed', category: 'CLOSE', entity: 'Sheet' },
  REQUEST_CLOSE: { label: 'Close requested', category: 'CLOSE', entity: 'Sheet' },
  APPROVE_CLOSE: { label: 'Close approved', category: 'CLOSE', entity: 'Sheet' },
  REJECT_CLOSE: { label: 'Close rejected (sheet reopened)', category: 'CLOSE', entity: 'Sheet' },
  SWAP_ASSIGNMENT: { label: 'Driver / van / crew changed', category: 'CREW', entity: 'Sheet' },
  CONFIRM_CREW: { label: 'Crew confirmed', category: 'CREW', entity: 'Sheet' },

  CLOSED_EXPENSE_CORRECTED: { label: 'Expense corrected (closed sheet)', category: 'CORRECTION', entity: 'Expense' },
  CLOSED_EXPENSE_VOIDED: { label: 'Expense voided (closed sheet)', category: 'DELETE', entity: 'Expense' },
  CLOSED_EXPENSE_ADDED: { label: 'Expense added (closed sheet)', category: 'CREATE', entity: 'Expense' },

  ACKNOWLEDGE_MESSAGE: { label: 'Instruction acknowledged', category: 'ACK', entity: 'Message' },
};

const CREW_CASH: Record<string, AuditActionMeta> = {
  CREATED: { label: 'Crew cash recorded', category: 'CREATE', entity: 'Crew Cash' },
  EDITED: { label: 'Crew cash edited', category: 'EDIT', entity: 'Crew Cash' },
  DELETED: { label: 'Crew cash deleted', category: 'DELETE', entity: 'Crew Cash' },
  APPROVED: { label: 'Crew cash approved', category: 'OTHER', entity: 'Crew Cash' },
  SYNCED: { label: 'Crew cash synced to payroll', category: 'OTHER', entity: 'Crew Cash' },
  REVERSED: { label: 'Crew cash reversed (closed sheet)', category: 'CORRECTION', entity: 'Crew Cash' },
  CORRECTED: { label: 'Crew cash corrected (closed sheet)', category: 'CORRECTION', entity: 'Crew Cash' },
};

const DISCREPANCY_CASE: Record<string, AuditActionMeta> = {
  CREATED: { label: 'Discrepancy case opened', category: 'DISCREPANCY', entity: 'Discrepancy Case' },
  RESOLVED: { label: 'Discrepancy case resolved', category: 'DISCREPANCY', entity: 'Discrepancy Case' },
};

const DAMAGE_CASE: Record<string, AuditActionMeta> = {
  REPORTED: { label: 'Damage case opened', category: 'DISCREPANCY', entity: 'Damage Case' },
  UPDATED: { label: 'Damage case updated', category: 'EDIT', entity: 'Damage Case' },
  UNDER_REVIEW: { label: 'Damage case under review', category: 'OTHER', entity: 'Damage Case' },
  CHARGED: { label: 'Damage charged to customer', category: 'OTHER', entity: 'Damage Case' },
  WAIVED: { label: 'Damage charge waived', category: 'OTHER', entity: 'Damage Case' },
  REVERSED: { label: 'Damage charge reversed', category: 'CORRECTION', entity: 'Damage Case' },
};

const VEHICLE_CHECK: Record<string, AuditActionMeta> = {
  VEHICLE_CHECK_RECORDED: { label: 'Vehicle check recorded', category: 'CREATE', entity: 'Vehicle Check' },
  VEHICLE_ODOMETER_CORRECTED: { label: 'Odometer corrected', category: 'CORRECTION', entity: 'Vehicle Check' },
  VEHICLE_CRITICAL_OVERRIDE: { label: 'Critical check override', category: 'OTHER', entity: 'Vehicle Check' },
};

const MOVE_LOG: Record<string, AuditActionMeta> = {
  DELIVERY_MOVED_OUT: { label: 'Delivery moved out to another sheet', category: 'MOVE', entity: 'Delivery' },
  DELIVERY_MOVED_IN: { label: 'Delivery moved in from another sheet', category: 'MOVE', entity: 'Delivery' },
};

const BY_SOURCE: Record<Source, Record<string, AuditActionMeta>> = {
  AUDIT_LOG,
  CREW_CASH,
  DISCREPANCY_CASE,
  DAMAGE_CASE,
  VEHICLE_CHECK,
  MOVE_LOG,
};

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function auditActionMeta(source: Source, action: string): AuditActionMeta {
  return BY_SOURCE[source]?.[action] ?? { label: titleCase(action), category: 'OTHER', entity: 'Sheet' };
}

/**
 * Keys inside an audit `before`/`after` blob whose value is a raw entity id.
 * On display these are swapped for the entity's name and the key is relabelled
 * (so `driverId: "<uuid>"` renders as `Driver: Ali Khan`, not `Driver Id: <uuid>`).
 */
export const AUDIT_ID_KEY_LABELS = {
  user: {
    driverId: 'Driver',
    newDriverId: 'New driver',
    previousDriverId: 'Previous driver',
    crewConfirmedBy: 'Crew confirmed by',
    crewConfirmedById: 'Crew confirmed by',
    unlockedBy: 'Unlocked by',
    unlockedById: 'Unlocked by',
    acknowledgedById: 'Acknowledged by',
    reportedById: 'Reported by',
    resolvedById: 'Resolved by',
    salesmanId: 'Salesman',
    loader1Id: 'Loader 1',
    loader2Id: 'Loader 2',
    employeeId: 'Employee',
    createdById: 'Created by',
    distributedById: 'Distributed by',
    approvedById: 'Approved by',
    userId: 'User',
  } as Record<string, string>,
  van: {
    vanId: 'Van',
    newVanId: 'New van',
    previousVanId: 'Previous van',
  } as Record<string, string>,
  customer: {
    customerId: 'Customer',
  } as Record<string, string>,
  product: {
    productId: 'Product',
  } as Record<string, string>,
};

export interface AuditBlobNameMaps {
  user: Map<string, string>;
  van: Map<string, string>;
  customer: Map<string, string>;
  product: Map<string, string>;
}

/** Gathers every entity id referenced by known keys in a before/after blob. */
export function collectAuditBlobIds(blob: unknown): {
  userIds: string[];
  vanIds: string[];
  customerIds: string[];
  productIds: string[];
} {
  const userIds: string[] = [];
  const vanIds: string[] = [];
  const customerIds: string[] = [];
  const productIds: string[] = [];
  if (blob && typeof blob === 'object') {
    for (const [key, value] of Object.entries(blob as Record<string, unknown>)) {
      if (key === 'crew' && Array.isArray(value)) {
        for (const c of value) {
          const uid = (c as Record<string, unknown> | null)?.['userId'];
          if (typeof uid === 'string') userIds.push(uid);
        }
        continue;
      }
      if (typeof value !== 'string') continue;
      if (key in AUDIT_ID_KEY_LABELS.user) userIds.push(value);
      else if (key in AUDIT_ID_KEY_LABELS.van) vanIds.push(value);
      else if (key in AUDIT_ID_KEY_LABELS.customer) customerIds.push(value);
      else if (key in AUDIT_ID_KEY_LABELS.product) productIds.push(value);
    }
  }
  return { userIds, vanIds, customerIds, productIds };
}

/**
 * Rewrites an audit before/after blob for display: known id-bearing keys are
 * relabelled and their value resolved to the entity's name, and the `crew`
 * array is collapsed to a readable "Name (Role), …" string ("None" when empty).
 * Unknown keys pass through untouched. Ids that can't be resolved keep their
 * raw value so nothing is silently dropped.
 */
export function humanizeAuditBlob(
  blob: Record<string, unknown> | null,
  names: AuditBlobNameMaps,
): Record<string, unknown> | null {
  if (!blob) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(blob)) {
    if (key === 'crew' && Array.isArray(value)) {
      out['Crew'] = value.length
        ? value
            .map((c) => {
              const member = c as Record<string, unknown> | null;
              const uid = typeof member?.['userId'] === 'string' ? (member['userId'] as string) : null;
              const name = (uid && names.user.get(uid)) || 'Unknown';
              const role = typeof member?.['role'] === 'string' ? titleCase(member['role'] as string) : null;
              return role ? `${name} (${role})` : name;
            })
            .join(', ')
        : 'None';
      continue;
    }
    if (typeof value === 'string') {
      if (key in AUDIT_ID_KEY_LABELS.user) {
        out[AUDIT_ID_KEY_LABELS.user[key]] = names.user.get(value) ?? value;
        continue;
      }
      if (key in AUDIT_ID_KEY_LABELS.van) {
        out[AUDIT_ID_KEY_LABELS.van[key]] = names.van.get(value) ?? value;
        continue;
      }
      if (key in AUDIT_ID_KEY_LABELS.customer) {
        out[AUDIT_ID_KEY_LABELS.customer[key]] = names.customer.get(value) ?? value;
        continue;
      }
      if (key in AUDIT_ID_KEY_LABELS.product) {
        out[AUDIT_ID_KEY_LABELS.product[key]] = names.product.get(value) ?? value;
        continue;
      }
    }
    out[key] = value;
  }
  return out;
}

/** Pulls a human "reason / note" out of a changes/payload blob, if one is present. */
export function extractReason(blob: unknown): string | null {
  if (!blob || typeof blob !== 'object') return null;
  const o = blob as Record<string, unknown>;
  for (const key of [
    'correctionNote',
    'voidNote',
    'voidReason',
    'reason',
    'rejectionReason',
    'resolutionNote',
    'note',
    'odometerEditReason',
    'criticalOverrideNote',
  ]) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return extractReason(o.after) ?? extractReason(o.before);
}
