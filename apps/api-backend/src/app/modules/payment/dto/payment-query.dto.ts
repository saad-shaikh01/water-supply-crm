import { IsOptional, IsEnum, IsString } from 'class-validator';
import { PaymentRequestStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentRequestStatus)
  status?: PaymentRequestStatus;

  @IsOptional()
  @IsString()
  customerId?: string;
}
