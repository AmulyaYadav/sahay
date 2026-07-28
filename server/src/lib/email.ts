/**
 * Email OTP delivery abstraction. Providers receive the full email address to
 * deliver the message, but NOTHING here (or anywhere else) may ever log a full
 * email address — use maskEmail() for any diagnostics.
 */
import { loadConfig } from '../config.js';
import { t } from '@sahay/shared';

export interface OtpProvider {
  send(email: string, code: string, locale: 'en' | 'hi'): Promise<void>;
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
}

export class ResendEmailProvider implements OtpProvider {
  async send(email: string, code: string, locale: 'en' | 'hi'): Promise<void> {
    const config = loadConfig();
    const apiKey = config.RESEND_API_KEY;
    const from = config.RESEND_FROM;
    if (!apiKey || !from) throw new Error('resend provider not configured');
    const appName = t(locale, 'common.appName');
    const subject = t(locale, 'auth.otpEmailSubject', { appName });
    const body = t(locale, 'auth.otpEmailBody', { appName, code });
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: email,
        subject,
        html: `<p>${body.replace(code, `<strong>${code}</strong>`)}</p>`,
        text: body,
      }),
    });
    if (!res.ok) {
      // Never include the email address (masked or not) alongside provider error bodies.
      throw new Error(`resend send failed: status ${res.status}`);
    }
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
