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

export interface ConsumptionSummary {
  deliveryCount: number;
  totalFilledDropped: number;
  totalEmptyReceived: number;
  avgFilledPerDelivery: number;
}

export interface ConsumptionByProduct {
  product: Pick<ProductSummary, 'id' | 'name'>;
  deliveryCount: number;
  totalConsumed: number;
  avgPerDelivery: number;
  consumptionRate: string;
}

export interface CustomerConsumption {
  summary: ConsumptionSummary;
  byProduct: ConsumptionByProduct[];
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
  bottleBalanceAfter?: number | null;
  financialBalanceAfter?: number | null;
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
