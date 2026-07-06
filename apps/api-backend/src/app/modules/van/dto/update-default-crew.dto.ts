import { IsArray, IsEnum, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CrewRole } from '@prisma/client';

export class CrewMemberDto {
  @IsUUID()
  userId!: string;

  @IsEnum(CrewRole)
  role!: CrewRole;
}

/** Full-replace list of the van's default supporting crew (salesman/loaders). */
export class UpdateDefaultCrewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrewMemberDto)
  crew!: CrewMemberDto[];
}
