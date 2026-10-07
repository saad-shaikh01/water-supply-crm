import { IsBoolean, IsUUID, IsInt, Min, IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateServiceRecordDto {
  @IsUUID()
  vehicleId: string;

  // Catalogue key (VehicleServiceTypeDef.key) — checked against the vendor's
  // catalogue in VehicleMaintenanceService.
  @IsString()
  @MaxLength(40)
  serviceType: string;

  @IsInt()
  @Min(0)
  performedAtOdometer: number;

  @IsDateString()
  performedAtDate: string;

  @IsNumber()
  @Min(0)
  cost: number;

  @IsOptional() @IsString() @MaxLength(150) workshopName?: string;
  @IsOptional() @IsString() invoicePhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) partsReplaced?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;

  // false = paid by bank/online — keeps this cost out of Office Cash in the
  // Cash Ledger. Omitted = cash (the historical behaviour).
  @IsOptional() @IsBoolean() paidFromCash?: boolean;

  // Set only when the record is added from a Daily Sheet's "Add / Record" menu —
  // the spawned Expense is then pinned to that sheet, so a cash-paid service
  // reduces the driver's hand-in (buildReconciliation) like fuel / crew cash do.
  // Omitted (Fleet / Expense Center) = office-level expense, Cash Ledger only.
  @IsOptional() @IsUUID() dailySheetId?: string;
}
