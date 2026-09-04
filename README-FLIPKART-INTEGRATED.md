# OV Stock House — v3 + Flipkart Label Import

This project is based on the OV Stock House Mobile App v3 SKU Suggestions build and integrates
the Flipkart bulk label PDF workflow.

## Flipkart workflow

1. Select a specific company from the sidebar.
2. Open **Flipkart Upload**.
3. Upload a Flipkart shipping-label PDF.
4. Analyze the PDF.
5. The app reads the label section before `Tax Invoice`, so invoice-side SKU repeats are not double counted.
6. Exact existing company SKUs are matched case-insensitively.
7. Same SKU repeated twice on a label counts as 2 units.
8. Different SKUs on one label are counted separately.
9. A normal explicit quantity such as QTY 2 is counted as 2.
10. Unknown SKUs or insufficient stock block the update.
11. Confirming the update creates one Flipkart order ledger record per label/order+SKU and one Stock Out movement per order.
12. Platform is fixed to Flipkart and shipping partner is recorded as E-Kart Logistics.
13. Re-uploading the same labels skips already-recorded order+SKU records to avoid duplicate deductions.

## Important

- The PDF parser is intended for text/selectable Flipkart labels. Image-only scanned PDFs would need OCR.
- `.env.local` is intentionally excluded from this distributable ZIP. Configure Supabase in your local `.env.local`
  or Vercel Environment Variables using `.env.example`.
- Keep the Supabase publishable/anon key in environment variables; never commit secret/service-role keys.
