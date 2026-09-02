const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || '';

const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = () =>
  Boolean(SUPABASE_URL && SUPABASE_KEY);

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      cache: 'no-store',
    }
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      text || `Supabase request failed (${response.status})`
    );
  }

  return (text ? JSON.parse(text) : null) as T;
}

export const db = {
  select: <T = any>(
    table: string,
    query = 'select=*'
  ) =>
    request<T[]>(
      `${table}?${query}`
    ),

  insert: <T = any>(
    table: string,
    body: any
  ) =>
    request<T[]>(
      table,
      {
        method: 'POST',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(body),
      }
    ),

  update: <T = any>(
    table: string,
    filter: string,
    body: any
  ) =>
    request<T[]>(
      `${table}?${filter}`,
      {
        method: 'PATCH',
        headers: {
          Prefer: 'return=representation',
        },
        body: JSON.stringify(body),
      }
    ),

  remove: (
    table: string,
    filter: string
  ) =>
    request(
      `${table}?${filter}`,
      {
        method: 'DELETE',
        headers: {
          Prefer: 'return=minimal',
        },
      }
    ),

  rpc: <T = any>(
    fn: string,
    body: any
  ) =>
    request<T>(
      `rpc/${fn}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
};
