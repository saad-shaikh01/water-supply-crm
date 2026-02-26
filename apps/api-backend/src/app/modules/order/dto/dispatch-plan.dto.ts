import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { DispatchMode } from '@prisma/client';

export class DispatchPlanDto {
  @IsDateString()
  targetDate: string;

  @IsOptional()
  @IsString()
  timeWindow?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsEnum(DispatchMode)
  dispatchMode: DispatchMode;

  @IsOptional()
  @IsString()
  notes?: string;
}
