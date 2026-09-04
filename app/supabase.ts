const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://svnrrtzpixckiutlitur.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_6qI3gdSka_O0QfDlowgZRg_4w3C1Xbt';

export function isSupabaseConfigured(){ return Boolean(SUPABASE_URL && SUPABASE_KEY); }

async function request(path:string, options:RequestInit={}){
  if(!isSupabaseConfigured()) throw new Error('Supabase environment variables are missing.');
  const res=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{
    ...options,
    headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json',...(options.headers||{})},
  });
  if(!res.ok){const text=await res.text();throw new Error(text||`Supabase request failed (${res.status})`)}
  const text=await res.text(); return text?JSON.parse(text):null;
}
export const db={
  select:<T=any>(table:string,query='select=*')=>request<T[]>(`${table}?${query}`),
  insert:<T=any>(table:string,body:any)=>request<T[]>(table,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}),
  update:<T=any>(table:string,filter:string,body:any)=>request<T[]>(`${table}?${filter}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)}),
  remove:(table:string,filter:string)=>request(table,{method:'DELETE',headers:{Prefer:'return=minimal'},body:undefined}),
  rpc:<T=any>(fn:string,body:any)=>request<T>(`rpc/${fn}`,{method:'POST',body:JSON.stringify(body)}),
};
