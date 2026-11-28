/**
 * Reset ONE vendor's daily-sheet history — every DailySheet (open AND closed), not the whole vendor.
 *
 * REMOVES (for that vendor only): daily sheets + items, trips/loads, crew snapshots, transactions
 * linked by sheet or item, crew cash distributions, van cash handovers, vehicle daily
 * checks, sheet discrepancy cases (+ their audit logs), delivery issues, delivery repricing items,
 * delivery-item move logs, linked expenses, fuel logs, warehouse transactions, and staff
 * attendance. Linked conversations are deleted along with their messages and read receipts.
 * The Wasabi cleanup includes delivery photos and chat voice notes.
 *
 * KEPT (never touched): customers, wallets, financial/bottle balances (running totals — deleting old
 * transactions does not change them), products, vans, vehicles, routes, users, payroll/staff ledger
 * data, customer deposits (only their dailySheetItemId link is nulled), DamageCase
 * (only their dailySheetId/dailySheetItemId link is nulled), warehouse stock counts.
 *
 * SAFE BY DEFAULT: without --execute it is a DRY RUN (counts only, nothing deleted).
 *
 *   # dry run
 *   node -r ./scripts/register-ts-paths.cjs scripts/vendor-reset-daily-sheets.ts --slug <vendor-slug>
 *   # real run (vendor must be suspended first; take a DB backup first)
 *   node -r ./scripts/register-ts-paths.cjs scripts/vendor-reset-daily-sheets.ts --slug <vendor-slug> --execute --confirm <vendor-slug>
 *
 * Flags: --skip-wasabi (DB only).
 * Order: DB transaction first (all-or-nothing), THEN Wasabi deletion. If the DB step fails nothing in Wasabi is touched.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { planVendorWipe } from '../apps/api-backend/src/app/modules/vendor/vendor-wipe.planner';

// Only DailySheet seeds ownership — everything else must be reached through a required relation
// (DailySheetItem, DailySheetCrew, DailySheetLoad, CrewCashDistribution, VehicleDailyCheck,
// VanCashHandover, SheetDiscrepancyCase(+AuditLog), DeliveryIssue, DeliveryRepricingItem,
// ConversationMessage, DeliveryItemMoveLog — all discovered automatically from the schema) or one
// of the forced optional links below. Everything NOT reached this way is left alone.
const ROOT_MODELS = new Set<string>(['DailySheet']);

// Optional-FK models the owner explicitly chose to delete (not just unlink) when they were part of
// a reset sheet. Field name is the Prisma RELATION field (not the `*Id` column).
const FORCE_OWN_VIA = {
  Expense: ['dailySheet'],
  FuelLog: ['dailySheet'],
  WarehouseTransaction: ['dailySheet'],
  StaffAttendance: ['dailySheet'],
  Transaction: ['dailySheet', 'dailySheetItem'],
  Conversation: ['dailySheet', 'item'],
};

// [model, column] pairs (within the owned subtree only) that hold Wasabi object keys.
const FILE_COLUMNS: [string, string][] = [
  ['DailySheetItem', 'photoKey'],
  ['CrewCashDistribution', 'photoKeys'],
  ['VehicleDailyCheck', 'odometerPhotoKey'],
  ['VehicleDailyCheck', 'damagePhotoKeys'],
  ['FuelLog', 'receiptPhotoKey'],
  ['ConversationMessage', 'audioKey'],
  ['ConversationMessage', 'attachments'],
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

  const plan = planVendorWipe(Prisma.dmmf.datamodel.models as never, {
    rootModels: ROOT_MODELS,
    forceOwnVia: FORCE_OWN_VIA,
  });
  console.log('Tables that will be emptied (for this vendor\'s reset sheets):\n  ' + plan.deleteOrder.join(', ') + '\n');

  // ── counts ──
  const counts: { model: string; rows: number }[] = [];
  for (const s of plan.countSteps) {
    const r = (await prisma.$queryRawUnsafe(s.sql, id)) as { n: number }[];
    if (Number(r[0]?.n) > 0) counts.push({ model: s.model, rows: Number(r[0].n) });
  }
  counts.sort((a, b) => b.rows - a.rows);
  console.table(counts);

  // ── Wasabi keys (collected BEFORE the DB rows disappear) ──
  const keys = new Set<string>();
  for (const [model, col] of FILE_COLUMNS) {
    const scope = plan.scopes[model];
    if (!scope) throw new Error(`File column ${model}.${col}: model is not in the reset scope — fix FILE_COLUMNS`);
    const rows = (await prisma.$queryRawUnsafe(`SELECT to_jsonb(a."${col}")::text AS v FROM "${model}" a WHERE ${scope} AND a."${col}" IS NOT NULL`, id)) as { v: string }[];
    for (const r of rows) collectKeys(JSON.parse(r.v), keys);
  }

  const wasabi = !flag('skip-wasabi');
  let s3: S3Client | undefined;
  const bucket = process.env['WASABI_BUCKET'] ?? '';
  if (wasabi && keys.size > 0) {
    if (!process.env['WASABI_ENDPOINT'] || !bucket) throw new Error('WASABI_* env vars missing (or pass --skip-wasabi)');
    s3 = new S3Client({
      region: process.env['WASABI_REGION'] ?? 'us-east-1', endpoint: process.env['WASABI_ENDPOINT'], forcePathStyle: true,
      credentials: { accessKeyId: process.env['WASABI_ACCESS_KEY_ID'] ?? '', secretAccessKey: process.env['WASABI_SECRET_ACCESS_KEY'] ?? '' },
    });
  }
  console.log(`Wasabi files to delete: ${wasabi ? keys.size : '(skipped)'}  (referenced only by the rows actually being reset — no prefix sweep)`);

  if (!execute) { console.log('\nDRY RUN — nothing was changed. Re-run with --execute --confirm <slug> to apply.'); return prisma.$disconnect(); }

  // ── guards ──
  if (arg('confirm') !== vendor.slug) throw new Error('--confirm must equal the vendor slug');
  if (vendor.isActive) throw new Error('Suspend the vendor first (so nobody writes a sheet while it is being removed).');

  // manifest of what will be deleted from Wasabi (so the list survives)
  const dir = join(process.cwd(), 'tmp'); mkdirSync(dir, { recursive: true });
  const manifest = join(dir, `daily-sheet-reset-wasabi-manifest-${vendor.slug}-${Date.now()}.txt`);
  writeFileSync(manifest, [...keys].join('\n'));
  console.log('Wasabi key manifest:', manifest);

  // ── DB: one transaction ──
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `daily-sheet-reset:${id}`);
    for (const s of plan.nullifySteps) await tx.$executeRawUnsafe(s.sql, id);
    for (const s of plan.deleteSteps) deleted[s.model] = Number(await tx.$executeRawUnsafe(s.sql, id));
  }, { timeout: 15 * 60_000, maxWait: 10_000 });
  console.log('DB reset done. Rows deleted:', Object.values(deleted).reduce((a, b) => a + b, 0));

  // one summary row so the reset itself is traceable
  await prisma.auditLog.create({ data: { vendorId: id, action: 'VENDOR_DAILY_SHEETS_RESET', entity: 'Vendor', entityId: id, changes: { totalFiles: keys.size, tables: deleted } as never } }).catch(() => undefined);

  // ── Wasabi (after the DB commit) ──
  if (wasabi && s3 && keys.size > 0) {
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
  console.log('\nNext: clear Redis cache (restart API / redis scripts) if sheet/dashboard data looks stale, then reactivate the vendor.');
  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR', e.message ?? e); process.exit(1); });
