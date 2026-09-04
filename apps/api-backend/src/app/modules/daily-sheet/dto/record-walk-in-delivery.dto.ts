import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryChannel } from '@prisma/client';

/**
 * Walk-in / Self-Pickup Delivery (docs/features/walk-in-delivery.md).
 *
 * Records a delivery that happened off the route pipeline. No van, odometer,
 * load-out, trip or crew confirmation — the service finds-or-creates the
 * synthetic WALK_IN daily sheet for `date` and appends one DailySheetItem.
 *
 * Price is NOT accepted here: it is resolved server-side from the customer's
 * own rate (custom price → product base price), or ₨0 for billing-exempt
 * customers — exactly like `submitDelivery`.
 */
export class RecordWalkInDeliveryDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  filledDropped!: number;

  @IsInt()
  @Min(0)
  emptyReceived!: number;

  @IsInt()
  @Min(0)
  filledReceived!: number;

  /** Defaults to 0 — a walk-in customer may leave the charge on their balance. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  cashCollected?: number;

  /**
   * The date the delivery happened (YYYY-MM-DD or ISO). Must be today or
   * earlier — future dates are rejected. A past date lands on (or lazily
   * creates) that date's WALK_IN sheet and anchors the ledger rows to it.
   */
  @IsDateString()
  date!: string;

  /** Fixed dropdown; defaults to OTHER when omitted. */
  @IsOptional()
  @IsEnum(DeliveryChannel)
  deliveryChannel?: DeliveryChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Send the delivery-complete WhatsApp PDF receipt. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;
}
