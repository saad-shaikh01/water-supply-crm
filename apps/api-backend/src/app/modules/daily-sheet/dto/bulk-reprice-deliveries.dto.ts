import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Bulk Closed Delivery Repricing — retroactively change the per-bottle rate on
 * several already-recorded COMPLETED/EMPTY_ONLY deliveries on CLOSED sheets,
 * all for the same customer, in one management-approved action. Quantities are
 * never part of this DTO — only the rate changes; the ledger delta engine
 * (LedgerService.recordDelivery) does the balance adjustment per item.
 *
 * Deliberately separate from CorrectDeliveryDto: that DTO amends a single
 * delivery's driver-recorded figures (a mistake); this one only ever changes
 * `newPricePerBottle` across N deliveries (a business decision), and `reason`
 * is always mandatory here (never optional, unlike `priceOverride` there).
 */
export class BulkRepriceDeliveriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  dailySheetItemIds!: string[];

  @IsNumber()
  @Min(0)
  newPricePerBottle!: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
