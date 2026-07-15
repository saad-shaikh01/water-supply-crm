import { IsEnum } from 'class-validator';
import { ConversationStatus } from '@prisma/client';

export class UpdateConversationStatusDto {
  @IsEnum(ConversationStatus)
  status!: ConversationStatus;
}
