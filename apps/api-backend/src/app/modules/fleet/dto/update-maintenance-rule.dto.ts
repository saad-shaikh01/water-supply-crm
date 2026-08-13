import { IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class UpdateMaintenanceRuleDto {
  @IsOptional() @IsInt() @Min(0) intervalKm?: number | null;
  @IsOptional() @IsInt() @Min(0) intervalDays?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
