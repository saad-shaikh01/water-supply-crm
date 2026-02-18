/**
 * Prisma Seed Script - Water Supply CRM
 *
 * Generates a realistic dataset for a demo vendor.
 *
 * - 1 Vendor ('AquaPure Karachi')
 * - 1 Vendor Admin
 * - 3 Drivers
 * - 3 Vans (linked to drivers)
 * - 3 Routes (DHA, Gulshan, Malir)
 * - 100 Customers with realistic Karachi addresses, assigned to routes.
 * - 1 Product ('19L Water Bottle')
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env['DATABASE_URL'] },
  },
});

const VENDOR_SLUG = 'aquapure-karachi';
const CUSTOMER_COUNT = 100;
const BCRYPT_ROUNDS = 10;

// Helper to generate realistic addresses
const KARACHI_AREAS = {
  DHA: ['Phase 8', 'Phase 7', 'Phase 6', 'Phase 5', 'Phase 2 Ext'],
  GULSHAN: ['Gulshan-e-Iqbal Block 13', 'Gulshan-e-Iqbal Block 10', 'Gulistan-e-Jauhar Block 15', 'FB Area Block 16'],
  MALIR: ['Malir Cantt', 'Model Colony', 'Saadi Town', 'Airport'],
};

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log('🌱 Starting database seed...\n');

  console.log('--- Wiping existing demo data ---');
  // Order of deletion matters to respect foreign key constraints
  const deletedUsers = await prisma.user.deleteMany({
    where: { vendor: { slug: VENDOR_SLUG } },
  });
  console.log(`- Deleted ${deletedUsers.count} users.`);
  const deletedVendor = await prisma.vendor.deleteMany({
    where: { slug: VENDOR_SLUG },
  });
  console.log(`- Deleted ${deletedVendor.count} vendors.\n`);

  console.log('--- Creating Demo Vendor: AquaPure Karachi ---');
  const vendor = await prisma.vendor.create({
    data: {
      name: 'AquaPure Karachi',
      slug: VENDOR_SLUG,
      address: 'Karachi, Pakistan',
      raastId: '03001234567',
    },
  });
  console.log(`✅ Vendor created (ID: ${vendor.id})\n`);

  const vendorAdminPass = await bcrypt.hash('Vendor@123456', BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      email: 'vendor@aquapure.com',
      password: vendorAdminPass,
      name: 'AquaPure Admin',
      role: 'VENDOR_ADMIN',
      vendorId: vendor.id,
    },
  });
  console.log('✅ VENDOR_ADMIN created (vendor@aquapure.com / Vendor@123456)\n');
  
  await prisma.product.create({
    data: {
      name: '19L Mineral Water',
      basePrice: 150,
      vendorId: vendor.id,
    },
  });
  console.log('✅ Default Product created\n');

  console.log('--- Creating Routes ---');
  const routes = await prisma.$transaction(
    ['DHA', 'Gulshan', 'Malir'].map(name => prisma.route.create({ data: { name, vendorId: vendor.id } }))
  );
  console.log(`✅ 3 Routes created\n`);

  console.log('--- Creating Drivers & Vans ---');
  const driversData = [
    { name: 'Kamran Khan', email: 'driver1@aquapure.com' },
    { name: 'Faisal Malik', email: 'driver2@aquapure.com' },
    { name: 'Rizwan Ahmed', email: 'driver3@aquapure.com' },
  ];
  const vansData = [
    { plateNumber: 'KHI-123' },
    { plateNumber: 'SINDH-456' },
    { plateNumber: 'PK-789' },
  ];

  const driverPass = await bcrypt.hash('Driver@123', BCRYPT_ROUNDS);
  for (let i = 0; i < 3; i++) {
    const driver = await prisma.user.create({
      data: {
        ...driversData[i],
        password: driverPass,
        role: 'DRIVER',
        vendorId: vendor.id,
      },
    });

    await prisma.van.create({
      data: {
        ...vansData[i],
        vendorId: vendor.id,
        defaultDriverId: driver.id,
      },
    });
  }
  console.log('✅ 3 Drivers and 3 Vans created and linked\n');

  console.log(`--- Generating ${CUSTOMER_COUNT} Customers ---`);
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const route = getRandomItem(routes);
    const areaKey = route.name.toUpperCase() as keyof typeof KARACHI_AREAS;
    const area = getRandomItem(KARACHI_AREAS[areaKey]);
    
    const customer = await prisma.customer.create({
      data: {
        customerCode: `AQR-${String(i + 1).padStart(4, '0')}`,
        name: faker.person.fullName(),
        phoneNumber: faker.helpers.replaceSymbols('03##-#######'),
        address: `${faker.location.streetAddress(false)}, ${area}`,
        deliveryDays: [1, 3, 5], // Mon, Wed, Fri
        vendorId: vendor.id,
        routeId: route.id,
      },
    });
    
    // Create default wallet
    const product = await prisma.product.findFirst({ where: { vendorId: vendor.id }});
    if (product) {
        await prisma.bottleWallet.create({
            data: {
                customerId: customer.id,
                productId: product.id,
                balance: 0,
            }
        });
    }
  }
  console.log(`✅ ${CUSTOMER_COUNT} customers created with Karachi addresses.\n`);

  console.log('═══════════════════════════════════════════════════════');
  console.log('  SEED COMPLETE — Login with AquaPure Karachi');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  VENDOR_ADMIN : vendor@aquapure.com`);
  console.log(`  Password     : Vendor@123456`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  DRIVER (ANY) : driver1@aquapure.com`);
  console.log(`  Password     : Driver@123`);
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
