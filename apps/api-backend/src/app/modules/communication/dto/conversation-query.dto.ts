import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ConversationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  // Derived filter: DRIVER = last message was from office; OFFICE = last from driver.
  @IsOptional()
  @IsIn(['DRIVER', 'OFFICE'])
  waitingOn?: 'DRIVER' | 'OFFICE';

  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  // Reads `obj`, not `value` — the global ValidationPipe's `enableImplicitConversion`
  // otherwise coerces any non-empty string to `true` before this `@Transform` runs.
  @IsOptional()
  @Transform(({ obj }) => obj.unreadOnly === 'true' || obj.unreadOnly === true)
  unreadOnly?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
