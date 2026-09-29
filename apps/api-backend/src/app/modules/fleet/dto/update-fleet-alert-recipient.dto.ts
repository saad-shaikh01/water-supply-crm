import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateFleetAlertRecipientDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MinLength(7) @MaxLength(20) phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
