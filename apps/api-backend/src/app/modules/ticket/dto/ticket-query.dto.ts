import { IsOptional, IsEnum } from 'class-validator';
import { TicketType, TicketStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class TicketQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(TicketType)
  type?: TicketType;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
