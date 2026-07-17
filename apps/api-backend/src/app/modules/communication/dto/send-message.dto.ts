import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;

  // "Instruction — driver must acknowledge". Ignored for DRIVER senders.
  @IsOptional()
  @IsBoolean()
  requiresAck?: boolean;

  // Which delivery this message is about — Conversation is per-customer now,
  // so every send must say which item it's tagging (drives the ack-gate and
  // the per-message delivery-context chip/link in the thread UI).
  @IsUUID()
  itemId!: string;
}
