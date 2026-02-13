/**
 * Prisma Seed Script - Water Supply CRM
 *
 * Creates the initial SUPER_ADMIN user and optionally a demo vendor.
 *
 * Run:
 *   npx ts-node --project libs/shared/database/tsconfig.lib.json libs/shared/database/prisma/seed.ts
 *
 * Or after adding "prisma.seed" to root package.json:
 *   npx prisma db seed --schema=libs/shared/database/prisma/schema.prisma
 */

import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env[`DATABASE_URL`] },
  },
});

async function main() {
  console.log('🌱  Starting database seed...\n');

  // ── 1. Create SUPER_ADMIN ─────────────────────────────────────────────────
  const superAdminEmail = process.env[`SUPER_ADMIN_EMAIL`] || 'admin@watercrm.com';
  const superAdminPassword = process.env[`SUPER_ADMIN_PASSWORD`] || 'Admin@123456';
  const superAdminName = process.env[`SUPER_ADMIN_NAME`] || 'Platform Admin';

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { email: superAdminEmail },
  });

  if (existingSuperAdmin) {
    console.log(`⚠️  SUPER_ADMIN already exists: ${superAdminEmail} — skipping`);
  } else {
    const hashedPassword = await bcrypt.hash(superAdminPassword, 10);
    const superAdmin = await prisma.user.create({
      data: {
        email: superAdminEmail,
        password: hashedPassword,
        name: superAdminName,
        role: UserRole.SUPER_ADMIN,
        vendorId: null,
      },
    });
    console.log(`✅  SUPER_ADMIN created:`);
    console.log(`    Email    : ${superAdmin.email}`);
    console.log(`    Password : ${superAdminPassword}`);
    console.log(`    ID       : ${superAdmin.id}\n`);
  }

  // ── 2. Create Demo Vendor (optional, can skip with SKIP_DEMO=true) ────────
  if (process.env[`SKIP_DEMO`] === 'true') {
    console.log('ℹ️  SKIP_DEMO=true — skipping demo vendor creation');
    return;
  }

  const demoSlug = 'demo-water-co';
  const existingVendor = await prisma.vendor.findUnique({
    where: { slug: demoSlug },
  });

  if (existingVendor) {
    console.log(`⚠️  Demo vendor already exists (slug: ${demoSlug}) — skipping\n`);
    return;
  }

  // Create demo vendor
  const vendor = await prisma.vendor.create({
    data: {
      name: 'Demo Water Company',
      slug: demoSlug,
      address: 'Karachi, Pakistan',
    },
  });
  console.log(`✅  Demo Vendor created: "${vendor.name}" (ID: ${vendor.id})\n`);

  // Create VENDOR_ADMIN for demo vendor
  const vendorAdminEmail = 'vendor@demo.com';
  const vendorAdminPassword = 'Vendor@123456';

  const hashedVendorPassword = await bcrypt.hash(vendorAdminPassword, 10);
  const vendorAdmin = await prisma.user.create({
    data: {
      email: vendorAdminEmail,
      password: hashedVendorPassword,
      name: 'Demo Vendor Admin',
      role: UserRole.VENDOR_ADMIN,
      vendorId: vendor.id,
    },
  });
  console.log(`✅  VENDOR_ADMIN created:`);
  console.log(`    Email    : ${vendorAdmin.email}`);
  console.log(`    Password : ${vendorAdminPassword}`);
  console.log(`    VendorId : ${vendor.id}\n`);

  // Create a demo product
  const product = await prisma.product.create({
    data: {
      name: '19L Water Bottle',
      description: 'Standard 19-litre refillable water bottle',
      basePrice: 120,
      vendorId: vendor.id,
    },
  });
  console.log(`✅  Demo Product: "${product.name}" @ PKR ${product.basePrice}\n`);

  // Create a demo route
  const route = await prisma.route.create({
    data: {
      name: 'Route A - Central',
      vendorId: vendor.id,
    },
  });
  console.log(`✅  Demo Route: "${route.name}"\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SEED COMPLETE — Login Credentials');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  SUPER_ADMIN    : ${superAdminEmail}`);
  console.log(`  Password       : ${superAdminPassword}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  VENDOR_ADMIN   : ${vendorAdminEmail}`);
  console.log(`  Password       : ${vendorAdminPassword}`);
  console.log(`  Vendor         : Demo Water Company`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('  POST /api/auth/login');
  console.log('  { "email": "...", "password": "..." }');
  console.log('═══════════════════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
