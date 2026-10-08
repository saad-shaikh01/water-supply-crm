import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { Prisma, VendorBranding } from '@prisma/client';
import type { AuthUser } from '@water-supply-crm/types';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { evaluateGate, isLegacyVendor } from '../../common/tenant-gate/legacy-vendor-gate';
import {
  BrandImage,
  DocBranding,
  PaymentAccount,
  PaymentAccountKind,
  lightenHex,
  neutralBranding,
} from '../../common/pdf/doc-branding';
import { LEGACY_DOC_BRANDING } from '../../common/pdf/legacy-dasani-branding';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { PAYMENT_ACCOUNT_KINDS, UpsertVendorBrandingDto } from './dto/vendor-branding.dto';

/** Sentinel stored in logoKey/iconKey for the Dasani backfill: use the bundled Blue Ice asset. */
export const BUILTIN_LOGO_KEY = 'builtin:blue-ice';

export type BrandingImageKind = 'logo' | 'icon';

const DOC_CACHE_TTL_MS = 60_000;
const LOGO_CACHE_MAX = 20;
const MAX_IMAGE_BYTES = 1024 * 1024; // 1 MB — logos are drawn at < 130 pt
const DEFAULT_DARK = '#0d0d5e'; // BRAND_GRADIENT.dark — used when only an accent colour is set

export interface PortalBranding {
  slug: string;
  name: string;
  logoUrl: string | null;
  builtinLogo: boolean;
  primaryColor: string | null;
  accentColor: string | null;
}

export interface BrandingView {
  exists: boolean;
  branding: (Omit<VendorBranding, 'paymentAccounts' | 'createdAt' | 'updatedAt'> & {
    paymentAccounts: PaymentAccount[];
    updatedAt: Date;
  }) | null;
  /** What the form can pre-fill on first use. */
  suggested: { displayName: string; address: string | null };
  vendor: { id: string; name: string };
  logoUrl: string | null;
  iconUrl: string | null;
  /** Required-for-go-live fields that are still empty. */
  missing: string[];
}

function isPaymentAccount(a: unknown): a is PaymentAccount {
  if (!a || typeof a !== 'object') return false;
  const o = a as Record<string, unknown>;
  return (
    PAYMENT_ACCOUNT_KINDS.includes(o['kind'] as PaymentAccountKind) &&
    typeof o['accountTitle'] === 'string' &&
    typeof o['accountNumber'] === 'string'
  );
}

export function parsePaymentAccounts(json: unknown): PaymentAccount[] {
  return Array.isArray(json) ? json.filter(isPaymentAccount) : [];
}

/** Fields a vendor must have before going live (docs §7). */
export function missingRequired(row: { displayName?: string | null; address?: string | null; phones?: string | null; paymentAccounts?: unknown } | null): string[] {
  const missing: string[] = [];
  if (!row?.displayName?.trim()) missing.push('displayName');
  if (!row?.address?.trim()) missing.push('address');
  if (!row?.phones?.trim()) missing.push('phones');
  if (!parsePaymentAccounts(row?.paymentAccounts).length) missing.push('paymentAccounts');
  return missing;
}

function sniffImage(buf: Buffer): 'png' | 'jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

type BrandingRowLike = Pick<
  VendorBranding,
  'displayName' | 'legalName' | 'address' | 'phones' | 'email' | 'website' | 'ntn' | 'strn' | 'logoKey' | 'iconKey' | 'primaryColor' | 'accentColor' | 'invoiceFooter'
> & { paymentAccounts: unknown };

@Injectable()
export class VendorBrandingService {
  private readonly logger = new Logger(VendorBrandingService.name);
  private readonly docCache = new Map<string, { at: number; value: DocBranding }>();
  private readonly imageCache = new Map<string, Buffer>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly statementPdf: CustomerStatementPdfService,
    private readonly receiptPdf: DeliveryReceiptPdfService,
  ) {}

  // ── Read / write (company profile screens) ────────────────────────────────

  async get(vendorId: string): Promise<BrandingView> {
    const vendor = await this.requireVendor(vendorId);
    const row = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });
    return {
      exists: !!row,
      branding: row ? { ...row, paymentAccounts: parsePaymentAccounts(row.paymentAccounts) } : null,
      suggested: { displayName: vendor.name, address: vendor.address },
      vendor: { id: vendor.id, name: vendor.name },
      logoUrl: await this.signedImageUrl(row?.logoKey),
      iconUrl: await this.signedImageUrl(row?.iconKey),
      missing: missingRequired(row),
    };
  }

  async upsert(vendorId: string, dto: UpsertVendorBrandingDto, actor: AuthUser): Promise<BrandingView> {
    await this.requireVendor(vendorId);
    const before = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });

    const data = {
      displayName: dto.displayName,
      legalName: dto.legalName ?? null,
      address: dto.address ?? null,
      phones: dto.phones ?? null,
      email: dto.email ?? null,
      website: dto.website ?? null,
      ntn: dto.ntn ?? null,
      strn: dto.strn ?? null,
      primaryColor: dto.primaryColor ?? null,
      accentColor: dto.accentColor ?? null,
      invoiceFooter: dto.invoiceFooter ?? null,
      paymentAccounts: this.cleanAccounts(dto.paymentAccounts) as unknown as Prisma.InputJsonValue,
      updatedById: actor.userId,
    };
    await this.prisma.vendorBranding.upsert({
      where: { vendorId },
      create: { vendorId, ...data },
      update: data,
    });
    this.docCache.delete(vendorId);

    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: before ? 'UPDATE' : 'CREATE',
      entity: 'VendorBranding',
      entityId: vendorId,
      changes: { before: before ? this.auditShape(before) : undefined, after: this.auditShape({ ...data, logoKey: before?.logoKey ?? null, iconKey: before?.iconKey ?? null }) },
    });
    return this.get(vendorId);
  }

  async setImage(vendorId: string, kind: BrandingImageKind, file: { buffer: Buffer; originalname: string; size: number }, actor: AuthUser): Promise<BrandingView> {
    const vendor = await this.requireVendor(vendorId);
    const row = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });
    if (file.size > MAX_IMAGE_BYTES || file.buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException('Image is too large — maximum 1 MB');
    }
    const type = sniffImage(file.buffer);
    if (!type) throw new BadRequestException('Only PNG or JPEG images are supported (documents cannot print WebP/SVG)');

    // Documents read the logo through the cache by key; a fresh key per upload means no stale reads.
    const { key } = await this.storage.upload(`vendor-branding/${kind}`, file.buffer, `${kind}.${type === 'png' ? 'png' : 'jpg'}`, type === 'png' ? 'image/png' : 'image/jpeg', vendorId);
    const field = kind === 'logo' ? 'logoKey' : 'iconKey';
    if (row) {
      await this.prisma.vendorBranding.update({ where: { vendorId }, data: { [field]: key, updatedById: actor.userId } });
    } else {
      // First touch is an image upload: create the row from the vendor's own name so the logo is not lost.
      await this.prisma.vendorBranding.create({
        data: { vendorId, displayName: vendor.name, address: vendor.address, [field]: key, updatedById: actor.userId, paymentAccounts: [] },
      });
    }
    this.docCache.delete(vendorId);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'UPDATE', entity: 'VendorBranding', entityId: vendorId, changes: { after: { [field]: key } } });
    return this.get(vendorId);
  }

  async removeImage(vendorId: string, kind: BrandingImageKind, actor: AuthUser): Promise<BrandingView> {
    await this.requireVendor(vendorId);
    const field = kind === 'logo' ? 'logoKey' : 'iconKey';
    const row = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });
    if (row && row[field]) {
      await this.prisma.vendorBranding.update({ where: { vendorId }, data: { [field]: null, updatedById: actor.userId } });
      this.docCache.delete(vendorId);
      await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'UPDATE', entity: 'VendorBranding', entityId: vendorId, changes: { before: { [field]: row[field] }, after: { [field]: null } } });
    }
    return this.get(vendorId);
  }

  // ── Preview (draft, not saved) ────────────────────────────────────────────

  /** Renders a sample statement / receipt from the DRAFT form values, so a vendor sees what customers will get. */
  async preview(vendorId: string, dto: UpsertVendorBrandingDto, doc: 'statement' | 'receipt'): Promise<Buffer> {
    await this.requireVendor(vendorId);
    const saved = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });
    const branding = await this.toDocBranding({
      displayName: dto.displayName,
      legalName: dto.legalName ?? null,
      address: dto.address ?? null,
      phones: dto.phones ?? null,
      email: dto.email ?? null,
      website: dto.website ?? null,
      ntn: dto.ntn ?? null,
      strn: dto.strn ?? null,
      logoKey: saved?.logoKey ?? null,
      iconKey: saved?.iconKey ?? null,
      primaryColor: dto.primaryColor ?? null,
      accentColor: dto.accentColor ?? null,
      invoiceFooter: dto.invoiceFooter ?? null,
      paymentAccounts: this.cleanAccounts(dto.paymentAccounts),
    });

    if (doc === 'receipt') {
      return this.receiptPdf.generate(
        {
          customerName: 'Sample Customer', customerCode: 'L0001', productName: '19L Bottle', van: 'V1',
          filledDropped: 2, emptyReceived: 2, cashCollected: 200, pricePerBottle: 240,
          financialBalanceAfter: 280, bottleBalanceAfter: 2, deliveryDate: new Date().toISOString().slice(0, 10),
          deliveryTime: '10:30', vendorName: branding.name, depositCash: 0, depositBottles: 0,
        },
        branding,
      );
    }
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.statementPdf.generate({
      customer: { name: 'Sample Customer', customerCode: 'L0001', address: 'House 1, Street 2, Sample Town', phoneNumber: '923001234567', paymentType: 'MONTHLY' },
      transactions: [
        { id: 's1', type: 'DELIVERY', amount: 480, createdAt: new Date(now.getFullYear(), now.getMonth(), 3, 10), filledDropped: 2, emptyReceived: 2, description: 'Delivery', product: { name: '19L Bottle' }, dailySheetItem: { bottleBalanceAfter: 2 } },
        { id: 's2', type: 'PAYMENT', amount: -200, createdAt: new Date(now.getFullYear(), now.getMonth(), 10, 10), description: 'Cash payment', product: null, dailySheetItem: null },
      ],
      openingBalance: 0, closingBalance: 280, period: 'Sample statement', month, ratePerBottle: 240, branding,
    });
  }

  // ── Customer portal ───────────────────────────────────────────────────────

  /**
   * What the customer portal may show about a vendor: brand name, logo and colours — nothing private.
   * `builtinLogo` = the portal's own bundled Blue Ice artwork applies (Dasani only).
   */
  async publicBrandingForVendor(vendorId: string): Promise<PortalBranding | null> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { slug: true, name: true, isActive: true, branding: true },
    });
    if (!vendor || !vendor.isActive) return null;
    const b = vendor.branding;
    return {
      slug: vendor.slug,
      name: b?.displayName ?? vendor.name,
      logoUrl: b?.logoKey && b.logoKey !== BUILTIN_LOGO_KEY ? await this.signedImageUrl(b.logoKey) : null,
      // No profile row but on the legacy allow-list (Blue Ice): keep the portal's bundled artwork, never a bare name.
      builtinLogo: b ? b.logoKey === BUILTIN_LOGO_KEY : isLegacyVendor(vendorId),
      primaryColor: b?.primaryColor ?? null,
      accentColor: b?.accentColor ?? null,
    };
  }

  async publicBrandingBySlug(slug: string): Promise<PortalBranding | null> {
    const vendor = await this.prisma.vendor.findUnique({ where: { slug }, select: { id: true } });
    return vendor ? this.publicBrandingForVendor(vendor.id) : null;
  }

  /** The payment accounts a customer may be shown in the portal (no internal notes). */
  async portalPaymentAccounts(vendorId: string): Promise<Array<Pick<PaymentAccount, 'kind' | 'accountTitle' | 'accountNumber' | 'bankName' | 'iban' | 'branch'>>> {
    const row = await this.prisma.vendorBranding.findUnique({ where: { vendorId }, select: { paymentAccounts: true } });
    return parsePaymentAccounts(row?.paymentAccounts).map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle,
      accountNumber: a.accountNumber,
      bankName: a.bankName ?? null,
      iban: a.iban ?? null,
      branch: a.branch ?? null,
    }));
  }

  // ── Resolution for documents ──────────────────────────────────────────────

  /**
   * The identity every customer-facing PDF for this vendor is drawn from.
   *  - vendor has a VendorBranding row            -> that row
   *  - no row, vendor on the legacy allow-list /
   *    gate not enforcing (default `shadow`)      -> the legacy Dasani values (so Blue Ice can never degrade)
   *  - no row, gate enforcing, other vendor       -> neutral: its own name + address only, no payment block
   * Never throws: a failure falls back the same way (and is not cached).
   */
  async resolveForDocs(vendorId: string | null | undefined, fallbackName?: string | null): Promise<DocBranding> {
    if (vendorId) {
      const hit = this.docCache.get(vendorId);
      if (hit && Date.now() - hit.at < DOC_CACHE_TTL_MS) return hit.value;
    }

    let row: VendorBranding | null = null;
    let cacheable = true;
    if (vendorId) {
      try {
        row = await this.prisma.vendorBranding.findUnique({ where: { vendorId } });
      } catch (err) {
        cacheable = false;
        this.logger.warn(`Could not read VendorBranding for ${vendorId}: ${(err as Error).message}`);
      }
    }

    let value: DocBranding;
    if (row) {
      value = await this.toDocBranding(row);
    } else if (!evaluateGate(vendorId, 'pdf.branding').blocked) {
      value = LEGACY_DOC_BRANDING;
    } else {
      let name = fallbackName ?? '';
      let address: string | null = null;
      if (vendorId) {
        try {
          const v = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true, address: true } });
          if (v) {
            name = v.name;
            address = v.address;
          }
        } catch (err) {
          cacheable = false;
          this.logger.warn(`Could not load vendor ${vendorId} for document branding: ${(err as Error).message}`);
        }
      }
      value = neutralBranding(name, address);
    }

    if (vendorId && cacheable) this.docCache.set(vendorId, { at: Date.now(), value });
    return value;
  }

  /** Row (or draft) -> render-ready branding. Image download failures degrade to "no logo", never to an error. */
  async toDocBranding(row: BrandingRowLike): Promise<DocBranding> {
    const accounts = parsePaymentAccounts(row.paymentAccounts);
    const tax = [row.ntn ? `NTN: ${row.ntn}` : null, row.strn ? `STRN: ${row.strn}` : null].filter(Boolean).join('  ·  ');

    let gradient: DocBranding['gradient'] = null;
    if (row.primaryColor) gradient = { dark: row.primaryColor, light: row.accentColor ?? lightenHex(row.primaryColor) };
    else if (row.accentColor) gradient = { light: row.accentColor, dark: DEFAULT_DARK };

    const logo = await this.loadImage(row.logoKey);
    const icon = await this.loadImage(row.iconKey);
    return {
      name: row.displayName,
      payTo: row.legalName?.trim() || row.displayName,
      address: row.address,
      phones: row.phones,
      email: row.email,
      website: row.website,
      taxLine: tax || null,
      logo,
      icon,
      gradient,
      paymentAccounts: accounts,
      footerNote: row.invoiceFooter,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private async loadImage(key: string | null | undefined): Promise<BrandImage> {
    if (!key) return null;
    if (key === BUILTIN_LOGO_KEY) return 'builtin';
    const cached = this.imageCache.get(key);
    if (cached) return cached;
    try {
      const buf = await this.storage.getObjectBuffer(key);
      if (!sniffImage(buf)) return null;
      this.imageCache.set(key, buf);
      if (this.imageCache.size > LOGO_CACHE_MAX) {
        const oldest = this.imageCache.keys().next().value;
        if (oldest !== undefined) this.imageCache.delete(oldest);
      }
      return buf;
    } catch (err) {
      this.logger.warn(`Could not load branding image ${key}: ${(err as Error).message}`);
      return null;
    }
  }

  private async signedImageUrl(key: string | null | undefined): Promise<string | null> {
    if (!key || key === BUILTIN_LOGO_KEY) return null;
    try {
      return await this.storage.getSignedUrl(key, 900);
    } catch {
      return null;
    }
  }

  private cleanAccounts(accounts: PaymentAccount[]): PaymentAccount[] {
    return accounts.map((a) => ({
      kind: a.kind,
      accountTitle: a.accountTitle,
      accountNumber: a.accountNumber,
      ...(a.bankName ? { bankName: a.bankName } : {}),
      ...(a.iban ? { iban: a.iban } : {}),
      ...(a.branch ? { branch: a.branch } : {}),
      ...(a.note ? { note: a.note } : {}),
    }));
  }

  private auditShape(r: Record<string, unknown>) {
    const { createdAt: _c, updatedAt: _u, vendorId: _v, ...rest } = r;
    return rest;
  }

  private async requireVendor(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, address: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }
}
