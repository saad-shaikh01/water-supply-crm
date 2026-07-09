import { IsArray, ArrayMinSize, IsUUID, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class MoveDeliveryItemsDto {
  /** DailySheetItem ids to move — a single-element array is the "move one customer" case. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  itemIds!: string[];

  @IsUUID()
  destinationVanId!: string;

  /** Sheet date to move onto — today or a future date. The destination sheet is auto-created if it doesn't exist yet. */
  @IsDateString()
  destinationDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
