import { IsUUID, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CrewMemberDto } from '../../van/dto/update-default-crew.dto';

export class SwapDriverDto {
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;

  /**
   * Full-replace list of the sheet's supporting crew (salesman/loaders).
   * Omit to leave the crew unchanged. Any driver/van/crew change resets
   * crewConfirmed — the crew must be re-confirmed before trips start.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  crew?: CrewMemberDto[];
}
