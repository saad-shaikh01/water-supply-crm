import { IsDateString } from 'class-validator';

export class ScheduleQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
