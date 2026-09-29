import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ApplyCustomerFlagDto {
  @IsUUID()
  categoryId: string;

  // Optional override of the category's defaultMessage — the "why" shown to
  // staff wherever the badge appears. Falls back to the category's default
  // when omitted; one of the two must end up non-empty (checked in-service).
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  message?: string;
}
