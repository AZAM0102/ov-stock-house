'use client';
import React,{useEffect,useMemo,useState} from 'react';
import {Shell,CompanyNotice} from '../components';
import {Product,useStore} from '../store';

const blank=(companyId:string,companyName:string):Product=>({id:'',companyId,companyName,sku:'',barcode:'',name:'',openingStock:0,received:0,shipped:0,returned:0,stock:0,minStock:20,costPrice:500,status:'OK',sourceFile:'Added in app',isActive:true,alternateSkus:[]});

export default function Products(){
 const {products,companies,selectedCompanyId,addProduct,updateProduct,removeProduct,adjustStock}=useStore();
 const [q,setQ]=useState('');
 const [company,setCompany]=useState(selectedCompanyId==='all'?'':selectedCompanyId);
 const [edit,setEdit]=useState<Product|null>(null);
 const [show,setShow]=useState(false);
 const [stockInput,setStockInput]=useState('0');
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 useEffect(()=>{const value=new URLSearchParams(window.location.search).get('search');if(value!==null)setQ(value)},[]);
 useEffect(()=>{if(selectedCompanyId!=='all')setCompany(selectedCompanyId)},[selectedCompanyId]);
 const filtered=useMemo(()=>products.filter(p=>(!company||p.companyId===company)&&[p.name,p.sku,p.barcode,p.companyName,...p.alternateSkus].join(' ').toLowerCase().includes(q.toLowerCase())),[products,q,company]);
 function openNew(){if(!company){alert('Select a company first.');return}const c=companies.find(x=>x.id===company)!;const fresh=blank(c.id,c.name);setEdit(fresh);setStockInput(String(fresh.stock));setShow(true)}
 async function save(){
  if(!edit||!edit.sku.trim()){alert('SKU is required.');return}
  const normalized=edit.sku.trim();
  const dup=products.find(p=>p.companyId===edit.companyId&&p.sku.toLowerCase()===normalized.toLowerCase()&&p.id!==edit.id);
  if(dup){alert('This SKU already exists in the same company.');return}
  const desiredStock=Math.max(0,Math.floor(Number(stockInput)||0));
  if(edit.id && desiredStock!==edit.stock){
   const delta=desiredStock-edit.stock;
   const type=delta>0?'Stock In':'Stock Out';
   if(delta<0 && Math.abs(delta)>edit.stock){alert('Stock cannot go below 0.');return}
  }
  const alternateSkus=[...new Set(edit.alternateSkus.map(x=>x.trim()).filter(Boolean))].filter(x=>x.toLowerCase()!==normalized.toLowerCase());
  const parentConflict=products.find(p=>p.companyId===edit.companyId&&p.id!==edit.id&&[p.sku,...p.alternateSkus].some(x=>x.toLowerCase()===normalized.toLowerCase()));
  if(parentConflict){alert(`SKU ${normalized} is already mapped to ${parentConflict.sku}.`);return}
  const localConflict=alternateSkus.find(x=>products.some(p=>p.companyId===edit.companyId&&p.id!==edit.id&&p.sku.toLowerCase()===x.toLowerCase()));
  if(localConflict){alert(`Alternate SKU ${localConflict} is already a parent SKU.`);return}
  const ok=edit.id?await updateProduct({...edit,sku:normalized,alternateSkus}):await addProduct({...edit,id:`${edit.companyId}::${normalized}`,sku:normalized,alternateSkus});
  if(!ok)return;
  if(edit.id && desiredStock!==edit.stock){
   const delta=desiredStock-edit.stock;
   const stockOk=await adjustStock(edit.id,Math.abs(delta),delta>0?'Stock In':'Stock Out','', '', 'Stock changed from Product Edit');
   if(!stockOk)return;
  }
  setShow(false);setEdit(null)
 }
 return <Shell active="Products" title="Products">
  <div className="page-intro"><div><p className="eyebrow">PRODUCT MASTER</p><h1>Products</h1><p className="muted">Company-wise product and SKU master. Changes are saved to Supabase.</p></div><button className="btn primary" onClick={openNew}>＋ Add Product</button></div>
  <CompanyNotice/>
  <div className="toolbar card"><select value={company} onChange={e=>setCompany(e.target.value)}><option value="">All Companies</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input value={q} onChange={e=>setQ(e.target.value)} placeholder="⌕ Search company, product or exact SKU..."/><span className="pill">{filtered.length} results</span></div>
  <div className="card table-card"><div className="table-wrap"><table><thead><tr><th>Company</th><th>Product</th><th>Parent / Master SKU</th><th>Alternate SKUs</th><th>Opening</th><th>Received</th><th>Current</th><th>Cost / Piece</th><th>Inventory Value</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map(p=><React.Fragment key={p.id}><tr><td>{p.companyName}</td><td><b>{p.name||'Unnamed product'}</b></td><td className="sku-cell"><span className="parent-sku-wrap">{p.alternateSkus.length>0&&<button type="button" className="sku-expand-btn" aria-label={expanded[p.id]?'Hide alternate SKUs':'Show alternate SKUs'} title={expanded[p.id]?'Hide alternate SKUs':'Show alternate SKUs'} onClick={()=>setExpanded(x=>({...x,[p.id]:!x[p.id]}))}>{expanded[p.id]?'▾':'▸'}</button>}<b>{p.sku}</b></span></td><td>{p.alternateSkus.length ? <span title={p.alternateSkus.join(', ')}>{p.alternateSkus.length} mapped SKU{p.alternateSkus.length===1?'':'s'}</span> : <span className="muted">—</span>}</td><td>{p.openingStock}</td><td>{p.received}</td><td><b>{p.stock}</b></td><td>₹{p.costPrice.toLocaleString('en-IN')}</td><td><b>₹{(p.stock*p.costPrice).toLocaleString('en-IN')}</b></td><td><span className={`badge ${p.stock===0?'out-of-stock':p.stock<=p.minStock?'low-stock':'in-stock'}`}>{p.stock===0?'Out of Stock':p.stock<=p.minStock?'Low Stock':'In Stock'}</span></td><td><button className="link-btn" onClick={()=>{setEdit(p);setStockInput(String(p.stock));setShow(true)}}>✎ Edit</button> <button className="link-btn danger-text" onClick={async()=>{await removeProduct(p.id)}}>Archive</button></td></tr>{expanded[p.id]&&p.alternateSkus.map((sku,index)=><tr key={`${p.id}-alt-${index}`} className="alternate-sku-row"><td></td><td><span className="alternate-label">↳ Alternate SKU</span></td><td className="sku-cell">{sku}</td><td><span className="muted">Uses parent stock</span></td><td colSpan={7}></td></tr>)}</React.Fragment>)}</tbody></table>{!filtered.length&&<div className="empty">No products match this filter.</div>}</div></div>
  {show&&edit&&<div className="modal-backdrop"><div className="modal"><div className="card-head"><div><h2>{edit.id?'Edit Product':'Add Product'}</h2><p>SKU can be edited. The new SKU is saved permanently to Supabase.</p></div><button className="link-btn" onClick={()=>{setShow(false);setEdit(null)}}>Close</button></div><div className="form-grid"><label>Company<select value={edit.companyId} disabled={!!edit.id} onChange={e=>{const c=companies.find(x=>x.id===e.target.value)!;setEdit({...edit,companyId:c.id,companyName:c.name})}}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Exact SKU<input value={edit.sku} onChange={e=>setEdit({...edit,sku:e.target.value})}/></label><label>Alternate / Marketplace SKUs<textarea rows={4} value={edit.alternateSkus.join('\n')} onChange={e=>setEdit({...edit,alternateSkus:e.target.value.split(/\n|,|;|\r/).map(x=>x.trim()).filter(Boolean)})} placeholder="One SKU per line"/><small className="field-note">Flipkart marketplace SKUs. All mapped SKUs use this same parent product stock.</small></label><label>Barcode (optional)<input value={edit.barcode} onChange={e=>setEdit({...edit,barcode:e.target.value})}/></label><label>Product Name<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label>Opening Stock{edit.id?<><input type="number" value={edit.openingStock} disabled/><small className="field-note">Original opening balance is locked.</small></>:<input type="number" min="0" value={edit.openingStock} onChange={e=>{const value=Math.max(0,Number(e.target.value)||0);setEdit({...edit,openingStock:value});setStockInput(String(value))}}/>}</label><label>Current Stock<input type="number" min="0" step="1" value={stockInput} onChange={e=>setStockInput(e.target.value)}/><small className="field-note">Change stock from here. Save creates a Stock In / Stock Out movement automatically.</small></label><label>Cost Price / Piece<input type="number" min="0" step="0.01" value={edit.costPrice} onChange={e=>setEdit({...edit,costPrice:Math.max(0,Number(e.target.value)||0)})}/><small className="field-note">₹ per piece.</small></label><label>Inventory Value<input value={`₹${(Math.max(0,Math.floor(Number(stockInput)||0))*edit.costPrice).toLocaleString('en-IN')}`} disabled/><small className="field-note">Automatically calculated: Cost Price × Current Stock.</small></label><label>Minimum Stock<input type="number" min="0" value={edit.minStock} onChange={e=>setEdit({...edit,minStock:Number(e.target.value)})}/></label></div><div className="modal-actions"><button className="btn secondary" onClick={()=>{setShow(false);setEdit(null)}}>Cancel</button><button className="btn primary" onClick={save}>Save Product</button></div></div></div>}
 </Shell>
}
