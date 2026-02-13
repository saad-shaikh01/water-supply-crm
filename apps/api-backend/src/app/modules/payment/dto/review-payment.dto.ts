import { IsOptional, IsString, MinLength } from 'class-validator';

export class RejectPaymentDto {
  @IsString()
  @MinLength(5)
  reason!: string;
}

export class ApprovePaymentDto {
  @IsOptional()
  @IsString()
  note?: string;
}
