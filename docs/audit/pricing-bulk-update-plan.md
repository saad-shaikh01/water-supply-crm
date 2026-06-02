# Pricing Bulk Update Tool — Implementation Plan

## Background & Problem Statement

Current system mein har customer ka price individually `CustomerProductPrice` table mein store hota hai. Jab vendor hazaro customers ki pricing update karna chahta hai (e.g., sabki 19L price 120 se 130 karna), to unhe har customer ka page open karke manually update karna padta hai — jo completely impractical hai at scale.

**Root cause:** Koi bulk pricing management tool nahi hai. Prices isolated hain, group ya filter se update karne ka koi mechanism nahi.

---

## Real Business Scenarios (Confirmed with Client)

### Scenario 1 — Same price wale sab customers update karo
> "Jo sab customers abhi 120 pe hain, unhe 130 karo"

Filter: current price = 120  
Action: set exact price = 130  
Impact: hundreds of customers, ek click

### Scenario 2 — Area-wise price increase
> "Johar area ke sab customers ki price 10 rupay barha do"

Filter: area = Johar  
Action: flat increase = +10  
Impact: area ke tamam customers

### Scenario 3 — Van/Route-wise update
> "V1 van ke monthly customers ki price update karni hai"

Filter: van = V1, billing type = Monthly  
Action: set new price ya percentage increase  
Impact: specific route ke customers

### Scenario 4 — Range-based increase
> "Jo customers 100 se 130 ke beech mein hain, unhe sab ek standard price pe lao"

Filter: current price between 100–130  
Action: set exact price = 130  
Impact: pricing standardization

### Scenario 5 — Percentage increase across board
> "Sab customers ki price 8% increase karo"

Filter: none (all customers)  
Action: percentage increase = +8%  
Impact: global price revision

---

## Proposed Solution: Filter-Based Bulk Price Update

### Core Concept

Ek dedicated **Pricing Management** page jahan vendor:
1. Product select kare
2. Customers filter kare (price range, area, van, billing type — any combination)
3. Matching customers ka preview dekhe (count + list)
4. Action choose kare (exact / flat / percentage)
5. Ek click mein sab update ho jaaye

### Why NOT Price Groups/Tiers

Client ke paas hazaron customers hain with **many unique price points** — groups banana impractical hai kyunki:
- Itne groups banana overhead hai
- Har naye negotiated price ke liye naya group banana padega
- Current individual price model already flexible hai — sirf management tool missing hai

---

## UI Design (Vendor Dashboard)

### Page: `/dashboard/pricing`

```
┌─────────────────────────────────────────────────────┐
│  Bulk Price Update                                   │
├─────────────────────────────────────────────────────┤
│  Product:        [19L Mineral Water ▼]               │
│                                                      │
│  ── Filters ──────────────────────────────────────  │
│  Current Price:  From [___] To [___]                 │
│  Area:           [All Areas ▼]                       │
│  Van/Route:      [All Vans ▼]                        │
│  Billing Type:   [All ▼]                             │
│                                                      │
│  [Apply Filters]                                     │
├─────────────────────────────────────────────────────┤
│  Preview: 247 customers match                        │
│                                                      │
│  Name          Area      Current Price               │
│  ──────────    ──────    ─────────────               │
│  Ahmed Ali     Johar     ₨120                        │
│  Sara Khan     Johar     ₨120                        │
│  ...                                                 │
├─────────────────────────────────────────────────────┤
│  ── Action ───────────────────────────────────────  │
│  ○ Set exact price:       ₨ [___]                    │
│  ○ Flat increase:         + ₨ [___]                  │
│  ○ Percentage increase:   + [___] %                  │
│                                                      │
│  New price preview: ₨120 → ₨130 (for 247 customers) │
│                                                      │
│  [Update 247 Customers]                              │
└─────────────────────────────────────────────────────┘
```

### Sidebar Entry
- Section: Operations (existing)
- Icon: `Tag` (lucide-react)
- Label: "Pricing"
- Route: `/dashboard/pricing`

---

## Backend API Design

### Endpoint 1 — Preview (Dry Run)
```
POST /customers/pricing/preview

Body:
{
  productId: string,
  filters: {
    priceFrom?: number,
    priceTo?: number,
    area?: string,
    vanId?: string,
    billingType?: 'MONTHLY' | 'CASH'
  }
}

Response:
{
  count: number,
  customers: [{ id, name, area, currentPrice }]
}
```

### Endpoint 2 — Apply Bulk Update
```
POST /customers/pricing/bulk-update

Body:
{
  productId: string,
  filters: {
    priceFrom?: number,
    priceTo?: number,
    area?: string,
    vanId?: string,
    billingType?: 'MONTHLY' | 'CASH'
  },
  action: {
    type: 'SET' | 'FLAT_INCREASE' | 'PERCENTAGE_INCREASE',
    value: number
  }
}

Response:
{
  updatedCount: number,
  message: string
}
```

### Business Logic
```
Filter customers based on:
  1. vendorId (multi-tenant isolation)
  2. isActive = true
  3. customPrice for productId falls in priceFrom–priceTo range
     OR no customPrice set and basePrice falls in range (if price filters applied)
  4. customer.area matches (if area filter)
  5. deliverySchedule van matches (if vanId filter)
  6. customer.billingType matches (if billingType filter)

For each matched customer:
  - type = SET        → upsert CustomerProductPrice with value
  - type = FLAT       → currentPrice + value
  - type = PERCENTAGE → currentPrice * (1 + value/100), rounded to nearest integer
```

---

## Known Bug: Historical Daily Sheet Prices Incorrect

### Bug Description

`DailySheetItem` mein `pricePerBottle` field store nahi hoti. Daily sheet reconciliation report mein price **dynamically** current `CustomerProductPrice` se recalculate hoti hai:

```typescript
// apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts — line 510
const getPrice = (item: any): number => {
  const custom = item.customer?.customPrices?.find(
    (cp: any) => cp.productId === item.productId,
  );
  return custom?.customPrice ?? item.product?.basePrice ?? 0;
};
```

**Consequence:** Agar January mein delivery ₨150 pe hui aur aaj price ₨160 kardi, to January ka purana daily sheet kholo to ₨160 dikhega — **galat historical data**.

### What Is Safe

| Data | Status |
|------|--------|
| `Transaction.amount` | Safe — delivery ke waqt calculate hokar store hota hai |
| Customer financial balance | Safe — transactions se derive hota hai |
| Outstanding balance, payment history | Safe |
| Daily sheet reconciliation report amounts | **Bug — current price se recalculate hota hai** |

### Fix Required

**Step 1 — Schema:** `DailySheetItem` mein `pricePerBottle` field add karo:

```prisma
model DailySheetItem {
  ...
  pricePerBottle Float @default(0)   // ← ADD THIS
  ...
}
```

**Step 2 — Delivery submission:** Price store karo jab delivery complete ho:

```typescript
// daily-sheet.service.ts — submitSheet() mein
await prisma.dailySheetItem.update({
  where: { id: item.id },
  data: {
    ...existingFields,
    pricePerBottle: price,   // ← store at time of delivery
  }
});
```

**Step 3 — Report:** `getPrice()` ko stored value use karwao:

```typescript
const getPrice = (item: any): number => {
  if (item.pricePerBottle > 0) return item.pricePerBottle; // use stored
  // fallback for old data before this fix
  const custom = item.customer?.customPrices?.find(
    (cp: any) => cp.productId === item.productId,
  );
  return custom?.customPrice ?? item.product?.basePrice ?? 0;
};
```

### Files To Modify For Bug Fix

| File | Change |
|------|--------|
| `schema.prisma` | `pricePerBottle Float @default(0)` add to `DailySheetItem` |
| `daily-sheet.service.ts` line ~123 | `pricePerBottle: price` already passed — confirm it's saved |
| `daily-sheet.service.ts` line ~510 | `getPrice()` — use stored `item.pricePerBottle` first |
| New migration file | `npx prisma migrate dev` |

---

## Database Changes

**Schema change required for bug fix only.** Bulk update tool ke liye koi schema change nahi — existing `CustomerProductPrice` table ka use hoga.

---

## Files To Create/Modify

### Backend
| File | Change |
|------|--------|
| `customer.controller.ts` | 2 new endpoints: `/pricing/preview`, `/pricing/bulk-update` |
| `customer.service.ts` | `previewBulkPricing()` + `bulkUpdatePricing()` methods |
| `dto/bulk-price-update.dto.ts` | New DTO file |

### Frontend (vendor-dashboard)
| File | Change |
|------|--------|
| `src/features/pricing/` | New feature folder |
| `src/features/pricing/pages/pricing-page.tsx` | Main page |
| `src/features/pricing/hooks/use-pricing.ts` | React Query hooks |
| `src/features/pricing/api/pricing.api.ts` | API calls |
| `src/app/dashboard/pricing/page.tsx` | Next.js route |
| `src/components/layout/sidebar.tsx` | Add Pricing nav item |

---

## Confirmation Before Updates Warning

Bulk update destructive action hai — ek baar update hone ke baad manually reverse karna mushkil hai. UI mein yeh safeguards honi chahiye:

1. Preview step mandatory — directly update nahi hona chahiye
2. Confirmation dialog: "247 customers ki price update hogi. Kya aap sure hain?"
3. Update ke baad success toast mein count dikhana: "247 customers updated successfully"

---

## Future Enhancements (Out of Scope for Now)

- Price update history / audit log (kon sa user ne kab kya change kiya)
- Scheduled price updates (e.g., 1st of every month automatically increase by X)
- CSV export of current pricing for review before bulk update
- Undo last bulk update (within 1 hour window)

---

## Status

- [x] Problem identified and discussed with client
- [x] Solution approach locked (filter-based bulk update)
- [x] Real scenarios documented
- [x] Historical price bug identified and fix designed
- [ ] Bug fix implementation pending (pricePerBottle schema + migration)
- [ ] Bulk update tool implementation pending
