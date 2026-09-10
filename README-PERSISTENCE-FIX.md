# OV Stock House – Permanent Supabase Save Fix

This build makes stock mutations database-confirmed instead of optimistic. A Stock In/Out success is shown only after Supabase returns successfully and the app refreshes from the database.

## Localhost
A `.env.local` is included for the Supabase project using the project publishable key. Keep `.env.local` out of Git; the included `.gitignore` does that.

## Vercel
Keep these Production environment variables configured:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

## Stock flow
Confirm Stock In/Out -> RPC `adjust_stock` -> database commit -> refresh -> success.

The app no longer changes the visible stock before the database confirms the update.
