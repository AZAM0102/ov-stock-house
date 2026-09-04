# Flipkart PDF Bulk Upload

## Safe flow
1. Select one company.
2. Upload a selectable-text Flipkart label PDF.
3. Analyze the label pages.
4. Match exact company SKUs.
5. Preview units and insufficient-stock warnings.
6. Confirm once.
7. The browser sends one batch to `process_flipkart_batch()`.
8. The database transaction creates stock-out movements and order rows atomically.
9. Re-uploading the same PDF skips already-recorded `(company, platform, marketplace order ID, SKU)` lines.

## Quantity safety
The parser trusts explicit `QTY` / `QUANTITY` markers. It does not use arbitrary numbers from the label as quantity because AWB, price, date and other numeric values can otherwise corrupt stock.

If a label has the same SKU twice, the two occurrences are aggregated into one order line for that marketplace order/SKU.

## Limitation
The browser parser requires selectable text. Image-only/scanned PDFs are not OCR-enabled in this version.
