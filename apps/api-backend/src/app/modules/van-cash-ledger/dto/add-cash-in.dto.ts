import { ManualCashInSource } from '@prisma/client';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * A manually-recorded cash-in event outside the normal driver-handover flow —
 * see VanCashLedgerService.addManualCashIn. `vanId` is optional: set it to
 * anchor the entry to one van's balance, or omit it for a general/office-wide
 * entry (only visible in the vendor-wide "All Vans" view). `source` is an
 * optional categorisation for "Office Cash In by source" reporting.
 *
 * `relatedVehicleId` / `relatedEmployeeId` are exclusive attributions the
 * service requires (and validates) when `source` is VEHICLE_RENTED_OUT /
 * LABOUR_LENT_OUT respectively — see VanCashLedgerService.addManualCashIn.
 */
export class AddCashInDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsNumber()
  @Min(0)
  openingBalance: number;

  @IsDateString()
  openingDate: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(ManualCashInSource)
  source?: ManualCashInSource;

  /** The physical vehicle rented out — required only when `source` is VEHICLE_RENTED_OUT. */
  @IsOptional()
  @IsUUID()
  relatedVehicleId?: string;

  /** The employee (driver/salesman/loader) lent out — required only when `source` is LABOUR_LENT_OUT. */
  @IsOptional()
  @IsUUID()
  relatedEmployeeId?: string;
}
