import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CloneRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
