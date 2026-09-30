import { IsOptional, IsString, IsIn, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class NotificationLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['WHATSAPP', 'SMS', 'FCM', 'IN_APP'])
  channel?: string;

  @IsOptional()
  @IsIn(['SENT', 'FAILED', 'SKIPPED'])
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
  search?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Van whose delivery sheets the log's delivery item belongs to. */
  @IsOptional()
  @IsString()
  vanId?: string;

  /** One specific daily sheet. */
  @IsOptional()
  @IsString()
  dailySheetId?: string;

  /** Delivery date (YYYY-MM-DD) of the daily sheet the send belongs to. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  sheetDate?: string;

  /** Full history for one customer. */
  @IsOptional()
  @IsString()
  customerId?: string;

  /** Grouped failure reason, matched against lastError. */
  @IsOptional()
  @IsIn(['DISABLED', 'NOT_DELIVERED', 'API_ERROR'])
  errorCategory?: string;
}
