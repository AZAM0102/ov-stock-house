# OV Stock House — Production-Hardened

OV Stock House is a Supabase-backed inventory command center for five company inventories.

## Included
- 5 companies / 86 products with exact Excel SKUs preserved
- Live Supabase source of truth
- Stock In / Stock Out with locked inventory counters
- Barcode/manual SKU scanner
- Atomic marketplace order creation
- Marketplace Order ID duplicate protection
- Returns → QC Pending → Resellable / Damaged
- Atomic Flipkart PDF bulk processing
- Idempotent Flipkart re-upload protection
- Excel reports
- Product archive instead of destructive delete
- Supabase Auth login and signed-in database requests
- Production RLS and least-privilege table/function permissions

## First-time production setup

### 1. Environment variables
Copy `.env.example` to `.env.local` for local development and set:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never add a Supabase service-role/secret key to browser code.

### 2. Apply the database migration
Run the SQL in:

`supabase/migrations/20260905_ov_stock_house_production.sql`

Use the Supabase SQL Editor for a quick one-time setup, or add the file to your normal Supabase migration workflow.

The migration:
- adds `products.is_active`
- adds `orders.marketplace_order_id`
- adds SKU/order indexes
- locks opening stock/company after product creation
- removes anonymous CRUD access
- grants only required authenticated permissions
- restricts RPC execution to authenticated users
- creates atomic `create_order()` and `process_flipkart_batch()` functions

### 3. Create the admin user
In Supabase Dashboard → Authentication → Users, create the authorized email/password account used to access OV Stock House.

This project intentionally has no public sign-up screen.

### 4. Vercel
Set the same two public environment variables in the Vercel project for Production/Preview as required.

## Inventory rules
- Opening Stock is editable only when creating a new product.
- Existing stock changes must go through Stock In, Stock Out, or QC-approved Resellable returns.
- Orders deduct stock and create the order + movement in one database transaction.
- Flipkart batches are processed atomically; if any new line fails, the complete batch rolls back.
- Re-uploading the same Flipkart labels skips already-recorded order lines.
- Products with history are archived, not deleted.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm start
```
