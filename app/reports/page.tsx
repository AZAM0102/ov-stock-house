'use client';

import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Shell, CompanyNotice, Stat } from '../components';
import { useStore, Movement, Order, ReturnRow } from '../store';
import { db, isSupabaseConfigured } from '../supabase';

const pad = (n:number) => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const formatDate = (value:string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${pad(d.getDate())}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
};
const formatDateTime = (value:string) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${formatDate(value)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function downloadWorkbook(
  rows: { summary:any[]; current:any[]; daily:any[]; movements:any[]; returns:any[] },
  filename:string,
) {
  const wb = XLSX.utils.book_new();
  const add = (name:string, data:any[]) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    if (range.e.c >= 0) ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
    ws['!cols'] = Object.keys(data[0] || {}).map(k => ({ wch: Math.min(Math.max(k.length + 4, 12), 28) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add('Summary', rows.summary);
  add('Current Stock', rows.current);
  add('Daily Platform Detail', rows.daily);
  add('Stock Movements', rows.movements);
  add('Returns', rows.returns);
  XLSX.writeFile(wb, filename);
}

export default function Reports(){
  const { companies, products, orders, returns, movements, selectedCompanyId } = useStore();
  const ps = products.filter(p => selectedCompanyId === 'all' || p.companyId === selectedCompanyId);
  const os = orders.filter(o => selectedCompanyId === 'all' || o.companyId === selectedCompanyId);
  const rs = returns.filter(r => selectedCompanyId === 'all' || r.companyId === selectedCompanyId);
  const shipped = os.reduce((a,o)=>a+o.items,0), returned = rs.reduce((a,r)=>a+r.qty,0);
  const [exportOpen, setExportOpen] = useState(false);
  const [from, setFrom] = useState(localDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [to, setTo] = useState(localDate());
  const [exportCompany, setExportCompany] = useState(selectedCompanyId);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const scopedCompanies = exportCompany === 'all' ? companies : companies.filter(c=>c.id===exportCompany);

  async function generateExcel(){
    setExportError('');
    if (!from || !to || from > to) { setExportError('Please select a valid From and To date.'); return; }
    if (!isSupabaseConfigured()) { setExportError('Supabase is not configured. Connect the app to the database before exporting.'); return; }
    setExporting(true);
    try {
      const start = new Date(`${from}T00:00:00`);
      const endExclusive = new Date(`${to}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate()+1);
      const startISO = start.toISOString();
      const endISO = endExclusive.toISOString();

      const companyFilter = exportCompany === 'all' ? '' : `&company_id=eq.${encodeURIComponent(exportCompany)}`;
      const [ms, afterMs, rr, oo] = await Promise.all([
        db.select<any>('inventory_movements', `select=*&created_at=gte.${encodeURIComponent(startISO)}&created_at=lt.${encodeURIComponent(endISO)}${companyFilter}&order=created_at.asc&limit=10000`),
        db.select<any>('inventory_movements', `select=*&created_at=gte.${encodeURIComponent(endISO)}${companyFilter}&order=created_at.asc&limit=10000`),
        db.select<any>('returns', `select=*&return_date=gte.${encodeURIComponent(startISO)}&return_date=lt.${encodeURIComponent(endISO)}${companyFilter}&order=return_date.asc&limit=10000`),
        db.select<any>('orders', `select=*&order_date=gte.${encodeURIComponent(startISO)}&order_date=lt.${encodeURIComponent(endISO)}${companyFilter}&order=order_date.asc&limit=10000`),
      ]);

      const companyMap = new Map(companies.map(c=>[c.id,c.name]));
      const productMap = new Map(products.map(p=>[p.id,p]));
      const selectedProducts = products.filter(p=>exportCompany === 'all' || p.companyId===exportCompany);
      const selectedIds = new Set(selectedProducts.map(p=>p.id));
      const periodMovements = (ms as any[]).filter(r=>selectedIds.has(r.product_id));
      const afterMovements = (afterMs as any[]).filter(r=>selectedIds.has(r.product_id));
      const periodReturns = (rr as any[]).filter(r=>selectedIds.has(r.product_id));
      const periodOrders = (oo as any[]).filter(r=>selectedIds.has(r.product_id));

      const netSigned = (arr:any[], productId:string) => arr.filter(r=>r.product_id===productId).reduce((sum,r)=>{
        const type = r.movement_type;
        return sum + (type==='stock_out' ? -Number(r.quantity||0) : Number(r.quantity||0));
      },0);

      const currentRows = selectedProducts.map(p=>{
        const afterNet = netSigned(afterMovements,p.id);
        const closing = p.stock - afterNet;
        const periodNet = netSigned(periodMovements,p.id);
        const opening = closing - periodNet;
        const ins = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='stock_in').reduce((s,r)=>s+Number(r.quantity||0),0);
        const outs = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='stock_out').reduce((s,r)=>s+Number(r.quantity||0),0);
        const rets = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='return').reduce((s,r)=>s+Number(r.quantity||0),0);
        return {
          Company:p.companyName, SKU:p.sku, 'Product Name':p.name, 'Opening Stock (Period)':opening,
          'Stock In':ins, 'Total Out':outs, 'Returns':rets, 'Closing Stock (To Date)':closing,
          'Live Current Stock':p.stock, 'Low Stock Limit':p.minStock, Status:p.status,
        };
      });

      const platformOut = new Map<string,any>();
      for (const r of periodMovements) {
        if (r.movement_type !== 'stock_out') continue;
        const p = productMap.get(r.product_id);
        if (!p) continue;
        const key = `${r.created_at.slice(0,10)}|${p.companyId}|${r.platform || 'Other'}|${r.product_id}`;
        const existing = platformOut.get(key) || {
          Date:r.created_at.slice(0,10), Company:p.companyName, Platform:r.platform || 'Other', SKU:p.sku, 'Product Name':p.name, Quantity:0,
        };
        existing.Quantity += Number(r.quantity||0);
        platformOut.set(key,existing);
      }
      // Keep an order-backed view available even where an order record exists without a movement row.
      for (const r of periodOrders) {
        const p = productMap.get(r.product_id);
        if (!p) continue;
        const key = `${r.order_date.slice(0,10)}|${p.companyId}|${r.platform || 'Other'}|${p.id}|orders`;
        const existing = platformOut.get(key);
        if (existing) continue;
        platformOut.set(key, {Date:r.order_date.slice(0,10), Company:p.companyName, Platform:r.platform || 'Other', SKU:p.sku, 'Product Name':p.name, Quantity:Number(r.quantity||0)});
      }

      const summaryRows:any[] = [];
      const totals = {stockIn:0,out:0,returns:0,amazon:0,flipkart:0,meesho:0,other:0};
      for (const p of selectedProducts) {
        const ins = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='stock_in').reduce((s,r)=>s+Number(r.quantity||0),0);
        const out = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='stock_out').reduce((s,r)=>s+Number(r.quantity||0),0);
        const ret = periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='return').reduce((s,r)=>s+Number(r.quantity||0),0);
        totals.stockIn+=ins; totals.out+=out; totals.returns+=ret;
        for (const x of periodMovements.filter(r=>r.product_id===p.id && r.movement_type==='stock_out')) {
          const platform=(x.platform||'Other').toLowerCase(); const q=Number(x.quantity||0);
          if(platform==='amazon') totals.amazon+=q; else if(platform==='flipkart') totals.flipkart+=q; else if(platform==='meesho') totals.meesho+=q; else totals.other+=q;
        }
      }
      const liveCurrent = selectedProducts.reduce((s,p)=>s+p.stock,0);
      const historicalClosing = currentRows.reduce((s,r)=>s+Number(r['Closing Stock (To Date)']||0),0);
      const periodOrdersUnits = periodOrders.reduce((s,r)=>s+Number(r.quantity||0),0);
      summaryRows.push(
        {Metric:'Report From',Value:formatDate(from+'T00:00:00')},
        {Metric:'Report To',Value:formatDate(to+'T00:00:00')},
        {Metric:'Company / Account',Value:scopedCompanies.map(c=>c.name).join(', ') || 'All Companies'},
        {Metric:'SKU Count',Value:selectedProducts.length},
        {Metric:'Closing Stock at To Date',Value:historicalClosing},
        {Metric:'Live Current Stock',Value:liveCurrent},
        {Metric:'Stock In During Period',Value:totals.stockIn},
        {Metric:'Stock Out During Period',Value:totals.out},
        {Metric:'Returns During Period',Value:totals.returns},
        {Metric:'Amazon Out',Value:totals.amazon},
        {Metric:'Flipkart Out',Value:totals.flipkart},
        {Metric:'Meesho Out',Value:totals.meesho},
        {Metric:'Other Out',Value:totals.other},
        {Metric:'Marketplace Order Units',Value:periodOrdersUnits},
      );

      const dailyRows = Array.from(platformOut.values()).sort((a,b)=>String(a.Date).localeCompare(String(b.Date)) || String(a.Company).localeCompare(String(b.Company)) || String(a.Platform).localeCompare(String(b.Platform)) || String(a.SKU).localeCompare(String(b.SKU)));
      const movementRows = periodMovements.map(r=>{
        const p=productMap.get(r.product_id);
        return {Date:formatDateTime(r.created_at),Company:companyMap.get(r.company_id)||p?.companyName||'',SKU:p?.sku||'', 'Product Name':p?.name||'',Type:r.movement_type==='stock_in'?'Stock In':r.movement_type==='stock_out'?'Stock Out':'Return',Quantity:Number(r.quantity||0),Platform:r.platform||'', 'Shipping Partner':r.shipping_partner||'',Note:r.note||''};
      });
      const returnRows = periodReturns.map(r=>{
        const p=productMap.get(r.product_id);
        return {Date:formatDateTime(r.return_date),Company:companyMap.get(r.company_id)||p?.companyName||'',SKU:p?.sku||'', 'Product Name':p?.name||'',Platform:r.platform||'',Quantity:Number(r.quantity||0), 'QC Status':r.qc_status==='pending'?'QC Pending':r.qc_status==='resellable'?'Resellable':'Damaged','Shipping Partner':r.shipping_partner||''};
      });

      const stamp = `${from}_to_${to}`;
      downloadWorkbook({summary:summaryRows,current:currentRows,daily:dailyRows,movements:movementRows,returns:returnRows}, `OV-Stock-House-Report-${stamp}.xlsx`);
      setExportOpen(false);
    } catch (e:any) {
      setExportError(e?.message || 'Could not generate the Excel report.');
    } finally { setExporting(false); }
  }

  return <Shell active="Reports" title="Reports">
    <div className="page-intro">
      <div><p className="eyebrow">ANALYTICS</p><h1>Reports & Analytics</h1><p className="muted">Live summaries from the selected company view.</p></div>
      <button className="btn primary" onClick={()=>{setExportCompany(selectedCompanyId);setExportOpen(true)}}>📊 Export Excel</button>
    </div>
    <CompanyNotice/>
    <div className="stats-grid"><Stat label="Current Stock" value={ps.reduce((a,p)=>a+p.stock,0)}/><Stat label="Units Shipped" value={shipped}/><Stat label="Return Units" value={returned} tone="orange"/><Stat label="Pending QC" value={rs.filter(r=>r.condition==='QC Pending').reduce((a,r)=>a+r.qty,0)} tone="purple"/></div>
    <div className="grid-2">
      <section className="card"><div className="card-head"><div><h2>Platform Performance</h2><p>Orders, shipped units and returned units</p></div></div><div className="report-list">{['Amazon','Flipkart','Meesho'].map(x=>{const a=os.filter(o=>o.platform===x),r=rs.filter(z=>z.platform===x);return <div className="report-row" key={x}><b>{x}</b><span>Orders <strong>{a.length}</strong></span><span>Units <strong>{a.reduce((n,o)=>n+o.items,0)}</strong></span><span>Returns <strong className="danger-text">{r.reduce((n,z)=>n+z.qty,0)}</strong></span></div>})}</div></section>
      <section className="card"><div className="card-head"><div><h2>Company Stock</h2><p>Current stock across the five Excel inventories</p></div></div><div className="company-report">{companies.map(c=>{const cp=products.filter(p=>p.companyId===c.id);return <div key={c.id}><span>{c.name}</span><b>{cp.reduce((a,p)=>a+p.stock,0)}</b><small>{cp.length} products</small></div>})}</div></section>
    </div>
    <section className="card table-card"><div className="card-head"><div><h2>Low Stock Report</h2><p>Products at or below their configured threshold</p></div></div><div className="table-wrap"><table><thead><tr><th>Company</th><th>SKU</th><th>Product</th><th>Current</th><th>Limit</th></tr></thead><tbody>{ps.filter(p=>p.stock<=p.minStock).sort((a,b)=>a.stock-b.stock).map(p=><tr key={p.id}><td>{p.companyName}</td><td className="sku-cell"><b>{p.sku}</b></td><td>{p.name||'Unnamed product'}</td><td className="danger-text"><b>{p.stock}</b></td><td>{p.minStock}</td></tr>)}</tbody></table></div></section>

    {exportOpen && <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setExportOpen(false)}}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="card-head"><div><p className="eyebrow">EXCEL EXPORT</p><h2 id="export-title">Generate Stock Report</h2><p>Select the date range and account/company.</p></div><button className="link-btn" onClick={()=>setExportOpen(false)}>✕ Close</button></div>
        <div className="form-grid">
          <label>From Date<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
          <label>To Date<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
          <label>Account / Company<select value={exportCompany} onChange={e=>setExportCompany(e.target.value)}><option value="all">All Companies</option>{companies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
        </div>
        <div className="export-preview">
          <b>Excel will contain</b>
          <span>Summary • Current Stock • Daily Platform Detail • Stock Movements • Returns</span>
          <small>Daily Platform Detail shows date-wise Stock Out by Amazon, Flipkart, Meesho and Other. Current Stock remains the live database stock; the report also calculates closing stock at the selected To Date.</small>
        </div>
        {exportError && <div className="warning-box"><b>Export failed</b><span>{exportError}</span></div>}
        <div className="modal-actions"><button className="btn ghost" onClick={()=>setExportOpen(false)}>Cancel</button><button className="btn primary" onClick={generateExcel} disabled={exporting}>{exporting?'Generating…':'Generate Excel'}</button></div>
      </section>
    </div>}
  </Shell>;
}
