import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OfficeCashRemittanceDestination } from '@prisma/client';

/**
 * Records a PENDING OfficeCashRemittance — the office -> owner/CEO/bank cash
 * hop. Vendor-wide (no vanId). `attachmentKey` is a Wasabi object key returned
 * by `POST /van-cash-ledger/remittance/attachment`, uploaded before this call
 * (same two-step pattern as damage-case photos).
 */
export class CreateRemittanceDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  date: string;

  @IsEnum(OfficeCashRemittanceDestination)
  destination: OfficeCashRemittanceDestination;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  destinationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  attachmentKey?: string;
}
