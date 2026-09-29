import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFleetAlertRecipientDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;

  // Any format the office would naturally type — normalized server-side via
  // whatsapp/phone.util.ts (normalizePhone) and validated as sendable before save.
  @IsString() @MinLength(7) @MaxLength(20) phone: string;
}
