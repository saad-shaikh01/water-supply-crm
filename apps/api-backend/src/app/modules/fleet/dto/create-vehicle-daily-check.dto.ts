import { Type } from 'class-transformer';
import {
  IsUUID,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { VehicleCheckType } from '@prisma/client';

class ChecklistItemInputDto {
  @IsString()
  key: string;

  @IsBoolean()
  passed: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreateVehicleDailyCheckDto {
  @IsUUID()
  dailySheetId: string;

  @IsEnum(VehicleCheckType)
  checkType: VehicleCheckType;

  // Required on START (the physical vehicle taking this route's trip out
  // today, §17 Amendment 2026-08-21/§17.3) — validated + enforced
  // server-side (VehicleCheckService.create), not just by this decorator,
  // since it's optional on END (inherited from the sheet's own START check,
  // never re-picked mid-trip — §17.5, locked).
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @IsInt()
  @Min(0)
  odometerReading: number;

  @IsOptional()
  @IsString()
  odometerPhotoKey?: string;

  // Optional — many vans' dashboards don't have a working gauge, and this
  // never fed any calculation (daily km = odometer delta, average mileage =
  // FuelLog fill-to-fill; neither reads this field).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  fuelGaugeLevel?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemInputDto)
  checklistResults: ChecklistItemInputDto[];

  @IsOptional()
  @IsBoolean()
  damageNoted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  damageNote?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  damagePhotoKeys?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
