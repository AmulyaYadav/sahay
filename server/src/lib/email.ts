/**
 * Email OTP delivery abstraction. Providers receive the full email address to
 * deliver the message, but NOTHING here (or anywhere else) may ever log a full
 * email address — use maskEmail() for any diagnostics.
 */
import { loadConfig } from '../config.js';
import { t } from '@sahay/shared';

export interface OtpProvider {
  send(email: string, code: string, locale: 'en' | 'hi'): Promise<void>;
  /** Username reminder for the "forgot username" flow. */
  sendUsername(email: string, username: string, locale: 'en' | 'hi'): Promise<void>;
}

/** "person@example.com" → "p***@example.com" — safe for logs. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.[0] ?? ''}***@${domain ?? ''}`;
}

/** Development provider: prints the code with a masked address. */
export class ConsoleEmailProvider implements OtpProvider {
  async send(email: string, code: string, _locale: 'en' | 'hi'): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[email] OTP for ${maskEmail(email)}: ${code}`);
  }

  async sendUsername(email: string, username: string, _locale: 'en' | 'hi'): Promise<void> {
    // The username is not a secret the way a code is, but it still identifies an
    // account, so the address stays masked as everywhere else.
    // eslint-disable-next-line no-console
    console.log(`[email] username for ${maskEmail(email)}: ${username}`);
  }
}

export class ResendEmailProvider implements OtpProvider {
  private async post(email: string, subject: string, text: string, emphasise?: string): Promise<void> {
    const config = loadConfig();
    const apiKey = config.RESEND_API_KEY;
    const from = config.RESEND_FROM;
    if (!apiKey || !from) throw new Error('resend provider not configured');
    const html = emphasise ? text.replace(emphasise, `<strong>${emphasise}</strong>`) : text;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: email, subject, html: `<p>${html}</p>`, text }),
    });
    if (!res.ok) {
      // Never include the email address (masked or not) alongside provider error
      // bodies. Status alone is enough to diagnose; 403 here almost always means
      // Resend is in test mode and will only deliver to the account owner.
      throw new Error(`resend send failed: status ${res.status}`);
    }
  }

  async send(email: string, code: string, locale: 'en' | 'hi'): Promise<void> {
    const appName = t(locale, 'common.appName');
    await this.post(
      email,
      t(locale, 'auth.otpEmailSubject', { appName }),
      t(locale, 'auth.otpEmailBody', { appName, code }),
      code,
    );
  }

  async sendUsername(email: string, username: string, locale: 'en' | 'hi'): Promise<void> {
    const appName = t(locale, 'common.appName');
    await this.post(
      email,
      t(locale, 'auth.usernameEmailSubject', { appName }),
      t(locale, 'auth.usernameEmailBody', { appName, username }),
      username,
    );
  }
}

export function getOtpProvider(): OtpProvider {
  switch (loadConfig().EMAIL_PROVIDER) {
    case 'resend':
      return new ResendEmailProvider();
    default:
      return new ConsoleEmailProvider();
  }
}
