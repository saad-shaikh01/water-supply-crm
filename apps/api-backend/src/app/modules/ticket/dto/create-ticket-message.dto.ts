import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateTicketMessageDto {
  @IsString()
  message: string;

  @IsOptional()
  @IsArray()
  attachments?: Record<string, unknown>[];
}
