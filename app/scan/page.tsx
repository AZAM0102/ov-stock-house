'use client';
import {useEffect,useRef,useState} from 'react';
import {Shell,CompanyNotice} from '../components';
import {useStore,Product} from '../store';

type ScanMode='Stock In'|'Stock Out';

export default function Scan(){
 const {companies,products,selectedCompanyId,adjustStock}=useStore();
 const [companyId,setCompanyId]=useState(selectedCompanyId==='all'?'':selectedCompanyId);
 const [selected,setSelected]=useState<Product|null>(null);
 const [value,setValue]=useState('');
 const [qty,setQty]=useState(1);
 const [platform,setPlatform]=useState('Amazon');
 const [partner,setPartner]=useState('');
 const [running,setRunning]=useState(false);
 const [continuous,setContinuous]=useState(true);
 const [mode,setMode]=useState<ScanMode>('Stock Out');
 const [msg,setMsg]=useState('Select a company, then start the camera scanner.');
 const [scriptReady,setScriptReady]=useState(false);
 const [scanCount,setScanCount]=useState(0);
 const scanner=useRef<any>(null);
 const scannerRunning=useRef(false);
 const lastDecoded=useRef({value:'',time:0});
 const inputRef=useRef<HTMLInputElement>(null);
 const scannerId='ov-barcode-reader';

 useEffect(()=>{setCompanyId(selectedCompanyId==='all'?'':selectedCompanyId)},[selectedCompanyId]);
 useEffect(()=>{if(!selected)return;const latest=products.find(p=>p.id===selected.id);if(latest&&latest.stock!==selected.stock)setSelected(latest)},[products,selected?.id]);

 useEffect(()=>{
   const existing=document.querySelector('script[data-ov-scanner]') as HTMLScriptElement|null;
   if(existing){setScriptReady(true);return;}
   const s=document.createElement('script');
   s.src='https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
   s.async=true;
   s.dataset.ovScanner='1';
   s.onload=()=>setScriptReady(true);
   s.onerror=()=>setMsg('Camera library could not load. Use a USB/Bluetooth scanner or manual SKU.');
   document.body.appendChild(s);
   return()=>{void stopCamera()};
 },[]);

 const scoped=products.filter(p=>!companyId||p.companyId===companyId);
 const suggestions=value.trim()?scoped.filter(p=>{const q=value.trim().toLowerCase();return p.sku.toLowerCase().startsWith(q)||p.barcode.toLowerCase().startsWith(q)||p.name.toLowerCase().startsWith(q)}).slice(0,8):[];

 function find(raw:string, source:'camera'|'scanner'|'manual'='manual'){
   const v=raw.trim();
   if(!v)return false;
   const now=Date.now();
   if(source==='camera' && lastDecoded.current.value===v && now-lastDecoded.current.time<1400)return false;
   lastDecoded.current={value:v,time:now};
   const lower=v.toLowerCase();
   const matches=scoped.filter(x=>x.sku.toLowerCase()===lower||x.barcode.toLowerCase()===lower);
   if(matches.length===1){
     setSelected(matches[0]);
     setValue(v);
     setScanCount(c=>c+1);
     setMsg(`✓ Found ${matches[0].name||matches[0].sku}${source==='camera'?' — ready for the next scan.':''}`);
     if(source!=='camera')setTimeout(()=>inputRef.current?.focus(),50);
     return true;
   }
   setSelected(null);
   setMsg(matches.length>1?'Multiple products matched. Select a company first.':`No product found for “${v}”. Check the company or barcode.`);
   return false;
 }

 async function stopCamera(){
   scannerRunning.current=false;
   try{await scanner.current?.stop();}catch{}
   try{scanner.current?.clear();}catch{}
   scanner.current=null;
   setRunning(false);
 }

 async function startCamera(){
   if(scannerRunning.current)return;
   if(!companyId){setMsg('Select a company before scanning.');return;}
   if(!scriptReady || !(window as any).Html5Qrcode){setMsg('Camera scanner is still loading. Refresh once if needed.');return;}
   try{
     const H=(window as any).Html5Qrcode;
     const x=new H(scannerId);
     scanner.current=x;
     scannerRunning.current=true;
     await x.start(
       {facingMode:'environment'},
       {fps:12,qrbox:{width:Math.min(310,window.innerWidth-70),height:145},aspectRatio:1.777},
       (decoded:string)=>{
         const found=find(decoded,'camera');
         if(found && !continuous)void stopCamera();
       },
       ()=>{}
     );
     setRunning(true);
     setMsg(continuous?'Continuous scan is ON — scan the next barcode.':'Camera active — scan one barcode.');
   }catch(e:any){
     scannerRunning.current=false;
     setRunning(false);
     setMsg(`Camera could not start: ${e?.message||'permission or browser issue'}`);
     try{await scanner.current?.clear()}catch{}
     scanner.current=null;
   }
 }

 async function toggleCamera(){if(running)await stopCamera();else await startCamera()}

 async function update(type:ScanMode){
   if(!selected)return;
   if(!companyId){setMsg('Select a company first.');return}
   const ok=await adjustStock(selected.id,qty,type,type==='Stock Out'?platform:'',partner,`Barcode scan — ${mode}`);
   if(!ok){setMsg('Stock update failed. Check the error and try again.');return}
   setMsg(`✓ ${type} saved to database: ${qty} unit(s). Scan the next product.`);
   setQty(1);
   if(running && continuous){setTimeout(()=>inputRef.current?.focus(),80)}
 }

 function clearSelection(){setSelected(null);setValue('');setMsg(running?'Scanner is ready for the next barcode.':'Select a company, then start scanning.');}

 return <Shell active="Scan Product" title="Scan Product">
   <div className="page-intro"><div><p className="eyebrow">QUICK STOCK UPDATE</p><h1>Scan & Update Stock</h1><p className="muted">Use your phone camera, USB/Bluetooth scanner, or exact SKU/barcode.</p></div></div>
   <CompanyNotice/>
   <div className="scan-mode-switch card">
     <div><span className="section-label">ACTION MODE</span><p className="mode-help">Choose what every successful scan should do.</p></div>
     <div className="mode-buttons"><button className={mode==='Stock Out'?'active':''} onClick={()=>setMode('Stock Out')}>− Stock Out</button><button className={mode==='Stock In'?'active':''} onClick={()=>setMode('Stock In')}>＋ Stock In</button></div>
     {mode==='Stock Out'&&<label className="compact-field">Platform<select value={platform} onChange={e=>setPlatform(e.target.value)}><option>Amazon</option><option>Flipkart</option><option>Meesho</option><option>Other</option></select></label>}
   </div>
   <div className="scan-layout">
    <section className="scanner-panel card">
      <div className="form-grid one"><label>Company<select value={companyId} onChange={e=>{setCompanyId(e.target.value);setSelected(null);setValue('')}}><option value="">Select company</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
      <div className="scanner-top"><span>Phone Camera Scanner</span><span className={running?'live':'scanner-ready'}>● {running?'Scanning':'Ready'}</span></div>
      <div id={scannerId} className="scan-video"><div className="scan-placeholder"><div className="camera-icon">▣</div><b>{running?'Point camera at a barcode':'Camera scanner'}</b><br/><small>EAN, UPC, Code 128, QR and other browser-supported formats</small></div></div>
      <div className="scan-actions"><button className="btn primary scan-main-btn" onClick={toggleCamera} disabled={!scriptReady||!companyId}>{!scriptReady?'Loading scanner…':running?'Stop Camera':'Start Camera Scanner'}</button></div>
      <label className="continuous-toggle"><input type="checkbox" checked={continuous} onChange={e=>setContinuous(e.target.checked)}/><span><b>Continuous scanning</b><small>Keep camera running after each successful scan</small></span></label>
      <div className="scanner-status"><b>{msg}</b>{scanCount>0&&<span className="scan-counter">Scans this session: {scanCount}</span>}</div>
      <div className="or"><span>or use handheld scanner</span></div>
      <div className="sku-search-wrap"><div className="sku-search"><input ref={inputRef} value={value} onChange={e=>{setValue(e.target.value);setSelected(null)}} onKeyDown={e=>{if(e.key==='Enter'){if(suggestions.length===1)find(suggestions[0].sku,'manual');else find(value,'scanner')}}} placeholder="Scan with USB/Bluetooth or enter SKU/barcode" autoFocus/><button className="btn secondary" onClick={()=>suggestions.length===1?find(suggestions[0].sku,'manual'):find(value,'manual')}>Find</button></div>{suggestions.length>0&&<div className="sku-suggestions" role="listbox">{suggestions.map(p=><button key={p.id} type="button" className="sku-suggestion" onClick={()=>{setValue(p.sku);setSelected(p);setMsg(`✓ Selected ${p.name||p.sku}`);setTimeout(()=>inputRef.current?.focus(),50)}}><span><b>{p.sku}</b><small>{p.name||'Unnamed product'} · {p.companyName}</small></span><strong>{p.stock} in stock</strong></button>)}</div>}</div>
      <p className="muted form-help">A USB/Bluetooth HID scanner behaves like a keyboard. Keep this field focused and scan; most scanners send Enter automatically.</p>
    </section>
    <section className="card selected-product">
      {selected?<>
        <div className="selected-head"><div className="section-label">SCANNED PRODUCT</div><button className="link-btn" onClick={clearSelection}>Clear</button></div>
        <div className="product-large"><div className="product-placeholder">▦</div><div><div className="mini-company">{selected.companyName}</div><h2>{selected.name||'Unnamed product'}</h2><p>SKU: <b>{selected.sku}</b></p><div className="stock-big">{selected.stock} <span>pieces available</span></div></div></div>
        <div className="scan-action-summary"><b>{mode}</b><span>{mode==='Stock Out'?platform:'Warehouse stock'}</span></div>
        <div className="divider"/>
        <label className="qty-label">Quantity<input type="number" min="1" step="1" value={qty} onChange={e=>setQty(Math.max(1,Number(e.target.value)||1))} inputMode="numeric"/></label>
        {mode==='Stock Out'&&<label>Shipping Partner (optional)<input value={partner} onChange={e=>setPartner(e.target.value)} placeholder="Delhivery, Ecom Express..."/></label>}
        <button className={`btn wide-action ${mode==='Stock Out'?'stock-out':'stock-in'}`} onClick={()=>update(mode)}>{mode==='Stock Out'?'− Confirm Stock Out':'＋ Confirm Stock In'}</button>
        <div className="detail-grid" style={{marginTop:16}}><div className="detail-box"><small>Opening Stock</small><b>{selected.openingStock}</b></div><div className="detail-box"><small>Received</small><b>{selected.received}</b></div><div className="detail-box"><small>Shipped</small><b>{selected.shipped}</b></div><div className="detail-box"><small>Returned</small><b>{selected.returned}</b></div></div>
      </>:<div className="empty big-empty"><div className="empty-icon">⌁</div><h2>No product selected</h2><p>Select a company, then scan a barcode to load the product here.</p></div>}
    </section>
   </div>
 </Shell>
}
