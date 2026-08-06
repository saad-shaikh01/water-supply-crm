import { IsDateString, IsOptional } from 'class-validator';

export class EffectiveSalaryStructureQueryDto {
  /** Defaults to "now" (service-side) when omitted. */
  @IsOptional()
  @IsDateString()
  date?: string;
}
