import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { ImportRowDto } from './bulk-import-confirm.dto';

// An ad-hoc row resolved by the user (ambiguous) or auto-resolved (single van).
// sheetId already determined — backend will CREATE a new DailySheetItem then apply delivery.
export class AdhocImportRowDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  sheetId!: string;

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
}

export class GlobalImportGroupDto {
  @IsUUID()
  sheetId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdhocImportRowDto)
  adhocRows!: AdhocImportRowDto[];
}

export class GlobalImportConfirmDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlobalImportGroupDto)
  groups!: GlobalImportGroupDto[];
}
