import { IsInt, Min } from 'class-validator';

export class ApproveCrewCashDistributionDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;
}
