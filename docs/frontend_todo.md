# Frontend Implementation TODO List

## Phase 1: Advanced Data Management (Next Steps)
- [ ] **Customer Management Feature:**
    - [ ] List view with server-side pagination (nuqs).
    - [ ] Filters: Search by Name/Code, Filter by Route, Filter by Delivery Day.
    - [ ] Create/Edit Customer Drawer (shadcn Sheet).
    - [ ] Customer Detail View: Showing Bottle Wallet and Transaction History.
- [ ] **Route Management Feature:**
    - [ ] List routes and customer density.
    - [ ] Drag-and-drop sequencing for route optimization (Future).
- [ ] **Product Enhancements:**
    - [ ] Edit Product pricing.
    - [ ] Toggle product status (Active/Inactive).

## Phase 2: The Core Logistics UI
- [ ] **Daily Sheet Generation UI:**
    - [ ] Date picker with "Pending Routes" indicator.
    - [ ] Bulk generation button with loading progress.
- [ ] **Driver Assignment:**
    - [ ] Ability to swap drivers/vans for a specific day.
- [ ] **Daily Sheet Detail:**
    - [ ] Driver's view of the sequence.
    - [ ] "Submit Delivery" modal with Bottle Wallet input (Filled/Empty/Cash).
    - [ ] End-of-day reconciliation view for staff.

## Phase 3: Monitoring & Real-time
- [ ] **Live Tracking Map:**
    - [ ] Integration with Leaflet or Google Maps.
    - [ ] Real-time van markers (via WebSockets or polling).
- [ ] **WhatsApp Notification Center:**
    - [ ] Templates for delivery receipts.
    - [ ] Manual "Resend" option for notifications.

## Phase 4: Customer Portal
- [ ] **Customer Dashboard:**
    - [ ] Current Bottle Balance view.
    - [ ] Outstanding Balance payment widget.
    - [ ] Delivery Calendar.
- [ ] **On-Demand Requests:**
    - [ ] Simple form to request extra bottles.
- [ ] **Support Ticket System:**
    - [ ] Simple UI to report bottle discrepancies.

## Phase 5: Polish & Performance
- [ ] **Global Error Handling:** Toast notifications for API failures.
- [ ] **Skeleton Loaders:** Adding shadcn skeletons for all list views.
- [ ] **PWA Support:** Making the Driver portal installable on mobile.
- [ ] **Dark Mode Support:** Using next-themes.
