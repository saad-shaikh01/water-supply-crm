import { ImportEntity, PaymentType, Prisma } from '@prisma/client';
import type { PrismaService } from '@water-supply-crm/database';
import { createCustomerRecords } from '../../customer/customer-create.helper';
import { isSendablePhone, normalizePhone } from '../../whatsapp/phone.util';
import { ImportError } from '../import.types';
import type {
  ImportFieldDef,
  ImportMapping,
  NormalizedRowResult,
  PlanSummary,
  PlannedRow,
  RawRow,
  RowIssue,
} from '../import.types';
import { parseIsoDate, parseMoney, parseText, parseWholeNumber, toPaise } from '../pipeline/value-parsers';
import type { ExecOutcome, ExecRow, ImportDefinition, OptionsInfo } from './import-definition';
import { revertCustomerRows } from './customers-opening.revert';

/**
 * CUSTOMERS_OPENING — onboard customers together with their opening balances (money owed +
 * bottles held). Create-only: an existing customer is skipped, never updated (design doc §1).
 *
 * Opening balances are written straight onto `Customer.financialBalance` and `BottleWallet.balance`,
 * exactly like the one-off BLUE ICE migration — NO Transaction/ledger row is created, so P&L,
 * Cash Ledger and collection analytics are untouched (design doc F2).
 */

export const SKIP_ROW_VALUE = '__SKIP_ROW__';
export const SIGN_CUSTOMER_OWES = 'POSITIVE_MEANS_CUSTOMER_OWES';
export const SIGN_WE_OWE = 'POSITIVE_MEANS_WE_OWE_CUSTOMER';

export interface CustomersOpeningOptions {
  productId: string | null;
  balanceSign: typeof SIGN_CUSTOMER_OWES | typeof SIGN_WE_OWE;
  /** YYYY-MM-DD the balances were true on — informational only (no ledger row is created). */
  balancesAsOf: string | null;
  codeStrategy: 'USE_FILE_CODES' | 'GENERATE';
  defaultPaymentType: 'CASH' | 'MONTHLY';
  areaIntoAddress: boolean;
  /** Vans named in the file that do not exist yet are created (default on). */
  createMissingVans: boolean;
  /** Prepended to every van label from the file — van labels are unique across ALL companies. */
  vanPrefix: string;
  /** No Route column mapped: use the Area column as the route name. */
  routeFromArea: boolean;
}

export interface ScheduleEntry {
  /** 1 = Monday … 6 = Saturday (the CRM's CustomerDeliverySchedule convention). */
  dayOfWeek: number;
  /** Van label exactly as typed in the file (prefix is applied at plan/execute time). */
  vanLabel: string;
}

export interface NormalizedCustomer {
  customerCode: string | null;
  name: string;
  /** Stored value — "-" when the file has none (existing convention). */
  phoneNumber: string;
  hasPhone: boolean;
  address: string;
  floor: string | null;
  nearbyLandmark: string | null;
  paymentType: 'CASH' | 'MONTHLY';
  isActive: boolean;
  rate: number | null;
  /** Positive = the customer owes the vendor (already sign-corrected). Rupees, 2 dp. */
  openingBalance: number;
  openingBottles: number;
  /** Optional customer grouping: names as typed in the file (trimmed); resolved to ids at execution. */
  group: string | null;
  subGroup: string | null;
  /** Optional route (created if missing) and the customer's stop number on it. */
  route: string | null;
  routeSequence: number | null;
  /** Weekly delivery schedule: which van serves the customer on which day. */
  schedule: ScheduleEntry[];
}

interface VanRef {
  id: string;
  plateNumber: string;
  vendorId: string;
  isActive: boolean;
}

interface PlanContext {
  vendorId: string;
  /** lower-cased plate number -> van (any company: plate numbers are globally unique). */
  vansByPlate: Map<string, VanRef>;
  /** lower-cased route names this company already has. */
  routeNames: Set<string>;
  groupingEnabled: boolean;
  existingCodes: Set<string>;
  existingPhoneName: Set<string>;
  existingPhones: Set<string>;
}

interface ExecContext {
  activeProductIds: string[];
  basePriceByProduct: Map<string, number>;
  reservedCodes: Set<string>;
  nextNumber: number;
  /** groupKey(name) -> CustomerGroup id for the top-level groups used by this file. */
  groupIds: Map<string, string>;
  /** subGroupKey(parentId, name) -> CustomerGroup id. */
  subGroupIds: Map<string, string>;
  /** lower-cased plate number -> Van id (existing + created by this import). */
  vanIds: Map<string, string>;
  /** routeKey(name) -> Route id (existing + created by this import). */
  routeIds: Map<string, string>;
}

const MAX_GROUP_NAME = 100;
const groupKey = (name: string) => name.trim().toLowerCase();
const subGroupKey = (parentId: string, name: string) => `${parentId}|${groupKey(name)}`;

/** One "van per weekday" column each (Sunday is not a delivery day in the CRM). dayOfWeek: 1 = Monday. */
const DAY_COLUMNS: { key: string; dayOfWeek: number; label: string; aliases: string[] }[] = [
  { key: 'dayMon', dayOfWeek: 1, label: 'Monday', aliases: ['mon', 'monday', 'mon van'] },
  { key: 'dayTue', dayOfWeek: 2, label: 'Tuesday', aliases: ['tue', 'tues', 'tuesday', 'tue van'] },
  { key: 'dayWed', dayOfWeek: 3, label: 'Wednesday', aliases: ['wed', 'wednesday', 'wed van'] },
  { key: 'dayThu', dayOfWeek: 4, label: 'Thursday', aliases: ['thu', 'thur', 'thurs', 'thursday', 'thu van'] },
  { key: 'dayFri', dayOfWeek: 5, label: 'Friday', aliases: ['fri', 'friday', 'fri van'] },
  { key: 'daySat', dayOfWeek: 6, label: 'Saturday', aliases: ['sat', 'saturday', 'sat van'] },
];

const DAY_WORDS: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6,
};
const ALL_DAYS_WORDS = new Set(['daily', 'everyday', 'every day', 'all', 'all days', 'mon-sat', 'mon to sat']);
const MAX_VAN_LABEL = 30;
const VAN_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/#-]*$/;
const VAN_PREFIX_RE = /^[A-Za-z0-9._/#-]{0,12}$/;

const routeKey = (name: string) => name.trim().toLowerCase();

/** The plate number a file van label is stored under (prefix applied once, case-insensitively). */
function plateOf(label: string, prefix: string): string {
  const l = label.trim();
  if (!prefix || l.toLowerCase().startsWith(prefix.toLowerCase())) return l;
  return `${prefix}${l}`;
}

/** "Mon, Thu" | "Mon Wed Fri" | "Daily" | "1,4" -> sorted unique day numbers, or the bad token. */
function parseDeliveryDays(text: string): { ok: true; days: number[] } | { ok: false; bad: string } {
  const t = text.trim().toLowerCase();
  if (ALL_DAYS_WORDS.has(t)) return { ok: true, days: [1, 2, 3, 4, 5, 6] };
  const days = new Set<number>();
  for (const tok of t.split(/[\s,;/&+]+/).filter((x) => x && x !== 'and')) {
    const range = /^([a-z]+)-([a-z]+)$/.exec(tok);
    if (range && DAY_WORDS[range[1]] && DAY_WORDS[range[2]] && DAY_WORDS[range[1]] <= DAY_WORDS[range[2]]) {
      for (let d = DAY_WORDS[range[1]]; d <= DAY_WORDS[range[2]]; d++) days.add(d);
      continue;
    }
    const d = DAY_WORDS[tok];
    if (!d) return { ok: false, bad: tok };
    days.add(d);
  }
  return { ok: true, days: [...days].sort((a, b) => a - b) };
}

const FIELDS: ImportFieldDef[] = [
  {
    key: 'customerCode',
    label: 'Customer code',
    type: 'text',
    required: false,
    help: 'Your own customer ID. Leave unmapped to have codes generated.',
    aliases: ['code', 'cust code', 'customer id', 'cust id', 'id', 'account no', 'account number', 'customer no', 'ref', 'reference'],
  },
  {
    key: 'name',
    label: 'Customer name',
    type: 'text',
    required: true,
    aliases: ['name', 'customer', 'customer name', 'party', 'party name', 'client', 'client name', 'full name'],
  },
  {
    key: 'phone',
    label: 'Phone / WhatsApp',
    type: 'phone',
    required: false,
    help: 'Needed for WhatsApp reminders and portal activation.',
    aliases: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'contact', 'contact number', 'contact no', 'cell', 'cell number', 'whatsapp', 'tel', 'telephone'],
  },
  {
    key: 'address',
    label: 'Address',
    type: 'text',
    required: true,
    help: 'Required unless an Area column is mapped.',
    aliases: ['address', 'house no', 'house', 'street', 'location', 'residence', 'delivery address'],
  },
  {
    key: 'area',
    label: 'Area / block',
    type: 'text',
    required: false,
    help: 'Appended to the address.',
    aliases: ['area', 'block', 'sector', 'locality', 'society', 'colony', 'zone', 'town'],
  },
  { key: 'floor', label: 'Floor / flat', type: 'text', required: false, aliases: ['floor', 'flat', 'apartment', 'apt'] },
  {
    key: 'nearbyLandmark',
    label: 'Nearby landmark',
    type: 'text',
    required: false,
    aliases: ['landmark', 'nearby landmark', 'near', 'nearby', 'nearest landmark'],
  },
  {
    key: 'paymentType',
    label: 'Payment type',
    type: 'enum',
    required: false,
    enumValues: [
      { value: 'CASH', label: 'Cash' },
      { value: 'MONTHLY', label: 'Monthly billing' },
    ],
    aliases: ['payment type', 'billing type', 'billing', 'payment mode', 'payment method', 'account type', 'customer type'],
    defaultValueMap: {
      cash: 'CASH',
      'cash customer': 'CASH',
      monthly: 'MONTHLY',
      'monthly customer': 'MONTHLY',
      billing: 'MONTHLY',
      bill: 'MONTHLY',
      credit: 'MONTHLY',
    },
  },
  {
    key: 'group',
    label: 'Customer group',
    type: 'text',
    required: false,
    help: 'Optional. Created automatically if it does not exist yet. Needs Customer Grouping enabled for your company.',
    aliases: ['group', 'client group', 'client_group', 'customer group', 'company', 'party group'],
  },
  {
    key: 'subGroup',
    label: 'Customer sub-group',
    type: 'text',
    required: false,
    help: 'Optional. Sits under the group above, so a Group column must be mapped too.',
    aliases: ['sub group', 'sub_group', 'subgroup', 'sub-group', 'customer sub group'],
  },
  {
    key: 'route',
    label: 'Route',
    type: 'text',
    required: false,
    help: 'Optional. A route is created automatically if it does not exist yet.',
    aliases: ['route', 'route name', 'delivery route', 'route no', 'route number'],
  },
  {
    key: 'routeSequence',
    label: 'Stop number on the route',
    type: 'int',
    required: false,
    help: "Order of this customer in the van's delivery run.",
    aliases: ['route seq', 'route sequence', 'sequence', 'seq', 'stop', 'stop no', 'stop number', 'stop order', 'delivery order', 'route order'],
  },
  {
    key: 'van',
    label: 'Van (for the delivery days below)',
    type: 'text',
    required: false,
    help: 'Use together with "Delivery days". A van is created automatically if it does not exist yet. Or use the Monday–Saturday columns instead.',
    aliases: ['van', 'van no', 'van code', 'van number', 'delivery van', 'vehicle'],
  },
  {
    key: 'deliveryDays',
    label: 'Delivery days',
    type: 'text',
    required: false,
    help: 'e.g. "Mon, Thu" or "Daily" (Mon–Sat). Numbers 1–6 mean Monday–Saturday. Needs the Van column.',
    aliases: ['delivery days', 'delivery day', 'days', 'day', 'weekdays', 'schedule', 'delivery schedule'],
  },
  ...DAY_COLUMNS.map(({ key, label, aliases }) => ({
    key,
    label: `${label} — van`,
    type: 'text' as const,
    required: false,
    help: `The van that delivers on ${label}; leave blank or 0 for no delivery.`,
    aliases,
  })),
  {
    key: 'isActive',
    label: 'Status (active / closed)',
    type: 'bool',
    required: false,
    help: 'Numeric codes (0/1) are never guessed — you map them yourself.',
    enumValues: [
      { value: 'true', label: 'Active' },
      { value: 'false', label: 'Closed / inactive' },
    ],
    aliases: ['status', 'customer status', 'cust status', 'active', 'is active', 'state'],
    defaultValueMap: {
      active: 'true', open: 'true', yes: 'true', true: 'true', y: 'true',
      inactive: 'false', closed: 'false', close: 'false', no: 'false', false: 'false', n: 'false', disabled: 'false',
    },
  },
  {
    key: 'rate',
    label: 'Rate per bottle',
    type: 'money',
    required: false,
    help: 'Stored as a custom price only when it differs from the product price.',
    aliases: ['rate', 'price', 'rate per bottle', 'bottle rate', 'unit price', 'price per bottle', 'bottle price'],
  },
  {
    key: 'openingBalance',
    label: 'Opening balance (money)',
    type: 'money',
    required: false,
    aliases: ['opening balance', 'balance', 'outstanding', 'outstanding balance', 'outstanding bal', 'due', 'amount due', 'dues', 'receivable', 'pending amount', 'closing balance', 'baqaya'],
  },
  {
    key: 'openingBottles',
    label: 'Bottles with customer',
    type: 'int',
    required: false,
    aliases: ['bottle balance', 'bottle bal', 'bottles', 'opening bottles', 'bottles with customer', 'bottles balance', 'pending bottles', 'empty balance'],
  },
];

const CODE_RE = /^[A-Za-z0-9._\-/#]{1,32}$/;

function fieldHeaders(mapping: ImportMapping): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [header, key] of Object.entries(mapping.columns)) if (key) out[key] = header;
  return out;
}

type EnumResolution =
  | { state: 'empty' }
  | { state: 'value'; value: string }
  | { state: 'skip' }
  | { state: 'unmapped'; raw: string };

function resolveEnum(def: ImportFieldDef, mapping: ImportMapping, cell: unknown): EnumResolution {
  const text = parseText(cell as never);
  if (text === null) return { state: 'empty' };
  const key = text.toLowerCase();
  const user = mapping.valueMaps?.[def.key]?.[key];
  if (user === SKIP_ROW_VALUE) return { state: 'skip' };
  const hit = user ?? def.defaultValueMap?.[key];
  if (hit !== undefined && def.enumValues?.some((e) => e.value === hit)) return { state: 'value', value: hit };
  return { state: 'unmapped', raw: text };
}

function err(code: string, message: string, field?: string): RowIssue {
  return { severity: 'ERROR', code, message, field };
}
function warn(code: string, message: string, field?: string): RowIssue {
  return { severity: 'WARNING', code, message, field };
}

function phoneNameKey(phoneNumber: string, name: string): string | null {
  if (!isSendablePhone(phoneNumber)) return null;
  return `${normalizePhone(phoneNumber)}|${name.trim().toLowerCase()}`;
}

function fieldDef(key: string): ImportFieldDef {
  return FIELDS.find((f) => f.key === key) as ImportFieldDef;
}

export const customersOpeningDefinition: ImportDefinition<NormalizedCustomer, CustomersOpeningOptions, PlanContext, ExecContext> = {
  entity: ImportEntity.CUSTOMERS_OPENING,
  label: 'Customers & opening balances',
  fields: FIELDS,

  requiredMappings() {
    return [
      { anyOf: ['name'], message: 'Map the column that holds the customer name.' },
      { anyOf: ['address', 'area'], message: 'Map an Address column (or at least an Area column).' },
    ];
  },

  parseOptions(raw, info: OptionsInfo): CustomersOpeningOptions {
    const o = (raw ?? {}) as Record<string, unknown>;
    const mapped = info.mappedFieldKeys;
    const productDependent = mapped.has('openingBottles') || mapped.has('rate');

    let productId: string | null = typeof o['productId'] === 'string' && o['productId'] ? (o['productId'] as string) : null;
    if (productDependent) {
      if (info.activeProducts.length === 0) {
        throw new ImportError('NO_ACTIVE_PRODUCT', 'Create at least one active product before importing bottle balances or rates.');
      }
      if (!productId) {
        if (info.activeProducts.length === 1) productId = info.activeProducts[0].id;
        else throw new ImportError('PRODUCT_REQUIRED', 'Choose which product the bottle balances and rates belong to.');
      }
      if (!info.activeProducts.some((p) => p.id === productId)) {
        throw new ImportError('PRODUCT_REQUIRED', 'The selected product is not an active product of this vendor.');
      }
    } else {
      productId = null;
    }

    let balanceSign: CustomersOpeningOptions['balanceSign'] = SIGN_CUSTOMER_OWES;
    if (mapped.has('openingBalance')) {
      if (o['balanceSign'] !== SIGN_CUSTOMER_OWES && o['balanceSign'] !== SIGN_WE_OWE) {
        throw new ImportError('BALANCE_SIGN_REQUIRED', 'Say what a positive balance means: the customer owes you, or you owe the customer.');
      }
      balanceSign = o['balanceSign'] as CustomersOpeningOptions['balanceSign'];
    }

    let balancesAsOf: string | null = null;
    if (mapped.has('openingBalance') || mapped.has('openingBottles')) {
      balancesAsOf = parseIsoDate(o['balancesAsOf']);
      if (!balancesAsOf) {
        throw new ImportError('AS_OF_DATE_REQUIRED', 'Enter the date these balances were true on (YYYY-MM-DD).');
      }
      const tomorrow = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
      if (balancesAsOf > tomorrow) throw new ImportError('AS_OF_DATE_REQUIRED', 'The balances date cannot be in the future.');
    }

    const codeStrategy: CustomersOpeningOptions['codeStrategy'] =
      mapped.has('customerCode') && o['codeStrategy'] !== 'GENERATE' ? 'USE_FILE_CODES' : 'GENERATE';

    // Weekly schedule: either "Van + Delivery days" or one van column per weekday — never both.
    const hasVan = mapped.has('van');
    const hasDays = mapped.has('deliveryDays');
    const hasDayCols = DAY_COLUMNS.some((d) => mapped.has(d.key));
    if (hasVan && !hasDays && !hasDayCols) {
      throw new ImportError('VAN_DAYS_PAIR', 'You mapped a Van column but no "Delivery days" column. Map both, or use the Monday–Saturday columns instead.');
    }
    if (hasDays && !hasVan) {
      throw new ImportError('VAN_DAYS_PAIR', 'You mapped "Delivery days" but no Van column. Map the van column too.');
    }
    if (hasVan && hasDayCols) {
      throw new ImportError('SCHEDULE_AMBIGUOUS', 'Use either "Van + Delivery days" or the Monday–Saturday columns — not both.');
    }

    const vanPrefix = typeof o['vanPrefix'] === 'string' ? o['vanPrefix'].trim() : '';
    if (!VAN_PREFIX_RE.test(vanPrefix)) {
      throw new ImportError('VAN_PREFIX_INVALID', 'The van prefix may only contain letters, numbers and . _ - / # (max 12 characters).');
    }

    return {
      productId,
      balanceSign,
      balancesAsOf,
      codeStrategy,
      defaultPaymentType: o['defaultPaymentType'] === 'MONTHLY' ? 'MONTHLY' : 'CASH',
      areaIntoAddress: o['areaIntoAddress'] !== false,
      createMissingVans: o['createMissingVans'] !== false,
      vanPrefix,
      routeFromArea: o['routeFromArea'] === true && mapped.has('area') && !mapped.has('route'),
    };
  },

  normalizeRow(raw: RawRow, mapping: ImportMapping, options): NormalizedRowResult<NormalizedCustomer> {
    const headers = fieldHeaders(mapping);
    const cell = (key: string) => (headers[key] === undefined ? undefined : raw[headers[key]]);
    const issues: RowIssue[] = [];

    // name
    const name = parseText(cell('name') as never);
    if (!name) issues.push(err('NAME_REQUIRED', 'Customer name is missing.', 'name'));

    // code
    let customerCode: string | null = null;
    if (options.codeStrategy === 'USE_FILE_CODES') {
      const c = parseText(cell('customerCode') as never);
      if (c) {
        if (!CODE_RE.test(c)) issues.push(err('CODE_INVALID', `Customer code "${c}" is not valid (letters, numbers, . _ - / # only, max 32).`, 'customerCode'));
        else customerCode = c;
      }
    }

    // phone
    let phoneNumber = '-';
    let hasPhone = false;
    const phoneRaw = parseText(cell('phone') as never);
    if (phoneRaw) {
      if (isSendablePhone(phoneRaw)) {
        phoneNumber = normalizePhone(phoneRaw);
        hasPhone = true;
      } else {
        phoneNumber = phoneRaw.slice(0, 40);
        issues.push(warn('PHONE_INVALID', `Phone "${phoneRaw}" doesn't look like a valid number — WhatsApp reminders and portal activation won't work for this customer.`, 'phone'));
      }
    } else {
      issues.push(warn('PHONE_MISSING', 'No phone number — WhatsApp reminders and portal activation will not work for this customer.', 'phone'));
    }

    // address
    const address1 = parseText(cell('address') as never);
    const area = parseText(cell('area') as never);
    const parts: string[] = [];
    if (address1) parts.push(address1);
    if (area && (options.areaIntoAddress || !address1) && !(address1 && address1.toLowerCase().includes(area.toLowerCase()))) parts.push(area);
    const address = parts.join(', ');
    if (!address) issues.push(err('ADDRESS_REQUIRED', 'Address is missing (and there is no area to fall back on).', 'address'));

    // payment type
    let paymentType: 'CASH' | 'MONTHLY' = options.defaultPaymentType;
    if (headers['paymentType'] !== undefined) {
      const r = resolveEnum(fieldDef('paymentType'), mapping, cell('paymentType'));
      if (r.state === 'value') paymentType = r.value as 'CASH' | 'MONTHLY';
      else if (r.state === 'skip') issues.push(err('ROW_SKIPPED_BY_MAPPING', 'Skipped because of your payment-type mapping.', 'paymentType'));
      else if (r.state === 'unmapped') issues.push(err('UNMAPPED_VALUE', `Payment type "${r.raw}" has not been mapped to Cash or Monthly.`, 'paymentType'));
    }

    // status
    let isActive = true;
    if (headers['isActive'] !== undefined) {
      const r = resolveEnum(fieldDef('isActive'), mapping, cell('isActive'));
      if (r.state === 'value') isActive = r.value === 'true';
      else if (r.state === 'skip') issues.push(err('ROW_SKIPPED_BY_MAPPING', 'Skipped because of your status mapping.', 'isActive'));
      else if (r.state === 'unmapped') issues.push(err('UNMAPPED_VALUE', `Status "${r.raw}" has not been mapped to Active or Closed.`, 'isActive'));
    }

    // rate
    let rate: number | null = null;
    if (headers['rate'] !== undefined) {
      const r = parseMoney(cell('rate') as never);
      if (!r.ok) issues.push(err('INVALID_NUMBER', `Rate "${String(cell('rate'))}" is not a valid amount.`, 'rate'));
      else if (r.value !== null && r.value < 0) issues.push(err('RATE_NEGATIVE', 'Rate cannot be negative.', 'rate'));
      else rate = r.value;
    }

    // opening balance (sign-corrected so positive = customer owes)
    let openingBalance = 0;
    if (headers['openingBalance'] !== undefined) {
      const r = parseMoney(cell('openingBalance') as never);
      if (!r.ok) issues.push(err('INVALID_NUMBER', `Balance "${String(cell('openingBalance'))}" is not a valid amount.`, 'openingBalance'));
      else {
        const v = r.value ?? 0;
        openingBalance = options.balanceSign === SIGN_WE_OWE ? (v === 0 ? 0 : -v) : v;
        if (r.rounded) issues.push(warn('BALANCE_ROUNDED', 'Balance had more than 2 decimals and was rounded.', 'openingBalance'));
      }
    }

    // opening bottles
    let openingBottles = 0;
    if (headers['openingBottles'] !== undefined) {
      const r = parseWholeNumber(cell('openingBottles') as never);
      if (!r.ok) issues.push(err('INVALID_NUMBER', `Bottles "${String(cell('openingBottles'))}" is not a whole number.`, 'openingBottles'));
      else {
        openingBottles = r.value ?? 0;
        if (openingBottles < 0) issues.push(warn('NEGATIVE_BOTTLES', 'Bottle balance is negative (the customer is owed bottles).', 'openingBottles'));
      }
    }

    // optional grouping
    const group = parseText(cell('group') as never);
    const subGroup = parseText(cell('subGroup') as never);
    if (subGroup && !group) issues.push(err('SUBGROUP_WITHOUT_GROUP', 'A sub-group needs a group on the same row.', 'subGroup'));
    if (group && group.length > MAX_GROUP_NAME) issues.push(err('GROUP_NAME_TOO_LONG', `Group name is longer than ${MAX_GROUP_NAME} characters.`, 'group'));
    if (subGroup && subGroup.length > MAX_GROUP_NAME) issues.push(err('GROUP_NAME_TOO_LONG', `Sub-group name is longer than ${MAX_GROUP_NAME} characters.`, 'subGroup'));

    // route + stop number
    let route = parseText(cell('route') as never);
    if (!route && options.routeFromArea) route = area;
    if (route && route.length > MAX_GROUP_NAME) issues.push(err('ROUTE_NAME_TOO_LONG', `Route name is longer than ${MAX_GROUP_NAME} characters.`, 'route'));
    let routeSequence: number | null = null;
    if (headers['routeSequence'] !== undefined) {
      const r = parseWholeNumber(cell('routeSequence') as never);
      if (!r.ok || (r.value !== null && r.value < 0)) issues.push(err('INVALID_NUMBER', `Stop number "${String(cell('routeSequence'))}" is not a whole number.`, 'routeSequence'));
      else routeSequence = r.value;
    }

    // weekly delivery schedule
    const schedule: ScheduleEntry[] = [];
    const scheduleMapped = headers['van'] !== undefined || DAY_COLUMNS.some((d) => headers[d.key] !== undefined);
    const addVan = (dayOfWeek: number, label: string, field: string) => {
      if (label.length > MAX_VAN_LABEL || !VAN_LABEL_RE.test(label)) {
        issues.push(err('VAN_LABEL_INVALID', `Van "${label}" is not a valid van name (letters, numbers, space and . _ - / # only, max ${MAX_VAN_LABEL}).`, field));
        return;
      }
      schedule.push({ dayOfWeek, vanLabel: label });
    };
    if (headers['van'] !== undefined) {
      const van = parseText(cell('van') as never);
      const daysText = parseText(cell('deliveryDays') as never);
      if (daysText && !van) {
        issues.push(err('VAN_MISSING', 'Delivery days are given but the van is blank.', 'van'));
      } else if (van && !daysText) {
        issues.push(warn('DELIVERY_DAYS_MISSING', 'A van is given but no delivery days — no schedule will be created for this customer.', 'deliveryDays'));
      } else if (van && daysText) {
        const parsed = parseDeliveryDays(daysText);
        if ('bad' in parsed) issues.push(err('DELIVERY_DAYS_INVALID', `Delivery day "${parsed.bad}" is not recognised. Use Mon, Tue, Wed, Thu, Fri, Sat, "Daily" or 1–6.`, 'deliveryDays'));
        else if (parsed.days.length === 0) issues.push(warn('DELIVERY_DAYS_MISSING', 'No delivery days found — no schedule will be created for this customer.', 'deliveryDays'));
        else for (const d of parsed.days) addVan(d, van, 'van');
      }
    }
    for (const d of DAY_COLUMNS) {
      if (headers[d.key] === undefined) continue;
      const v = parseText(cell(d.key) as never);
      if (v && v !== '0') addVan(d.dayOfWeek, v, d.key);
    }
    if (scheduleMapped && schedule.length === 0 && !issues.some((i) => i.severity === 'ERROR' || i.code === 'DELIVERY_DAYS_MISSING')) {
      issues.push(warn('NO_SCHEDULE', 'No delivery day/van for this customer — it will be created without a delivery schedule.', 'van'));
    }
    if (routeSequence !== null && schedule.length === 0 && !route) {
      issues.push(warn('SEQUENCE_UNUSED', 'A stop number is given but there is no schedule or route to apply it to.', 'routeSequence'));
    }

    if (!isActive && (openingBalance !== 0 || openingBottles !== 0)) {
      issues.push(warn('CLOSED_WITH_BALANCE', 'Customer is closed but has a non-zero balance.', 'isActive'));
    }

    const hasError = issues.some((i) => i.severity === 'ERROR');
    if (hasError || !name) return { normalized: null, issues };

    return {
      normalized: {
        customerCode,
        name,
        phoneNumber,
        hasPhone,
        address,
        floor: parseText(cell('floor') as never),
        nearbyLandmark: parseText(cell('nearbyLandmark') as never),
        paymentType,
        isActive,
        rate,
        openingBalance,
        openingBottles,
        group,
        subGroup,
        route,
        routeSequence,
        schedule,
      },
      issues,
    };
  },

  async loadContext(prisma: PrismaService, vendorId: string, options, rows): Promise<PlanContext> {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { customerGroupingEnabled: true } });
    const vansByPlate = await loadVansByPlate(prisma, scheduleLabels(rows ?? []).map((l) => plateOf(l, options.vanPrefix)));
    const routes = await prisma.route.findMany({ where: { vendorId }, select: { name: true } });
    const existing = await prisma.customer.findMany({
      where: { vendorId },
      select: { customerCode: true, name: true, phoneNumber: true },
    });
    const existingCodes = new Set<string>();
    const existingPhoneName = new Set<string>();
    const existingPhones = new Set<string>();
    for (const c of existing) {
      existingCodes.add(c.customerCode);
      if (isSendablePhone(c.phoneNumber)) {
        existingPhones.add(normalizePhone(c.phoneNumber));
        const k = phoneNameKey(c.phoneNumber, c.name);
        if (k) existingPhoneName.add(k);
      }
    }
    return {
      vendorId,
      vansByPlate,
      routeNames: new Set(routes.map((r) => routeKey(r.name))),
      existingCodes,
      existingPhoneName,
      existingPhones,
      groupingEnabled: vendor?.customerGroupingEnabled ?? false,
    };
  },

  validateAndPlan(rows, ctx, options): PlannedRow<NormalizedCustomer>[] {
    const seenCodes = new Map<string, number>();
    const seenPhoneName = new Map<string, number>();
    const seenPhones = new Set<string>();

    return rows.map((row) => {
      const issues = [...row.issues];
      const n = row.normalized;
      if (!n || issues.some((i) => i.severity === 'ERROR')) {
        return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_INVALID' as const };
      }

      if (n.group && !ctx.groupingEnabled) {
        issues.push(err('GROUPING_DISABLED', 'Customer Grouping is not enabled for your company. Turn it on in Company Profile, or unmap the group columns.', 'group'));
        return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_INVALID' as const };
      }

      // In-file duplicates — first occurrence wins, later ones are blocked.
      if (n.customerCode) {
        const first = seenCodes.get(n.customerCode);
        if (first !== undefined) {
          issues.push(err('DUPLICATE_CODE_IN_FILE', `Customer code "${n.customerCode}" already appears on row ${first}.`, 'customerCode'));
          return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_INVALID' as const };
        }
      }
      const pnKey = phoneNameKey(n.phoneNumber, n.name);
      if (!n.customerCode && pnKey) {
        const first = seenPhoneName.get(pnKey);
        if (first !== undefined) {
          issues.push(err('DUPLICATE_IN_FILE', `Same name and phone as row ${first}.`));
          return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_INVALID' as const };
        }
      }
      if (n.customerCode) seenCodes.set(n.customerCode, row.rowNumber);
      if (pnKey) seenPhoneName.set(pnKey, row.rowNumber);

      // Already in the CRM → skip (create-only).
      if (n.customerCode && ctx.existingCodes.has(n.customerCode)) {
        issues.push(warn('ALREADY_EXISTS', `A customer with code "${n.customerCode}" already exists — skipped, nothing was changed.`, 'customerCode'));
        return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_EXISTING' as const };
      }
      if (!n.customerCode && pnKey && ctx.existingPhoneName.has(pnKey)) {
        issues.push(warn('ALREADY_EXISTS', 'A customer with the same name and phone already exists — skipped, nothing was changed.'));
        return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_EXISTING' as const };
      }

      // Shared phone is allowed (families, shops) but flagged — it blocks portal activation.
      if (n.hasPhone) {
        const p = normalizePhone(n.phoneNumber);
        if (ctx.existingPhones.has(p) || seenPhones.has(p)) {
          issues.push(warn('PHONE_SHARED', 'This phone number is already used by another customer.', 'phone'));
        }
        seenPhones.add(p);
      }

      // Every van the schedule names must be usable by THIS company.
      let vanProblem = false;
      for (const label of new Set(n.schedule.map((s) => s.vanLabel))) {
        const plate = plateOf(label, options.vanPrefix);
        const van = ctx.vansByPlate.get(plate.toLowerCase());
        if (van && van.vendorId !== ctx.vendorId) {
          issues.push(err('VAN_LABEL_TAKEN', `Van "${plate}" is already used by another company's account. Set a van prefix (e.g. "ABC-") in the import options so your vans get their own names.`, 'van'));
          vanProblem = true;
        } else if (van && !van.isActive) {
          issues.push(err('VAN_INACTIVE', `Van "${van.plateNumber}" exists but is inactive. Reactivate it first.`, 'van'));
          vanProblem = true;
        } else if (!van && !options.createMissingVans) {
          issues.push(err('VAN_NOT_FOUND', `Van "${plate}" does not exist. Create it first, or allow the import to create missing vans.`, 'van'));
          vanProblem = true;
        }
      }
      if (vanProblem) return { rowNumber: row.rowNumber, normalized: n, issues, action: 'SKIP_INVALID' as const };

      return { rowNumber: row.rowNumber, normalized: n, issues, action: 'CREATE' as const };
    });
  },

  summarize(planned, options, ctx): PlanSummary {
    const s: PlanSummary = {
      total: planned.length,
      create: 0,
      skipExisting: 0,
      skipInvalid: 0,
      rowsWithWarnings: 0,
      sumOpeningBalancePaise: 0,
      sumOpeningBottles: 0,
    };
    for (const p of planned) {
      if (p.action === 'CREATE' && p.normalized) {
        s.create++;
        s.sumOpeningBalancePaise += toPaise(p.normalized.openingBalance);
        s.sumOpeningBottles += p.normalized.openingBottles;
        if (p.issues.some((i) => i.severity === 'WARNING')) s.rowsWithWarnings++;
      } else if (p.action === 'SKIP_EXISTING') s.skipExisting++;
      else s.skipInvalid++;
    }

    // Routes / vans / schedules this import will create (only when the file carries any).
    const created = planned.filter((p) => p.action === 'CREATE' && p.normalized).map((p) => p.normalized as NormalizedCustomer);
    if (options && ctx && created.some((n) => n.route || n.schedule.length)) {
      const newVans = new Map<string, string>();
      const existingVans = new Set<string>();
      for (const n of created) {
        for (const e of n.schedule) {
          const plate = plateOf(e.vanLabel, options.vanPrefix);
          if (ctx.vansByPlate.has(plate.toLowerCase())) existingVans.add(plate.toLowerCase());
          else if (!newVans.has(plate.toLowerCase())) newVans.set(plate.toLowerCase(), plate);
        }
      }
      const newRoutes = new Map<string, string>();
      const existingRoutes = new Set<string>();
      for (const n of created) {
        if (!n.route) continue;
        if (ctx.routeNames.has(routeKey(n.route))) existingRoutes.add(routeKey(n.route));
        else if (!newRoutes.has(routeKey(n.route))) newRoutes.set(routeKey(n.route), n.route);
      }
      s.schedule = {
        customersWithSchedule: created.filter((n) => n.schedule.length > 0).length,
        scheduleEntries: created.reduce((sum, n) => sum + n.schedule.length, 0),
        vansToCreate: [...newVans.values()].sort(),
        vansExisting: existingVans.size,
        routesToCreate: [...newRoutes.values()].sort(),
        routesExisting: existingRoutes.size,
      };
    }
    return s;
  },

  async prepareExecution(prisma: PrismaService, vendorId: string, rows, options): Promise<ExecContext> {
    const products = await prisma.product.findMany({
      where: { vendorId, isActive: true },
      select: { id: true, basePrice: true },
    });
    const max = await prisma.$queryRaw<{ maxnum: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING("customerCode", 2) AS INTEGER)) AS maxnum
      FROM "Customer"
      WHERE "vendorId" = ${vendorId} AND "customerCode" ~ '^L[0-9]{1,9}$'
    `;
    const reservedCodes = new Set<string>();
    for (const r of rows) if (r.normalized.customerCode) reservedCodes.add(r.normalized.customerCode);
    const { groupIds, subGroupIds } = await resolveGroups(prisma, vendorId, rows.map((r) => r.normalized));
    const { vanIds, routeIds } = await resolveVansAndRoutes(prisma, vendorId, rows.map((r) => r.normalized), options);
    return {
      groupIds,
      subGroupIds,
      vanIds,
      routeIds,
      activeProductIds: products.map((p) => p.id),
      basePriceByProduct: new Map(products.map((p) => [p.id, p.basePrice])),
      reservedCodes,
      nextNumber: (max[0]?.maxnum ?? 0) + 1,
    };
  },

  async executeRow(prisma: PrismaService, vendorId: string, row: ExecRow<NormalizedCustomer>, exec, options, record): Promise<ExecOutcome> {
    const n = row.normalized;
    const fileCode = n.customerCode;

    for (let attempt = 0; attempt < 4; attempt++) {
      let code = fileCode;
      if (!code) {
        do code = `L${exec.nextNumber++}`;
        while (exec.reservedCodes.has(code));
      }
      try {
        return await prisma.$transaction(async (tx) => {
          // Re-check at write time: someone may have created it since the plan was built.
          const clash = await tx.customer.findUnique({
            where: { vendorId_customerCode: { vendorId, customerCode: code as string } },
            select: { id: true },
          });
          if (clash) {
            if (fileCode) {
              return { result: 'SKIPPED', resultCode: 'CODE_ALREADY_EXISTS', resultMessage: `A customer with code "${code}" already exists — skipped.` } as ExecOutcome;
            }
            throw new CodeCollision();
          }

          const groupId = n.group ? exec.groupIds.get(groupKey(n.group)) ?? null : null;
          const subGroupId = groupId && n.subGroup ? exec.subGroupIds.get(subGroupKey(groupId, n.subGroup)) ?? null : null;

          const routeId = n.route ? exec.routeIds.get(routeKey(n.route)) ?? null : null;
          const deliverySchedule = (n.schedule ?? []).flatMap((e) => {
            const vanId = exec.vanIds.get(plateOf(e.vanLabel, options.vanPrefix).toLowerCase());
            return vanId ? [{ vanId, dayOfWeek: e.dayOfWeek, routeSequence: n.routeSequence }] : [];
          });

          const productId = options.productId;
          const basePrice = productId ? exec.basePriceByProduct.get(productId) : undefined;
          const applyRate = productId !== null && n.rate !== null && n.rate !== basePrice;
          const walletBalances = productId && n.openingBottles !== 0 ? { [productId]: n.openingBottles } : undefined;

          const customer = await createCustomerRecords(tx, {
            vendorId,
            customerCode: code as string,
            customer: {
              name: n.name,
              phoneNumber: n.phoneNumber,
              address: n.address,
              floor: n.floor,
              nearbyLandmark: n.nearbyLandmark,
              paymentType: n.paymentType === 'MONTHLY' ? PaymentType.MONTHLY : PaymentType.CASH,
              isActive: n.isActive,
              financialBalance: n.openingBalance,
              groupId,
              subGroupId,
              routeId,
            },
            deliverySchedule,
            activeProductIds: exec.activeProductIds,
            walletBalances,
            defaultProductId: applyRate ? (productId as string) : undefined,
            defaultPrice: applyRate ? (n.rate as number) : undefined,
          });

          const outcome: ExecOutcome = {
            result: 'CREATED',
            entityType: 'Customer',
            entityId: customer.id,
            appliedSnapshot: {
              customerCode: customer.customerCode,
              financialBalance: n.openingBalance,
              productId: productId,
              walletBalance: walletBalances ? n.openingBottles : 0,
              customPrice: applyRate ? n.rate : null,
            } as Prisma.InputJsonValue,
          };
          await record(tx, outcome); // same transaction as the customer write
          return outcome;
        }, TX_OPTIONS);
      } catch (e) {
        const isUnique = (e as { code?: string })?.code === 'P2002';
        if ((e instanceof CodeCollision || isUnique) && !fileCode && attempt < 3) {
          // Generated code raced with a manual create — take the next number and retry.
          if (code) exec.reservedCodes.add(code);
          continue;
        }
        if (isUnique) {
          return { result: 'FAILED', resultCode: 'CODE_CONFLICT', resultMessage: `Customer code "${code}" is already taken.`, cause: e };
        }
        return { result: 'FAILED', resultCode: 'DB_ERROR', resultMessage: 'This row could not be saved. It can be retried with Resume.', cause: e };
      }
    }
    return { result: 'FAILED', resultCode: 'CODE_CONFLICT', resultMessage: 'Could not allocate a free customer code.' };
  },

  revertRows: revertCustomerRows,

  templateSample() {
    return {
      headers: [
        'Customer Code', 'Customer Name', 'Phone', 'Address', 'Area', 'Floor', 'Payment Type', 'Status', 'Rate', 'Opening Balance', 'Bottles With Customer',
        'Route', 'Stop Number', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
      ],
      example: ['C001', 'Ahmed Khan', '03001234567', 'House 12, Street 4', 'Block B', '2nd', 'Cash', 'Active', 240, 1500, 3, 'Block B route', 5, 'V1', '', 'V1', '', 'V1', ''],
    };
  },
};

class CodeCollision extends Error {}

/**
 * Find-or-create every group / sub-group the file uses (case-insensitive, trimmed) BEFORE the
 * per-row transactions run, so a rolled-back row can never leave a stale id in the cache. Groups
 * created here stay even if a later row fails or the import is reverted; they are empty and harmless.
 */
async function resolveGroups(
  prisma: PrismaService,
  vendorId: string,
  customers: NormalizedCustomer[],
): Promise<{ groupIds: Map<string, string>; subGroupIds: Map<string, string> }> {
  const groupIds = new Map<string, string>();
  const subGroupIds = new Map<string, string>();

  // distinct names, keeping the first spelling seen
  const groups = new Map<string, string>();
  const subs = new Map<string, { group: string; name: string }>();
  for (const c of customers) {
    if (!c.group) continue;
    const gk = groupKey(c.group);
    if (!groups.has(gk)) groups.set(gk, c.group);
    if (c.subGroup) {
      const sk = `${gk}|${groupKey(c.subGroup)}`;
      if (!subs.has(sk)) subs.set(sk, { group: gk, name: c.subGroup });
    }
  }
  if (groups.size === 0) return { groupIds, subGroupIds };

  const existing = await prisma.customerGroup.findMany({ where: { vendorId, deletedAt: null } });
  const byId = new Map(existing.map((g) => [g.id, g]));
  for (const g of existing) {
    if (g.parentId === null && !groupIds.has(groupKey(g.name))) groupIds.set(groupKey(g.name), g.id);
  }
  for (const g of existing) {
    const parent = g.parentId ? byId.get(g.parentId) : undefined;
    if (parent && !subGroupIds.has(subGroupKey(parent.id, g.name))) subGroupIds.set(subGroupKey(parent.id, g.name), g.id);
  }

  for (const [gk, name] of groups) {
    if (!groupIds.has(gk)) {
      const created = await prisma.customerGroup.create({ data: { vendorId, name } });
      groupIds.set(gk, created.id);
    }
  }
  for (const { group, name } of subs.values()) {
    const parentId = groupIds.get(group) as string;
    if (!subGroupIds.has(subGroupKey(parentId, name))) {
      const created = await prisma.customerGroup.create({ data: { vendorId, name, parentId } });
      subGroupIds.set(subGroupKey(parentId, name), created.id);
    }
  }
  return { groupIds, subGroupIds };
}

/** Distinct van labels used by the file's schedules (first spelling wins, case-insensitive). */
function scheduleLabels(rows: { normalized: NormalizedCustomer | null }[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) for (const e of r.normalized?.schedule ?? []) if (!seen.has(e.vanLabel.toLowerCase())) seen.set(e.vanLabel.toLowerCase(), e.vanLabel);
  return [...seen.values()];
}

/** Vans (of ANY company — plate numbers are globally unique) matching these plate numbers, keyed by lower-case plate. */
async function loadVansByPlate(prisma: PrismaService, plates: string[]): Promise<Map<string, VanRef>> {
  const out = new Map<string, VanRef>();
  const distinct = [...new Set(plates.map((p) => p.toLowerCase()))];
  for (let i = 0; i < distinct.length; i += 100) {
    const chunk = distinct.slice(i, i + 100);
    const vans = await prisma.van.findMany({
      where: { OR: chunk.map((p) => ({ plateNumber: { equals: p, mode: 'insensitive' as const } })) },
      select: { id: true, plateNumber: true, vendorId: true, isActive: true },
    });
    for (const v of vans) out.set(v.plateNumber.toLowerCase(), v);
  }
  return out;
}

/**
 * Find-or-create every van and route the file uses BEFORE the per-row transactions run (same
 * reasoning as resolveGroups). Vans/routes created here stay if the import is reverted — they are
 * empty and harmless. A new route's default van is the van most of its customers use.
 */
async function resolveVansAndRoutes(
  prisma: PrismaService,
  vendorId: string,
  customers: NormalizedCustomer[],
  options: CustomersOpeningOptions,
): Promise<{ vanIds: Map<string, string>; routeIds: Map<string, string> }> {
  const vanIds = new Map<string, string>();
  const routeIds = new Map<string, string>();

  const plates = new Map<string, string>(); // lower -> display
  for (const label of scheduleLabels(customers.map((normalized) => ({ normalized })))) {
    const plate = plateOf(label, options.vanPrefix);
    if (!plates.has(plate.toLowerCase())) plates.set(plate.toLowerCase(), plate);
  }
  if (plates.size > 0) {
    const existing = await loadVansByPlate(prisma, [...plates.values()]);
    for (const [lower, plate] of plates) {
      const van = existing.get(lower);
      if (van) {
        if (van.vendorId !== vendorId) throw new ImportError('VAN_LABEL_TAKEN', `Van "${plate}" is already used by another company's account. Set a van prefix in the import options.`);
        if (!van.isActive) throw new ImportError('VAN_INACTIVE', `Van "${van.plateNumber}" is inactive.`);
        vanIds.set(lower, van.id);
      } else if (options.createMissingVans) {
        const created = await prisma.van.create({ data: { plateNumber: plate, vendorId } });
        vanIds.set(lower, created.id);
      } else {
        throw new ImportError('VAN_NOT_FOUND', `Van "${plate}" does not exist.`);
      }
    }
  }

  const wanted = new Map<string, string>(); // routeKey -> display name
  const vanVotes = new Map<string, Map<string, number>>(); // routeKey -> vanId -> customers
  for (const c of customers) {
    if (!c.route) continue;
    const k = routeKey(c.route);
    if (!wanted.has(k)) wanted.set(k, c.route);
    const first = [...(c.schedule ?? [])].sort((a, b) => a.dayOfWeek - b.dayOfWeek)[0];
    const vanId = first ? vanIds.get(plateOf(first.vanLabel, options.vanPrefix).toLowerCase()) : undefined;
    if (vanId) {
      const votes = vanVotes.get(k) ?? new Map<string, number>();
      votes.set(vanId, (votes.get(vanId) ?? 0) + 1);
      vanVotes.set(k, votes);
    }
  }
  if (wanted.size > 0) {
    const existing = await prisma.route.findMany({ where: { vendorId }, select: { id: true, name: true } });
    for (const r of existing) if (!routeIds.has(routeKey(r.name))) routeIds.set(routeKey(r.name), r.id);
    for (const [k, name] of wanted) {
      if (routeIds.has(k)) continue;
      const top = [...(vanVotes.get(k) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])[0];
      const created = await prisma.route.create({ data: { name, vendorId, defaultVanId: top ? top[0] : null } });
      routeIds.set(k, created.id);
    }
  }
  return { vanIds, routeIds };
}

/** A slow DB must not expire the per-row transaction (Prisma defaults are 2 s wait / 5 s run). */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;
