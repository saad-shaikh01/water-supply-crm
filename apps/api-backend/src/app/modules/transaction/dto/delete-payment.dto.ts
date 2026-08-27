import {
  IsDateString,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaymentEditReason } from '@prisma/client';

export class DeletePaymentDto {
  @IsEnum(PaymentEditReason)
  reason!: PaymentEditReason;

  // Required only when reason is OTHER; skipped for every other reason.
  @ValidateIf((o) => o.reason === PaymentEditReason.OTHER)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reasonNote?: string;

  // Optimistic-lock token — the exact ISO string (incl. milliseconds) the client read.
  @IsDateString()
  expectedUpdatedAt!: string;
}
