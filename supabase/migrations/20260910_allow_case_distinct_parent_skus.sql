-- Parent SKUs may legitimately differ only by letter case.
-- Keep the exact (company_id, sku) uniqueness rule and remove the older
-- case-insensitive parent-SKU index so exact Excel SKU spelling is preserved.
drop index if exists public.products_company_sku_unique_idx;
