import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Delivery Issues Phase 3 — bulk entry point into the exact same
 * plan()+moveDeliveryItems() flow the single Plan dialog now uses (Phase 2).
 * Not a second scheduling system: this DTO only carries what
 * DailySheetService.moveDeliveryItems() itself needs (itemIds/van/date),
 * mapped from issue ids to their dailySheetItemId server-side.
 */
export class BulkScheduleIssuesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  issueIds!: string[];

  @IsUUID()
  destinationVanId!: string;

  @IsDateString()
  destinationDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  notes?: string;
}
