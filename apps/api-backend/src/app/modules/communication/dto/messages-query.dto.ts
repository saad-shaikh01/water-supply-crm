import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class MessagesQueryDto {
  // Cursor: return messages strictly older than this timestamp.
  @IsOptional()
  @IsISO8601()
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}
