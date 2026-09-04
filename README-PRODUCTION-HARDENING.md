# Production Hardening Checklist

1. Apply `supabase/migrations/20260905_ov_stock_house_production.sql`.
2. Create at least one authorized Supabase Auth email/password user.
3. Configure Vercel environment variables.
4. Sign in through `/login`.
5. Test Stock In, Stock Out, oversell rejection, manual order, duplicate marketplace order, return QC, and Flipkart bulk upload.
6. Verify Excel closing stock against the live database.
7. Do not re-enable anonymous CRUD policies.
8. Do not expose a service-role/secret key in the browser.
