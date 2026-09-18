import { ManualCashInSource } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Edits an ACTIVE manual cash-in in place (P2). Every field except `version`
 * and `reason` is optional — only the fields present are considered, and at
 * least one must actually differ from the stored row (checked in the service).
 * `null` for `vanId` detaches the entry from any van (office-wide); `null` for
 * `source` clears the categorisation. A written reason is mandatory — it is
 * stored in the audit trail with the before/after diff.
 */
export class EditManualCashInDto {
  /** Optimistic-concurrency token — must match the row's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  /** YYYY-MM-DD (or a full ISO timestamp). Future dates are rejected in the service. */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsOptional()
  @IsEnum(ManualCashInSource)
  source?: ManualCashInSource | null;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
