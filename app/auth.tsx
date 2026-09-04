'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type AuthUser = { id: string; email?: string | null };
export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: AuthUser;
};

type AuthContextValue = {
  session: AuthSession | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = 'ov-stock-house-session';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

function configured() {
  return Boolean(url && publishableKey);
}

function readSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as AuthSession;
    return session?.access_token && session?.refresh_token ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session: AuthSession | null) {
  if (typeof window === 'undefined') return;
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

function withExpiry(session: AuthSession): AuthSession {
  return {
    ...session,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600),
  };
}

async function authRequest<T>(path: string, body?: unknown, token?: string): Promise<T> {
  if (!configured()) throw new Error('Supabase environment variables are missing.');
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'msg' in payload
      ? String((payload as { msg: unknown }).msg)
      : typeof payload === 'object' && payload && 'error_description' in payload
        ? String((payload as { error_description: unknown }).error_description)
        : 'Authentication request failed.';
    throw new Error(message);
  }
  return payload as T;
}

export async function refreshStoredSession(): Promise<AuthSession | null> {
  const current = readSession();
  if (!current || !configured()) return current;
  const expiresAt = current.expires_at || 0;
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return current;
  try {
    const next = await authRequest<AuthSession>('token?grant_type=refresh_token', {
      refresh_token: current.refresh_token,
    });
    const normalized = withExpiry(next);
    saveSession(normalized);
    return normalized;
  } catch {
    saveSession(null);
    return null;
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await refreshStoredSession();
  return session?.access_token || null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const next = await refreshStoredSession();
      if (active) {
        setSession(next);
        setLoading(false);
      }
    })();
    const timer = window.setInterval(async () => {
      const next = await refreshStoredSession();
      if (active) setSession(next);
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    loading,
    signIn: async (email, password) => {
      const next = await authRequest<AuthSession>('token?grant_type=password', {
        email: email.trim(),
        password,
      });
      const normalized = withExpiry(next);
      saveSession(normalized);
      setSession(normalized);
    },
    signOut: async () => {
      const token = session?.access_token;
      try {
        if (token) await authRequest('logout', undefined, token);
      } finally {
        saveSession(null);
        setSession(null);
      }
    },
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be inside AuthProvider');
  return value;
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!session && pathname !== '/login') router.replace('/login');
    if (session && pathname === '/login') router.replace('/');
  }, [loading, pathname, router, session]);

  if (pathname === '/login') return <>{children}</>;
  if (loading || !session) {
    return <div className="auth-loading"><div className="auth-loading-card"><div className="auth-logo">OV</div><b>OV Stock House</b><span>Checking secure session…</span></div></div>;
  }
  return <>{children}</>;
}
