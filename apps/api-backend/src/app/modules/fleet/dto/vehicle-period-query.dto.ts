import { IsOptional, IsDateString, IsInt, Min, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';

export class VehiclePeriodQueryDto {
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}

export class VehicleMonthlyReportQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(36) months?: number;
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'endMonth must be YYYY-MM' }) endMonth?: string;
}

export class VehicleOtherExpensesQueryDto extends VehiclePeriodQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
