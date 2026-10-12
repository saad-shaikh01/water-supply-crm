/**
 * Manual end-to-end check of the super-admin vendor wipe against a REAL, THROWAWAY Postgres
 * (guards, password, preview token, the wipe transaction, re-provisioning, audit, other vendors untouched).
 *
 *   docker run --name wipe-test-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=wipetest -p 55432:5432 -d postgres:15-alpine
 *   U=postgresql://postgres:pw@127.0.0.1:55432/wipetest?schema=public
 *   DATABASE_URL="$U" DIRECT_DATABASE_URL="$U" npx prisma migrate deploy --schema=libs/shared/database/prisma/schema.prisma
 *   DATABASE_URL="$U" DIRECT_DATABASE_URL="$U" TS_NODE_TRANSPILE_ONLY=true \
 *     TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","experimentalDecorators":true,"emitDecoratorMetadata":true}' \
 *     node -r ./scripts/register-ts-paths.cjs scripts/vendor-wipe-check.ts
 *
 * ALWAYS set BOTH DATABASE_URL and DIRECT_DATABASE_URL: "prisma migrate" otherwise uses DIRECT_DATABASE_URL from .env,
 * which is your local dev database.
 * Refuses to run unless the database name ends with "test".
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { VendorWipeService } from '../apps/api-backend/src/app/modules/vendor/vendor-wipe.service';
import { VendorProvisioningService } from '../apps/api-backend/src/app/modules/vendor/vendor-provisioning.service';
import { AuditService } from '../apps/api-backend/src/app/modules/audit/audit.service';

const dbName = (process.env['DATABASE_URL'] ?? '').split('?')[0].split('/').pop() ?? '';
if (!/test$/i.test(dbName)) {
  console.error('Refusing to run: DATABASE_URL must point at a throwaway database whose name ends with "test" (got "' + dbName + '").');
  process.exit(3);
}

const prisma = new PrismaClient();
const cache = { invalidateVendorEntity: async () => undefined, invalidateOverview: async () => undefined, invalidateAnalytics: async () => undefined, invalidateDailyDashboard: async () => undefined };
const audit = new AuditService(prisma as never);
const provisioning = new VendorProvisioningService(prisma as never, { invalidateUsers: async () => undefined } as never, audit);
const svc = new VendorWipeService(prisma as never, provisioning, audit, cache as never);

async function main() {
  process.env['VENDOR_WIPE_ENABLED'] = 'true';
  const su = await prisma.user.create({ data: { name: 'root', role: 'SUPER_ADMIN', email: `su-${Date.now()}@x.test`, password: await bcrypt.hash('Correct#1', 4) } });
  const actor = { userId: su.id, name: 'root' } as never;

  const vendor = await prisma.vendor.create({ data: { name: 'Acme', slug: `acme-${Date.now()}`, isActive: true, goLiveAt: new Date() } });
  const id = vendor.id;
  await provisioning.repair(id); // roles + flag categories like a real new vendor
  const admin = await prisma.user.create({ data: { name: 'adm', role: 'VENDOR_ADMIN', vendorId: id, email: `a-${Date.now()}@x.test` } });
  const drv = await prisma.user.create({ data: { name: 'drv', role: 'DRIVER', vendorId: id, email: `d-${Date.now()}@x.test` } });
  const product = await prisma.product.create({ data: { name: 'P', basePrice: 1, vendorId: id } });
  const van = await prisma.van.create({ data: { vendorId: id, plateNumber: `V-${Date.now()}`, defaultDriverId: drv.id } });
  const cust = await prisma.customer.create({ data: { customerCode: 'C1', name: 'n', phoneNumber: '-', address: 'a', vendorId: id } });
  await prisma.customerDeliverySchedule.create({ data: { customerId: cust.id, vanId: van.id, dayOfWeek: 2 } });
  await prisma.bottleWallet.create({ data: { customerId: cust.id, productId: product.id, balance: 1 } });
  await prisma.auditLog.create({ data: { vendorId: id, action: 'OLD', entity: 'X' } });
  const other = await prisma.vendor.create({ data: { name: 'Other', slug: `other-${Date.now()}` } });
  await prisma.customer.create({ data: { customerCode: 'C1', name: 'o', phoneNumber: '-', address: 'a', vendorId: other.id } });

  const expectErr = async (label: string, fn: () => Promise<unknown>, re: RegExp) => {
    try { await fn(); console.log('FAIL (no error):', label); process.exitCode = 1; }
    catch (e) { const ok = re.test((e as Error).message); console.log(ok ? 'ok  ' : 'FAIL', label, '->', (e as Error).message.slice(0, 80)); if (!ok) process.exitCode = 1; }
  };

  const pv0 = await svc.preview(id);
  console.log('preview: allowed=%s blockers=%s total=%d', pv0.allowed, pv0.blockers.map((b) => b.code).join(','), pv0.totalRows);
  await expectErr('active vendor refused', () => svc.wipe(actor, id, { confirmSlug: vendor.slug, password: 'Correct#1', acknowledgeBackup: true, previewToken: pv0.previewToken } as never), /Suspend/);

  await prisma.vendor.update({ where: { id }, data: { isActive: false } });
  const pv = await svc.preview(id);
  console.log('after suspend: allowed=%s', pv.allowed);
  await expectErr('wrong slug', () => svc.wipe(actor, id, { confirmSlug: 'nope', password: 'Correct#1', acknowledgeBackup: true, previewToken: pv.previewToken } as never), /slug/);
  await expectErr('wrong password', () => svc.wipe(actor, id, { confirmSlug: vendor.slug, password: 'bad', acknowledgeBackup: true, previewToken: pv.previewToken } as never), /password/i);
  await expectErr('stale token', () => svc.wipe(actor, id, { confirmSlug: vendor.slug, password: 'Correct#1', acknowledgeBackup: true, previewToken: 'x' } as never), /changed since/);
  console.log('still intact after refusals:', await prisma.customer.count({ where: { vendorId: id } }) === 1);

  const res = await svc.wipe(actor, id, { confirmSlug: vendor.slug, password: 'Correct#1', acknowledgeBackup: true, previewToken: pv.previewToken } as never);
  console.log('wiped:', res.totalRows, 'rows;', res.tables.slice(0, 4).map((t) => `${t.model}=${t.rows}`).join(', '));

  const after = {
    vendorExists: !!(await prisma.vendor.findUnique({ where: { id } })),
    goLiveAt: (await prisma.vendor.findUnique({ where: { id } }))?.goLiveAt,
    isActive: (await prisma.vendor.findUnique({ where: { id } }))?.isActive,
    customers: await prisma.customer.count({ where: { vendorId: id } }),
    vans: await prisma.van.count({ where: { vendorId: id } }),
    users: (await prisma.user.findMany({ where: { vendorId: id }, select: { role: true } })).map((u) => u.role),
    roles: await prisma.role.count({ where: { vendorId: id } }),
    flagCats: await prisma.customerFlagCategory.count({ where: { vendorId: id } }),
    oldAudit: await prisma.auditLog.count({ where: { vendorId: id } }),
    wipeAudit: await prisma.auditLog.count({ where: { action: 'WIPE_VENDOR_DATA', entityId: id, vendorId: null } }),
    otherCustomers: await prisma.customer.count({ where: { vendorId: other.id } }),
    superAdminStill: !!(await prisma.user.findUnique({ where: { id: su.id } })),
    adminStill: !!(await prisma.user.findUnique({ where: { id: admin.id } })),
  };
  console.log(after);
  const ok = after.vendorExists && after.goLiveAt === null && after.isActive === false && after.customers === 0 && after.vans === 0
    && after.users.length === 1 && after.users[0] === 'VENDOR_ADMIN' && after.roles > 0 && after.flagCats > 0 && after.oldAudit === 0
    && after.wipeAudit === 1 && after.otherCustomers === 1 && after.superAdminStill && after.adminStill;
  console.log(ok && !process.exitCode ? 'RESULT: PASS' : 'RESULT: FAIL');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error('ERROR', e); await prisma.$disconnect(); process.exit(2); });
