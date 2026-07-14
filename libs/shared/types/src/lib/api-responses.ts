export type DeliveryStatusType =
  | 'PENDING'
  | 'COMPLETED'
  | 'EMPTY_ONLY'
  | 'NOT_AVAILABLE'
  | 'RESCHEDULED'
  | 'CANCELLED';

export type PaymentTypeValue = 'MONTHLY' | 'CASH';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ProductSummary {
  id: string;
  name: string;
  basePrice: number;
}

export interface BottleWallet {
  id: string;
  balance: number;
  productId: string;
  product: Pick<ProductSummary, 'id' | 'name'>;
}

export interface CustomPrice {
  id: string;
  customPrice: number;
  productId: string;
  product: Pick<ProductSummary, 'id' | 'name' | 'basePrice'>;
}

export interface DeliverySchedule {
  id: string;
  dayOfWeek: number;
  vanId: string;
  routeSequence: number | null;
  van: { id: string; plateNumber: string };
}

export interface CustomerDetail {
  id: string;
  name: string;
  customerCode: string;
  phoneNumber: string;
  address: string;
  floor: string | null;
  nearbyLandmark: string | null;
  deliveryInstructions: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  financialBalance: number;
  paymentType: PaymentTypeValue;
  isBillingExempt: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  routeId: string | null;
  route: { id: string; name: string } | null;
  wallets: BottleWallet[];
  customPrices: CustomPrice[];
  deliverySchedules: DeliverySchedule[];
  user: { id: string; email: string } | null;
}

export interface ConsumptionPeriod {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  days: number; // elapsed days used for per-day rates
  allTime: boolean;
}

export interface ConsumptionSummary {
  deliveryCount: number;
  totalFilledDropped: number;
  totalEmptyReceived: number;
  avgFilledPerDelivery: number;
  bottlesPerDay: number;
  avgDaysBetweenDeliveries: number | null;
}

export interface ConsumptionTrend {
  prevFrom: string;
  prevTo: string;
  prevBottlesPerDay: number;
  changePct: number | null;
}

export type ConsumptionRateStatus = 'ON_TARGET' | 'ATTENTION' | 'ACTION';

export interface ConsumptionByProduct {
  product: Pick<ProductSummary, 'id' | 'name'>;
  currentWalletBalance: number;
  periodEndWalletBalance: number;
  deliveryCount: number;
  totalConsumed: number;
  totalEmptyReceived: number;
  avgPerDelivery: number;
  bottlesPerDay: number;
  estStockDaysLeft: number | null;
  consumptionRate: string; // e.g. "82.5%" or "N/A"
  rateStatus: ConsumptionRateStatus | null;
}

export interface CustomerConsumption {
  customerId: string;
  customerName: string;
  period: ConsumptionPeriod;
  summary: ConsumptionSummary;
  byProduct: ConsumptionByProduct[];
  trend: ConsumptionTrend | null;
}

export interface CustomerScheduleItem {
  id: string;
  date: string | null;
  status: DeliveryStatusType;
  filledDropped: number;
  product: Pick<ProductSummary, 'name'> | null;
  dailySheet: { date: string } | null;
}

export interface CustomerWalletSummary {
  balance: number;
  productId: string;
  product: { name: string };
}

// Customer Communication Center (docs/features/customer-communication-center.md).
// ConversationMessage evolved from the old DeliveryItemNote table; DeliveryItemNote
// is kept as an alias so the not-yet-migrated notes UI keeps compiling until Phase 7.
export interface ConversationMessage {
  id: string;
  type: 'TEXT' | 'VOICE';
  text: string | null;
  audioKey: string | null;
  audioDuration: number | null;
  requiresAck: boolean;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
}

/** @deprecated Alias for ConversationMessage — removed in Phase 7. */
export type DeliveryItemNote = ConversationMessage;

export interface ConversationContext {
  id: string;
  status: 'OPEN' | 'RESOLVED' | 'CLOSED';
  waitingOn: 'DRIVER' | 'OFFICE' | null;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  customer: { id: string; name: string; customerCode: string; phoneNumber: string | null };
  dailySheet: { id: string; date: string; isClosed: boolean };
  van: { id: string; plateNumber: string };
  driver: { id: string; name: string };
  item: { id: string; sequence: number; status: DeliveryStatusType; product: { id: string; name: string } };
}

export interface DeliveryItem {
  id: string;
  sequence: number;
  customerId: string;
  customer?: {
    name: string;
    address: string;
    customerCode: string;
    floor?: string | null;
    nearbyLandmark?: string | null;
    deliveryInstructions?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    phoneNumber?: string | null;
    paymentType?: PaymentTypeValue;
    financialBalance?: number;
    previousMonthOutstanding?: number;
    consumptionRate30d?: number | null;
    wallets?: CustomerWalletSummary[];
    customPrices?: { productId: string; customPrice: number }[];
  };
  productId: string;
  product?: { name: string; basePrice?: number };
  status: DeliveryStatusType;
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  reason?: string | null;
  failureCategory?: string | null;
  photoKey?: string | null;
  pricePerBottle?: number;
  lastFilledDropped?: number | null;
  deliveredAt?: string | null;
  editUnlockedBy?: string | null;
  editUnlockExpiresAt?: string | null;
  editRequestedAt?: string | null;
  whatsappSentAt?: string | null;
  bottleBalanceAfter?: number | null;
  financialBalanceAfter?: number | null;
  notes?: DeliveryItemNote[];
  deliveryType?: 'SCHEDULED' | 'ON_DEMAND';
  sourceOrderId?: string | null;
  isCorrection?: boolean;
  correctionAddedAt?: string | null;
  correctionNote?: string | null;
}

export interface CustomerFinancialSummary {
  currentMonthPaid: number;
  prevMonthOutstanding: number;
  currentOutstanding: number;
}

export interface CustomerDeliveryHistoryItem {
  id: string;
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  pricePerBottle: number;
  bottleBalanceAfter: number | null;
  financialBalanceAfter: number | null;
  deliveredAt: string | null;
  dailySheet: { date: string };
}

export interface LoadTrip {
  id: string;
  tripNumber: number;
  loadedFilled: number;
  returnedFilled: number;
  collectedEmpty: number;
  cashHandedIn: number;
  startedAt: string;
  endedAt: string | null;
}

export interface SheetExpense {
  id: string;
  category: string;
  amount: number;
  description: string;
  date: string;
  vanId: string | null;
  van: { id: string; plateNumber: string } | null;
  createdBy: { id: string; name: string };
}

export type CrewRole = 'DRIVER' | 'SALESMAN' | 'LOADER';

export interface SheetCrewMember {
  id: string;
  userId: string;
  role: CrewRole;
  user: { id: string; name: string; role: string };
}

export interface SheetDetail {
  id: string;
  date: string;
  isClosed: boolean;
  vendorId: string;
  filledOutCount: number;
  vanId: string | null;
  driverId: string | null;
  route: { id: string; name: string } | null;
  van: { id: string; plateNumber: string } | null;
  driver: { id: string; name: string } | null;
  crew: SheetCrewMember[];
  crewConfirmed: boolean;
  crewConfirmedAt: string | null;
  crewConfirmedBy: { id: string; name: string } | null;
  items: DeliveryItem[];
  loads: LoadTrip[];
  expenses: SheetExpense[];
}

export interface VanSummary {
  id: string;
  plateNumber: string;
}

export interface DriverSummary {
  id: string;
  name: string;
}
