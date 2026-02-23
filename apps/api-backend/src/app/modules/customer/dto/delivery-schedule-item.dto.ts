import { IsInt, IsOptional, IsUUID, Min, Max } from 'class-validator';

export class DeliveryScheduleItemDto {
  @IsInt()
  @Min(1)
  @Max(6)
  dayOfWeek!: number;

  @IsUUID()
  vanId!: string;

  @IsOptional()
  @IsInt()
  routeSequence?: number;
}
