'use client';

import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Shell, CompanyNotice } from '../components';
import { db } from '../supabase';

type ParsedOrder = {
  orderId: string;
  sku: string;
  qty: number;
  productName: string;
  productId: string;
  stock: number;
  page: number;
};

type ParsedLine = {
  sku: string;
  qty: number;
  orderCount: number;
  productName: string;
  productId: string;
  stock: number;
};

type UnknownLine = { value:string; page:number };

function escapeRegExp(value:string){
  return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
}

async function extractPdfPages(file:File){
  const pdfjs:any=await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

  const buffer=await file.arrayBuffer();
  const pdf=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise;
  const pages:string[]=[];

  for(let i=1;i<=pdf.numPages;i++){
    const page=await pdf.getPage(i);
    const content=await page.getTextContent();
    const text=(content.items||[]).map((item:any)=>item.str||'').join(' ');
    pages.push(text.replace(/\s+/g,' ').trim());
  }
  return pages;
}

/**
 * Flipkart labels can repeat SKU data in the Tax Invoice section.
 * We ONLY parse the shipping-label section before "Tax Invoice".
 *
 * A single label may contain:
 *   SKU | SKU              => 2 units
 *   SKU | OTHER-SKU       => 1 unit of each
 *   SKU ... QTY 2         => 2 units
 *
 * We preserve an individual ParsedOrder per label/order+SKU, then aggregate
 * those records for the review table.
 */
function parsePages(
  pages:string[],
  products:ReturnType<typeof useStore>['products']
){
  const skuMap=new Map(products.map(p=>[p.sku.toUpperCase(),p]));
  const knownSkus=[...skuMap.keys()].sort((a,b)=>b.length-a.length);
  const orders:ParsedOrder[]=[];
  const unknown:UnknownLine[]=[];

  pages.forEach((fullText,pageIndex)=>{
    const labelSection=fullText.split(/Tax Invoice/i)[0];
    if(!/SKU\s*ID/i.test(labelSection)) return;

    const orderId=fullText.match(/\bOD\d{8,}\b/i)?.[0]?.toUpperCase()
      || `FLIPKART-PAGE-${pageIndex+1}`;

    // Find SKU occurrences in document order.
    const hits:{sku:string; index:number; length:number}[]=[];
    for(const sku of knownSkus){
      const re=new RegExp(escapeRegExp(sku),'gi');
      for(const hit of labelSection.matchAll(re)){
        hits.push({sku,index:hit.index||0,length:hit[0].length});
      }
    }
    hits.sort((a,b)=>a.index-b.index);

    // Remove accidental overlapping matches.
    const accepted:{sku:string;index:number;length:number}[]=[];
    for(const hit of hits){
      const previous=accepted[accepted.length-1];
      if(previous && hit.index < previous.index+previous.length) continue;
      accepted.push(hit);
    }

    // Candidate unknown SKU tokens before a pipe.
    for(const match of labelSection.matchAll(/\b([A-Z0-9][A-Z0-9._-]{2,})\s*\|/gi)){
      const value=match[1].toUpperCase();
      if(skuMap.has(value)) continue;
      if(/^(SKU|ID|QTY|GST|HNO|STD|AWB|COD|PREPAID)$/.test(value)) continue;
      unknown.push({value,page:pageIndex+1});
    }

    accepted.forEach((hit,idx)=>{
      const next=accepted[idx+1];
      let segment=labelSection.slice(hit.index+hit.length,next?.index ?? labelSection.length);

      // Don't let tracking/AWB data become a quantity.
      segment=segment.split(/\b(?:FMPC|FMPP)\d{8,}\b/i)[0];

      // Only trust an explicit quantity marker. Random label numbers such as
      // prices, PIN codes, dates or tracking values must never become stock qty.
      const qtyMatch=segment.match(/\b(?:QTY|QUANTITY)\s*[:#-]?\s*(\d{1,3})\b/i);
      const explicitQty=qtyMatch ? Number(qtyMatch[1]) : 0;

      // If another SKU immediately follows, each occurrence represents one unit.
      // Otherwise use explicit QTY when present; safe fallback is one unit.
      const nextIsSku=Boolean(next);
      const qty=nextIsSku ? 1 : (explicitQty>0 && explicitQty<1000 ? explicitQty : 1);

      const p=skuMap.get(hit.sku)!;
      orders.push({
        orderId,
        sku:p.sku,
        qty,
        productName:p.name,
        productId:p.id,
        stock:p.stock,
        page:pageIndex+1
      });
    });
  });

  const dedupUnknown=unknown.filter((x,i,arr)=>
    arr.findIndex(y=>y.value===x.value && y.page===x.page)===i
  );

  const grouped=new Map<string,ParsedLine>();
  for(const order of orders){
    const key=order.sku.toUpperCase();
    const old=grouped.get(key);
    grouped.set(key,{
      sku:order.sku,
      qty:(old?.qty||0)+order.qty,
      orderCount:(old?.orderCount||0)+1,
      productName:order.productName,
      productId:order.productId,
      stock:order.stock
    });
  }

  return {
    orders,
    rows:[...grouped.values()],
    unknown:dedupUnknown,
    orderIds:[...new Set(orders.map(o=>o.orderId))]
  };
}

export default function FlipkartUpload(){
  const {selectedCompanyId,selectedProducts,companies}=useStore();
  const [file,setFile]=useState<File|null>(null);
  const [rows,setRows]=useState<ParsedLine[]>([]);
  const [parsedOrders,setParsedOrders]=useState<ParsedOrder[]>([]);
  const [unknown,setUnknown]=useState<UnknownLine[]>([]);
  const [orderIds,setOrderIds]=useState<string[]>([]);
  const [pages,setPages]=useState(0);
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [updated,setUpdated]=useState(false);

  const company=companies.find(c=>c.id===selectedCompanyId);
  const totalUnits=useMemo(()=>rows.reduce((sum,row)=>sum+row.qty,0),[rows]);
  const insufficient=rows.filter(r=>r.qty>r.stock);
  const ready=Boolean(
    selectedCompanyId &&
    selectedCompanyId!=='all' &&
    rows.length>0 &&
    insufficient.length===0 &&
    unknown.length===0 &&
    !updated
  );

  async function analyze(){
    if(!file) return;
    if(!selectedCompanyId || selectedCompanyId==='all'){
      alert('Pehle sidebar se ek specific company select karo.');
      return;
    }

    try{
      setBusy(true);
      setStatus('Reading Flipkart labels...');
      setUpdated(false);

      const pageTexts=await extractPdfPages(file);
      const parsed=parsePages(pageTexts,selectedProducts);

      setPages(pageTexts.length);
      setRows(parsed.rows);
      setParsedOrders(parsed.orders);
      setUnknown(parsed.unknown);
      setOrderIds(parsed.orderIds);
      setStatus(
        `Analysis complete: ${parsed.orders.length} labels/orders and ${parsed.rows.reduce((a,r)=>a+r.qty,0)} units found.`
      );
    }catch(e:any){
      setStatus('');
      alert(e?.message||'PDF analyze nahi ho saka.');
    }finally{
      setBusy(false);
    }
  }

  async function updateStock(){
    if(!ready) return;

    const ok=confirm(
      `Flipkart ke ${totalUnits} units verify karke atomic transaction mein process honge. Continue?`
    );
    if(!ok) return;

    try{
      setBusy(true);
      setStatus('Preparing an atomic Flipkart stock transaction...');

      // Aggregate repeated SKU hits belonging to the same marketplace order.
      // This prevents SKU|SKU on one label from creating duplicate order rows.
      const batchMap=new Map<string,{order_id:string;product_id:string;sku:string;qty:number;shipping_partner:string}>();
      for(const order of parsedOrders){
        const key=`${order.orderId.toUpperCase()}|${order.productId}`;
        const old=batchMap.get(key);
        batchMap.set(key,{
          order_id:order.orderId,
          product_id:order.productId,
          sku:order.sku,
          qty:(old?.qty||0)+order.qty,
          shipping_partner:'E-Kart Logistics',
        });
      }

      const result=await db.rpc<{processed:number;skipped:number;units_processed:number;units_skipped:number}>(
        'process_flipkart_batch',
        {
          p_company_id:selectedCompanyId,
          p_file_name:file?.name||'Flipkart PDF',
          p_orders:[...batchMap.values()],
        }
      );

      const processed=Number(result?.processed||0);
      const skipped=Number(result?.skipped||0);
      const unitsProcessed=Number(result?.units_processed||0);
      const unitsSkipped=Number(result?.units_skipped||0);
      setUpdated(true);
      const message=`Done — ${processed} new Flipkart order lines processed (${unitsProcessed} units). ${skipped} already-processed duplicate lines skipped (${unitsSkipped} units).`;
      setStatus(message);
      alert(message);
      window.location.reload();
    }catch(e:unknown){
      setStatus('');
      alert((e instanceof Error?e.message:'Flipkart stock update failed.')+'\n\nNo partial batch is committed; the database transaction rolls back on failure.');
      await new Promise(resolve=>setTimeout(resolve,100));
      window.location.reload();
    }finally{
      setBusy(false);
    }
  }

  function reset(){
    setFile(null);
    setRows([]);
    setParsedOrders([]);
    setUnknown([]);
    setOrderIds([]);
    setPages(0);
    setStatus('');
    setUpdated(false);
  }

  return <Shell active="Flipkart Upload" title="Flipkart Upload">
    <div className="page-intro">
      <div>
        <p className="eyebrow">FLIPKART • BULK ORDER UPDATE</p>
        <h1>Upload Flipkart Labels</h1>
        <p className="muted">
          Flipkart label PDF upload karo. OV Stock House SKU-wise orders detect karke
          preview dikhayega aur confirm karne par stock automatically deduct karega.
        </p>
      </div>
    </div>

    <CompanyNotice/>

    <div className="card" style={{padding:24}}>
      <div style={{display:'grid',gap:16}}>
        <div>
          <h2 style={{marginBottom:6}}>1. Upload Labels PDF</h2>
          <p className="muted">
            Current company: <b>{company?.name||'Select a company first'}</b>
          </p>
        </div>

        <div className="upload-box">
          <input type="file" accept=".pdf,application/pdf" onChange={e=>{
            setFile(e.target.files?.[0]||null);
            setRows([]);
            setParsedOrders([]);
            setUnknown([]);
            setOrderIds([]);
            setStatus('');
            setUpdated(false);
          }}/>
          <span>{file?file.name:'Choose Flipkart labels PDF'}</span>
        </div>

        <div className="modal-actions">
          <button className="btn secondary" onClick={reset} disabled={busy}>Clear</button>
          <button className="btn primary"
            onClick={analyze}
            disabled={!file||busy||!selectedCompanyId||selectedCompanyId==='all'}>
            {busy?'Analyzing...':'Analyze Labels'}
          </button>
        </div>

        {status&&<div className="company-notice"><b>Flipkart</b><span>{status}</span></div>}
      </div>
    </div>

    {rows.length>0&&<div className="card table-card" style={{marginTop:18}}>
      <div className="card-head">
        <div>
          <h2>2. Review Before Stock Update</h2>
          <p>{pages} PDF pages • {orderIds.length} Flipkart order IDs • {parsedOrders.length} label/order records • {totalUnits} total units</p>
        </div>
        <span className={`badge ${unknown.length||insufficient.length?'out-of-stock':'in-stock'}`}>
          {unknown.length||insufficient.length?'Needs Attention':'Ready'}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>SKU</th>
            <th>Product</th>
            <th>Flipkart Orders</th>
            <th>Units</th>
            <th>Current Stock</th>
            <th>After Update</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            {rows.map(row=>{
              const after=row.stock-row.qty;
              const bad=row.qty>row.stock;
              return <tr key={row.sku}>
                <td className="sku-cell"><b>{row.sku}</b></td>
                <td>{row.productName}</td>
                <td><b>{row.orderCount}</b></td>
                <td><b>{row.qty}</b></td>
                <td>{row.stock}</td>
                <td><b>{after}</b></td>
                <td><span className={`badge ${bad?'out-of-stock':'in-stock'}`}>
                  {bad?'Insufficient Stock':'Ready'}
                </span></td>
              </tr>
            })}
          </tbody>
        </table>
      </div>

      {unknown.length>0&&<div className="alert-box danger-alert">
        <b>Unknown SKU detected</b>
        <p>{unknown.map(x=>`${x.value} (page ${x.page})`).join(', ')}</p>
        <small>Unknown SKUs ke saath stock update disabled hai. Pehle Products mein exact SKU add/match karo.</small>
      </div>}

      {insufficient.length>0&&<div className="alert-box danger-alert">
        <b>Insufficient stock</b>
        <p>{insufficient.map(x=>`${x.sku}: ${x.stock} available, ${x.qty} units required`).join(' • ')}</p>
        <small>Stock update tab tak disabled rahega jab tak required quantity available stock se zyada hai.</small>
      </div>}

      <div className="modal-actions" style={{padding:18}}>
        <button className="btn secondary" onClick={reset} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={updateStock} disabled={!ready||busy}>
          {busy?'Updating Stock...':`Confirm & Update Stock — ${totalUnits} Units`}
        </button>
      </div>
    </div>}

    {rows.length===0&&file&&!busy&&<div className="card" style={{marginTop:18,padding:24}}>
      <b>No known SKU found.</b>
      <p className="muted">
        Make sure this is a Flipkart label PDF and the selected company contains the exact SKU.
      </p>
    </div>}

    <style jsx global>{`
      .upload-box{border:1.5px dashed var(--line);border-radius:14px;padding:22px;background:#f8fbff;display:flex;align-items:center;gap:14px;min-height:74px}
      .upload-box input{max-width:100%}
      .alert-box{margin:0 18px 18px;padding:15px 16px;border-radius:12px;border:1px solid var(--line)}
      .danger-alert{background:#fff5f4;border-color:#f2c7c3}
      .danger-alert p{margin:6px 0}
      .danger-alert small{color:var(--muted)}
    `}</style>
  </Shell>
}
