Code Quality Review Report
Scope: API Backend (NestJS) + Vendor Dashboard (Next.js/React)
Last Updated: 2026-05-20 — Implementation session done

Overall Verdict
App	TypeScript Quality	React/NestJS Patterns	Error Handling	Code Organization	Score
API Backend	⚠️ Fair	✅ Good	⚠️ Fair	⚠️ Fair	6/10
Vendor Dashboard	❌ Poor	⚠️ Fair	⚠️ Fair	❌ Poor	5/10
BACKEND CODE QUALITY
TypeScript — Problems
✅ B1 — any Types Spread Across Core Services

Ye sabse bada issue hai. Type safety naam ki koi cheez nahi kuch jagah:


// apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts
private buildReconciliation(sheet: any) { ... }  // Line 478 — main method untyped

// apps/api-backend/src/app/modules/customer/customer.service.ts
private async generateCustomerCode(vendorId: string, tx: any)  // Prisma tx untyped

// apps/api-backend/src/app/modules/analytics/analytics.service.ts
const cached = await this.cache.get<any>(cacheKey);  // Cache result untyped
Fix — Prisma transaction type:


import { Prisma } from '@prisma/client';
// tx ki proper type:
tx: Prisma.TransactionClient
✅ B2 — @CurrentUser() Decorator Returns any Everywhere

File: apps/api-backend/src/app/modules/customer/customer.controller.ts

// Har controller mein yahi problem hai:
create(@CurrentUser() user: any, ...)
update(@CurrentUser() user: any, ...)
Fix — Ek shared interface banao:


// libs/shared/types/src/lib/types.ts
export interface AuthUser {
  userId: string;
  vendorId: string;
  role: UserRole;
  email: string;
}
// Phir har jagah: @CurrentUser() user: AuthUser
✅ B3 — Magic Strings — Prisma Enums Use Nahi Kar Rahe

File: apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts

// ❌ Multiple jagah string literals
if (resolvedStatus !== 'PENDING') { ... }
const completedStatuses = new Set(['COMPLETED', 'EMPTY_ONLY']);
const missedStatuses = new Set(['CANCELLED', 'NOT_AVAILABLE']);
items.filter((i) => i.status === 'COMPLETED' || i.status === 'EMPTY_ONLY')

// ✅ Hona chahiye
import { DeliveryStatus } from '@prisma/client';
if (resolvedStatus !== DeliveryStatus.PENDING) { ... }
const completedStatuses = new Set([DeliveryStatus.COMPLETED, DeliveryStatus.EMPTY_ONLY]);
NestJS Patterns — Problems
✅ B4 — Fire-and-Forget FCM/WhatsApp — Errors Silently Swallowed

Files: apps/api-backend/src/app/modules/order/order.service.ts, apps/api-backend/src/app/modules/daily-sheet/daily-sheet.service.ts

// ❌ Current — error completely invisible
this.fcm.sendToVendorUsers(...).catch(() => null);
this.fcm.sendToCustomer(...).catch(() => null);

// ✅ Fix — log karo kam se kam
this.fcm.sendToVendorUsers(...).catch((e) =>
  this.logger.warn(`FCM send failed for vendor ${vendorId}: ${e.message}`)
);
✅ B5 — ledger.service.ts — Idempotency Method 70+ Lines, Should Be Extracted

File: apps/api-backend/src/app/modules/transaction/ledger.service.ts

// ❌ Lines 39-114: Ek condition mein 70+ lines
if (data.dailySheetItemId) {
  const existingDelivery = await tx.transaction.findFirst({...});
  if (existingDelivery) {
    // ... 60+ lines of re-post logic
  }
}

// ✅ Extract karo:
private async applyIdempotentRepost(tx, data): Promise<void> { ... }
✅ B6 — analytics.service.ts — Map Pattern Repeated 4 Times

File: apps/api-backend/src/app/modules/analytics/analytics.service.ts

// ❌ Ye exact same pattern 4 baar repeat hota hai:
const routeRevMap = new Map<string, { routeId: string; routeName: string; revenue: number }>();
for (const sheet of sheets) {
  const key = sheet.routeId;
  const entry = routeRevMap.get(key) ?? { routeId: ..., routeName: ..., revenue: 0 };
  entry.revenue += ...;
  routeRevMap.set(key, entry);
}

// ✅ Generic helper:
function groupAndSum<T extends { id: string; name: string }>(
  items: any[], keyFn: (i) => T, valueFn: (i) => number
): Map<string, T & { total: number }> { ... }
Error Handling — Problems
✅ B7 — Prisma Constraint Violations Not Caught


// ❌ Agar duplicate email se customer banao:
await this.prisma.customer.create({ data: { email: duplicate } })
// → Prisma throws P2002 (unique constraint) as 500 Internal Server Error

// ✅ Catch karo:
try {
  return await this.prisma.customer.create({ ... });
} catch (e) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw new ConflictException('Email already exists');
  }
  throw e;
}
✅ B8 — Month Format Validation Missing Before PDF Generation (already handled via @Matches in StatementQueryDto — no change needed)

File: apps/api-backend/src/app/modules/customer/customer.controller.ts

// ❌ User-provided month → directly in filename — no validation
const month = query.month ?? new Date().toISOString().slice(0, 7);
'Content-Disposition': `attachment; filename="statement-${month}.pdf"`

// ✅ Validate first:
const MONTH_REGEX = /^\d{4}-\d{2}$/;
if (query.month && !MONTH_REGEX.test(query.month))
  throw new BadRequestException('Invalid month format. Use YYYY-MM');
FRONTEND CODE QUALITY
TypeScript — Critical Problems
✅ F1 — any Types on Every API Response — Type Safety Zero

File: apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx

// ❌ Ye poori file mein repeat hota hai
const customer = (data ?? {}) as Record<string, any>;          // Line 105
const c = consumptionData as any;                              // Line 171
const items = (scheduleData as any[]) ?? [];                   // Line 321
const allProducts = (productsData as any)?.data ?? [];         // Line 69
File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx

const allVans = ((vansData as any)?.data ?? []) as Array<...>; // Line 109
const sheet = (data ?? {}) as Record<string, any>;             // Line 171
const [reconcileData, setReconcileData] = useState<any>(null); // Line 120
Fix — Backend response types ek shared file mein define karo:


// libs/shared/types/src/lib/api-responses.ts
export interface CustomerDetail {
  id: string; name: string; customerCode: string;
  financialBalance: number; paymentType: PaymentType;
  deliverySchedules: DeliverySchedule[];
  // ...
}
export interface SheetDetail {
  id: string; date: string; isClosed: boolean;
  items: DeliveryItem[]; loads: LoadTrip[];
  // ...
}
React — Critical Problems
✅ F2 — sheet-detail.tsx — God Component, 1300+ Lines, 16 State Variables

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx

// ❌ Ek hi component mein sab kuch:
const [newTripOpen, setNewTripOpen] = useState(false);
const [checkinOpen, setCheckinOpen] = useState<string | null>(null);
const [deliveryOpen, setDeliveryOpen] = useState<string | null>(null);
const [swapOpen, setSwapOpen] = useState(false);
const [reconcileOpen, setReconcileOpen] = useState(false);
const [reconcileData, setReconcileData] = useState<any>(null);
const [newTripFilled, setNewTripFilled] = useState(0);
const [checkinForm, setCheckinForm] = useState({ ... });
const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});
const [swapForm, setSwapForm] = useState({ ... });
const [deliveryMode, setDeliveryMode] = useState<...>('delivered');
const [failureCategory, setFailureCategory] = useState<string>(...);
const [unableReason, setUnableReason] = useState('');
const [activeTab, setActiveTab] = useState('delivery');
const [tabPage, setTabPage] = useState(1);
const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
// 16 state variables = useReducer banana chahiye tha
Fix — Split karo:


sheet-detail.tsx (coordinator only)
├── components/
│   ├── sheet-header.tsx       (van/driver/date/status)
│   ├── delivery-queue.tsx     (items accordion + pagination)
│   ├── load-trips-section.tsx (checkin/checkout dialog)
│   └── dialogs/
│       ├── delivery-dialog.tsx
│       ├── swap-driver-dialog.tsx
│       └── reconcile-dialog.tsx
✅ F3 — customer-detail.tsx — 763 Lines, Missing useReducer

File: apps/vendor-dashboard/src/features/customers/components/customer-detail.tsx

// ❌ 8+ unrelated useState calls
const [portalOpen, setPortalOpen] = useState(false);
const [portalData, setPortalData] = useState({ email: '' });
const [customPriceOpen, setCustomPriceOpen] = useState(false);
const [customPriceForm, setCustomPriceForm] = useState({ productId: '', customPrice: '' });
const [scheduleRange, setScheduleRange] = useState({ ... });
// ...

// ✅ Group related state:
const [dialogState, dispatch] = useReducer(dialogReducer, initialDialogState);
✅ F4 — Expensive Computations Without useMemo — Re-render Per Interaction

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx

// ❌ Har render pe 100 items pe filter+reduce run hota hai
const doneItems = items.filter((i) => i.status === 'COMPLETED' || ...);
const totalFilledDropped = doneItems.reduce((acc, i) => acc + i.filledDropped, 0);
const totalCash = doneItems.reduce((acc, i) => acc + i.cashAmount, 0);
const totalEmptyReturned = items.reduce((acc, i) => acc + i.emptyReturned, 0);
const filteredItems = items.filter(...).slice(...);

// ✅ Memoize:
const doneItems = useMemo(
  () => items.filter((i) => completedStatuses.has(i.status)),
  [items]
);
const stats = useMemo(() => ({
  filledDropped: doneItems.reduce((s, i) => s + i.filledDropped, 0),
  cash: doneItems.reduce((s, i) => s + i.cashAmount, 0),
  emptyReturned: items.reduce((s, i) => s + i.emptyReturned, 0),
}), [doneItems, items]);
React Query — Problems
✅ F5 — Object Reference in Query Key — Infinite Refetch Bug

File: apps/vendor-dashboard/src/features/customers/hooks/use-customers.ts

// ❌ `params` object har render pe naya reference banta hai
queryKey: ['customers', id, 'schedule', params],

// ✅ Primitive values spread karo:
queryKey: ['customers', id, 'schedule', params.dateFrom, params.dateTo],
✅ F6 — Mutations Missing onError Handlers (already complete across all hooks — confirmed, no change needed)


// ❌ use-customers.ts mein multiple mutations:
const { mutate: updateCustomer } = useMutation({
  mutationFn: (dto) => customersApi.update(id, dto),
  onSuccess: () => { ... },
  // onError NAHI HAI — user ko pata nahi chalega kya hua
});

// ✅
onError: (error: any) => {
  toast.error(error?.response?.data?.message ?? 'Update failed. Please try again.');
},
✅ F7 — Queries Without enabled Guard — Run on Undefined Params


// ❌ id undefined ho to bhi query chalta hai
const { data } = useCustomerSchedule(customerId, scheduleRange);
// customerId = undefined → API call /customers/undefined/schedule

// ✅
enabled: !!customerId && !!scheduleRange?.dateFrom,
✅ F8 — Query Key Invalidation Mismatch (Stale Data) (already using ['customers'] base key in all mutations — confirmed, no change needed)

File: apps/vendor-dashboard/src/lib/query-keys.ts

// ❌ Actual cache key includes params:
['customers', { page: 1, search: 'ali', paymentType: 'CASH', ... }]

// ❌ Invalidation uses base key only:
queryClient.invalidateQueries({ queryKey: queryKeys.customers.all({}) })
// → ['customers', {}] ≠ ['customers', { page: 1, ... }] — NO MATCH

// ✅ React Query v5 mein prefix matching use karo:
queryClient.invalidateQueries({ queryKey: ['customers'] })
// → Matches ALL keys starting with 'customers'
Code Organization — Problems
✅ F9 — Inline Helper Functions in Render — New Reference Every Render

File: apps/vendor-dashboard/src/features/daily-sheets/components/sheet-detail.tsx

// ❌ Har render pe naya function banta hai
const formatTime = (dt: string) => new Date(dt).toLocaleTimeString(...);

// ✅ Component ke bahar move karo (module level):
const formatTime = (dt: string) => new Date(dt).toLocaleTimeString(...);
✅ F10 — Type Assertion Instead of Validation on Enums


// ❌ Assert kiya, validate nahi kiya
(paymentType as 'MONTHLY' | 'CASH')

// ✅ Proper check:
const VALID_PAYMENT_TYPES = ['MONTHLY', 'CASH'] as const;
type PaymentTypeValue = typeof VALID_PAYMENT_TYPES[number];
if (!VALID_PAYMENT_TYPES.includes(paymentType as any))
  throw new Error('Invalid payment type');
Summary — Prioritized Fix List
Fix This Week (Breaks Type Safety / Real Bugs)
#	Status	Problem	Files	Effort
1	✅ DONE	Define shared API response interfaces — remove all any	libs/shared/types/ + all feature hooks	1 day
2	✅ DONE	Fix query key invalidation — use base key ['customers'] not queryKeys.customers.all({})	query-keys.ts, all hooks	2 hrs
3	✅ DONE	Fix object-in-query-key infinite refetch	use-customers.ts line ~170	30 min
4	✅ DONE	@CurrentUser() decorator return type — define AuthUser interface	all controllers	1 hr
5	✅ DONE	Use DeliveryStatus enum instead of string literals	daily-sheet.service.ts	1 hr
6	✅ DONE	Add onError handlers to all mutations	all use-*.ts hook files	2 hrs
7	✅ DONE	Add enabled: !!param guards to queries with optional params	all hooks	1 hr
Fix Next Sprint (Code Quality)
#	Status	Problem	Files	Effort
8	✅ DONE	Wrap Prisma creates/updates in try/catch for P2002 (unique constraint)	customer, user, vendor services	2 hrs
9	✅ DONE	Extract buildReconciliation / idempotency logic to private methods	ledger.service.ts, daily-sheet.service.ts	3 hrs
10	✅ DONE	Add useMemo on filter/reduce in SheetDetail	sheet-detail.tsx	1 hr
11	✅ DONE	Month format validation in PDF endpoint	customer.controller.ts	30 min
12	✅ DONE	FCM .catch(() => null) → log warning	order.service.ts, daily-sheet.service.ts	30 min
Refactor (Technical Debt — Plan for Later)
#	Status	Problem	Files	Effort
13	✅ DONE	Split sheet-detail.tsx (1300 lines) into sub-components	sheet-detail.tsx	2 days
14	✅ DONE	Split customer-detail.tsx (763 lines), extract dialogs	customer-detail.tsx	1 day
15	✅ DONE	Replace 16 useState calls with useReducer in SheetDetail	sheet-detail.tsx	4 hrs
16	✅ DONE	DRY up analytics.service.ts Map-grouping pattern → generic helper	analytics.service.ts	2 hrs
17	✅ DONE	Move inline helpers (formatTime, etc.) outside component render	sheet-detail.tsx	1 hr
Bottom line: Core NestJS structure (modules, DI, guards, interceptors) sahi hai. Asli masla hai any types ka overuse — backend aur frontend dono mein — jo runtime crashes ka risk create karta hai aur refactoring painful banata hai. Frontend ka sabse urgent issue hai query key invalidation bug jo stale data show karta hai users ko, aur SheetDetail component jo ek monster ban gaya hai. Week 1 fixes (shared types + query keys + onError handlers) se code quality dramatically improve hogi bina koi bada refactor kiye.