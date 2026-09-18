import { IsString, MaxLength, MinLength } from 'class-validator';

// Rename only — the stable `key` (stored on rules/records) never changes.
export class UpdateServiceTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label: string;
}
