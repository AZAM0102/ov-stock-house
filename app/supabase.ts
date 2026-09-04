import { getValidAccessToken } from './auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function request<T>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  if (!isSupabaseConfigured()) throw new Error('Supabase environment variables are missing.');
  const token = await getValidAccessToken();
  if (!token) throw new Error('Your session has expired. Please sign in again.');

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 && retry) {
    const freshToken = await getValidAccessToken();
    if (freshToken && freshToken !== token) {
      return request<T>(path, options, false);
    }
  }

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; details?: string; hint?: string; code?: string };
      message = parsed.message || parsed.details || parsed.hint || text;
      if (parsed.code) message = `${message} (${parsed.code})`;
    } catch {}
    throw new Error(message || `Supabase request failed (${res.status})`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

export const db = {
  select: <T = unknown>(table: string, query = 'select=*') =>
    request<T[]>(`${table}?${query}`),

  insert: <T = unknown>(table: string, body: unknown) =>
    request<T[]>(table, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    }),

  update: <T = unknown>(table: string, filter: string, body: unknown) =>
    request<T[]>(`${table}?${filter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    }),

  remove: (table: string, filter: string) =>
    request<unknown[]>(`${table}?${filter}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }),

  rpc: <T = unknown>(fn: string, body: unknown) =>
    request<T>(`rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
