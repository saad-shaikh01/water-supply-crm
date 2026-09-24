import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** PATCH /van-cash-ledger/supplier-bills/opening-balance — Vendor Admin only. */
export class SetSupplierBillOpeningBalanceDto {
  @IsNumber()
  @Min(0)
  plantAmount!: number;

  @IsNumber()
  @Min(0)
  capsAmount!: number;

  @IsOptional()
  @IsString()
  note?: string;
}
