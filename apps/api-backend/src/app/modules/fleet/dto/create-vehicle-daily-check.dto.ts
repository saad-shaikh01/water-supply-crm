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

  @IsInt()
  @Min(0)
  odometerReading: number;

  @IsOptional()
  @IsString()
  odometerPhotoKey?: string;

  @IsInt()
  @Min(0)
  @Max(8)
  fuelGaugeLevel: number;

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
