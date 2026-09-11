import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class BulkDeactivateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  customerIds!: string[];

  /**
   * Force-write-off a customer's outstanding balance and/or bottles instead of
   * skipping them — same per-blocker permission gate as the single-customer
   * `PATCH /customers/:id/deactivate` (`customers:force_deactivate` /
   * `customers:force_deactivate_bottles`). A customer whose blocker(s) the
   * caller isn't permitted to force still lands in `skipped`.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
