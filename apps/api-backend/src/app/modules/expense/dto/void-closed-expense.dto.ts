import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Post-Close Expense Correction — hard-delete an Expense row that sits on an
 * ALREADY-CLOSED daily sheet, via `POST /expenses/:id/void`. The row is removed
 * with `tx.expense.delete`; the audit `before` block (which carries this
 * `correctionNote`) is the only surviving record.
 *
 * `correctionNote` is trimmed first so an all-whitespace note collapses to "" and
 * is then rejected by `@MinLength(3)` (same style as
 * daily-sheet/dto/void-delivery.dto.ts).
 */
export class VoidClosedExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  correctionNote!: string;
}
