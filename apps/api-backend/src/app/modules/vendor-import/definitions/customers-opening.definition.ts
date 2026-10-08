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
}

interface PlanContext {
  existingCodes: Set<string>;
  existingPhoneName: Set<string>;
  existingPhones: Set<string>;
}

interface ExecContext {
  activeProductIds: string[];
  basePriceByProduct: Map<string, number>;
  reservedCodes: Set<string>;
  nextNumber: number;
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

    return {
      productId,
      balanceSign,
      balancesAsOf,
      codeStrategy,
      defaultPaymentType: o['defaultPaymentType'] === 'MONTHLY' ? 'MONTHLY' : 'CASH',
      areaIntoAddress: o['areaIntoAddress'] !== false,
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
      },
      issues,
    };
  },

  async loadContext(prisma: PrismaService, vendorId: string): Promise<PlanContext> {
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
    return { existingCodes, existingPhoneName, existingPhones };
  },

  validateAndPlan(rows, ctx): PlannedRow<NormalizedCustomer>[] {
    const seenCodes = new Map<string, number>();
    const seenPhoneName = new Map<string, number>();
    const seenPhones = new Set<string>();

    return rows.map((row) => {
      const issues = [...row.issues];
      const n = row.normalized;
      if (!n || issues.some((i) => i.severity === 'ERROR')) {
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

      return { rowNumber: row.rowNumber, normalized: n, issues, action: 'CREATE' as const };
    });
  },

  summarize(planned): PlanSummary {
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
    return s;
  },

  async prepareExecution(prisma: PrismaService, vendorId: string, rows): Promise<ExecContext> {
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
    return {
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
            },
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
      headers: ['Customer Code', 'Customer Name', 'Phone', 'Address', 'Area', 'Floor', 'Payment Type', 'Status', 'Rate', 'Opening Balance', 'Bottles With Customer'],
      example: ['C001', 'Ahmed Khan', '03001234567', 'House 12, Street 4', 'Block B', '2nd', 'Cash', 'Active', 240, 1500, 3],
    };
  },
};

class CodeCollision extends Error {}

/** A slow DB must not expire the per-row transaction (Prisma defaults are 2 s wait / 5 s run). */
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;
