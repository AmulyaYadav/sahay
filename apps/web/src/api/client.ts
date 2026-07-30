/**
 * Fetch wrapper for the Sahay API.
 * - base URL: VITE_API_URL (default http://localhost:4000) + /api/v1
 * - bearer token from localStorage('sahay.token')
 * - non-2xx parsed via the zApiError envelope into ApiClientError
 * - 401 clears the token and redirects to /auth (with ?next=), except on the
 *   routes where 401 means "wrong credentials" rather than "session expired"
 */
import { zApiError } from '@sahay/shared';

const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');
const PREFIX = '/api/v1';
const TOKEN_KEY = 'sahay.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function wsUrl(): string {
  const token = getToken() ?? '';
  return `${API_BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Fired so the OfflineBanner can apply a "failed fetch" heuristic on flaky networks. */
export const NET_EVENT = 'sahay:net';
function emitNet(ok: boolean): void {
  window.dispatchEvent(new CustomEvent(NET_EVENT, { detail: { ok } }));
}

export function redirectToAuth(): void {
  clearToken();
  if (window.location.pathname.startsWith('/auth')) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/auth?next=${next}`);
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const params = new URLSearchParams();
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
  }
  const qs = params.size > 0 ? `?${params.toString()}` : '';

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${PREFIX}${path}${qs}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ?? null,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    emitNet(false);
    throw new ApiClientError('network_error', 'Network request failed', 0);
  }
  emitNet(true);

  // On these routes a 401 is a credential answer, not an expired session:
  // /auth/otp/* is a wrong code, /auth/password is a wrong current password.
  // Redirecting would sign the caller out for a typo and swallow the message.
  const authAnswers401 = path.startsWith('/auth/otp') || path === '/auth/password';
  if (res.status === 401 && !authAnswers401) {
    redirectToAuth();
    throw new ApiClientError('unauthorized', 'Session expired', 401);
  }

  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || 'Request failed';
    let details: Record<string, unknown> | undefined;
    try {
      const parsed = zApiError.safeParse(await res.json());
      if (parsed.success) {
        code = parsed.data.error.code;
        message = parsed.data.error.message;
        details = parsed.data.error.details;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(code, message, res.status, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
