# GOLDPEARLS Parent SKU Update

This build is prepared from `GOLD PEARL DATA(2).xlsx`.

- 13 parent/master SKUs
- 52 alternate/marketplace SKUs
- Parent stock is the single stock bucket used by all mapped SKUs
- Exact SKU spelling is preserved
- SKU resolution uses exact match first, then case-insensitive fallback only when unambiguous
- Flipkart PDF parsing supports mapped marketplace SKUs
- Cost Price and Inventory Value are retained
- Supabase remains the source of truth

The migration `20260910_allow_case_distinct_parent_skus.sql` removes the legacy case-insensitive
parent SKU unique index while retaining the exact `(company_id, sku)` unique constraint.
