-- Parent/master SKU + marketplace alternate SKU mapping.
-- One physical inventory product can be reached by multiple marketplace SKUs.

create table if not exists public.product_sku_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  platform text not null default 'Flipkart',
  marketplace_sku text not null,
  created_at timestamptz not null default now(),
  constraint product_sku_mappings_sku_nonempty check (btrim(marketplace_sku) <> '')
);

create unique index if not exists product_sku_mappings_unique_sku
  on public.product_sku_mappings(company_id, platform, lower(btrim(marketplace_sku)));
create index if not exists product_sku_mappings_product_idx
  on public.product_sku_mappings(product_id);
create index if not exists product_sku_mappings_lookup_idx
  on public.product_sku_mappings(company_id, lower(btrim(marketplace_sku)));

alter table public.product_sku_mappings enable row level security;
drop policy if exists product_sku_mappings_authenticated_read on public.product_sku_mappings;
drop policy if exists product_sku_mappings_authenticated_insert on public.product_sku_mappings;
drop policy if exists product_sku_mappings_authenticated_delete on public.product_sku_mappings;
create policy product_sku_mappings_authenticated_read on public.product_sku_mappings
for select to authenticated using (true);
create policy product_sku_mappings_authenticated_insert on public.product_sku_mappings
for insert to authenticated with check (true);
create policy product_sku_mappings_authenticated_delete on public.product_sku_mappings
for delete to authenticated using (true);

grant select, insert, delete on public.product_sku_mappings to authenticated;
