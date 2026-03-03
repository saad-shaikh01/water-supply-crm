import { IsOptional, IsEnum, IsString, IsDateString } from 'class-validator';
import { PaymentMethod, PaymentRequestStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentRequestStatus)
  status?: PaymentRequestStatus;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
