import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { NoteType } from '@prisma/client';

export class CreateDeliveryNoteDto {
  @IsEnum(NoteType)
  type!: NoteType;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;
}
