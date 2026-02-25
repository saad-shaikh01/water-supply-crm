import { IsEnum, IsString, IsOptional, MinLength } from 'class-validator';
import { TicketType, TicketPriority } from '@prisma/client';

export class CreateTicketDto {
  @IsEnum(TicketType)
  type: TicketType;

  @IsString()
  @MinLength(3)
  subject: string;

  @IsString()
  @MinLength(10)
  description: string;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;
}
