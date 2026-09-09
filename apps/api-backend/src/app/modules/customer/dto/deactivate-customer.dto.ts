import { IsBoolean, IsOptional } from 'class-validator';

export class DeactivateCustomerDto {
  /**
   * Deactivate past the outstanding-balance guard, writing the customer's
   * remaining `financialBalance` off as a company loss (bad debt). Requires the
   * caller to hold `customers:force_deactivate` (VENDOR_ADMIN only by default) —
   * the guarded `customers:deactivate` alone is not enough. Does NOT bypass the
   * pending-delivery or outstanding-bottle guards.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
