import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { PaymentAccountKind } from '../../../common/pdf/doc-branding';

/**
 * Documents are drawn with the standard PDF fonts (Helvetica / WinAnsi): Urdu script, emoji and other
 * non-Latin text would print as garbage. Reject it at the API with a clear message.
 */
const PDF_SAFE = /^[\x20-\x7E\xA0-\xFF]*$/;
const PDF_SAFE_MESSAGE = '$property: only English letters, numbers and common symbols are supported on documents';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** '' -> null so the form can clear an optional field. */
const trimOrNull = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

export const PAYMENT_ACCOUNT_KINDS: PaymentAccountKind[] = ['BANK', 'EASYPAISA', 'JAZZCASH', 'RAAST'];

export class PaymentAccountDto {
  @IsIn(PAYMENT_ACCOUNT_KINDS)
  kind!: PaymentAccountKind;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  accountTitle!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^[0-9A-Za-z\- ]{4,40}$/, { message: 'accountNumber must be 4-40 letters, digits, spaces or dashes' })
  accountNumber!: string;

  /** Required for BANK accounts. */
  @ValidateIf((o: PaymentAccountDto) => o.kind === 'BANK')
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'bankName is required for a bank account' })
  @MaxLength(60)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  bankName?: string | null;

  @IsOptional()
  @Transform(({ value }) => {
    const t = trimOrNull({ value });
    return typeof t === 'string' ? t.toUpperCase() : t;
  })
  @Matches(/^[A-Z]{2}[0-9]{2}[0-9A-Z ]{8,30}$/, { message: 'iban looks invalid (e.g. PK36SCBL0000001123456702)' })
  iban?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(60)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  branch?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  note?: string | null;
}

export class UpsertVendorBrandingDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  displayName!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  legalName?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  address?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  phones?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsEmail()
  @MaxLength(120)
  email?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(120)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  website?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  ntn?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(30)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  strn?: string | null;

  /** #RRGGBB — banner gradient dark end. */
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'primaryColor must be a #RRGGBB colour' })
  primaryColor?: string | null;

  /** #RRGGBB — banner gradient light end (derived from primaryColor when omitted). */
  @IsOptional()
  @Transform(trimOrNull)
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'accentColor must be a #RRGGBB colour' })
  accentColor?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  @Matches(PDF_SAFE, { message: PDF_SAFE_MESSAGE })
  invoiceFooter?: string | null;

  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PaymentAccountDto)
  paymentAccounts!: PaymentAccountDto[];
}
