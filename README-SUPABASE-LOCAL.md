# Local Supabase connection

This build includes a client-side fallback for the Supabase project URL and publishable key so the local app can connect even when `.env.local` has not been created.

For deployment, environment variables are still preferred:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

Do not add any Supabase service-role/secret key to the project.
