/**
 * SMS delivery abstraction. Providers receive the full E.164 number to deliver
 * the message, but NOTHING here (or anywhere else) may ever log a full phone
 * number — use maskPhone() for any diagnostics.
 */
import { loadConfig } from '../config.js';

export interface SmsProvider {
  send(phoneE164: string, message: string, locale: 'en' | 'hi'): Promise<void>;
}

/** "+919876543210" → "+91…3210" — safe for logs. */
export function maskPhone(phoneE164: string): string {
  return `${phoneE164.slice(0, 3)}…${phoneE164.slice(-4)}`;
}

/** Development provider: prints the message (which contains the OTP) with a masked number. */
export class ConsoleSmsProvider implements SmsProvider {
  async send(phoneE164: string, message: string, _locale: 'en' | 'hi'): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[sms] OTP for ${maskPhone(phoneE164)}: ${message}`);
  }
}

export class TwilioSmsProvider implements SmsProvider {
  async send(phoneE164: string, message: string, _locale: 'en' | 'hi'): Promise<void> {
    const config = loadConfig();
    const sid = config.TWILIO_ACCOUNT_SID;
    const token = config.TWILIO_AUTH_TOKEN;
    const from = config.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error('twilio provider not configured');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phoneE164, From: from, Body: message }).toString(),
    });
    if (!res.ok) {
      // Never include the phone number (masked or not) alongside provider error bodies.
      throw new Error(`twilio send failed: status ${res.status}`);
    }
  }
}

export class Msg91SmsProvider implements SmsProvider {
  async send(phoneE164: string, message: string, _locale: 'en' | 'hi'): Promise<void> {
    const config = loadConfig();
    const authKey = config.MSG91_AUTH_KEY;
    const senderId = config.MSG91_SENDER_ID;
    if (!authKey || !senderId) throw new Error('msg91 provider not configured');
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: senderId,
        short_url: '0',
        mobiles: phoneE164.replace(/^\+/, ''),
        message,
      }),
    });
    if (!res.ok) throw new Error(`msg91 send failed: status ${res.status}`);
  }
}

export function getSmsProvider(): SmsProvider {
  switch (loadConfig().SMS_PROVIDER) {
    case 'twilio':
      return new TwilioSmsProvider();
    case 'msg91':
      return new Msg91SmsProvider();
    default:
      return new ConsoleSmsProvider();
  }
}
