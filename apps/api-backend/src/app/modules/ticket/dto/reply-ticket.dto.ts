import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { TicketStatus } from '@prisma/client';

export class ReplyTicketDto {
  @IsString()
  @IsNotEmpty()
  vendorReply: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;
}
