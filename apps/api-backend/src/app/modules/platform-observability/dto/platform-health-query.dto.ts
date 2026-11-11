import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class HealthQueryDto {
  @IsOptional() @IsBooleanString() refresh?: string;
}

export class FailedJobsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
