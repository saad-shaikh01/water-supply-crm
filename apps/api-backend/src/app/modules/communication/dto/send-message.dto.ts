import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  // "Instruction — driver must acknowledge". Ignored for DRIVER senders.
  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;
}
