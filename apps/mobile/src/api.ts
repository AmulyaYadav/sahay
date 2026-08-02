/** REST client for the Sahay API (docs/api-surface.md). */

const DEFAULT_BASE = 'http://localhost:4000';

export function apiOrigin(): string {
  return process.env.EXPO_PUBLIC_API_ORIGIN ?? DEFAULT_BASE;
}

export function apiBase(): string {
  return `${apiOrigin()}/api/v1`;
}

export function wsUrl(token: string): string {
  const origin = apiOrigin().replace(/^http/, 'ws');
  return `${origin}/ws?token=${encodeURIComponent(token)}`;
}

/** Error thrown for any non-2xx response, carrying the zApiError envelope. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Thrown when the device appears offline / the server is unreachable. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('network_error');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof NetworkError;
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the default request timeout. */
  timeoutMs?: number;
}

/**
 * How long to wait before giving up on a request.
 *
 * `fetch` has no timeout of its own, and the platform socket timeout is a
 * minute or more. A screen that disables its button while a request is in
 * flight therefore looks frozen on a bad connection — pressed, greyed out,
 * and never resolving. Failing at 20s turns that into an error the person can
 * act on.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token, query, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  let url = `${apiBase()}${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    if (qs) url += `?${qs}`;
  }

  let res: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(url, {
      method,
      headers: {
        // Only when there is something to describe. Declaring a JSON body and
        // then sending none is what a strict server rejects outright, which is
        // how cancelling a request, leaving an event and logging out all came
        // back as an unexplained error.
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // An abort is indistinguishable from a dead connection to the caller, and
    // both want the same "you appear to be offline" handling.
    throw new NetworkError(err);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let code = 'unknown';
    let message = `HTTP ${res.status}`;
    let details: Record<string, unknown> | undefined;
    try {
      const payload = (await res.json()) as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> };
      };
      code = payload.error?.code ?? code;
      message = payload.error?.message ?? message;
      details = payload.error?.details;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(res.status, code, message, details);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Random idempotency key (8–64 chars per zIdempotencyKey). */
export function idempotencyKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
