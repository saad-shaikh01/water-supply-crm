import { IsInt, IsNumber, IsOptional, IsString, MaxLength, MinLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Edit Closed-Sheet Delivery — amend the figures of an already-recorded
 * COMPLETED / EMPTY_ONLY delivery on a CLOSED sheet, keeping it one delivery
 * row (as opposed to void + re-add, which splits it into two). The ledger delta
 * engine (ledger.recordDelivery on an item that already has rows) does the
 * balance/wallet adjustment.
 *
 * The four counts are `@IsInt @Min(0)` and all required. `priceOverride` is
 * optional — when omitted the existing per-bottle price is kept (never
 * silently re-resolved from custom/base price). `correctionNote` is ALWAYS
 * required, `@Transform`-trimmed first so a whitespace-only note collapses to
 * "" and is then rejected by `@MinLength(3)` (same style as
 * void-delivery.dto.ts / correct-closed-trip.dto.ts).
 */
export class CorrectDeliveryDto {
  @IsInt()
  @Min(0)
  filledDropped!: number;

  @IsInt()
  @Min(0)
  emptyReceived!: number;

  @IsInt()
  @Min(0)
  filledReceived!: number;

  @IsInt()
  @Min(0)
  cashCollected!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceOverride?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  correctionNote!: string;
}
