import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResolveCustomerFlagDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolvedReason?: string;
}
