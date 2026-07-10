import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class BulkScheduleUpdateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  customerIds!: string[];

  /** Reassign all selected customers' delivery schedule rows to this van. */
  @IsOptional()
  @IsUUID()
  vanId?: string;

  /** Replace each selected customer's entire delivery schedule with a single entry on this day. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  dayOfWeek?: number;
}
