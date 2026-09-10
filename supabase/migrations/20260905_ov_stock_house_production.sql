-- OV Stock House production hardening
-- Run this migration on the existing Supabase project before deploying the new UI.

alter table public.products
  add column if not exists is_active boolean not null default true;

alter table public.orders
  add column if not exists marketplace_order_id text;

create unique index if not exists orders_marketplace_unique_idx
  on public.orders (company_id, platform, marketplace_order_id, product_id)
  where marketplace_order_id is not null and btrim(marketplace_order_id) <> '';

create unique index if not exists products_company_sku_unique_idx
  on public.products (company_id, lower(btrim(sku)));

create index if not exists products_company_id_idx on public.products(company_id);
create index if not exists products_active_idx on public.products(is_active);
create index if not exists movements_product_created_idx on public.inventory_movements(product_id, created_at desc);
create index if not exists orders_company_date_idx on public.orders(company_id, order_date desc);
create index if not exists returns_company_date_idx on public.returns(company_id, return_date desc);

-- Existing products must never have their opening balance edited. Stock changes
-- happen only through Stock In, Stock Out, or a QC-approved return.
create or replace function public.prevent_opening_stock_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.opening_stock <> old.opening_stock then
    raise exception 'Opening stock is locked after product creation. Use Stock In or Stock Out.';
  end if;
  if new.company_id <> old.company_id then
    raise exception 'Product company cannot be changed after creation.';
  end if;
  return new;
end;
$$;

drop trigger if exists products_protect_inventory_fields on public.products;
create trigger products_protect_inventory_fields
before update on public.products
for each row execute function public.prevent_opening_stock_change();

-- Remove broad browser privileges. RPCs below perform protected writes atomically.
revoke all on table public.companies from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.inventory_movements from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.returns from anon, authenticated;

-- Read access for signed-in users.
grant select on public.companies to authenticated;
grant select on public.products to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.orders to authenticated;
grant select on public.returns to authenticated;

-- Product master writes: no direct stock-counter writes and no hard delete.
grant insert (company_id, sku, product_name, barcode, opening_stock, low_stock_limit) on public.products to authenticated;
grant update (sku, product_name, barcode, low_stock_limit, is_active) on public.products to authenticated;

-- New returns can be created as QC pending only. Processing happens via RPC.
grant insert (company_id, product_id, platform, quantity, shipping_partner, return_date) on public.returns to authenticated;

alter table public.companies enable row level security;
alter table public.products enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.orders enable row level security;
alter table public.returns enable row level security;

drop policy if exists "anon manage companies" on public.companies;
drop policy if exists "anon read companies" on public.companies;
drop policy if exists "authenticated users can manage companies" on public.companies;
drop policy if exists "authenticated users can read companies" on public.companies;
drop policy if exists companies_anon_manage on public.companies;
drop policy if exists companies_authenticated_manage on public.companies;
drop policy if exists companies_authenticated_read on public.companies;
create policy companies_authenticated_read on public.companies
for select to authenticated using (true);

drop policy if exists "anon manage products" on public.products;
drop policy if exists "anon read products" on public.products;
drop policy if exists "authenticated users can manage products" on public.products;
drop policy if exists "authenticated users can read products" on public.products;
drop policy if exists products_anon_manage on public.products;
drop policy if exists products_authenticated_manage on public.products;
drop policy if exists products_authenticated_read on public.products;
drop policy if exists products_authenticated_insert on public.products;
drop policy if exists products_authenticated_update on public.products;
create policy products_authenticated_read on public.products
for select to authenticated using (is_active = true);
create policy products_authenticated_insert on public.products
for insert to authenticated
with check (
  is_active = true
  and opening_stock >= 0
  and low_stock_limit >= 0
  and received = 0
  and shipped = 0
  and returned = 0
);
create policy products_authenticated_update on public.products
for update to authenticated
using (true)
with check (low_stock_limit >= 0);

drop policy if exists "anon read movements" on public.inventory_movements;
drop policy if exists "authenticated users can manage movements" on public.inventory_movements;
drop policy if exists "authenticated users can read movements" on public.inventory_movements;
drop policy if exists movements_anon_read on public.inventory_movements;
drop policy if exists movements_authenticated_read on public.inventory_movements;
create policy movements_authenticated_read on public.inventory_movements
for select to authenticated using (true);

drop policy if exists "anon read orders" on public.orders;
drop policy if exists "authenticated users can manage orders" on public.orders;
drop policy if exists "authenticated users can read orders" on public.orders;
drop policy if exists orders_anon_read on public.orders;
drop policy if exists orders_authenticated_read on public.orders;
create policy orders_authenticated_read on public.orders
for select to authenticated using (true);

drop policy if exists "anon read returns" on public.returns;
drop policy if exists "authenticated users can manage returns" on public.returns;
drop policy if exists "authenticated users can read returns" on public.returns;
drop policy if exists returns_anon_manage on public.returns;
drop policy if exists returns_authenticated_manage on public.returns;
drop policy if exists returns_authenticated_read on public.returns;
drop policy if exists returns_authenticated_insert on public.returns;
create policy returns_authenticated_read on public.returns
for select to authenticated using (true);
create policy returns_authenticated_insert on public.returns
for insert to authenticated
with check (qc_status = 'pending' and quantity > 0);

-- Atomic manual order creation. Stock deduction + movement + order row are one transaction.
create or replace function public.create_order(
  p_company_id uuid,
  p_product_id uuid,
  p_platform text,
  p_quantity integer,
  p_shipping_partner text default null,
  p_order_date timestamptz default now(),
  p_marketplace_order_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.products%rowtype;
  new_stock integer;
  clean_order_id text;
  order_uuid uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_quantity <= 0 then raise exception 'Order quantity must be greater than zero'; end if;
  if p_platform is null or btrim(p_platform) = '' then raise exception 'Platform is required'; end if;

  clean_order_id := nullif(btrim(p_marketplace_order_id), '');

  if clean_order_id is not null and exists (
    select 1 from public.orders
    where company_id=p_company_id and platform=p_platform and marketplace_order_id=clean_order_id and product_id=p_product_id
  ) then
    raise exception 'Duplicate marketplace order already exists for this SKU';
  end if;

  select * into p
  from public.products pr
  where pr.id=p_product_id and pr.company_id=p_company_id and pr.is_active=true
  for update;
  if not found then raise exception 'Product not found for the selected company'; end if;

  new_stock := p.opening_stock + p.received + p.returned - p.shipped - p_quantity;
  if new_stock < 0 then raise exception 'Stock Out quantity cannot exceed available stock'; end if;

  update public.products
  set shipped=shipped+p_quantity, updated_at=now()
  where id=p.id;

  insert into public.inventory_movements(company_id,product_id,movement_type,quantity,platform,shipping_partner,note)
  values(p.company_id,p.id,'stock_out',p_quantity,p_platform,p_shipping_partner,'Marketplace order');

  insert into public.orders(company_id,product_id,platform,quantity,shipping_partner,order_date,marketplace_order_id)
  values(p_company_id,p_product_id,p_platform,p_quantity,p_shipping_partner,p_order_date,clean_order_id)
  returning id into order_uuid;

  return jsonb_build_object('order_id',order_uuid,'product_id',p.id,'stock',new_stock);
end;
$$;

-- Atomic Flipkart bulk import. The entire batch commits or rolls back together.
-- Existing (company, platform, marketplace_order_id, product) rows are skipped so
-- re-uploading the same PDF is safe and idempotent.
create or replace function public.process_flipkart_batch(
  p_company_id uuid,
  p_orders jsonb,
  p_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  p public.products%rowtype;
  clean_order_id text;
  v_product_id uuid;
  qty integer;
  shipping_partner text;
  processed integer := 0;
  skipped integer := 0;
  units_processed integer := 0;
  units_skipped integer := 0;
  new_stock integer;
  order_uuid uuid;
  v_platform text := 'Flipkart';
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_orders) <> 'array' then raise exception 'Flipkart order payload must be an array'; end if;

  for item in select * from jsonb_array_elements(p_orders)
  loop
    clean_order_id := nullif(btrim(item->>'order_id'), '');
    v_product_id := (item->>'product_id')::uuid;
    qty := (item->>'qty')::integer;
    shipping_partner := nullif(btrim(coalesce(item->>'shipping_partner','')), '');

    if clean_order_id is null then raise exception 'Flipkart order ID is missing'; end if;
    if qty is null or qty <= 0 then raise exception 'Invalid quantity for Flipkart order %', clean_order_id; end if;

    if exists (
      select 1 from public.orders o
      where o.company_id=p_company_id and o.platform=v_platform and o.marketplace_order_id=clean_order_id and o.product_id=v_product_id
    ) then
      skipped := skipped + 1;
      units_skipped := units_skipped + qty;
      continue;
    end if;

    select * into p
    from public.products pr
    where pr.id=v_product_id and pr.company_id=p_company_id and pr.is_active=true
    for update;
    if not found then raise exception 'SKU/product % not found for selected company', item->>'sku'; end if;

    new_stock := p.opening_stock + p.received + p.returned - p.shipped - qty;
    if new_stock < 0 then
      raise exception 'SKU % has only % stock but % Flipkart units are required', p.sku, (p.opening_stock+p.received+p.returned-p.shipped), qty;
    end if;

    update public.products set shipped=shipped+qty, updated_at=now() where id=p.id;

    insert into public.inventory_movements(company_id,product_id,movement_type,quantity,platform,shipping_partner,note)
    values(p.company_id,p.id,'stock_out',qty,v_platform,shipping_partner,
      concat('Flipkart label ',clean_order_id,case when p_file_name is not null then concat(' • PDF: ',p_file_name) else '' end));

    insert into public.orders(company_id,product_id,platform,quantity,shipping_partner,order_date,marketplace_order_id)
    values(p_company_id,p.id,v_platform,qty,shipping_partner,now(),clean_order_id)
    returning id into order_uuid;

    processed := processed + 1;
    units_processed := units_processed + qty;
  end loop;

  return jsonb_build_object(
    'processed',processed,
    'skipped',skipped,
    'units_processed',units_processed,
    'units_skipped',units_skipped
  );
end;
$$;

-- Existing stock RPCs stay available to signed-in users only.
revoke execute on function public.adjust_stock(uuid, integer, text, text, text, text) from public, anon;
revoke execute on function public.process_return(uuid, text) from public, anon;
grant execute on function public.adjust_stock(uuid, integer, text, text, text, text) to authenticated;
grant execute on function public.process_return(uuid, text) to authenticated;
grant execute on function public.create_order(uuid, uuid, text, integer, text, timestamptz, text) to authenticated;
grant execute on function public.process_flipkart_batch(uuid, jsonb, text) to authenticated;
revoke execute on function public.create_order(uuid, uuid, text, integer, text, timestamptz, text) from public, anon;
revoke execute on function public.process_flipkart_batch(uuid, jsonb, text) from public, anon;
