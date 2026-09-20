import type { ProblemDetails } from '@ifp/shared';

/**
 * API client.
 *
 * The access token lives in a module variable — in memory only, never in
 * localStorage. An XSS bug should not hand an attacker a token that survives a
 * page reload. The refresh token is an httpOnly cookie the JS never sees.
 */

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.title || 'Request failed');
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
  }

  /** Field-level messages, keyed by form path, for react-hook-form. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.problem.errors ?? []) out[e.path] = e.message;
    return out;
  }
}

const BASE = '/api/v1';

/**
 * Single-flight refresh: many components can 401 at once, but only one
 * refresh request is ever in the air, and the rest await it.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
        accessToken = data.accessToken;
        return true;
      } catch {
        return false;
      } finally {
        // Allow the next failure to trigger a fresh attempt.
        setTimeout(() => {
          refreshInFlight = null;
        }, 0);
      }
    })();
  }
  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = options;

  let url = `${BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401 && !options._retried && !path.startsWith('/auth/refresh')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return api<T>(path, { ...options, _retried: true });
    accessToken = null;
    onUnauthorized?.();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const problem: ProblemDetails =
      data && typeof data === 'object' && 'title' in data
        ? (data as ProblemDetails)
        : {
            type: 'about:blank',
            title: res.statusText || 'Request failed',
            status: res.status,
          };
    throw new ApiError(problem);
  }

  return data as T;
}

export const get = <T,>(path: string, query?: RequestOptions['query']) =>
  api<T>(path, query ? { query } : {});
export const post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
// DELETE with a body: revoking a device or an invitation carries a reason,
// and a reason belongs in the request rather than in a query string.
export const del = <T,>(path: string, body?: unknown) =>
  api<T>(path, body === undefined ? { method: 'DELETE' } : { method: 'DELETE', body });
