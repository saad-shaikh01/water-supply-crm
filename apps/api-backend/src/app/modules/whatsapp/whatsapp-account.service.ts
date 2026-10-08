import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { JOB_NAMES, QUEUE_NAMES } from '@water-supply-crm/queue';
import type { AuthUser } from '@water-supply-crm/types';
import type { WhatsAppAccount, WhatsAppAccountStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { evaluateGate, gateMode, isBlocked, isLegacyVendor } from '../../common/tenant-gate/legacy-vendor-gate';
import { SecretBoxError, openSecret, sealSecret, secretKeyConfigured } from '../../common/crypto/secret-box';
import { IWhatsAppProvider, WHATSAPP_PROVIDER, WhatsAppCredentials } from './providers/whatsapp-provider.interface';
import { ConnectWhatsAppAccountDto, UpdateWhatsAppSettingsDto } from './dto/whatsapp-account.dto';
import { TEMPLATE_CATALOG, renderTemplateBody, templateNameFor } from './templates/template-catalog';

/** How a send leaves the building. */
export interface WhatsAppRoute {
  /** undefined => the platform (env) credentials — the legacy single-number path. */
  creds?: WhatsAppCredentials;
  source: 'ACCOUNT' | 'PLATFORM';
  /** Set when source = ACCOUNT. */
  accountId?: string;
  /** Brand suffix for template names on a shared WABA (null = plain names). */
  templateSuffix?: string | null;
}

interface VendorLookup {
  /** The vendor pressed "Go live" (or predates the onboarding flow). */
  live: boolean;
  account: ReadyAccount | null;
}

interface ReadyAccount {
  creds: WhatsAppCredentials;
  accountId: string;
  templateSuffix: string | null;
}

export interface WhatsAppAccountView {
  /** WHATSAPP_ENABLED — the platform-wide master switch. */
  masterEnabled: boolean;
  /** Can this server store tokens at all (WHATSAPP_TOKEN_KEY set)? */
  keyConfigured: boolean;
  /** Are platform-level (env) credentials present — lets a super admin adopt them for a vendor. */
  platformCredentials: boolean;
  account: null | {
    id: string;
    label: string;
    wabaId: string | null;
    phoneNumberId: string | null;
    displayNumber: string | null;
    verifiedName: string | null;
    status: WhatsAppAccountStatus;
    qualityRating: string | null;
    lastHealthCheckAt: Date | null;
    lastHealthError: string | null;
    hasToken: boolean;
    templateSuffix: string | null;
    templatesSyncedAt: Date | null;
    /** Other vendors using the same sender (names are for the platform admin only). */
    sharedWith: Array<{ id: string; name: string }>;
    sharedCount: number;
  };
  /** Would a customer message for this vendor actually be sent right now? */
  sending: { allowed: boolean; via: 'ACCOUNT' | 'PLATFORM' | 'NONE' };
  /** The vendor may replace the credentials itself (false for a shared sender — platform admin only). */
  canEdit: boolean;
}

const READY_CACHE_TTL_MS = 60_000;
const HEALTH_CRON = '10 3 * * *';
const HEALTH_TZ = 'Asia/Karachi';
const HEALTH_JOB_ID = 'whatsapp-account-health';

@Injectable()
export class WhatsAppAccountService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppAccountService.name);
  private readonly readyCache = new Map<string, { at: number; found: VendorLookup | null }>();
  private readonly templateCache = new Map<string, { at: number; byName: Map<string, string> | null }>();
  private lastDecryptWarn = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: IWhatsAppProvider,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE_NAMES.WHATSAPP_HEALTH) private readonly healthQueue: Queue,
  ) {}

  async onModuleInit() {
    try {
      await this.healthQueue.upsertJobScheduler(
        HEALTH_JOB_ID,
        { pattern: HEALTH_CRON, tz: HEALTH_TZ },
        { name: JOB_NAMES.WHATSAPP_ACCOUNT_HEALTH, opts: { removeOnComplete: 30, removeOnFail: 20 } },
      );
      this.logger.log(`WhatsApp account health check scheduled (${HEALTH_CRON} ${HEALTH_TZ})`);
    } catch (err) {
      this.logger.error(`Failed to schedule WhatsApp account health check: ${(err as Error)?.message ?? String(err)}`);
    }
  }

  // ── Routing (used by WhatsAppService on every send) ────────────────────────

  /**
   * Which credentials may this vendor's message use?
   *  1. the vendor's own READY account                      -> that account
   *  2. otherwise, if the P0 gate lets the vendor through
   *     (default `shadow`, `off`, or the legacy allow-list)  -> the platform env credentials
   *  3. otherwise                                             -> null (blocked, never silently borrowed)
   * A broken/undecryptable account therefore degrades Blue Ice to the env path but never opens the platform
   * number to anyone else.
   */
  async routeFor(vendorId: string | null | undefined, feature: string, quiet = false): Promise<WhatsAppRoute | null> {
    const found = vendorId ? await this.lookup(vendorId) : null;
    if (vendorId && found && this.notLive(vendorId, found)) {
      if (!quiet) this.logNotLive(vendorId, feature);
      return null;
    }
    const acct = found?.account;
    if (acct) return { creds: acct.creds, source: 'ACCOUNT', accountId: acct.accountId, templateSuffix: acct.templateSuffix };
    const blocked = quiet ? isBlocked(vendorId) : evaluateGate(vendorId, feature).blocked;
    if (!blocked) return { source: 'PLATFORM' };
    return null;
  }

  /** Side-effect-free twin of routeFor (no gate logging) — for "can this vendor send at all?" checks. */
  async canSend(vendorId: string | null | undefined): Promise<boolean> {
    const found = vendorId ? await this.lookup(vendorId) : null;
    if (vendorId && found && this.notLive(vendorId, found)) return false;
    if (found?.account) return true;
    return !isBlocked(vendorId);
  }

  /**
   * Customer-facing WhatsApp stays off until the vendor goes live — but only while the gate ENFORCES
   * (default `shadow` changes nothing) and never for the legacy allow-list (Blue Ice).
   */
  private notLive(vendorId: string, found: VendorLookup): boolean {
    return gateMode() === 'enforce' && !isLegacyVendor(vendorId) && !found.live;
  }

  private readonly notLiveLogged = new Map<string, number>();

  private logNotLive(vendorId: string, feature: string) {
    const last = this.notLiveLogged.get(vendorId) ?? 0;
    if (Date.now() - last < 60_000) return;
    this.notLiveLogged.set(vendorId, Date.now());
    this.logger.warn(`BLOCKED ${feature} for vendor=${vendorId}: the vendor has not gone live yet (Settings -> onboarding checklist)`);
  }

  private async lookup(vendorId: string): Promise<VendorLookup | null> {
    const hit = this.readyCache.get(vendorId);
    if (hit && Date.now() - hit.at < READY_CACHE_TTL_MS) return hit.found;

    let account: ReadyAccount | null = null;
    let live = false;
    try {
      const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { goLiveAt: true, whatsappAccount: true } });
      if (!vendor) return null; // unknown vendor: the gate decides
      live = !!vendor.goLiveAt;
      const acct = vendor.whatsappAccount;
      if (acct && acct.status === 'READY' && acct.phoneNumberId && acct.tokenCipher && acct.tokenIv && acct.tokenTag) {
        account = {
          accountId: acct.id,
          templateSuffix: acct.templateSuffix,
          creds: {
            phoneNumberId: acct.phoneNumberId,
            accessToken: openSecret({ cipher: acct.tokenCipher, iv: acct.tokenIv, tag: acct.tokenTag, keyVersion: acct.keyVersion }),
          },
        };
      }
    } catch (err) {
      // DB hiccup or undecryptable token: fall through to the gate decision (never throws into a send).
      if (Date.now() - this.lastDecryptWarn > 60_000) {
        this.lastDecryptWarn = Date.now();
        this.logger.warn(`WhatsApp account for vendor ${vendorId} unusable: ${err instanceof SecretBoxError ? err.message : (err as Error).message}`);
      }
      return null; // not cached — retry next send
    }
    const found: VendorLookup = { live, account };
    this.readyCache.set(vendorId, { at: Date.now(), found });
    return found;
  }

  invalidate(vendorId?: string) {
    if (vendorId) this.readyCache.delete(vendorId);
    else {
      this.readyCache.clear();
      this.templateCache.clear();
    }
  }

  // ── Read ────────────────────────────────────────────────────────────────────

  async getView(vendorId: string, opts: { isSuperAdmin?: boolean } = {}): Promise<WhatsAppAccountView> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, whatsappAccount: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const acct = vendor.whatsappAccount;

    let sharedWith: Array<{ id: string; name: string }> = [];
    if (acct) {
      sharedWith = await this.prisma.vendor.findMany({
        where: { whatsappAccountId: acct.id, id: { not: vendorId } },
        select: { id: true, name: true },
      });
    }

    const masterEnabled = process.env['WHATSAPP_ENABLED'] === 'true';
    const ready = !!acct && acct.status === 'READY' && !!acct.tokenCipher;
    const platform = !isBlocked(vendorId) && this.provider.isReady();
    return {
      masterEnabled,
      keyConfigured: secretKeyConfigured(),
      platformCredentials: !!process.env['META_WA_ACCESS_TOKEN'] && !!process.env['META_WA_PHONE_NUMBER_ID'],
      account: acct
        ? {
            id: acct.id,
            label: acct.label,
            wabaId: acct.wabaId,
            phoneNumberId: acct.phoneNumberId,
            displayNumber: acct.displayNumber,
            verifiedName: acct.verifiedName,
            status: acct.status,
            qualityRating: acct.qualityRating,
            lastHealthCheckAt: acct.lastHealthCheckAt,
            lastHealthError: acct.lastHealthError,
            hasToken: !!acct.tokenCipher,
            templateSuffix: acct.templateSuffix,
            templatesSyncedAt: acct.templatesSyncedAt,
            sharedWith: opts.isSuperAdmin ? sharedWith : [],
            sharedCount: sharedWith.length,
          }
        : null,
      sending: !masterEnabled
        ? { allowed: false, via: 'NONE' }
        : ready
          ? { allowed: true, via: 'ACCOUNT' }
          : platform
            ? { allowed: true, via: 'PLATFORM' }
            : { allowed: false, via: 'NONE' },
      canEdit: !!opts.isSuperAdmin || sharedWith.length === 0,
    };
  }

  async listAccounts() {
    const accounts = await this.prisma.whatsAppAccount.findMany({
      orderBy: { createdAt: 'asc' },
      include: { vendors: { select: { id: true, name: true } } },
    });
    return accounts.map((a) => ({
      id: a.id,
      label: a.label,
      wabaId: a.wabaId,
      phoneNumberId: a.phoneNumberId,
      displayNumber: a.displayNumber,
      status: a.status,
      qualityRating: a.qualityRating,
      lastHealthCheckAt: a.lastHealthCheckAt,
      lastHealthError: a.lastHealthError,
      vendors: a.vendors,
    }));
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  /**
   * Save a vendor's own sender. The credentials are verified against Meta FIRST — an invalid
   * token / wrong phone-number id is rejected and nothing is stored.
   */
  async connect(
    vendorId: string,
    dto: Omit<ConnectWhatsAppAccountDto, 'wabaId'> & { wabaId?: string },
    actor: AuthUser,
    opts: { isSuperAdmin?: boolean } = {},
  ): Promise<WhatsAppAccountView> {
    if (!secretKeyConfigured()) {
      throw new ServiceUnavailableException('This server cannot store WhatsApp credentials yet (WHATSAPP_TOKEN_KEY is not configured). Contact the platform administrator.');
    }
    const vendor = await this.requireVendor(vendorId);
    const existing = vendor.whatsappAccount;
    if (existing && !opts.isSuperAdmin) {
      const others = await this.prisma.vendor.count({ where: { whatsappAccountId: existing.id, id: { not: vendorId } } });
      if (others > 0) throw new ForbiddenException('This WhatsApp number is shared with other brands — ask the platform administrator to change it.');
    }
    const suffix = dto.templateSuffix === undefined ? (existing?.templateSuffix ?? null) : dto.templateSuffix;
    const clash = await this.prisma.whatsAppAccount.findFirst({ where: { phoneNumberId: dto.phoneNumberId, ...(existing ? { id: { not: existing.id } } : {}) } });
    if (clash) {
      throw new ConflictException('This Phone Number ID is already connected to another account. If the same company owns both brands, ask the platform administrator to link them.');
    }
    await this.assertSuffixFree(dto.wabaId ?? existing?.wabaId ?? null, suffix, existing?.id);

    const info = await this.provider.fetchPhoneNumberInfo({ accessToken: dto.accessToken, phoneNumberId: dto.phoneNumberId });
    if (info.ok === false) {
      throw new BadRequestException(`WhatsApp rejected these credentials${info.code ? ` (code ${info.code})` : ''}: ${info.message}`);
    }

    const sealed = sealSecret(dto.accessToken);
    const data = {
      label: dto.label ?? existing?.label ?? vendor.name,
      wabaId: dto.wabaId ?? existing?.wabaId ?? null,
      templateSuffix: suffix,
      phoneNumberId: dto.phoneNumberId,
      displayNumber: info.displayNumber,
      verifiedName: info.verifiedName,
      qualityRating: info.qualityRating,
      tokenCipher: sealed.cipher,
      tokenIv: sealed.iv,
      tokenTag: sealed.tag,
      keyVersion: sealed.keyVersion,
      status: 'READY' as const,
      lastHealthCheckAt: new Date(),
      lastHealthError: null,
    };
    const account = existing
      ? await this.prisma.whatsAppAccount.update({ where: { id: existing.id }, data })
      : await this.prisma.whatsAppAccount.create({ data });
    if (!existing) await this.prisma.vendor.update({ where: { id: vendorId }, data: { whatsappAccountId: account.id } });

    this.invalidateAccount(account.id, vendorId);
    await this.audit.log({
      vendorId,
      userId: actor.userId,
      userName: actor.name,
      action: existing ? 'UPDATE' : 'CREATE',
      entity: 'WhatsAppAccount',
      entityId: account.id,
      // never the token
      changes: { after: { wabaId: dto.wabaId, phoneNumberId: dto.phoneNumberId, displayNumber: info.displayNumber, status: 'READY' } },
    });
    return this.getView(vendorId, opts);
  }

  /** Re-check the sender with Meta right now (and refresh status / quality rating). */
  async verifyVendor(vendorId: string, actor: AuthUser, opts: { isSuperAdmin?: boolean } = {}): Promise<WhatsAppAccountView> {
    const vendor = await this.requireVendor(vendorId);
    if (!vendor.whatsappAccount) throw new BadRequestException('No WhatsApp account is connected for this vendor.');
    await this.verifyAccount(vendor.whatsappAccount);
    this.invalidateAccount(vendor.whatsappAccount.id, vendorId);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'VERIFY', entity: 'WhatsAppAccount', entityId: vendor.whatsappAccount.id });
    return this.getView(vendorId, opts);
  }

  async disconnect(vendorId: string, actor: AuthUser, opts: { isSuperAdmin?: boolean } = {}): Promise<WhatsAppAccountView> {
    const vendor = await this.requireVendor(vendorId);
    const acct = vendor.whatsappAccount;
    if (!acct) return this.getView(vendorId, opts);

    const others = await this.prisma.vendor.count({ where: { whatsappAccountId: acct.id, id: { not: vendorId } } });
    if (others > 0 && !opts.isSuperAdmin) {
      throw new ForbiddenException('This WhatsApp number is shared with other brands — ask the platform administrator.');
    }
    await this.prisma.vendor.update({ where: { id: vendorId }, data: { whatsappAccountId: null } });
    if (others === 0) await this.prisma.whatsAppAccount.delete({ where: { id: acct.id } }); // token goes with the row
    this.invalidateAccount(acct.id, vendorId);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'DELETE', entity: 'WhatsAppAccount', entityId: acct.id, changes: { before: { phoneNumberId: acct.phoneNumberId, displayNumber: acct.displayNumber } } });
    return this.getView(vendorId, opts);
  }

  /** Platform admin: let sister brands (same owner) share one sender. */
  async linkVendor(vendorId: string, accountId: string, actor: AuthUser): Promise<WhatsAppAccountView> {
    await this.requireVendor(vendorId);
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    await this.prisma.vendor.update({ where: { id: vendorId }, data: { whatsappAccountId: accountId } });
    this.invalidate(vendorId);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'LINK', entity: 'WhatsAppAccount', entityId: accountId, changes: { after: { phoneNumberId: account.phoneNumberId } } });
    return this.getView(vendorId, { isSuperAdmin: true });
  }

  /**
   * Platform admin: adopt the platform's env credentials (META_WA_ACCESS_TOKEN / META_WA_PHONE_NUMBER_ID)
   * as this vendor's own account — how Blue Ice moves from env to the database without pasting a token.
   */
  async importPlatformCredentials(vendorId: string, actor: AuthUser): Promise<WhatsAppAccountView> {
    const accessToken = process.env['META_WA_ACCESS_TOKEN'];
    const phoneNumberId = process.env['META_WA_PHONE_NUMBER_ID'];
    if (!accessToken || !phoneNumberId) throw new BadRequestException('Platform WhatsApp credentials are not set in the server environment.');
    const existing = await this.prisma.whatsAppAccount.findUnique({ where: { phoneNumberId } });
    if (existing) return this.linkVendor(vendorId, existing.id, actor);
    return this.connect(vendorId, { wabaId: process.env['META_WA_WABA_ID'] || undefined, phoneNumberId, accessToken }, actor, { isSuperAdmin: true });
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  /** Daily job: re-verify every stored sender. Only updates the account; a failure never blocks Blue Ice (env fallback). */
  async runHealthCheck(): Promise<{ checked: number; invalid: number }> {
    const accounts = await this.prisma.whatsAppAccount.findMany({ where: { tokenCipher: { not: null } } });
    let invalid = 0;
    for (const a of accounts) {
      const status = await this.verifyAccount(a);
      if (status === 'TOKEN_INVALID') invalid++;
      else if (status === 'READY' && a.wabaId) await this.syncAccountTemplates(a).catch((e) => this.logger.warn(`Template sync failed for account ${a.id}: ${(e as Error).message}`));
    }
    this.invalidate();
    this.logger.log(`WhatsApp account health check: ${accounts.length} checked, ${invalid} with an invalid token`);
    return { checked: accounts.length, invalid };
  }

  private async verifyAccount(a: WhatsAppAccount): Promise<WhatsAppAccountStatus> {
    if (!a.tokenCipher || !a.tokenIv || !a.tokenTag || !a.phoneNumberId) {
      return this.saveHealth(a, 'NOT_CONFIGURED', 'No credentials stored');
    }
    let token: string;
    try {
      token = openSecret({ cipher: a.tokenCipher, iv: a.tokenIv, tag: a.tokenTag, keyVersion: a.keyVersion });
    } catch (err) {
      return this.saveHealth(a, 'TOKEN_INVALID', err instanceof SecretBoxError ? err.message : 'Stored token could not be read');
    }
    const info = await this.provider.fetchPhoneNumberInfo({ accessToken: token, phoneNumberId: a.phoneNumberId });
    if (info.ok === true) {
      await this.prisma.whatsAppAccount.update({
        where: { id: a.id },
        data: { status: a.status === 'SUSPENDED' ? 'SUSPENDED' : 'READY', displayNumber: info.displayNumber ?? a.displayNumber, verifiedName: info.verifiedName ?? a.verifiedName, qualityRating: info.qualityRating, lastHealthCheckAt: new Date(), lastHealthError: null },
      });
      return a.status === 'SUSPENDED' ? 'SUSPENDED' : 'READY';
    }
    // 401 / OAuth error 190 => the token is dead. Anything else (network, 5xx, rate limit) is transient: keep the status.
    if (info.status === 401 || info.code === 190) return this.saveHealth(a, 'TOKEN_INVALID', info.message);
    await this.prisma.whatsAppAccount.update({ where: { id: a.id }, data: { lastHealthCheckAt: new Date(), lastHealthError: info.message } });
    return a.status;
  }

  private async saveHealth(a: WhatsAppAccount, status: WhatsAppAccountStatus, error: string): Promise<WhatsAppAccountStatus> {
    await this.prisma.whatsAppAccount.update({ where: { id: a.id }, data: { status, lastHealthCheckAt: new Date(), lastHealthError: error.slice(0, 300) } });
    if (status === 'TOKEN_INVALID') this.logger.warn(`WhatsApp account ${a.id} (${a.label}) token invalid: ${error}`);
    return status;
  }

  // ── Templates ───────────────────────────────────────────────────────────────

  /**
   * May this template be sent through this account? Blocks only what we KNOW Meta has not approved:
   * after a successful sync, a template that is missing or not APPROVED is skipped (with the clear
   * reason in the log) instead of failing at Meta. Before the first sync nothing is blocked.
   */
  async templateSendable(accountId: string, finalName: string): Promise<boolean> {
    const hit = this.templateCache.get(accountId);
    let byName: Map<string, string> | null;
    if (hit && Date.now() - hit.at < READY_CACHE_TTL_MS) {
      byName = hit.byName;
    } else {
      try {
        const acct = await this.prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { templatesSyncedAt: true, templates: { select: { name: true, status: true } } } });
        byName = acct?.templatesSyncedAt ? new Map(acct.templates.map((t) => [t.name, t.status])) : null;
      } catch {
        return true; // never block a send on a lookup failure
      }
      this.templateCache.set(accountId, { at: Date.now(), byName });
    }
    if (!byName) return true;
    const ok = byName.get(finalName) === 'APPROVED';
    if (!ok) this.logger.warn(`WhatsApp template "${finalName}" is not approved on account ${accountId} (${byName.get(finalName) ?? 'not found on Meta'}) — send skipped`);
    return ok;
  }

  /** The catalogue of templates this vendor needs, rendered with ITS brand name, with each one's review status. */
  async getTemplates(vendorId: string, opts: { isSuperAdmin?: boolean } = {}) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { name: true, branding: { select: { displayName: true } }, whatsappAccount: { select: { id: true, wabaId: true, templateSuffix: true, templatesSyncedAt: true, templates: true } } },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');
    const acct = vendor.whatsappAccount;
    const brand = vendor.branding?.displayName ?? vendor.name;
    const byName = new Map((acct?.templates ?? []).map((t) => [t.name, t]));
    const synced = !!acct?.templatesSyncedAt;

    const items = TEMPLATE_CATALOG.map((t) => {
      const finalName = templateNameFor(t.name, acct?.templateSuffix);
      const found = byName.get(finalName);
      const status = !acct || !synced ? 'UNKNOWN' : (found?.status ?? 'NOT_FOUND');
      return {
        name: t.name,
        finalName,
        title: t.title,
        usedFor: t.usedFor,
        required: t.required,
        internal: !!t.internal,
        header: t.header,
        body: renderTemplateBody(t, brand),
        variables: t.variables,
        sample: t.sample,
        status,
        rejectedReason: found?.rejectedReason ?? null,
      };
    });
    return {
      brand,
      templateSuffix: acct?.templateSuffix ?? null,
      wabaId: acct?.wabaId ?? null,
      hasAccount: !!acct,
      syncedAt: acct?.templatesSyncedAt ?? null,
      canSync: !!acct?.wabaId,
      approvedRequired: items.filter((i) => i.required && i.status === 'APPROVED').length,
      totalRequired: items.filter((i) => i.required).length,
      items,
      canEdit: !!opts.isSuperAdmin,
    };
  }

  /** Refresh template review statuses from Meta now (read-only call). */
  async syncVendorTemplates(vendorId: string, actor: AuthUser, opts: { isSuperAdmin?: boolean } = {}) {
    const vendor = await this.requireVendor(vendorId);
    const acct = vendor.whatsappAccount;
    if (!acct) throw new BadRequestException('Connect a WhatsApp number first.');
    if (!acct.wabaId) throw new BadRequestException('The WhatsApp Business Account ID is missing — re-enter your credentials including the WABA ID to read template statuses.');
    await this.syncAccountTemplates(acct, true);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'SYNC', entity: 'WhatsAppTemplate', entityId: acct.id });
    return this.getTemplates(vendorId, opts);
  }

  private async syncAccountTemplates(a: WhatsAppAccount, throwOnError = false): Promise<void> {
    if (!a.wabaId || !a.tokenCipher || !a.tokenIv || !a.tokenTag) return;
    let token: string;
    try {
      token = openSecret({ cipher: a.tokenCipher, iv: a.tokenIv, tag: a.tokenTag, keyVersion: a.keyVersion });
    } catch {
      if (throwOnError) throw new BadRequestException('Stored access token could not be read — re-enter your credentials.');
      return;
    }
    const res = await this.provider.listTemplates({ accessToken: token, phoneNumberId: a.phoneNumberId ?? '' }, a.wabaId);
    if (res.ok === false) {
      if (throwOnError) throw new BadRequestException(`WhatsApp could not list templates${res.code ? ` (code ${res.code})` : ''}: ${res.message}`);
      this.logger.warn(`Template sync for account ${a.id} failed: ${res.message}`);
      return;
    }
    const now = new Date();
    const names = res.templates.map((t) => t.name);
    await this.prisma.$transaction([
      ...res.templates.map((t) =>
        this.prisma.whatsAppTemplate.upsert({
          where: { accountId_name_language: { accountId: a.id, name: t.name, language: t.language } },
          create: { accountId: a.id, name: t.name, language: t.language, category: t.category, status: t.status, rejectedReason: t.rejectedReason, syncedAt: now },
          update: { category: t.category, status: t.status, rejectedReason: t.rejectedReason, syncedAt: now },
        }),
      ),
      this.prisma.whatsAppTemplate.deleteMany({ where: { accountId: a.id, name: { notIn: names } } }),
      this.prisma.whatsAppAccount.update({ where: { id: a.id }, data: { templatesSyncedAt: now } }),
    ]);
    this.templateCache.delete(a.id);
  }

  /** Brand suffix for a WABA shared by several brands. */
  async updateSettings(vendorId: string, dto: UpdateWhatsAppSettingsDto, actor: AuthUser, opts: { isSuperAdmin?: boolean } = {}): Promise<WhatsAppAccountView> {
    const vendor = await this.requireVendor(vendorId);
    const acct = vendor.whatsappAccount;
    if (!acct) throw new BadRequestException('Connect a WhatsApp number first.');
    if (!opts.isSuperAdmin) {
      const others = await this.prisma.vendor.count({ where: { whatsappAccountId: acct.id, id: { not: vendorId } } });
      if (others > 0) throw new ForbiddenException('This WhatsApp number is shared with other brands — ask the platform administrator.');
    }
    const suffix = dto.templateSuffix ?? null;
    await this.assertSuffixFree(acct.wabaId, suffix, acct.id);
    await this.prisma.whatsAppAccount.update({ where: { id: acct.id }, data: { templateSuffix: suffix } });
    this.invalidateAccount(acct.id, vendorId);
    this.templateCache.delete(acct.id);
    await this.audit.log({ vendorId, userId: actor.userId, userName: actor.name, action: 'UPDATE', entity: 'WhatsAppAccount', entityId: acct.id, changes: { before: { templateSuffix: acct.templateSuffix }, after: { templateSuffix: suffix } } });
    return this.getView(vendorId, opts);
  }

  /** Two accounts on the same WABA must not use the same template names. */
  private async assertSuffixFree(wabaId: string | null, suffix: string | null, selfId?: string) {
    if (!wabaId) return;
    const clash = await this.prisma.whatsAppAccount.findFirst({
      where: { wabaId, templateSuffix: suffix, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { label: true },
    });
    if (clash) {
      throw new ConflictException(
        suffix
          ? `Another brand on this WhatsApp Business Account already uses the template suffix "${suffix}".`
          : `Another brand on this WhatsApp Business Account already uses the plain template names — give this brand its own template suffix (e.g. its short name).`,
      );
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private invalidateAccount(accountId: string, vendorId: string) {
    // every vendor sharing the account must re-read it
    this.readyCache.delete(vendorId);
    void this.prisma.vendor
      .findMany({ where: { whatsappAccountId: accountId }, select: { id: true } })
      .then((vs) => vs.forEach((v) => this.readyCache.delete(v.id)))
      .catch(() => this.readyCache.clear());
  }

  private async requireVendor(vendorId: string) {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, name: true, whatsappAccount: true } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }
}
