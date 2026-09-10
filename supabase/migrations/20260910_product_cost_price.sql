-- Product cost price / inventory valuation
-- Cost Price = internal inventory cost per piece, not marketplace selling price.

alter table public.products
  add column if not exists cost_price numeric(12,2) not null default 0
  check (cost_price >= 0);

-- Give existing products a temporary demo cost so the valuation feature is populated.
-- These values are intentionally temporary and can be edited from Products > Edit Product.
update public.products
set cost_price = floor(random() * 901) + 100
where cost_price = 0;

-- Product master writes: allow authenticated users to maintain cost price.
grant insert (company_id, sku, product_name, barcode, opening_stock, low_stock_limit, cost_price)
  on public.products to authenticated;
grant update (sku, product_name, barcode, low_stock_limit, is_active, cost_price)
  on public.products to authenticated;
