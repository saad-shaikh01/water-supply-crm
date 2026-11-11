import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  challengeToken!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(10, 14)
  recoveryCode?: string;
}

export class EnrollmentTokenDto {
  @IsString()
  enrollmentToken!: string;
}

export class EnrollmentConfirmDto extends EnrollmentTokenDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}

export class DisableTwoFactorDto extends TotpCodeDto {
  @IsString()
  password!: string;
}
