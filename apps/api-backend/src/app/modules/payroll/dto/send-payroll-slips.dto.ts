import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { SLIP_DOCUMENT_KINDS, type SlipDocumentKind } from '../payroll-slip.util';

/** Hard cap on slips per dispatch (WhatsApp warm-up lesson: never blast a whole vendor in one go by accident). */
export const MAX_SLIPS_PER_DISPATCH = 500;

/** One employee's own choice of documents, overriding the request-wide `documents`. */
export class SlipEntryDocumentsDto {
  @IsString()
  @IsNotEmpty()
  entryId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(SLIP_DOCUMENT_KINDS, { each: true })
  documents!: SlipDocumentKind[];
}

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

  /** Which documents everyone gets (SLIP, RECEIPT, or both). Omit = the full salary slip only. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(SLIP_DOCUMENT_KINDS, { each: true })
  documents?: SlipDocumentKind[];

  /** Per-employee overrides of `documents` (e.g. one employee gets only the receipt). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SLIPS_PER_DISPATCH)
  @ValidateNested({ each: true })
  @Type(() => SlipEntryDocumentsDto)
  perEntry?: SlipEntryDocumentsDto[];
}

export class SendPayrollSlipsDto extends PreviewPayrollSlipsDto {
  /** Re-send documents that were already sent. Without it, an already-sent document makes the request fail with 409 SLIP_ALREADY_SENT. */
  @IsOptional()
  @IsBoolean()
  confirmResend?: boolean;

  /** Silently leave out documents that were already sent (instead of the 409) — for "send to everyone not yet sent". */
  @IsOptional()
  @IsBoolean()
  skipAlreadySent?: boolean;
}
