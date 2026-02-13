import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;
  private enabled = false;

  onModuleInit() {
    const host = process.env['MAIL_HOST'];
    const user = process.env['MAIL_USER'];
    const pass = process.env['MAIL_PASS'];

    if (!host || !user || !pass) {
      this.logger.warn(
        'Email not configured (MAIL_HOST / MAIL_USER / MAIL_PASS missing). Password reset emails will not be sent.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env['MAIL_PORT'] || '587', 10),
      secure: process.env['MAIL_PORT'] === '465', // true only for port 465
      auth: { user, pass },
    });

    this.enabled = true;
    this.logger.log(`Email service ready (${host}:${process.env['MAIL_PORT'] || '587'})`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async sendPasswordReset(to: string, name: string, resetToken: string): Promise<void> {
    const frontendUrl = process.env['FRONTEND_URL'] || 'http://localhost:3000';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
    const from = process.env['MAIL_FROM'] || `"Water Supply CRM" <${process.env['MAIL_USER']}>`;

    const html = this.buildPasswordResetHtml(name, resetLink);
    const text = this.buildPasswordResetText(name, resetLink);

    if (!this.enabled) {
      // Log to console so dev can still test the flow without email setup
      this.logger.warn(`[Email DISABLED] Password reset link for ${to}: ${resetLink}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Password Reset — Water Supply CRM',
        text,
        html,
      });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, (error as Error).message);
      // Don't throw — caller should not know if email failed (security: no email enumeration)
    }
  }

  async sendPasswordChanged(to: string, name: string): Promise<void> {
    const from = process.env['MAIL_FROM'] || `"Water Supply CRM" <${process.env['MAIL_USER']}>`;

    if (!this.enabled) {
      this.logger.warn(`[Email DISABLED] Would send password-changed confirmation to ${to}`);
      return;
    }

    try {
      await this.transporter.sendMail({
        from,
        to,
        subject: 'Password Changed — Water Supply CRM',
        text: `Hello ${name},\n\nYour password has been successfully changed.\n\nIf you did not make this change, contact support immediately.`,
        html: this.buildPasswordChangedHtml(name),
      });
      this.logger.log(`Password-changed email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, (error as Error).message);
    }
  }

  // ─── HTML Templates ──────────────────────────────────────────────────────────

  private buildPasswordResetHtml(name: string, resetLink: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Password Reset</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#0ea5e9;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">💧 Water Supply CRM</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;">Password Reset Request</h2>
              <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
                Hello <strong>${name}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                We received a request to reset your password. Click the button below to set a new password.
                This link will expire in <strong>15 minutes</strong>.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 32px;">
                    <a href="${resetLink}"
                       style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;
                              padding:14px 36px;border-radius:6px;font-size:15px;font-weight:600;">
                      Reset My Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;color:#64748b;font-size:13px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px;word-break:break-all;">
                <a href="${resetLink}" style="color:#0ea5e9;font-size:13px;">${resetLink}</a>
              </p>

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;" />
              <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
                If you did not request a password reset, you can safely ignore this email.
                Your password will remain unchanged.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © ${new Date().getFullYear()} Water Supply CRM. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPasswordResetText(name: string, resetLink: string): string {
    return `Hello ${name},

We received a request to reset your password.

Click the link below to set a new password (expires in 15 minutes):
${resetLink}

If you did not request this, you can safely ignore this email.

— Water Supply CRM`;
  }

  private buildPasswordChangedHtml(name: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><title>Password Changed</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#10b981;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:22px;">💧 Water Supply CRM</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#1e293b;">Password Changed Successfully</h2>
              <p style="margin:0 0 16px;color:#475569;font-size:15px;line-height:1.6;">
                Hello <strong>${name}</strong>,
              </p>
              <p style="margin:0 0 24px;color:#475569;font-size:15px;line-height:1.6;">
                ✅ Your password has been changed successfully.
              </p>
              <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
                If you did not make this change, please contact support immediately.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">
                © ${new Date().getFullYear()} Water Supply CRM
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
