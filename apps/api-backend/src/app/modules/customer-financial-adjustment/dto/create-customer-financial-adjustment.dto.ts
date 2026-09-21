import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { POSTABLE_ADJUSTMENT_KINDS, type PostableAdjustmentKind } from '../adjustment-posting.util';

/** Trims strings; leaves everything else for the validators to reject. */
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Posts one Customer Financial Adjustment (charge or credit) to a customer's
 * ledger. The direction (charge vs credit) is NOT sent — it is fixed by `kind`
 * (libs/shared/types ADJUSTMENT_KIND_POLICY), so a caller can never post a
 * "penalty" that reduces a balance. Which RBAC action is required also follows
 * from `kind` and is enforced in the service.
 */
export class CreateCustomerFinancialAdjustmentDto {
  @IsUUID()
  customerId: string;

  @IsIn(POSTABLE_ADJUSTMENT_KINDS as readonly string[])
  kind: PostableAdjustmentKind;

  /** Positive amount in rupees, at most 2 decimal places (validated precisely in the service). */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /**
   * Label for the adjustment. Shown to the customer on their statement/portal for
   * ITEMIZED kinds (all of 2A), so write it as the customer should read it.
   */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  /**
   * Staff-only. Never copied to the ledger row. REQUIRED for every credit kind
   * (enforced in the service from the kind policy) — why was this balance reduced?
   */
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
   * Business date (YYYY-MM-DD or ISO). Omit (or pass today) to post now. An earlier
   * date is allowed only within the current month; future dates are rejected.
   */
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  /**
   * Client-generated per submit (e.g. a UUID minted when the dialog opens). A retry
   * or double-click with the same key returns the ORIGINAL result instead of posting
   * twice. Required so no API caller can double-post by accident.
   */
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}
