# Project Current Status - Water Supply CRM

**Last Updated:** February 11, 2026
**Status:** Core Backend Engine & Infrastructure Complete

---

## 1. Technical Stack Used
-   **Monorepo Management:** [Nx](https://nx.dev/)
-   **Backend Framework:** [NestJS](https://nestjs.com/) (Node.js)
-   **Database ORM:** [Prisma](https://www.prisma.io/)
-   **Database:** [PostgreSQL](https://www.postgresql.org/) (Running via Docker)
-   **Authentication:** JWT (JSON Web Tokens) with Passport.js
-   **Security:** Bcrypt for password hashing
-   **Infrastructure:** Docker Compose (Postgres, Redis, RabbitMQ, pgAdmin)

---

## 2. Implemented Modules & Business Logic

### A. Identity & Access Management (IAM)
-   **Multi-Tenancy:** Every record is linked to a `Vendor` via `vendorId`.
-   **Role-Based Access Control (RBAC):** Supports `SUPER_ADMIN`, `VENDOR_ADMIN`, `STAFF`, `DRIVER`, and `CUSTOMER`.
-   **Atomic Vendor Creation:** When a Vendor is created, its primary Admin user is created automatically within a single database transaction.

### B. Logistics Engine
-   **Product Management:** Vendors can define multiple products (e.g., 19L Bottles, 5L Bottles) with base prices.
-   **Route Management:** Support for fixed delivery routes.
-   **Customer Management:**
    -   Assignment to routes.
    -   Custom delivery schedules (e.g., Monday & Thursday).
    -   Automatic "Bottle Wallet" initialization for every product.
-   **Van Management:** Tracking fleet and assigning default drivers to vans.

### C. Daily Sheet Engine
-   **Bulk Generation:** Logic to generate sheets for all routes based on the current day of the week.
-   **Scheduling:** Filters customers automatically based on their assigned delivery days.
-   **Sequence Tracking:** Every delivery item has a sequence number for the driver.

### D. Transaction Ledger (The Backbone)
-   **Immutable Records:** Every bottle movement and cash payment is stored as a permanent transaction.
-   **Wallet Logic:** Real-time updates to customer bottle balances (`BottleWallet`).
-   **Financial Logic:** Automatic calculation of outstanding customer balances based on deliveries and payments.

---

## 3. API Endpoints Reference

### Authentication
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/auth/login` | Login with email/password and receive JWT |

### Vendors (Platform Level)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/vendors` | Create a new Vendor and its Admin User |
| GET | `/vendors` | List all vendors |
| GET | `/vendors/:id` | Get vendor details |

### Products
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/products` | Create a new product (Vendor context) |
| GET | `/products` | List all active products |
| GET | `/products/:id` | Get product details |

### Routes
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/routes` | Create a new delivery route |
| GET | `/routes` | List all routes with customer counts |

### Customers
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/customers` | Create a customer & initialize wallets |
| GET | `/customers` | List all customers with wallet balances |

### Vans
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/vans` | Register a new van and assign a driver |
| GET | `/vans` | List all vans |

### Daily Sheets
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/daily-sheets/generate` | Generate sheets for a specific date |
| GET | `/daily-sheets` | List all generated sheets |
| GET | `/daily-sheets/:id` | Get full sheet with all delivery items |
| PATCH | `/daily-sheets/items/:id` | **Submit Delivery:** Records exchange & updates Ledger |

---

## 4. Current Database Schema (Summary)
-   `Vendor`: Multi-tenant organizations.
-   `User`: Staff, Drivers, Admins.
-   `Product`: Water bottle types and pricing.
-   `Customer`: Profiles, routes, and financial balances.
-   `BottleWallet`: Per-product bottle counts at customer locations.
-   `DailySheet`: Master record for a van/driver's day.
-   `DailySheetItem`: Individual delivery stops.
-   `Transaction`: Immutable ledger of all movements.

---

## 5. Next Steps
1.  **Driver Portal UI:** Frontend for drivers to use on the road.
2.  **Live Tracking Service:** Real-time GPS updates from drivers.
3.  **WhatsApp Service:** Automated delivery receipts.
4.  **Admin Dashboard:** Visualizing sheets and reconciliation reports.
