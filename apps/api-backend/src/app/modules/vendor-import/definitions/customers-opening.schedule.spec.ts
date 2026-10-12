import { customersOpeningDefinition as def, type NormalizedCustomer } from './customers-opening.definition';
import { ImportError } from '../import.types';
import type { ImportMapping } from '../import.types';

/**
 * Routes / vans / weekly delivery schedule carried by the customers file (Master_Data-style
 * "van per weekday" columns, or a Van + Delivery days pair).
 */

const DAY_MAPPING: ImportMapping = {
  columns: {
    Name: 'name', Address: 'address', Area: 'area', Route: 'route', Seq: 'routeSequence',
    Mon: 'dayMon', Tue: 'dayTue', Wed: 'dayWed', Thu: 'dayThu', Fri: 'dayFri', Sat: 'daySat',
  },
  valueMaps: {},
};
const PAIR_MAPPING: ImportMapping = {
  columns: { Name: 'name', Address: 'address', Route: 'route', Seq: 'routeSequence', Van: 'van', Days: 'deliveryDays' },
  valueMaps: {},
};
const info = (m: ImportMapping) => ({ mappedFieldKeys: new Set(Object.values(m.columns).filter(Boolean) as string[]), activeProducts: [] });
const opts = (m: ImportMapping, raw: Record<string, unknown> = {}) => def.parseOptions(raw, info(m));

const norm = (m: ImportMapping, row: Record<string, string | number | null>, raw: Record<string, unknown> = {}) =>
  def.normalizeRow({ Name: 'Ali', Address: 'H1', ...row }, m, opts(m, raw));

describe('customers-opening schedule: normalizeRow', () => {
  it('reads one van per weekday column; blank and 0 mean no delivery that day', () => {
    const r = norm(DAY_MAPPING, { Mon: 'V1', Tue: '0', Wed: 'V2', Thu: '', Fri: 'V1', Sat: null, Route: 'Block B', Seq: 7 });
    expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(r.normalized?.schedule).toEqual([
      { dayOfWeek: 1, vanLabel: 'V1' },
      { dayOfWeek: 3, vanLabel: 'V2' },
      { dayOfWeek: 5, vanLabel: 'V1' },
    ]);
    expect(r.normalized?.route).toBe('Block B');
    expect(r.normalized?.routeSequence).toBe(7);
  });

  it('accepts a numeric van code in a day column', () => {
    const r = norm(DAY_MAPPING, { Mon: 2 });
    expect(r.normalized?.schedule).toEqual([{ dayOfWeek: 1, vanLabel: '2' }]);
  });

  it.each([
    ['Mon, Thu', [1, 4]],
    ['Mon Wed Fri', [1, 3, 5]],
    ['Monday and Thursday', [1, 4]],
    ['Daily', [1, 2, 3, 4, 5, 6]],
    ['Mon-Wed', [1, 2, 3]],
    ['1,4', [1, 4]],
    ['thu/mon', [1, 4]],
  ])('Van + Delivery days: "%s"', (days, expected) => {
    const r = norm(PAIR_MAPPING, { Van: 'V1', Days: days });
    expect(r.issues.filter((i) => i.severity === 'ERROR')).toEqual([]);
    expect(r.normalized?.schedule.map((s) => s.dayOfWeek)).toEqual(expected);
    expect(new Set(r.normalized?.schedule.map((s) => s.vanLabel))).toEqual(new Set(['V1']));
  });

  it('rejects an unknown day word and Sunday (not a delivery day)', () => {
    expect(norm(PAIR_MAPPING, { Van: 'V1', Days: 'Mon, Funday' }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DELIVERY_DAYS_INVALID', severity: 'ERROR' })]),
    );
    expect(norm(PAIR_MAPPING, { Van: 'V1', Days: 'Sun' }).normalized).toBeNull();
  });

  it('days without a van is an error; a van without days only warns', () => {
    expect(norm(PAIR_MAPPING, { Van: null, Days: 'Mon' }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VAN_MISSING', severity: 'ERROR' })]));
    const w = norm(PAIR_MAPPING, { Van: 'V1', Days: null });
    expect(w.normalized?.schedule).toEqual([]);
    expect(w.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DELIVERY_DAYS_MISSING', severity: 'WARNING' })]));
  });

  it('warns when a mapped schedule is empty for the row, and rejects a bad van label', () => {
    expect(norm(DAY_MAPPING, {}).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NO_SCHEDULE', severity: 'WARNING' })]));
    expect(norm(DAY_MAPPING, { Mon: 'V1; DROP' }).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VAN_LABEL_INVALID' })]));
  });

  it('uses the Area as the route only when asked and no Route column is mapped', () => {
    const m: ImportMapping = { columns: { Name: 'name', Address: 'address', Area: 'area' }, valueMaps: {} };
    expect(norm(m, { Area: 'Gulshan' }).normalized?.route).toBeNull();
    expect(norm(m, { Area: 'Gulshan' }, { routeFromArea: true }).normalized?.route).toBe('Gulshan');
    // With a Route column mapped the option is ignored.
    expect(opts(DAY_MAPPING, { routeFromArea: true }).routeFromArea).toBe(false);
  });

  it('a file without schedule columns behaves exactly as before', () => {
    const m: ImportMapping = { columns: { Name: 'name', Address: 'address' }, valueMaps: {} };
    const r = norm(m, {});
    expect(r.normalized).toMatchObject({ route: null, routeSequence: null, schedule: [] });
    expect(r.issues.some((i) => i.code === 'NO_SCHEDULE')).toBe(false);
  });
});

describe('customers-opening schedule: options', () => {
  it('Van needs Delivery days (or the weekday columns), and Delivery days needs Van', () => {
    const vanOnly: ImportMapping = { columns: { Name: 'name', Address: 'address', Van: 'van' }, valueMaps: {} };
    const daysOnly: ImportMapping = { columns: { Name: 'name', Address: 'address', Days: 'deliveryDays' }, valueMaps: {} };
    expect(() => opts(vanOnly)).toThrow(ImportError);
    expect(() => opts(daysOnly)).toThrow(expect.objectContaining({ code: 'VAN_DAYS_PAIR' }));
  });

  it('refuses both schedule styles at once', () => {
    const both: ImportMapping = { columns: { Name: 'name', Address: 'address', Van: 'van', Days: 'deliveryDays', Mon: 'dayMon' }, valueMaps: {} };
    expect(() => opts(both)).toThrow(expect.objectContaining({ code: 'SCHEDULE_AMBIGUOUS' }));
  });

  it('validates the van prefix and defaults createMissingVans on', () => {
    expect(() => opts(DAY_MAPPING, { vanPrefix: 'bad prefix!' })).toThrow(expect.objectContaining({ code: 'VAN_PREFIX_INVALID' }));
    expect(opts(DAY_MAPPING, { vanPrefix: ' ACME- ' })).toMatchObject({ vanPrefix: 'ACME-', createMissingVans: true });
    expect(opts(DAY_MAPPING, { createMissingVans: false }).createMissingVans).toBe(false);
  });
});

// ── plan ──
const van = (plateNumber: string, vendorId = 'v1', isActive = true) => ({ id: `van-${plateNumber}`, plateNumber, vendorId, isActive });
const ctxWith = (vans: ReturnType<typeof van>[] = [], routes: string[] = []) => ({
  vendorId: 'v1',
  vansByPlate: new Map(vans.map((v) => [v.plateNumber.toLowerCase(), v])),
  routeNames: new Set(routes.map((r) => r.toLowerCase())),
  existingCodes: new Set<string>(),
  existingPhoneName: new Set<string>(),
  existingPhones: new Set<string>(),
  groupingEnabled: true,
});

describe('customers-opening schedule: validateAndPlan + summarize', () => {
  const plan = (rows: Record<string, string | number | null>[], ctx = ctxWith(), raw: Record<string, unknown> = {}) => {
    const options = opts(DAY_MAPPING, raw);
    const normalized = rows.map((r, i) => ({ rowNumber: i + 2, ...def.normalizeRow({ Name: `C${i}`, Address: 'H1', ...r }, DAY_MAPPING, options) }));
    const planned = def.validateAndPlan(normalized, ctx, options);
    return { planned, options, summary: def.summarize(planned, options, ctx) };
  };

  it('blocks a van label that belongs to another company, and tells the user to set a prefix', () => {
    const { planned } = plan([{ Mon: 'V2' }], ctxWith([van('V2', 'someone-else')]));
    expect(planned[0].action).toBe('SKIP_INVALID');
    expect(planned[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VAN_LABEL_TAKEN', message: expect.stringContaining('prefix') })]));
  });

  it('the prefix gives the vendor its own van names, so the same label no longer clashes', () => {
    const { planned, summary } = plan([{ Mon: 'V2' }], ctxWith([van('V2', 'someone-else')]), { vanPrefix: 'ACME-' });
    expect(planned[0].action).toBe('CREATE');
    expect(summary.schedule?.vansToCreate).toEqual(['ACME-V2']);
  });

  it('does not double-apply the prefix and matches existing vans case-insensitively', () => {
    const { planned, summary } = plan([{ Mon: 'ACME-V1' }, { Mon: 'v1' }], ctxWith([van('ACME-V1')]), { vanPrefix: 'acme-' });
    expect(planned.map((p) => p.action)).toEqual(['CREATE', 'CREATE']);
    expect(summary.schedule).toMatchObject({ vansToCreate: [], vansExisting: 1 });
  });

  it('inactive van and "do not create vans" are errors', () => {
    expect(plan([{ Mon: 'V1' }], ctxWith([van('V1', 'v1', false)])).planned[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VAN_INACTIVE' })]));
    expect(plan([{ Mon: 'V9' }], ctxWith(), { createMissingVans: false }).planned[0].issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'VAN_NOT_FOUND' })]));
  });

  it('summarises schedules, new vans and new routes (counting each once)', () => {
    const { summary } = plan(
      [
        { Mon: 'V1', Wed: 'V1', Route: 'North' },
        { Tue: 'V2', Route: 'north' },
        { Mon: 'V1', Route: 'Old route' },
        {},
      ],
      ctxWith([van('V1')], ['Old route']),
    );
    expect(summary.schedule).toEqual({
      customersWithSchedule: 3,
      scheduleEntries: 4,
      vansToCreate: ['V2'],
      vansExisting: 1,
      routesToCreate: ['North'],
      routesExisting: 1,
    });
  });

  it('adds no schedule summary when the file carries none', () => {
    const m: ImportMapping = { columns: { Name: 'name', Address: 'address' }, valueMaps: {} };
    const options = opts(m);
    const n = def.normalizeRow({ Name: 'Ali', Address: 'H1' }, m, options);
    const planned = def.validateAndPlan([{ rowNumber: 2, ...n }], ctxWith(), options);
    expect(def.summarize(planned, options, ctxWith()).schedule).toBeUndefined();
  });
});

// ── execution ──
function fakeDb(existingVans: ReturnType<typeof van>[] = [], existingRoutes: { id: string; name: string }[] = []) {
  const state = {
    vans: existingVans.map((v) => ({ ...v })),
    routes: existingRoutes.map((r) => ({ ...r, defaultVanId: null as string | null })),
    customers: [] as Record<string, unknown>[],
    schedules: [] as Record<string, unknown>[],
  };
  const prisma = {
    van: {
      findMany: async ({ where }: { where: { OR: { plateNumber: { equals: string } }[] } }) => {
        const wanted = where.OR.map((o) => o.plateNumber.equals.toLowerCase());
        return state.vans.filter((v) => wanted.includes(v.plateNumber.toLowerCase()));
      },
      create: async ({ data }: { data: { plateNumber: string; vendorId: string } }) => {
        const v = { id: `van-new-${state.vans.length}`, isActive: true, ...data };
        state.vans.push(v);
        return v;
      },
    },
    route: {
      findMany: async () => state.routes,
      create: async ({ data }: { data: { name: string; defaultVanId: string | null } }) => {
        const r = { id: `route-new-${state.routes.length}`, ...data };
        state.routes.push(r);
        return r;
      },
    },
    product: { findMany: async () => [] },
    $queryRaw: async () => [{ maxnum: 0 }],
    $transaction: async (fn: (t: unknown) => unknown) =>
      fn({
        customer: {
          findUnique: async () => null,
          create: async ({ data }: { data: Record<string, unknown> }) => {
            const c = { id: `cust-${state.customers.length + 1}`, ...data };
            state.customers.push(c);
            return c;
          },
        },
        customerDeliverySchedule: { createMany: async ({ data }: { data: Record<string, unknown>[] }) => void state.schedules.push(...data) },
        bottleWallet: { create: async () => undefined },
        customerProductPrice: { upsert: async () => undefined },
      }),
  };
  return { prisma: prisma as never, state };
}

const cust = (over: Partial<NormalizedCustomer>): { rowNumber: number; normalized: NormalizedCustomer } => ({
  rowNumber: 2,
  normalized: {
    customerCode: 'C1', name: 'Ali', phoneNumber: '-', hasPhone: false, address: 'H1', floor: null, nearbyLandmark: null, paymentType: 'CASH',
    isActive: true, rate: null, openingBalance: 0, openingBottles: 0, group: null, subGroup: null, route: null, routeSequence: null, schedule: [], ...over,
  },
});
const execOptions = { productId: null, balanceSign: 'POSITIVE_MEANS_CUSTOMER_OWES', balancesAsOf: null, codeStrategy: 'USE_FILE_CODES', defaultPaymentType: 'CASH', areaIntoAddress: true, createMissingVans: true, vanPrefix: 'ACME-', routeFromArea: false } as const;

describe('customers-opening schedule: execution', () => {
  it('creates missing vans (with the prefix) and routes once, reuses existing ones, and gives a new route its most-used van', async () => {
    const { prisma, state } = fakeDb([van('ACME-V1')], [{ id: 'route-old', name: 'Old Route' }]);
    const rows = [
      cust({ customerCode: 'A', route: 'North', schedule: [{ dayOfWeek: 1, vanLabel: 'V2' }] }),
      cust({ customerCode: 'B', route: 'north', schedule: [{ dayOfWeek: 2, vanLabel: 'V2' }, { dayOfWeek: 4, vanLabel: 'V1' }] }),
      cust({ customerCode: 'C', route: 'North', schedule: [{ dayOfWeek: 1, vanLabel: 'V1' }] }),
      cust({ customerCode: 'D', route: 'Old Route', schedule: [{ dayOfWeek: 1, vanLabel: 'V1' }] }),
    ];
    const exec = await def.prepareExecution(prisma, 'v1', rows, execOptions);

    expect(state.vans.map((v) => v.plateNumber).sort()).toEqual(['ACME-V1', 'ACME-V2']); // only V2 was created
    expect(state.routes.filter((r) => r.name === 'North')).toHaveLength(1); // "North"/"north" -> one route
    expect(state.routes.find((r) => r.name === 'North')?.defaultVanId).toBe(exec.vanIds.get('acme-v2')); // 2 of 3 customers' first van
    expect(state.routes.find((r) => r.id === 'route-old')).toBeDefined();
    expect(state.routes).toHaveLength(2); // existing route reused, not duplicated
  });

  it('writes the customer with its route and one schedule row per day (stop number on each)', async () => {
    const { prisma, state } = fakeDb();
    const rows = [cust({ route: 'North', routeSequence: 5, schedule: [{ dayOfWeek: 1, vanLabel: 'V1' }, { dayOfWeek: 4, vanLabel: 'V1' }] })];
    const exec = await def.prepareExecution(prisma, 'v1', rows, execOptions);
    const out = await def.executeRow(prisma, 'v1', rows[0], exec, execOptions, async () => undefined);

    expect(out.result).toBe('CREATED');
    const vanId = exec.vanIds.get('acme-v1');
    expect(state.customers[0]).toMatchObject({ routeId: exec.routeIds.get('north') });
    expect(state.schedules).toEqual([
      { customerId: 'cust-1', vanId, dayOfWeek: 1, routeSequence: 5 },
      { customerId: 'cust-1', vanId, dayOfWeek: 4, routeSequence: 5 },
    ]);
  });

  it('a file with no schedule columns creates no vans, routes or schedule rows', async () => {
    const { prisma, state } = fakeDb();
    const rows = [cust({})];
    const exec = await def.prepareExecution(prisma, 'v1', rows, execOptions);
    await def.executeRow(prisma, 'v1', rows[0], exec, execOptions, async () => undefined);
    expect(state.vans).toHaveLength(0);
    expect(state.routes).toHaveLength(0);
    expect(state.schedules).toHaveLength(0);
    expect(state.customers[0]).toMatchObject({ routeId: null });
  });

  it('refuses at run time too if a van label now belongs to another company', async () => {
    const { prisma } = fakeDb([van('ACME-V1', 'someone-else')]);
    await expect(def.prepareExecution(prisma, 'v1', [cust({ schedule: [{ dayOfWeek: 1, vanLabel: 'V1' }] })], execOptions)).rejects.toMatchObject({ code: 'VAN_LABEL_TAKEN' });
  });
});

// ── auto-mapping of a real Master_Data-style header row ──
import { suggestMapping } from '../pipeline/column-mapper';

describe('customers-opening schedule: column auto-detection', () => {
  const headerOf = (suggestions: ReturnType<typeof suggestMapping>, h: string) => suggestions.find((s) => s.header === h)?.fieldKey ?? null;

  it('maps Mon..Sat to the weekday van fields, Route_Seq to the stop number, and leaves Sun alone', () => {
    const headers = [
      'Cust_Code', 'Name', 'Contact', 'House_No', 'Address2', 'Area', 'Block', 'Floor', 'Billing_Type', 'Cust_Status', 'Rate',
      'Bottle_Balance', 'Outstanding_Bal', 'Route_Seq', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    ];
    const s = suggestMapping({ headers, sampleRows: [], fields: def.fields });
    expect(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((h) => headerOf(s, h))).toEqual(['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat']);
    expect(headerOf(s, 'Sun')).toBeNull();
    expect(headerOf(s, 'Route_Seq')).toBe('routeSequence');
    expect(headerOf(s, 'Area')).toBe('area');
    expect(headerOf(s, 'Cust_Code')).toBe('customerCode');
  });

  it('maps the Van + Days style headers', () => {
    const s = suggestMapping({ headers: ['Customer Name', 'Address', 'Route', 'Stop No', 'Van', 'Delivery Days'], sampleRows: [], fields: def.fields });
    expect(['Route', 'Stop No', 'Van', 'Delivery Days'].map((h) => headerOf(s, h))).toEqual(['route', 'routeSequence', 'van', 'deliveryDays']);
  });
});
