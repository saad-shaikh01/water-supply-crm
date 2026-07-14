import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MessageType } from '@prisma/client';

// Legacy adapter DTO (Communication Center Phase 7 removes it with the
// deprecated /daily-sheets/items/.../notes endpoints).
export class CreateDeliveryNoteDto {
  @IsEnum(MessageType)
  type!: MessageType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;
}
