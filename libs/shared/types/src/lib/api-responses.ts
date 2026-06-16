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

export interface DeliveryItemNote {
  id: string;
  type: 'TEXT' | 'VOICE';
  text: string | null;
  audioKey: string | null;
  audioDuration: number | null;
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
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
  photoUrl?: string | null;
  pricePerBottle?: number;
  lastFilledDropped?: number | null;
  deliveredAt?: string | null;
  editUnlockedBy?: string | null;
  editUnlockExpiresAt?: string | null;
  whatsappSentAt?: string | null;
  bottleBalanceAfter?: number | null;
  financialBalanceAfter?: number | null;
  notes?: DeliveryItemNote[];
}

export interface CustomerFinancialSummary {
  prevMonthAmount: number;
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
