import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, MaxLength, MinLength, Min } from 'class-validator';

/**
 * Stale-sheet force close (admin tool). `reason` is mandatory and lands in the
 * audit log. `actualCashHandedIn` is optional — when omitted the sheet's own
 * expected hand-in (reconciliation `driver.totalToHandIn`) is used, i.e. a
 * zero cash discrepancy; pass a number to record what was REALLY handed in.
 */
export class ForceCloseSheetDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  actualCashHandedIn?: number;
}

/** Bulk variant — every sheet is closed with its own expected hand-in. */
export class ForceCloseBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  sheetIds!: string[];

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
