# Water Supply CRM - Project Overview

## 1. Project Vision
A SaaS-based Water Supply CRM designed for multi-tenant organizations (Vendors). The platform manages the end-to-end lifecycle of water bottle delivery, from warehouse inventory to customer "Bottle Wallets," featuring real-time driver tracking and automated customer communication.

## 2. User Roles & Access
*   **Platform Owner (Super Admin):** Manages Vendor subscriptions, monitors platform health, and global usage metrics.
*   **Vendor (Organization Owner):** Manages their specific business, warehouses, staff, and customer base.
*   **Vendor Staff (Admin/Inventory Manager):** Generates daily sheets, manages inventory, reconciles cash/bottles at day-end, and handles dynamic dispatch.
*   **Delivery Driver:** Uses a mobile portal to follow delivery sequences, record bottle exchanges, collect payments, and provide live location data.
*   **End Customer:** Uses a portal to view bottle/financial balance, delivery history, place on-demand orders, and raise support tickets.

## 3. Core Concepts
### The "Bottle Wallet"
Every customer has a digital wallet tracking the physical 19L bottles currently at their location.
*   **Empty Received:** Increases warehouse inventory / decreases customer possession.
*   **Filled Dropped:** Decreases warehouse inventory / increases customer possession.
*   **Balance:** The system maintains a real-time count of bottles to ensure asset tracking and consumption analysis.

### The "Daily Sheet" Engine
The heartbeat of the operation. It is a master record for a specific Van, Driver, and Date.
*   **Fixed Routes:** Customers are assigned to default routes and schedules (e.g., Mon/Thu).
*   **Bulk Generation:** Staff generates sheets for all active routes in one click.
*   **Sequence:** Deliveries are ordered by Customer Code or Map Proximity.
*   **Load-Out/Check-In:** Tracks bottles leaving the warehouse in the morning and returning (full/empty/cash) in the evening.

### Transaction-Based Architecture
Every single action (delivery, payment, inventory movement) is recorded as an immutable transaction. This ensures a perfect audit trail for financial and inventory reconciliation.

## 4. User Journeys

### A. The Vendor Staff Journey (Morning & Evening)
1.  **Morning:** Generate "Daily Sheets" based on the day's schedule.
2.  **Load-Out:** Record the total number of filled bottles loaded into each Van.
3.  **Real-Time:** Monitor the live map of drivers and "Push" any new on-demand customer requests to the nearest driver's live sheet.
4.  **Evening:** Reconcile the driver's return: Compare "Bottles Out" vs. ("Bottles Delivered" + "Bottles Returned"). Verify cash collected against the system's "Expected Cash" report.
5.  **Exception Handling:** Review "Skipped" or "Rescheduled" deliveries and move them to future sheets in bulk.

### B. The Delivery Driver Journey
1.  **Start Shift:** Log in to the portal and see the assigned Daily Sheet and sequence.
2.  **On-Route:** Navigate to the first customer.
3.  **Delivery Action:** 
    *   Input number of empty bottles received.
    *   Input number of filled bottles dropped.
    *   System calculates the new "Bottle Wallet" balance immediately.
4.  **Payment:** Record cash collected or mark as "Added to Account Balance."
5.  **WhatsApp:** Upon clicking "Complete," the system automatically sends a WhatsApp receipt to the customer with their current balance.
6.  **Exceptions:** If a customer is unavailable, mark as "Not Available" or "Rescheduled" with a reason.

### C. The End Customer Journey
1.  **Monitoring:** Log in to see how many bottles are currently at their home and their current outstanding financial balance.
2.  **History:** View a transparent log of every delivery made and payment recorded.
3.  **On-Demand:** If they run out of water before their scheduled day, place a "Special Request" order.
4.  **Communication:** Receive automated WhatsApp notifications for every transaction.

## 5. Key Features
*   **Live Driver Tracking:** Real-time map view with "Last Seen" status.
*   **Multi-Tenancy:** Data isolation for every Vendor organization.
*   **Automated Dispatch:** Logic to push on-demand orders into active routes.
*   **Scalable Inventory:** Designed to support multiple warehouses per vendor in the future.
*   **Financial Integrity:** Tracking of outstanding balances and cash-on-delivery reconciliation.
