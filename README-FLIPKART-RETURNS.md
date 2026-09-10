# Flipkart Return Import

The Returns page supports drag-and-drop `.xlsx`, `.xls`, and `.csv` Flipkart return reports.

## Flow
1. Select one company in the sidebar.
2. Drop the Flipkart return report on **Returns**.
3. Click **Analyze Return Sheet**.
4. SKU is resolved against the parent SKU and all marketplace/alternate SKU mappings, with exact spelling preferred.
5. Repeated rows for the same product are aggregated in the review screen, while every Return ID remains an individual auditable database record.
6. Click **Import Returns**. The batch is atomic and idempotent by `(company, platform, Return ID)`.
7. Imported returns enter **QC Pending**. **Pass QC** increases sellable stock and creates a `Return` inventory movement. **Damaged** never increases sellable stock.

## Important safety behavior
- `YET_TO_REACH` / `OUT_FOR_DELIVERY` rows are not automatically added to sellable stock.
- Re-uploading the same report skips already imported Return IDs.
- Unknown SKUs block the entire import until the SKU is mapped in Products.
- A repeated SKU such as `GR-DFL-01` is counted across all its rows, but is not double-created as one return record.
