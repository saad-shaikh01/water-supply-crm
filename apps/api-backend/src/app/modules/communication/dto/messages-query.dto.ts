import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
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

  // Narrows DRIVER read access to the item-scoped check (see
  // ConversationService.resolveConversationForRead) instead of the
  // history-based fallback. The frontend always has this in scope.
  @IsOptional()
  @IsUUID()
  itemId?: string;
}
