import { IsDateString, IsIn, IsOptional, Matches } from 'class-validator';

export class ConsumptionQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format' })
  month?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['true'])
  allTime?: string;
}
