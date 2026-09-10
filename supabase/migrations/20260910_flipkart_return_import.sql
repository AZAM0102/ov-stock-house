-- Flipkart return import: keep every marketplace return auditable and idempotent.
alter table public.returns
  add column if not exists marketplace_return_id text,
  add column if not exists marketplace_order_id text,
  add column if not exists source_status text,
  add column if not exists return_type text,
  add column if not exists return_reason text,
  add column if not exists return_sub_reason text,
  add column if not exists source_file text;

create unique index if not exists returns_company_marketplace_return_unique
  on public.returns(company_id, platform, marketplace_return_id)
  where marketplace_return_id is not null and btrim(marketplace_return_id) <> '';

create index if not exists returns_marketplace_order_idx
  on public.returns(company_id, platform, marketplace_order_id);

-- Bulk Flipkart return import. It ONLY creates QC Pending rows.
-- Stock is increased only when the operator passes QC through process_return.
-- Re-uploading the same return sheet is safe because Return ID is idempotent.
create or replace function public.process_flipkart_return_batch(
  p_company_id uuid,
  p_returns jsonb,
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
  clean_return_id text;
  clean_order_id text;
  v_product_id uuid;
  qty integer;
  source_status text;
  return_type text;
  return_reason text;
  return_sub_reason text;
  shipping_partner text;
  return_date timestamptz;
  inserted_count integer := 0;
  skipped_count integer := 0;
  units_inserted integer := 0;
  units_skipped integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_returns) <> 'array' then raise exception 'Return payload must be an array'; end if;

  for item in select * from jsonb_array_elements(p_returns)
  loop
    clean_return_id := nullif(btrim(coalesce(item->>'return_id','')), '');
    clean_order_id := nullif(btrim(coalesce(item->>'order_id','')), '');
    v_product_id := (item->>'product_id')::uuid;
    qty := (item->>'qty')::integer;
    source_status := nullif(btrim(coalesce(item->>'source_status','')), '');
    return_type := nullif(btrim(coalesce(item->>'return_type','')), '');
    return_reason := nullif(btrim(coalesce(item->>'return_reason','')), '');
    return_sub_reason := nullif(btrim(coalesce(item->>'return_sub_reason','')), '');
    shipping_partner := nullif(btrim(coalesce(item->>'shipping_partner','')), '');
    return_date := coalesce(nullif(item->>'return_date','')::timestamptz, now());

    if clean_return_id is null then raise exception 'Flipkart Return ID is missing'; end if;
    if v_product_id is null then raise exception 'Product ID is missing for return %', clean_return_id; end if;
    if qty is null or qty <= 0 then raise exception 'Invalid return quantity for %', clean_return_id; end if;

    if exists (
      select 1 from public.returns r
      where r.company_id=p_company_id and r.platform='Flipkart' and r.marketplace_return_id=clean_return_id
    ) then
      skipped_count := skipped_count + 1;
      units_skipped := units_skipped + qty;
      continue;
    end if;

    select * into p
    from public.products pr
    where pr.id=v_product_id and pr.company_id=p_company_id and pr.is_active=true;
    if not found then raise exception 'SKU/product % not found for selected company', item->>'sku'; end if;

    insert into public.returns(
      company_id, product_id, platform, quantity, qc_status,
      shipping_partner, return_date, marketplace_return_id,
      marketplace_order_id, source_status, return_type,
      return_reason, return_sub_reason, source_file
    ) values (
      p_company_id, p.id, 'Flipkart', qty, 'pending',
      shipping_partner, return_date, clean_return_id,
      clean_order_id, source_status, return_type,
      return_reason, return_sub_reason, p_file_name
    );

    inserted_count := inserted_count + 1;
    units_inserted := units_inserted + qty;
  end loop;

  return jsonb_build_object(
    'processed', inserted_count,
    'skipped', skipped_count,
    'units_processed', units_inserted,
    'units_skipped', units_skipped
  );
end;
$$;

revoke execute on function public.process_flipkart_return_batch(uuid, jsonb, text) from public, anon;
grant execute on function public.process_flipkart_return_batch(uuid, jsonb, text) to authenticated;
