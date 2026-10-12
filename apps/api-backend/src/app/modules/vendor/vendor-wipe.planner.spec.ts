import { Prisma } from '@prisma/client';
import { KEEP_MODELS, planVendorWipe, type DmmfModelLike } from './vendor-wipe.planner';

const models = Prisma.dmmf.datamodel.models as unknown as DmmfModelLike[];
const plan = planVendorWipe(models);

const fk = (field: string, type: string, required = true, to = 'id') => ({
  name: `${type.toLowerCase()}Rel`,
  kind: 'object',
  type,
  isRequired: required,
  relationFromFields: [field],
  relationToFields: [to],
});
const scalar = (name: string) => ({ name, kind: 'scalar', type: 'String', isRequired: true });

describe('vendor wipe planner (real schema)', () => {
  it('removes every model that has a vendorId column, except the deliberately kept ones', () => {
    const direct = models.filter((m) => m.fields.some((f) => f.name === 'vendorId' && f.kind === 'scalar')).map((m) => m.name);
    const missing = direct.filter((n) => !KEEP_MODELS.has(n) && !plan.deleteOrder.includes(n));
    expect(missing).toEqual([]);
  });

  it('never deletes the vendor, its branding, roles, role permissions or WhatsApp sender', () => {
    for (const keep of KEEP_MODELS) expect(plan.deleteOrder).not.toContain(keep);
    expect(plan.deleteSteps.map((s) => s.sql).join('\n')).not.toMatch(/DELETE FROM "(Vendor|VendorBranding|Role|RolePermission|WhatsAppAccount|WhatsAppTemplate)"/);
  });

  it('keeps the VENDOR_ADMIN users (User is only partly wiped)', () => {
    const userDelete = plan.deleteSteps.find((s) => s.model === 'User')?.sql ?? '';
    expect(userDelete).toContain(`"role" <> 'VENDOR_ADMIN'`);
    expect(plan.kept).toContain('User');
  });

  it('also removes child tables that have no vendorId (owned through a required parent)', () => {
    for (const child of ['DailySheetItem', 'BottleWallet', 'CustomerDeliverySchedule', 'PayrollSnapshot', 'ImportRow', 'FcmToken']) {
      expect(plan.deleteOrder).toContain(child);
    }
  });

  it('deletes children before the parents they reference', () => {
    const pos = new Map(plan.deleteOrder.map((n, i) => [n, i]));
    const nullified = new Set(plan.nullifySteps.map((s) => s.model));
    const violations: string[] = [];
    for (const m of models) {
      if (!pos.has(m.name)) continue;
      for (const f of m.fields) {
        if (f.kind !== 'object' || !(f.relationFromFields?.length) || !pos.has(f.type) || f.type === m.name) continue;
        // an optional FK on a cycle is nulled out first, so its order does not matter
        if (!f.isRequired && nullified.has(m.name)) continue;
        if ((pos.get(m.name) as number) > (pos.get(f.type) as number)) violations.push(`${m.name}.${f.name} -> ${f.type}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('breaks the self-referencing optional FKs before deleting', () => {
    const nullified = plan.nullifySteps.map((s) => s.model);
    expect(nullified).toEqual(expect.arrayContaining(['CustomerGroup', 'CustomerDepositEntry']));
    for (const s of plan.nullifySteps) expect(s.sql).toMatch(/^UPDATE "\w+" a SET "\w+" = NULL WHERE /);
  });

  it('only ever binds the vendor id as $1 (no interpolated values)', () => {
    for (const s of [...plan.countSteps, ...plan.deleteSteps, ...plan.nullifySteps]) {
      expect(s.sql).toContain('$1');
      expect(s.sql).not.toMatch(/\$[2-9]/);
      expect(s.sql).not.toMatch(/'[0-9a-f]{8}-/); // no literal uuid
    }
  });

  it('has one count step and one delete step per wiped model', () => {
    expect(plan.countSteps.map((s) => s.model).sort()).toEqual([...plan.deleteOrder].sort());
    expect(plan.deleteSteps).toHaveLength(plan.deleteOrder.length);
  });

  it('is deterministic', () => {
    expect(planVendorWipe(models)).toEqual(plan);
  });
});

describe('vendor wipe planner (synthetic schemas)', () => {
  it('derives ownership through a required relation and scopes the child via its parent', () => {
    const p = planVendorWipe([
      { name: 'Vendor', fields: [scalar('id')] },
      { name: 'Parent', fields: [scalar('id'), scalar('vendorId')] },
      { name: 'Child', fields: [scalar('id'), scalar('parentId'), fk('parentId', 'Parent')] },
    ]);
    expect(p.deleteOrder).toEqual(['Child', 'Parent']);
    expect(p.deleteSteps[0].sql).toBe(`DELETE FROM "Child" a WHERE a."parentId" IN (SELECT s1."id" FROM "Parent" s1 WHERE s1."vendorId" = $1)`);
  });

  it('does not treat an optional relation as ownership', () => {
    const p = planVendorWipe([
      { name: 'Vendor', fields: [scalar('id')] },
      { name: 'Parent', fields: [scalar('id'), scalar('vendorId')] },
      { name: 'Loose', fields: [scalar('id'), fk('parentId', 'Parent', false)] },
    ]);
    expect(p.deleteOrder).toEqual(['Parent']);
    expect(p.nullifySteps.map((s) => s.model)).toEqual(['Loose']); // a surviving row must not keep pointing at a deleted one
  });

  it('refuses a kept model that REQUIRES a wiped one (decision needed, never silently cascade)', () => {
    expect(() =>
      planVendorWipe([
        { name: 'Vendor', fields: [scalar('id')] },
        { name: 'Parent', fields: [scalar('id'), scalar('vendorId')] },
        { name: 'Role', fields: [scalar('id'), scalar('vendorId'), fk('parentId', 'Parent')] },
      ]),
    ).toThrow(/kept model Role/);
  });

  it('fails loudly on an unresolvable required cycle', () => {
    expect(() =>
      planVendorWipe([
        { name: 'Vendor', fields: [scalar('id')] },
        { name: 'A', fields: [scalar('id'), scalar('vendorId'), fk('bId', 'B')] },
        { name: 'B', fields: [scalar('id'), scalar('vendorId'), fk('aId', 'A')] },
      ]),
    ).toThrow(/cycle/);
  });

  it('breaks an optional cycle by nulling it', () => {
    const p = planVendorWipe([
      { name: 'Vendor', fields: [scalar('id')] },
      { name: 'A', fields: [scalar('id'), scalar('vendorId'), fk('bId', 'B', false)] },
      { name: 'B', fields: [scalar('id'), scalar('vendorId'), fk('aId', 'A')] },
    ]);
    expect(p.nullifySteps.map((s) => s.model)).toEqual(['A']);
    expect(p.deleteOrder).toEqual(['B', 'A']);
  });
});
