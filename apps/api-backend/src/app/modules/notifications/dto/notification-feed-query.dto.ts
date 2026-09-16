import { IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class NotificationFeedQueryDto extends PaginationQueryDto {
  // Reads `obj`, not `value` — the global ValidationPipe's `enableImplicitConversion`
  // otherwise coerces any non-empty string to `true` before this `@Transform` runs.
  @IsOptional()
  @IsBoolean()
  @Transform(({ obj }) => obj.isRead === 'true' || obj.isRead === true)
  isRead?: boolean;
}
