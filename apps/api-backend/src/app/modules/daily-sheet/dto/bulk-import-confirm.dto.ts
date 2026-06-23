import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ImportRowDto {
  @IsUUID()
  itemId!: string;

  @IsIn(['COMPLETED', 'SKIPPED', 'FAILED'])
  status!: string;

  @IsInt()
  @Min(0)
  filledDropped!: number;

  @IsInt()
  @Min(0)
  emptyReturned!: number;

  @IsNumber()
  @Min(0)
  cashCollected!: number;

  @IsOptional()
  @IsString()
  failureReason?: string;

  @IsOptional()
  @IsString()
  failureCategory?: string;
}

export class BulkImportConfirmDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}
