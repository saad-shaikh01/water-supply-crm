  Application Ko 0 Se Start Karne Ka Complete Flow                                                                                
                                                                                                                                  
  Step 0 — Prerequisites (ek baar karna hai)                                                                                      
                                                                                                                                  
  # Docker services start karo (Postgres + Redis)
  docker-compose up -d

  # Dependencies install
  npm install

  # Prisma client generate karo
  npx prisma generate --schema=libs/shared/database/prisma/schema.prisma

  ---
  Step 1 — Database Setup & Seed (ek baar karna hai)

  # New install (pehli baar) — database banao + migrations chalao
  npx prisma migrate dev \
    --schema=libs/shared/database/prisma/schema.prisma \
    --name init

  # Ab SUPER_ADMIN + demo vendor create karo
  npm run seed

  # Output milega:
  # ✅ SUPER_ADMIN  : admin@watercrm.com / Admin@123456
  # ✅ VENDOR_ADMIN : vendor@demo.com    / Vendor@123456

  Custom credentials chahiye (recommended for production):
  SUPER_ADMIN_EMAIL=myname@company.com \
  SUPER_ADMIN_PASSWORD=MyStrong@Pass123 \
  SKIP_DEMO=true \
  npm run seed

  ---
  Step 2 — SUPER_ADMIN Login karo

  POST /api/auth/login
  {
    "email": "admin@watercrm.com",
    "password": "Admin@123456"
  }

  Response:
  {
    "access_token": "eyJhbGc...",
    "refresh_token": "uuid-...",
    "user": { "role": "SUPER_ADMIN" }
  }

  ---
  Step 3 — SUPER_ADMIN se Vendor Create karo

  POST /api/vendors
  Authorization: Bearer <SUPER_ADMIN_token>
  {
    "name": "Ali Water Supply",
    "slug": "ali-water",
    "address": "Lahore, Pakistan",
    "adminEmail": "ali@aliwater.com",
    "adminPassword": "Ali@Secure123",
    "adminName": "Ali Hassan"
  }

  # Is ek request mein:
  # ✅ Vendor create hoga
  # ✅ VENDOR_ADMIN user create hoga

  ---
  Step 4 — VENDOR_ADMIN Login kare

  POST /api/auth/login
  {
    "email": "ali@aliwater.com",
    "password": "Ali@Secure123"
  }

  Response:
  {
    "access_token": "eyJhbGc...",
    "user": { "role": "VENDOR_ADMIN", "vendorId": "..." }
  }

  ---
  Step 5 — VENDOR_ADMIN Setup kare

  POST /api/products    → "19L Bottle" @ 120rs
  POST /api/routes      → "Route A"
  POST /api/vans        → Plate "LHR-1234"
  POST /api/users       → DRIVER (role: DRIVER)  ← van driver
  POST /api/users       → STAFF (role: STAFF)    ← office staff

  ---
  Step 6 — Customer Create + Portal Account

  # Customer create (VENDOR_ADMIN/STAFF)
  POST /api/customers
  {
    "customerCode": "C001",
    "name": "Ahmed Khan",
    "address": "Model Town, Lahore",
    "phoneNumber": "03001234567",
    "deliveryDays": [1, 4],    ← Monday aur Thursday
    "routeId": "..."
  }

  # Customer ko portal access dena (optional)
  POST /api/customers/:id/portal-account
  {
    "email": "ahmed@gmail.com",
    "password": "Ahmed@123"
  }

  ---
  Step 7 — Customer Login kare (Portal)

  POST /api/auth/login
  {
    "email": "ahmed@gmail.com",
    "password": "Ahmed@123"
  }

  Response:
  {
    "user": { "role": "CUSTOMER", "customerId": "..." }
  }

  # Customer ab in endpoints use kar sakta hai:
  GET /api/portal/me
  GET /api/portal/balance
  GET /api/portal/transactions
  POST /api/portal/payments/manual

  ---
  Summary — Role Hierarchy

  SUPER_ADMIN          ← Seed se banata hai (koi signup nahi)
      ↓ creates
  VENDOR_ADMIN         ← POST /api/vendors se banata hai
      ↓ creates
  STAFF / DRIVER       ← POST /api/users se banata hai
      ↓ creates
  CUSTOMER             ← POST /api/customers/:id/portal-account se

  Koi public signup endpoint nahi hai — ye SaaS model hai jahan platform owner vendors onboard karta hai, aur vendors apne
  customers ko access dete hain.



  🌱  Starting database seed...

⚠️  SUPER_ADMIN already exists: admin@watercrm.com — skipping
✅  Demo Vendor created: "Demo Water Company" (ID: 53bab703-05bf-45a6-a96f-e9e42b532f22)

✅  VENDOR_ADMIN created:
    Email    : vendor@demo.com
    Password : Vendor@123456
    VendorId : 53bab703-05bf-45a6-a96f-e9e42b532f22

✅  Demo Product: "19L Water Bottle" @ PKR 120

✅  Demo Route: "Route A - Central"

═══════════════════════════════════════════════════════
  SEED COMPLETE — Login Credentials
═══════════════════════════════════════════════════════
  SUPER_ADMIN    : admin@watercrm.com
  Password       : Admin@123456
───────────────────────────────────────────────────────
  VENDOR_ADMIN   : vendor@demo.com
  Password       : Vendor@123456
  Vendor         : Demo Water Company
═══════════════════════════════════════════════════════

  POST /api/auth/login
  { "email": "...", "password": "..." }
═══════════════════════════════════════════════════════


The seed command has been executed.
PS C:\Users\Saad shaikh\Desktop\portfolio\water-supply\water-supply-crm> 