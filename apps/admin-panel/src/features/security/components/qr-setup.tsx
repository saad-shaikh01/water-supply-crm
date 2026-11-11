import type { TwoFactorSetup } from '../../auth/api/auth.api';

/** QR image (data URL from the API) plus the base32 secret for manual entry. */
export function QrSetup({ setup }: { setup: TwoFactorSetup }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <img src={setup.qrDataUrl} alt="Two-factor QR code" width={192} height={192} className="rounded-md border bg-white p-1" />
      <p className="text-center text-xs text-muted-foreground">
        Cannot scan? Enter this key manually:
        <br />
        <code data-testid="totp-secret" className="break-all font-mono text-sm text-foreground">
          {setup.secret}
        </code>
      </p>
    </div>
  );
}
