import { z } from 'zod';

// Note: enum fields are never given `.default()` here — RHF's `defaultValues`
// carries the default instead (see feedback captured in project memory: `.default()`
// on a Zod enum breaks the Resolver<Input> type match with useForm<T>).

// The Vehicle's own identity fields — deliberately separate from
// vehicleProfileSchema below. `plateNumber` here is the vehicle's REAL
// registration plate; it has nothing to do with Van.plateNumber (the
// route/slot's display label, e.g. "Van1") which stays untouched everywhere
// else in the app. `usualVanId` uses the '__none__' sentinel because RHF/Select
// can't carry an empty-string or null value through a native <select>-style
// control; the dialog translates it to `null` before calling the API.
export const vehicleBasicSchema = z.object({
  plateNumber: z.string().min(1, 'Number plate is required').max(50),
  usualVanId: z.string(),
});
export type VehicleBasicInput = z.infer<typeof vehicleBasicSchema>;

export const vehicleProfileSchema = z.object({
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z.number().int().min(1950).max(2100).optional().nullable(),
  color: z.string().max(50).optional(),
  chassisNumber: z.string().max(100).optional(),
  engineNumber: z.string().max(100).optional(),
  fuelType: z.enum(['PETROL', 'DIESEL', 'CNG', 'HYBRID', 'ELECTRIC']).optional().nullable(),
  transmissionType: z.string().max(50).optional(),
  loadCapacityKg: z.number().min(0).optional().nullable(),
  seatingCapacity: z.number().int().min(0).optional().nullable(),
  ownershipType: z.enum(['OWNED', 'LEASED', 'RENTED', 'FINANCED']).optional().nullable(),
  purchaseDate: z.string().optional(),
  purchaseCost: z.number().min(0).optional().nullable(),
  supplierName: z.string().max(150).optional(),
  operationalStatus: z.enum(['ACTIVE', 'IN_MAINTENANCE', 'RETIRED']),
});
export type VehicleProfileInput = z.infer<typeof vehicleProfileSchema>;

export const vehicleDocumentSchema = z.object({
  type: z.enum(['REGISTRATION', 'INSURANCE', 'FITNESS_CERTIFICATE', 'ROUTE_PERMIT', 'TAX_TOKEN', 'LOAN_AGREEMENT', 'OTHER']),
  documentNumber: z.string().max(100).optional(),
  issuingAuthority: z.string().max(150).optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  reminderDaysBefore: z.number().int().min(1).max(365),
  notes: z.string().max(500).optional(),
});
export type VehicleDocumentInput = z.infer<typeof vehicleDocumentSchema>;

export const fuelLogSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  odometerAtFill: z.number().int().min(0, 'Must be 0 or more'),
  litersFilled: z.number().min(0.1, 'Must be greater than 0'),
  amountPaid: z.number().min(0, 'Must be 0 or more'),
  isFullTank: z.boolean(),
  // true = paid from the driver's van cash-in-hand (default — deducted from
  // cash hand-in); false = paid by card/bank/company account (not deducted).
  paidFromCash: z.boolean(),
  fuelStation: z.string().max(150).optional(),
  notes: z.string().max(500).optional(),
});
export type FuelLogInput = z.infer<typeof fuelLogSchema>;

export const serviceRecordSchema = z.object({
  serviceType: z.enum([
    'ENGINE_OIL', 'OIL_FILTER', 'AIR_FILTER', 'FUEL_FILTER', 'BRAKE_FLUID', 'BRAKE_PADS', 'COOLANT',
    'TRANSMISSION_FLUID', 'TYRE_ROTATION', 'BATTERY', 'SUSPENSION', 'CLUTCH', 'TIMING_BELT', 'SPARK_PLUGS',
    'WHEEL_ALIGNMENT', 'AC_SERVICE', 'GENERAL_INSPECTION', 'OTHER',
  ]),
  performedAtOdometer: z.number().int().min(0),
  performedAtDate: z.string().min(1, 'Date is required'),
  cost: z.number().min(0),
  workshopName: z.string().max(150).optional(),
  partsReplaced: z.string().max(500).optional(),
  notes: z.string().max(500).optional(),
});
export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>;
