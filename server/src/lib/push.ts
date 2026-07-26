/**
 * Push delivery abstraction. Providers receive opaque device tokens and a
 * minimal payload; notification CONTENT policy (vague vs detailed previews)
 * is decided by the notify worker before anything reaches this file. Tokens
 * are never logged in full — only a short prefix for diagnostics.
 */
import webpush from 'web-push';
import { loadConfig } from '../config.js';

export interface PushToken {
  provider: string; // 'expo' | 'webpush'
  token: string; // expo push token or JSON-serialized web-push subscription
}

export interface PushPayload {
  title: string;
  body: string;
  deepLink?: string;
}

export interface PushProvider {
  /** Returns the tokens that failed PERMANENTLY (invalid/expired registration). */
  send(tokens: PushToken[], payload: PushPayload): Promise<{ failed: string[] }>;
}

/** Safe-for-logs token preview. */
export function maskToken(token: string): string {
  return `${token.slice(0, 8)}…`;
}

/** Development provider: logs a count and masked tokens, never content-adjacent PII. */
export class ConsolePushProvider implements PushProvider {
  async send(tokens: PushToken[], payload: PushPayload): Promise<{ failed: string[] }> {
    if (tokens.length === 0) return { failed: [] };
    // eslint-disable-next-line no-console
    console.log(
      `[push] "${payload.title}" to ${tokens.length} device(s): ${tokens
        .map((t) => maskToken(t.token))
        .join(', ')}`,
    );
    return { failed: [] };
  }
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH_SIZE = 100;

/** Expo error codes that mean the token is dead and should be disabled. */
const EXPO_PERMANENT_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials']);

export class ExpoPushProvider implements PushProvider {
  async send(tokens: PushToken[], payload: PushPayload): Promise<{ failed: string[] }> {
    const expoTokens = tokens.filter((t) => t.provider === 'expo');
    const failed: string[] = [];
    for (let i = 0; i < expoTokens.length; i += EXPO_BATCH_SIZE) {
      const batch = expoTokens.slice(i, i + EXPO_BATCH_SIZE);
      const messages = batch.map((t) => ({
        to: t.token,
        title: payload.title,
        body: payload.body,
        data: payload.deepLink ? { deepLink: payload.deepLink } : {},
      }));
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(messages),
        });
        if (!res.ok) continue; // transient — do not disable tokens on HTTP failures
        const json = (await res.json()) as {
          data?: { status: string; details?: { error?: string } }[];
        };
        for (const [idx, ticket] of (json.data ?? []).entries()) {
          const token = batch[idx]?.token;
          if (!token) continue;
          if (ticket.status === 'error' && EXPO_PERMANENT_ERRORS.has(ticket.details?.error ?? '')) {
            failed.push(token);
          }
        }
      } catch {
        // Network errors are transient; the notification row + WS frame already landed.
      }
    }
    return { failed };
  }
}

export class WebPushProvider implements PushProvider {
  constructor(
    private readonly vapid: { publicKey: string; privateKey: string; subject: string },
  ) {
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  }

  async send(tokens: PushToken[], payload: PushPayload): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink ?? null,
    });
    for (const t of tokens) {
      if (t.provider !== 'webpush') continue;
      let subscription: webpush.PushSubscription;
      try {
        subscription = JSON.parse(t.token) as webpush.PushSubscription;
      } catch {
        failed.push(t.token); // unparseable subscription can never work again
        continue;
      }
      try {
        await webpush.sendNotification(subscription, body);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) failed.push(t.token); // gone forever
        // other statuses: transient, keep the token
      }
    }
    return { failed };
  }
}

/**
 * Active providers for this deployment. 'console' short-circuits everything
 * (dev/test); otherwise Expo always runs and WebPush joins when VAPID keys are
 * configured.
 */
export function getPushProviders(): PushProvider[] {
  const config = loadConfig();
  if (config.PUSH_PROVIDER === 'console') return [new ConsolePushProvider()];
  const providers: PushProvider[] = [new ExpoPushProvider()];
  if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) {
    providers.push(
      new WebPushProvider({
        publicKey: config.VAPID_PUBLIC_KEY,
        privateKey: config.VAPID_PRIVATE_KEY,
        subject: config.VAPID_SUBJECT ?? 'mailto:support@sahay.example',
      }),
    );
  }
  return providers;
}
