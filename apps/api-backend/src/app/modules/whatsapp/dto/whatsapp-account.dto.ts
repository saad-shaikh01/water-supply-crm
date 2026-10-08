import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOrUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

const suffixPattern = /^[a-z0-9]{2,20}$/;

/** Credentials of a vendor's own WhatsApp Business (Cloud API) sender. */
export class ConnectWhatsAppAccountDto {
  /** WhatsApp Business Account id (Meta Business Manager -> WhatsApp accounts). */
  @Transform(trim)
  @Matches(/^\d{5,30}$/, { message: 'wabaId must be the numeric WhatsApp Business Account ID' })
  wabaId!: string;

  /** Phone number ID of the sending number (NOT the phone number itself). */
  @Transform(trim)
  @Matches(/^\d{5,30}$/, { message: 'phoneNumberId must be the numeric Phone Number ID' })
  phoneNumberId!: string;

  /** Permanent System User access token. Write-only: never returned by any API. */
  @Transform(trim)
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  @Matches(/^\S+$/, { message: 'accessToken must not contain spaces' })
  accessToken!: string;

  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label?: string;

  /** See UpdateWhatsAppSettingsDto.templateSuffix. */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? (value.trim().toLowerCase() || undefined) : value))
  @Matches(suffixPattern, { message: 'templateSuffix must be 2-20 lowercase letters or digits' })
  templateSuffix?: string;
}

export class UpdateWhatsAppSettingsDto {
  /**
   * Only when several brands share ONE WhatsApp Business Account: this brand's templates are named
   * `<name>_<suffix>` (e.g. delivery_receipt_lorem). null/empty = the plain names.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? (value.trim().toLowerCase() || null) : value))
  @Matches(suffixPattern, { message: 'templateSuffix must be 2-20 lowercase letters or digits' })
  templateSuffix?: string | null;
}

export class LinkWhatsAppAccountDto {
  @IsUUID()
  accountId!: string;
}
