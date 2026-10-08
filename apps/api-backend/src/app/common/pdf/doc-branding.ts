import { Logger } from '@nestjs/common';
import { evaluateGate } from '../tenant-gate/legacy-vendor-gate';

/**
 * P0 stop-gap branding for customer-facing PDFs (statement, delivery receipt).
 * See docs/features/multi-vendor-branding-and-whatsapp.md §4 and §8 (P0 -> replaced by
 * VendorBranding in P1).
 *
 * `legacy: true`  -> the PDF keeps its existing hardcoded Dasani/Blue Ice identity, logo and
 *                    payment details (byte-for-byte what it printed before this change).
 * `legacy: false` -> the PDF is vendor-neutral: only the vendor's own name (+ address when set),
 *                    NO logo/watermark, NO phones/website/email and NO payment-account block
 *                    (another vendor's customers must never be told to pay Dasani's account).
 *
 * Omitting `branding` entirely (specs, debug scripts) is equivalent to `legacy: true`.
 */
export interface DocBranding {
  legacy: boolean;
  /** Vendor display name — only used when `legacy` is false. */
  name: string;
  address?: string | null;
}

export const LEGACY_DOC_BRANDING: DocBranding = { legacy: true, name: '' };

const logger = new Logger('DocBranding');

/** Structural slice of PrismaService — keeps this helper free of Prisma's generic overloads. */
interface VendorReader {
  vendor: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique(args: any): Promise<{ name: string; address: string | null } | null>;
  };
}

/**
 * Decide the branding for a vendor's document. In the default `shadow` gate mode (and `off`)
 * every vendor keeps the legacy identity and the would-be change is only logged; in `enforce`
 * mode only vendors in WHATSAPP_ALLOWED_VENDOR_IDS keep it.
 */
export async function resolveDocBranding(
  prisma: VendorReader,
  vendorId: string | null | undefined,
  fallbackName?: string | null,
): Promise<DocBranding> {
  if (!evaluateGate(vendorId, 'pdf.branding').blocked) return LEGACY_DOC_BRANDING;

  let name = fallbackName ?? '';
  let address: string | null = null;
  if (vendorId) {
    try {
      const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true, address: true } });
      if (vendor) {
        name = vendor.name;
        address = vendor.address;
      }
    } catch (err) {
      logger.warn(`Could not load vendor ${vendorId} for document branding: ${(err as Error).message}`);
    }
  }
  return { legacy: false, name, address };
}
