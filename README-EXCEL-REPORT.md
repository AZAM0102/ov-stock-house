# OV Stock House - Excel Report Export

The Reports page now has **Export Excel**.

Choose:
- From Date
- To Date
- Account / Company (All Companies or one company)

The generated `.xlsx` workbook contains:
1. Summary
2. Current Stock
3. Daily Platform Detail
4. Stock Movements
5. Returns

Daily Platform Detail is based on recorded Stock Out movements and includes Date, Company, Platform, SKU, Product Name and Quantity. Platforms include Amazon, Flipkart, Meesho and Other.

The report also calculates stock at the selected To Date from the current stock and later movements, while preserving the live current stock separately.

Run `npm install` after extracting because the export feature adds the `xlsx` package.
