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

function makeDeterministicUuid(value:string){
  let h1=0x811c9dc5, h2=0x01000193;
  for(let i=0;i<value.length;i++){
    const c=value.charCodeAt(i);
    h1^=c; h1=Math.imul(h1,16777619);
    h2^=c+i; h2=Math.imul(h2,2246822519);
  }
  const hex=`${(h1>>>0).toString(16).padStart(8,'0')}${(h2>>>0).toString(16).padStart(8,'0')}${((h1^h2)>>>0).toString(16).padStart(8,'0')}${((h1+h2)>>>0).toString(16).padStart(8,'0')}`;
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${(8+(parseInt(hex.slice(16,17),16)%4).toString(16))}${hex.slice(17,20)}-${hex.slice(20,32)}`;
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

      const numbers=[...segment.matchAll(
        /(?<![A-Za-z0-9])\d+(?![A-Za-z0-9])/g
      )].map(m=>Number(m[0])).filter(n=>n>0 && n<1000);

      // If another SKU immediately follows, this occurrence is one unit.
      // Otherwise use the last standalone number as QTY; default to one.
      const nextIsSku=Boolean(next);
      const qty=nextIsSku ? 1 : (numbers.length ? numbers[numbers.length-1] : 1);

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
      `Flipkart ke ${totalUnits} units stock se deduct honge aur ${parsedOrders.length} order records banenge. Continue?`
    );
    if(!ok) return;

    const insertedIds:string[]=[];

    try{
      setBusy(true);
      setStatus('Checking duplicate orders and preparing stock update...');

      // Re-check current stock from the latest selected products before writing.
      const currentById=new Map(selectedProducts.map(p=>[p.id,p]));
      const newOrders:ParsedOrder[]=[];

      for(const order of parsedOrders){
        const p=currentById.get(order.productId);
        if(!p) throw new Error(`SKU ${order.sku} current company mein nahi mila.`);

        const orderUuid=makeDeterministicUuid(
          `${selectedCompanyId}|flipkart|${order.orderId}|${order.sku}`
        );

        const existing=await db.select<any>(
          'orders',
          `select=id&company_id=eq.${encodeURIComponent(selectedCompanyId)}&id=eq.${orderUuid}`
        );

        if(existing?.length) continue;
        newOrders.push({...order,stock:p.stock});
      }

      // Aggregate only NEW orders, so a partially processed upload can be retried safely.
      const newTotals=new Map<string,{productId:string;sku:string;qty:number}>();
      for(const order of newOrders){
        const old=newTotals.get(order.productId);
        newTotals.set(order.productId,{
          productId:order.productId,
          sku:order.sku,
          qty:(old?.qty||0)+order.qty
        });
      }

      for(const item of newTotals.values()){
        const p=currentById.get(item.productId);
        if(!p) throw new Error(`SKU ${item.sku} current company mein nahi mila.`);
        if(item.qty>p.stock){
          throw new Error(
            `SKU ${item.sku} ke paas sirf ${p.stock} stock hai, lekin ${item.qty} new units process hone hain.`
          );
        }
      }

      // Process each order separately. This gives the Orders page the actual
      // number of Flipkart order rows and creates one stock movement per order.
      for(const order of newOrders){
        const orderUuid=makeDeterministicUuid(
          `${selectedCompanyId}|flipkart|${order.orderId}|${order.sku}`
        );

        await db.rpc('adjust_stock',{
          p_product_id:order.productId,
          p_quantity:order.qty,
          p_movement_type:'Stock Out',
          p_platform:'Flipkart',
          p_shipping_partner:'E-Kart Logistics',
          p_note:`Flipkart label ${order.orderId} • PDF: ${file?.name||'PDF'}`
        });

        await db.insert('orders',{
          id:orderUuid,
          company_id:selectedCompanyId,
          product_id:order.productId,
          platform:'Flipkart',
          quantity:order.qty,
          shipping_partner:'E-Kart Logistics',
          order_date:new Date().toISOString()
        });

        insertedIds.push(orderUuid);
      }

      const skipped=parsedOrders.length-newOrders.length;
      const message=skipped>0
        ? `Done — ${newOrders.length} new Flipkart order records processed; ${skipped} duplicate orders skipped.`
        : `Done — ${newOrders.length} Flipkart order records processed.`;

      setUpdated(true);
      setStatus(message);
      alert(`${message}\n\n${totalUnits} units were detected in the uploaded labels.`);
      window.location.reload();
    }catch(e:any){
      // If a later operation fails, remove order rows that were inserted in this
      // run. Stock movements are not safely reversible here, so surface the
      // error instead of silently pretending a rollback happened.
      for(const id of insertedIds){
        try{ await db.remove('orders',`id=eq.${id}`); }catch{}
      }
      setStatus('');
      alert(
        `${e?.message||'Stock update fail ho gaya.'}\n\n`+
        'Agar error stock update ke beech mein aaya hai, Inventory History check kar lena.'
      );
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
