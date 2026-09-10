'use client';

import { useEffect, useMemo, useState } from 'react';
import { Shell, CompanyNotice } from '../components';
import { useStore, resolveProductBySku } from '../store';
import * as XLSX from 'xlsx';
import { db } from '../supabase';

type ParsedReturn = {
  returnId: string;
  orderId: string;
  sku: string;
  qty: number;
  productId: string;
  productName: string;
  stock: number;
  sourceStatus: string;
  returnType: string;
  reason: string;
  subReason: string;
  shippingPartner: string;
  returnDate: string;
};

type ReturnRow = {
  sku: string;
  productName: string;
  productId: string;
  qty: number;
  returnCount: number;
  stock: number;
  sourceStatuses: string[];
};

const text = (v: unknown) => String(v ?? '').trim();
const key = (v: unknown) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, '');

function parseDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = text(value);
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const m = raw.match(/^(\d{1,2})\s+([A-Za-z]+),\s*(\d{4})$/);
  if (m) {
    const d2 = new Date(`${m[1]} ${m[2]} ${m[3]}`);
    if (!Number.isNaN(d2.getTime())) return d2.toISOString();
  }
  return new Date().toISOString();
}

export default function Returns() {
  const { companies, products, returns, selectedCompanyId, addReturn, processReturn } = useStore();
  const [company, setCompany] = useState(selectedCompanyId === 'all' ? '' : selectedCompanyId);
  const [platform, setPlatform] = useState('Amazon');
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState(1);
  const [partner, setPartner] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState<ParsedReturn[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => { if (selectedCompanyId !== 'all') setCompany(selectedCompanyId); }, [selectedCompanyId]);

  const list = returns.filter(r => selectedCompanyId === 'all' || r.companyId === selectedCompanyId);
  const selectedProducts = products.filter(p => p.companyId === company);
  const totalUnits = useMemo(() => parsed.reduce((a, r) => a + r.qty, 0), [parsed]);
  const grouped = useMemo<ReturnRow[]>(() => {
    const map = new Map<string, ReturnRow>();
    for (const r of parsed) {
      const old = map.get(r.productId);
      map.set(r.productId, {
        sku: r.sku, productName: r.productName, productId: r.productId,
        qty: (old?.qty || 0) + r.qty, returnCount: (old?.returnCount || 0) + 1,
        stock: r.stock, sourceStatuses: [...new Set([...(old?.sourceStatuses || []), r.sourceStatus].filter(Boolean))],
      });
    }
    return [...map.values()];
  }, [parsed]);

  function selectFile(next: File | null) {
    if (!next) return;
    const lower = next.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls') && !lower.endsWith('.csv')) {
      alert('Sirf Flipkart Return Excel/CSV file upload karo.');
      return;
    }
    setFile(next); setParsed([]); setUnknown([]); setStatus(''); setUpdated(false);
  }

  function resetImport() {
    setFile(null); setParsed([]); setUnknown([]); setStatus(''); setUpdated(false);
  }

  async function analyzeFile() {
    if (!file) return;
    if (!company || company === 'all') { alert('Pehle sidebar se ek specific company select karo.'); return; }
    try {
      setBusy(true); setUpdated(false); setStatus('Reading Flipkart return sheet...');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      const find = (row: Record<string, unknown>, ...names: string[]) => {
        const entries = Object.entries(row);
        for (const wanted of names) {
          const hit = entries.find(([h]) => key(h) === key(wanted)); if (hit) return hit[1];
        }
        for (const wanted of names) {
          const hit = entries.find(([h]) => key(h).includes(key(wanted)) || key(wanted).includes(key(h))); if (hit) return hit[1];
        }
        return '';
      };
      const out: ParsedReturn[] = []; const missing: string[] = []; const seen = new Set<string>();
      for (const row of rawRows) {
        const rawSku = text(find(row, 'SKU')); const returnId = text(find(row, 'Return ID', 'ReturnID')); const orderId = text(find(row, 'Order ID', 'OrderID')); const quantity = Number(find(row, 'Quantity', 'Qty')) || 0;
        if (!returnId || !rawSku || quantity < 1 || seen.has(returnId.toLowerCase())) continue;
        seen.add(returnId.toLowerCase());
        const p = resolveProductBySku(selectedProducts, company, rawSku);
        if (!p) { missing.push(rawSku); continue; }
        out.push({
          returnId, orderId, sku: rawSku, qty: quantity, productId: p.id, productName: p.name, stock: p.stock,
          sourceStatus: text(find(row, 'Yet to reach you/Handed over today', 'Return Status')),
          returnType: text(find(row, 'Return Type')), reason: text(find(row, 'Return Reason')),
          subReason: text(find(row, 'Return Sub-reason')), shippingPartner: text(find(row, 'Returns vendor Name')),
          returnDate: parseDate(find(row, 'Return Requested Date', 'Return Approval Date')),
        });
      }
      setParsed(out); setUnknown([...new Set(missing)]);
      setStatus(`Analysis complete: ${out.length} return records • ${out.reduce((a,r)=>a+r.qty,0)} units • ${new Set(out.map(r=>r.sku)).size} SKUs`);
    } catch (e) { setStatus(''); alert(e instanceof Error ? e.message : 'Return sheet analyze nahi ho saka.'); }
    finally { setBusy(false); }
  }

  async function importReturns() {
    if (!parsed.length || unknown.length) return;
    const ok = confirm(`Flipkart ke ${totalUnits} return units ko QC Pending me import kiya jayega.\n\nStock abhi increase nahi hoga. QC Pass karne par stock automatically add hoga.\n\nContinue?`);
    if (!ok) return;
    try {
      setBusy(true); setStatus('Importing Flipkart returns...');
      const result = await db.rpc<{processed:number;skipped:number;units_processed:number;units_skipped:number}>('process_flipkart_return_batch', {
        p_company_id: company,
        p_file_name: file?.name || 'Flipkart Return Sheet',
        p_returns: parsed.map(r => ({
          return_id: r.returnId, order_id: r.orderId, product_id: r.productId, sku: r.sku, qty: r.qty,
          source_status: r.sourceStatus, return_type: r.returnType, return_reason: r.reason,
          return_sub_reason: r.subReason, shipping_partner: r.shippingPartner, return_date: r.returnDate,
        })),
      });
      const message = `Imported ${Number(result?.processed || 0)} new return records (${Number(result?.units_processed || 0)} units). ${Number(result?.skipped || 0)} duplicate records skipped.`;
      setStatus(message); setUpdated(true); alert(message); window.location.reload();
    } catch (e) { setStatus(''); alert((e instanceof Error ? e.message : 'Return import failed.') + '\n\nNo partial batch was committed.'); }
    finally { setBusy(false); }
  }

  const p = resolveProductBySku(products, company, sku);
  async function addManual() {
    if (!p || qty < 1) return;
    await addReturn({ companyId: company, sku: sku.trim(), platform, qty, condition: 'QC Pending', shippingPartner: partner, date: new Date().toISOString(), source: 'App' });
    setSku(''); setQty(1);
  }

  return <Shell active="Returns" title="Returns">
    <div className="page-intro"><div><p className="eyebrow">RETURNS & QC</p><h1>Returns</h1><p className="muted">Any company select karke Flipkart Return Sheet upload karo. Duplicate Return IDs safe rahenge, repeated SKUs aggregate honge, aur QC Pass ke baad hi sellable stock increase hoga.</p></div></div>
    <CompanyNotice />

    <div className="stats-grid">
      <StatBox label="Total Return Units" value={list.reduce((a,r)=>a+r.qty,0)} />
      <StatBox label="QC Pending" value={list.filter(r=>r.condition==='QC Pending').reduce((a,r)=>a+r.qty,0)} />
      <StatBox label="Resellable" value={list.filter(r=>r.condition==='Resellable').reduce((a,r)=>a+r.qty,0)} />
      <StatBox label="Damaged" value={list.filter(r=>r.condition==='Damaged').reduce((a,r)=>a+r.qty,0)} />
    </div>

    <section className="card settings-card">
      <h2>Flipkart Return Excel / CSV Import</h2>
      <div className="form-grid" style={{marginBottom:14}}><label>Company for Return Import<select value={company} onChange={e=>{setCompany(e.target.value);setFile(null);setParsed([]);setUnknown([]);setStatus('');setUpdated(false)}}><option value="">Select company</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><div className="import-note" style={{alignSelf:'end'}}>Return Excel/CSV is processed only against the selected company's Parent + Alternate SKU mappings.</div></div>
      <div className={`upload-box ${dragOver?'drag-over':''}`}
        onDragOver={e=>{e.preventDefault();setDragOver(true)}}
        onDragLeave={()=>setDragOver(false)}
        onDrop={e=>{e.preventDefault();setDragOver(false);selectFile(e.dataTransfer.files?.[0]||null)}}>
        <input id="return-file" type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={e=>selectFile(e.target.files?.[0]||null)} />
        <label htmlFor="return-file" className="upload-label">{file ? file.name : 'Drag & drop Flipkart Return Excel / CSV here or click to choose'}</label>
      </div>
      <div className="modal-actions"><button className="btn secondary" onClick={resetImport} disabled={busy}>Clear</button><button className="btn primary" onClick={analyzeFile} disabled={!file||busy||!company||company==='all'}>{busy?'Analyzing...':'Analyze Return Sheet'}</button></div>
      {status && <div className="company-notice"><b>Flipkart Returns</b><span>{status}</span></div>}
    </section>

    {parsed.length>0 && <section className="card table-card" style={{marginTop:18}}>
      <div className="card-head"><div><h2>Review Before Import</h2><p>{parsed.length} Return IDs • {totalUnits} units • {grouped.length} unique parent products</p></div><span className={`badge ${unknown.length?'out-of-stock':'in-stock'}`}>{unknown.length?'Needs Attention':'Ready'}</span></div>
      <div className="table-wrap"><table><thead><tr><th>SKU</th><th>Product</th><th>Return Records</th><th>Units</th><th>Current Stock</th><th>Source Status</th></tr></thead><tbody>{grouped.map(r=><tr key={r.productId}><td className="sku-cell"><b>{r.sku}</b></td><td>{r.productName}</td><td>{r.returnCount}</td><td><b>{r.qty}</b></td><td>{r.stock}</td><td>{r.sourceStatuses.join(', ') || '—'}</td></tr>)}</tbody></table></div>
      {unknown.length>0&&<div className="alert-box danger-alert"><b>Unknown SKU detected</b><p>{unknown.join(', ')}</p><small>Stock update/import disabled. Products me exact Parent ya Alternate SKU mapping add karo.</small></div>}
      <div className="alert-box"><b>QC safety</b><p>Import ke baad returns <b>QC Pending</b> rahenge. <b>Pass QC</b> karne par hi stock + quantity add hogi. Damaged returns stock me add nahi honge.</p></div>
      <div className="modal-actions" style={{padding:18}}><button className="btn secondary" onClick={resetImport} disabled={busy}>Cancel</button><button className="btn primary" onClick={importReturns} disabled={!parsed.length||unknown.length>0||busy||updated}>{busy?'Importing...':`Import Returns — ${totalUnits} Units`}</button></div>
    </section>}

    <section className="card settings-card"><h2>Manual Return</h2><div className="form-grid"><label>Company<select value={company} onChange={e=>setCompany(e.target.value)}><option value="">Select company</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option>Amazon</option><option>Flipkart</option><option>Meesho</option><option>Other</option></select></label><label>Exact SKU<input value={sku} onChange={e=>setSku(e.target.value)} placeholder="Enter exact Excel SKU"/></label><label>Quantity<input type="number" min="1" value={qty} onChange={e=>setQty(Number(e.target.value))}/></label><label>QC Status<input value="QC Pending" disabled/></label><label>Shipping Partner<input value={partner} onChange={e=>setPartner(e.target.value)}/></label></div>{p&&<div className="import-note">{p.name || 'Unnamed product'} · Current stock {p.stock}</div>}<button className="btn primary" onClick={addManual}>Save Return</button></section>

    <section className="card table-card"><div className="card-head"><div><h2>Return & QC Ledger</h2><p>Pass QC = stock add. Damaged = no stock add.</p></div></div><div className="table-wrap"><table><thead><tr><th>Return ID</th><th>Date</th><th>Company</th><th>Platform</th><th>SKU</th><th>Qty</th><th>QC</th><th>Action</th></tr></thead><tbody>{list.map(r=><tr key={r.id}><td><b>{r.id}</b></td><td>{new Date(r.date).toLocaleString()}</td><td>{companies.find(c=>c.id===r.companyId)?.name}</td><td>{r.platform}</td><td className="sku-cell">{r.sku}</td><td>{r.qty}</td><td><span className={`badge ${r.condition==='Resellable'?'in-stock':r.condition==='Damaged'?'out-of-stock':''}`}>{r.condition}</span></td><td>{r.condition==='QC Pending'?<><button className="link-btn" onClick={()=>processReturn(r.id,'Resellable')}>Pass QC</button><button className="link-btn danger-text" onClick={()=>processReturn(r.id,'Damaged')}>Damaged</button></>:<span className="muted">Completed</span>}</td></tr>)}</tbody></table>{!list.length&&<div className="empty">No returns recorded yet.</div>}</div></section>

    <style jsx global>{`.upload-box{border:1.5px dashed var(--line);border-radius:14px;padding:22px;background:#f8fbff;display:flex;align-items:center;gap:14px;min-height:74px}.upload-box input{display:none}.upload-label{cursor:pointer;width:100%;font-weight:600;color:var(--text)}.upload-box.drag-over{border-color:#2563eb;background:#eef5ff}.alert-box{margin:0 18px 18px;padding:15px 16px;border-radius:12px;border:1px solid var(--line)}.danger-alert{background:#fff5f4;border-color:#f2c7c3}.alert-box p{margin:6px 0}.alert-box small{color:var(--muted)}`}</style>
  </Shell>;
}

function StatBox({label,value}:{label:string;value:number}){return <div className="stat-card"><div><span>{label}</span><strong>{value}</strong></div></div>}
