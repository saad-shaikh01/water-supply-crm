import { IsEnum, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { DeliveryVoidReason } from '@prisma/client';

/**
 * Void Delivery — strike a recorded stop from the operational record.
 *
 * `voidReason` is always required. `voidNote` is mandatory (min 3 chars) when
 * `voidReason === 'OTHER'`, and optional for every other structured reason; when
 * supplied it is still length-checked. Mirrors `AddCorrectionItemDto`'s
 * `@MinLength(3)` note-validation style.
 */
export class VoidDeliveryDto {
  @IsEnum(DeliveryVoidReason)
  voidReason!: DeliveryVoidReason;

  // Trim first so an all-whitespace note ("   ") collapses to "" and is then
  // rejected by @MinLength(3) instead of sneaking past it.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  // Validate only when it must be present (reason OTHER) or when the caller
  // actually sent a value — a bare `undefined` OR an explicit `null` for a
  // non-OTHER reason skips validation (loose `!= null`, so `null` is not a
  // spurious 400 on @IsString).
  @ValidateIf(
    (o: VoidDeliveryDto) => o.voidReason === DeliveryVoidReason.OTHER || o.voidNote != null,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  voidNote?: string;
}
