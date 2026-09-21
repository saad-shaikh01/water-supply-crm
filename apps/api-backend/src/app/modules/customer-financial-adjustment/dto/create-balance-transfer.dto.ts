import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Trims strings; leaves everything else for the validators to reject. */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Moves part (or all) of what one customer OWES onto another customer's account: the
 * source owes less, the target owes more, in one atomic posting of two linked ledger
 * rows. There is no `effectiveDate` — a transfer is always dated now — and no title:
 * the customer-facing wording is generated ("Balance transferred to/from <code>").
 */
export class CreateBalanceTransferDto {
  /** The customer whose balance is reduced. May be inactive (transfer-then-deactivate). */
  @IsUUID()
  fromCustomerId: string;

  /** The customer whose balance increases. Must be active and in the same vendor. */
  @IsUUID()
  toCustomerId: string;

  /**
   * Positive amount in rupees, at most 2 decimal places (validated precisely in the
   * service). Cannot exceed what the source currently owes.
   */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /** Staff-only. Never copied to the ledger rows. Optional for a transfer. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  internalNote?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  referenceNo?: string;

  /**
   * Client-generated per submit. A retry or double-click with the same key returns the
   * ORIGINAL transfer instead of moving the money twice. Required.
   */
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}
