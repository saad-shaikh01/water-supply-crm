import { IsUUID, Matches } from 'class-validator';

export class GetRouteHistoryQueryDto {
  @IsUUID()
  driverId: string;

  /** "YYYY-MM-DD" only — parsed as local calendar day, not a full ISO datetime. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be in YYYY-MM-DD format' })
  date: string;
}
