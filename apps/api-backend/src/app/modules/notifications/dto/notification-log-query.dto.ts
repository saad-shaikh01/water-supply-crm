import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class NotificationLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['WHATSAPP', 'SMS', 'FCM', 'IN_APP'])
  channel?: string;

  @IsOptional()
  @IsIn(['SENT', 'FAILED'])
  status?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'USER'])
  recipientType?: string;

  @IsOptional()
  @IsString()
  recipientId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}
