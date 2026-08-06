import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { CrewCashCategory } from '@prisma/client';

/**
 * Only `category`/`amount`/`notes`/`photoKeys` are editable pre-close — NOT
 * `employeeId`/`distributedById`/`dailySheetId`/`date` (doc §4/§9: wrong
 * employee is fixed by delete-and-recreate against the correct crew member,
 * never a field-level identity swap).
 */
export class UpdateCrewCashDistributionDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsEnum(CrewCashCategory)
  category?: CrewCashCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  photoKeys?: string[];
}
