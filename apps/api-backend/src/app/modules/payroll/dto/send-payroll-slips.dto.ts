import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Hard cap on slips per dispatch (WhatsApp warm-up lesson: never blast a whole vendor in one go by accident). */
export const MAX_SLIPS_PER_DISPATCH = 500;

export class PreviewPayrollSlipsDto {
  /** Omit for "all entries of the period"; otherwise only these entries (must belong to the period). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SLIPS_PER_DISPATCH)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  entryIds?: string[];
}

export class SendPayrollSlipsDto extends PreviewPayrollSlipsDto {
  /** Re-send entries that were already sent. Without it, an already-sent entry makes the request fail with 409 SLIP_ALREADY_SENT. */
  @IsOptional()
  @IsBoolean()
  confirmResend?: boolean;

  /** Silently leave out entries that were already sent (instead of the 409) — for "send to everyone not yet sent". */
  @IsOptional()
  @IsBoolean()
  skipAlreadySent?: boolean;
}
