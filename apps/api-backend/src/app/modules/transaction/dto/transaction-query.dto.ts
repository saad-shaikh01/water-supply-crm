import { IsOptional, IsUUID, IsEnum, IsDateString, IsString, MaxLength } from 'class-validator';
import { TransactionType, PaymentMode } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class TransactionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsEnum(TransactionType)
  type?: TransactionType;

  /** Filter PAYMENT rows by how the money arrived (cash / cheque / bank transfer). */
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Full-text search across customer name, customer code, and transaction description */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
