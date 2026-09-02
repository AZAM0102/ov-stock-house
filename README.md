# OV Stock House — Supabase Connected

OV Stock House is now connected to the Supabase project configured in `.env.local`.

## Cloud data
- 5 companies
- 86 products
- Exact Excel SKUs preserved
- 4,135 current stock units at migration time
- Imported stock-in movement history
- Orders and returns tables ready for live use
- Atomic stock update and return-QC database functions
- Automatic refresh every 8 seconds so multiple devices converge on cloud data

## Important
The browser no longer stores inventory/order/return data in localStorage. Supabase is the source of truth. Only the selected-company preference is stored locally.

The current UI has no login screen, so the app currently uses the Supabase publishable key with temporary `anon` CRUD policies. Before public production deployment, add Supabase Auth and tighten RLS policies to authenticated users/roles.

## Environment
Copy `.env.example` to `.env.local` and set:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

The publishable key is safe for browser use; never expose a Supabase service-role key in client code.
