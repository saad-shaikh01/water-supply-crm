import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@water-supply-crm/database';
import type { AuthUser } from '@water-supply-crm/types';
import { AuditService } from '../audit/audit.service';
import { WhatsAppAccountService } from '../whatsapp/whatsapp-account.service';
import { missingRequired } from '../vendor-branding/vendor-branding.service';

export type ReadinessStatus = 'DONE' | 'TODO' | 'WARN';

export interface ReadinessItem {
  key: string;
  label: string;
  /** Must be DONE before the vendor can go live. */
  required: boolean;
  status: ReadinessStatus;
  detail: string;
  /** Dashboard route that fixes it. */
  link: string;
}

export interface ReadinessView {
  vendor: { id: string; name: string };
  live: boolean;
  goLiveAt: Date | null;
  /** Every required item is DONE. */
  ready: boolean;
  items: ReadinessItem[];
}

/**
 * Computed (never stored) "ready to go live" checklist for a vendor — docs §7. Going live is the
 * vendor admin's explicit act; until then (and while the gate enforces) no customer-facing WhatsApp leaves.
 */
@Injectable()
export class VendorReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: WhatsAppAccountService,
    private readonly audit: AuditService,
  ) {}

  async get(vendorId: string): Promise<ReadinessView> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, goLiveAt: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const [branding, products, vans, routes, customers, waView, templates] = await Promise.all([
      this.prisma.vendorBranding.findUnique({ where: { vendorId } }),
      this.prisma.product.count({ where: { vendorId, isActive: true } }),
      this.prisma.van.count({ where: { vendorId, isActive: true } }),
      this.prisma.route.count({ where: { vendorId } }),
      this.prisma.customer.count({ where: { vendorId, isActive: true } }),
      this.accounts.getView(vendorId),
      this.accounts.getTemplates(vendorId),
    ]);

    const missing = missingRequired(branding);
    const profileMissing = missing.filter((m) => m !== 'paymentAccounts');
    const items: ReadinessItem[] = [
      {
        key: 'company_profile',
        label: 'Company profile',
        required: true,
        status: profileMissing.length === 0 ? 'DONE' : 'TODO',
        detail: profileMissing.length === 0 ? 'Name, address and phone are set.' : `Missing: ${profileMissing.map((m) => ({ displayName: 'company name', address: 'address', phones: 'phone number' } as Record<string, string>)[m] ?? m).join(', ')}.`,
        link: '/dashboard/company-profile',
      },
      {
        key: 'payment_accounts',
        label: 'Payment accounts',
        required: true,
        status: missing.includes('paymentAccounts') ? 'TODO' : 'DONE',
        detail: missing.includes('paymentAccounts')
          ? 'Add at least one bank / wallet / Raast account — customers are told to pay there.'
          : 'Printed on statements and receipts.',
        link: '/dashboard/company-profile',
      },
      {
        key: 'products',
        label: 'Products',
        required: true,
        status: products > 0 ? 'DONE' : 'TODO',
        detail: products > 0 ? `${products} active product${products > 1 ? 's' : ''}.` : 'Add the products you deliver.',
        link: '/dashboard/products',
      },
      {
        key: 'vans_routes',
        label: 'Vans & routes',
        required: false,
        status: vans > 0 && routes > 0 ? 'DONE' : 'WARN',
        detail: `${vans} van${vans === 1 ? '' : 's'}, ${routes} route${routes === 1 ? '' : 's'}.`,
        link: '/dashboard/vans',
      },
      {
        key: 'customers',
        label: 'Customers',
        required: false,
        status: customers > 0 ? 'DONE' : 'WARN',
        detail: customers > 0 ? `${customers} active customer${customers > 1 ? 's' : ''}.` : 'Import your customers and opening balances (Data Import).',
        link: '/dashboard/data-import',
      },
      {
        key: 'whatsapp_connected',
        label: 'WhatsApp number',
        required: true,
        status: waView.account?.status === 'READY' ? 'DONE' : 'TODO',
        detail: waView.account
          ? waView.account.status === 'READY'
            ? `Connected${waView.account.displayNumber ? ` (${waView.account.displayNumber})` : ''}.`
            : `The connection needs attention (${waView.account.status.toLowerCase().replace('_', ' ')}).`
          : 'Connect your own WhatsApp Business number so customers hear from your business.',
        link: '/dashboard/settings/whatsapp',
      },
      {
        key: 'whatsapp_templates',
        label: 'WhatsApp templates approved',
        required: true,
        status: templates.hasAccount && templates.syncedAt && templates.approvedRequired === templates.totalRequired ? 'DONE' : 'TODO',
        detail: !templates.hasAccount
          ? 'Connect WhatsApp first.'
          : !templates.syncedAt
            ? 'Create the message templates in Meta, then press "Refresh status".'
            : `${templates.approvedRequired} of ${templates.totalRequired} required templates approved.`,
        link: '/dashboard/settings/whatsapp',
      },
    ];

    return {
      vendor: { id: vendor.id, name: vendor.name },
      live: !!vendor.goLiveAt,
      goLiveAt: vendor.goLiveAt,
      ready: items.filter((i) => i.required).every((i) => i.status === 'DONE'),
      items,
    };
  }

  /** The vendor admin's explicit "Go live". Refused while a required item is open (platform admin may force). */
  async goLive(vendorId: string, actor: AuthUser, opts: { force?: boolean } = {}): Promise<ReadinessView> {
    const view = await this.get(vendorId);
    if (view.live) return view;
    if (!view.ready && !opts.force) {
      throw new ConflictException({
        message: 'Finish the required checklist items before going live.',
        open: view.items.filter((i) => i.required && i.status !== 'DONE').map((i) => i.key),
      });
    }
    await this.prisma.vendor.update({ where: { id: vendorId }, data: { goLiveAt: new Date() } });
    this.accounts.invalidate(vendorId);
    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: 'GO_LIVE',
      entity: 'Vendor',
      entityId: vendorId,
      changes: { after: { goLiveAt: 'now', forced: !!opts.force && !view.ready } },
    });
    return this.get(vendorId);
  }

  /** Platform admin: take a vendor back to "not live" (customer WhatsApp stops while the gate enforces). */
  async goOffline(vendorId: string, actor: AuthUser): Promise<ReadinessView> {
    await this.get(vendorId);
    await this.prisma.vendor.update({ where: { id: vendorId }, data: { goLiveAt: null } });
    this.accounts.invalidate(vendorId);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'GO_OFFLINE', entity: 'Vendor', entityId: vendorId });
    return this.get(vendorId);
  }

  /** Platform admin overview: every active vendor with how far along it is. */
  async overview() {
    const vendors = await this.prisma.vendor.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    const rows = [];
    for (const v of vendors) {
      const r = await this.get(v.id);
      const required = r.items.filter((i) => i.required);
      rows.push({
        vendor: r.vendor,
        live: r.live,
        ready: r.ready,
        requiredDone: required.filter((i) => i.status === 'DONE').length,
        requiredTotal: required.length,
        open: required.filter((i) => i.status !== 'DONE').map((i) => i.key),
      });
    }
    return rows;
  }
}
