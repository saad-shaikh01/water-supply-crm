/**
 * Reset ONE vendor to a "fresh start" while keeping its setup.
 *
 * REMOVES (for that vendor only): customers (+ wallets, prices, schedules, deposits, flags, groups), daily sheets and
 * everything under them, transactions, orders, tickets, payments, conversations, expenses, fleet records (fuel, service,
 * documents, daily checks, fuel top-ups ...), van cash ledger, imports, ALL logs (audit, notification, reminder,
 * in-app, driver location ...) and the Wasabi files those rows point to.
 *
 * KEEPS: vendor record, branding, users + roles, products (+ costs), vans, vehicles (+ profile, maintenance rules),
 * routes, warehouse stock ROWS (counts are set to 0), notification / reminder / policy settings, payroll + staff data.
 *
 * SAFE BY DEFAULT: without --execute it is a DRY RUN (counts only, nothing deleted).
 *
 *   # dry run
 *   node -r ./scripts/register-ts-paths.cjs scripts/vendor-reset-data.ts --slug <vendor-slug>
 *   # real run (vendor must be suspended first; take a DB backup first)
 *   node -r ./scripts/register-ts-paths.cjs scripts/vendor-reset-data.ts --slug <vendor-slug> --execute --confirm <vendor-slug>
 *
 * Flags: --skip-wasabi (DB only) | --keep-impersonation-sessions is the default (super-admin access trail is platform data).
 * Order: DB transaction first (all-or-nothing), THEN Wasabi deletion. If the DB step fails nothing in Wasabi is touched.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { planVendorWipe } from '../apps/api-backend/src/app/modules/vendor/vendor-wipe.planner';

// Everything NOT in this list (and owned by the vendor) is deleted.
const KEEP = new Set<string>([
  // identity / access
  'Vendor', 'VendorBranding', 'User', 'Role', 'RolePermission', 'WhatsAppAccount', 'WhatsAppTemplate',
  // catalogue + fleet identity
  'Product', 'ProductCost', 'Van', 'Vehicle', 'VehicleProfile', 'VehicleServiceTypeDef', 'VehicleMaintenanceRule',
  'FleetAlertRecipient', 'FuelCard', 'Route', 'ExtraLabourType',
  // warehouse stock rows are kept but zeroed below
  'WarehouseStock',
  // settings
  'NotificationSetting', 'ReminderScheduleConfig', 'WarehouseAutoRefillConfig', 'CollectionPolicyConfig',
  'CashCollectionPolicyConfig', 'BalanceReminderConfig', 'CustomerFlagCategory', 'AttendanceCategory', 'ImportMappingProfile',
  // payroll / staff (not customer data) + billing + super-admin trail
  'SalaryStructure', 'SupplierBillOpeningBalance', 'StaffLedgerEntry', 'StaffAdvancePlan', 'PayrollApprovalRule',
  'PayrollVendorConfig', 'PayrollPeriod', 'PayrollEntry', 'PayrollSlipDispatch', 'Settlement', 'StaffAttendance',
  'VendorSubscription', 'Invoice', 'InvoicePayment', 'PayrollSlipDelivery', 'StaffAdvanceInstallment', 'ImpersonationSession', 'AnnouncementVendor',
]);

// [model, column] pairs that hold Wasabi object keys (String, String[] or Json — all read through to_jsonb).
const FILE_COLUMNS: [string, string][] = [
  ['DailySheetItem', 'photoKey'], ['TicketMessage', 'attachments'], ['PaymentRequest', 'screenshotPath'],
  ['CrewCashDistribution', 'photoKeys'], ['DamageCase', 'photoKeys'], ['ConversationMessage', 'audioKey'],
  ['ConversationMessage', 'attachments'], ['VehicleDocument', 'fileKey'], ['VehicleDailyCheck', 'odometerPhotoKey'],
  ['VehicleDailyCheck', 'damagePhotoKeys'], ['FuelLog', 'receiptPhotoKey'], ['FuelCardTopUp', 'attachmentKey'],
  ['VehicleServiceRecord', 'invoicePhotoKey'], ['OfficeCashRemittance', 'attachmentKey'], ['ImportBatch', 'sourceFileKey'],
];
// Upload prefixes (`<prefix>/<vendorId>/<uuid>.ext`). `vendor-branding/*` is deliberately NOT here (branding is kept).
const VENDOR_PREFIXES = [
  'delivery-photos', 'delivery-voice-notes', 'damage-photos', 'payment-screenshots', 'ticket-attachments',
  'office-cash-remittance', 'fleet-photos', 'fuel-card-topup', 'imports',
];

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const flag = (n: string) => process.argv.includes(`--${n}`);

function collectKeys(v: unknown, out: Set<string>) {
  if (typeof v === 'string') { if (v && !/^https?:/i.test(v) && !v.startsWith('/') && v.includes('/')) out.add(v); }
  else if (Array.isArray(v)) v.forEach((x) => collectKeys(x, out));
  else if (v && typeof v === 'object') Object.values(v as object).forEach((x) => collectKeys(x, out));
}

async function main() {
  const slug = arg('slug');
  const execute = flag('execute');
  if (!slug) throw new Error('--slug <vendor-slug> is required');
  const prisma = new PrismaClient();
  const vendor = await prisma.vendor.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, isActive: true } });
  if (!vendor) throw new Error(`No vendor with slug "${slug}"`);
  const id = vendor.id;
  const dbName = (process.env['DATABASE_URL'] ?? '').split('?')[0].split('/').pop();
  console.log(`\nVendor: ${vendor.name} (${vendor.slug})  db=${dbName}  mode=${execute ? 'EXECUTE' : 'DRY RUN'}\n`);

  const plan = planVendorWipe(Prisma.dmmf.datamodel.models as never, { keepModels: KEEP, partialScope: {} });
  console.log('Tables that will be emptied (for this vendor):\n  ' + plan.deleteOrder.join(', ') + '\n');

  // ── counts ──
  const counts: { model: string; rows: number }[] = [];
  for (const s of plan.countSteps) {
    const r = (await prisma.$queryRawUnsafe(s.sql, id)) as { n: number }[];
    if (Number(r[0]?.n) > 0) counts.push({ model: s.model, rows: Number(r[0].n) });
  }
  counts.sort((a, b) => b.rows - a.rows);
  console.table(counts);
  const kept = await Promise.all(['User', 'Product', 'Van', 'Vehicle'].map(async (m) => [m, await (prisma as never as Record<string, { count(a: unknown): Promise<number> }>)[m[0].toLowerCase() + m.slice(1)].count({ where: { vendorId: id } })] as const));
  console.log('Kept (before):', Object.fromEntries(kept));

  // ── Wasabi keys (collected BEFORE the DB rows disappear) ──
  const keys = new Set<string>();
  for (const [model, col] of FILE_COLUMNS) {
    const scope = plan.scopes[model];
    if (!scope) throw new Error(`File column ${model}.${col}: model is not wiped — fix FILE_COLUMNS/KEEP`);
    const rows = (await prisma.$queryRawUnsafe(`SELECT to_jsonb(a."${col}")::text AS v FROM "${model}" a WHERE ${scope} AND a."${col}" IS NOT NULL`, id)) as { v: string }[];
    for (const r of rows) collectKeys(JSON.parse(r.v), keys);
  }
  const branding = await prisma.vendorBranding.findUnique({ where: { vendorId: id }, select: { logoKey: true, iconKey: true } });
  const protectedKeys = new Set([branding?.logoKey, branding?.iconKey].filter(Boolean) as string[]);
  for (const k of [...keys]) if (k.startsWith('vendor-branding/') || protectedKeys.has(k)) keys.delete(k);

  const wasabi = !flag('skip-wasabi');
  let s3: S3Client | undefined;
  const bucket = process.env['WASABI_BUCKET'] ?? '';
  if (wasabi) {
    if (!process.env['WASABI_ENDPOINT'] || !bucket) throw new Error('WASABI_* env vars missing (or pass --skip-wasabi)');
    s3 = new S3Client({
      region: process.env['WASABI_REGION'] ?? 'us-east-1', endpoint: process.env['WASABI_ENDPOINT'], forcePathStyle: true,
      credentials: { accessKeyId: process.env['WASABI_ACCESS_KEY_ID'] ?? '', secretAccessKey: process.env['WASABI_SECRET_ACCESS_KEY'] ?? '' },
    });
    for (const p of VENDOR_PREFIXES) {
      let token: string | undefined;
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${p}/${id}/`, ContinuationToken: token }));
        (r.Contents ?? []).forEach((o) => o.Key && keys.add(o.Key));
        token = r.NextContinuationToken;
      } while (token);
    }
  }
  console.log(`Wasabi files to delete: ${wasabi ? keys.size : '(skipped)'}  (referenced by rows + everything under <prefix>/${id}/)`);

  if (!execute) { console.log('\nDRY RUN — nothing was changed. Re-run with --execute --confirm <slug> to apply.'); return prisma.$disconnect(); }

  // ── guards ──
  if (arg('confirm') !== vendor.slug) throw new Error('--confirm must equal the vendor slug');
  if (vendor.isActive) throw new Error('Suspend the vendor first (so nobody writes while data is removed).');
  const allowed = (process.env['WHATSAPP_ALLOWED_VENDOR_IDS'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (allowed.includes(id)) console.log('NOTE: this vendor is in WHATSAPP_ALLOWED_VENDOR_IDS (live vendor) — proceeding because you passed --execute --confirm.');

  // manifest of what will be deleted from Wasabi (so the list survives)
  const dir = join(process.cwd(), 'tmp'); mkdirSync(dir, { recursive: true });
  const manifest = join(dir, `wasabi-delete-manifest-${vendor.slug}-${Date.now()}.txt`);
  writeFileSync(manifest, [...keys].join('\n'));
  console.log('Wasabi key manifest:', manifest);

  // ── DB: one transaction ──
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `vendor-reset:${id}`);
    for (const s of plan.nullifySteps) await tx.$executeRawUnsafe(s.sql, id);
    for (const s of plan.deleteSteps) deleted[s.model] = Number(await tx.$executeRawUnsafe(s.sql, id));
    await tx.warehouseStock.updateMany({ where: { vendorId: id }, data: { filledCount: 0, emptyCount: 0, damagedCount: 0, leakedCount: 0, inRepairCount: 0 } });
  }, { timeout: 15 * 60_000, maxWait: 10_000 });
  console.log('DB reset done. Rows deleted:', Object.values(deleted).reduce((a, b) => a + b, 0));

  // one summary row so the reset itself is traceable (written AFTER the logs were wiped)
  await prisma.auditLog.create({ data: { vendorId: id, action: 'VENDOR_DATA_RESET', entity: 'Vendor', entityId: id, changes: { totalFiles: keys.size, tables: deleted } as never } }).catch(() => undefined);

  // ── Wasabi (after the DB commit) ──
  if (wasabi && s3) {
    const all = [...keys]; let ok = 0; const failed: string[] = [];
    for (let i = 0; i < all.length; i += 1000) {
      const batch = all.slice(i, i + 1000);
      const r = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
      ok += batch.length - (r.Errors?.length ?? 0);
      (r.Errors ?? []).forEach((e) => e.Key && failed.push(e.Key));
    }
    console.log(`Wasabi: deleted ${ok}/${all.length}${failed.length ? `, FAILED ${failed.length}` : ''}`);
    if (failed.length) writeFileSync(manifest.replace('.txt', '-FAILED.txt'), failed.join('\n'));
  }
  console.log('\nNext: clear Redis cache (restart API / redis scripts), re-import data, then reactivate the vendor.');
  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR', e.message ?? e); process.exit(1); });
