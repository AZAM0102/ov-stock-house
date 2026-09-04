'use client';
import {useEffect,useMemo,useState} from 'react';
import {Shell,CompanyNotice} from '../components';
import {Product,useStore} from '../store';

const blank=(companyId:string,companyName:string):Product=>({id:'',companyId,companyName,sku:'',barcode:'',name:'',openingStock:0,received:0,shipped:0,returned:0,stock:0,minStock:20,status:'OK',sourceFile:'Added in app'});

export default function Products(){
 const {products,companies,selectedCompanyId,addProduct,updateProduct,removeProduct}=useStore();
 const [q,setQ]=useState('');
 const [company,setCompany]=useState(selectedCompanyId==='all'?'':selectedCompanyId);
 const [edit,setEdit]=useState<Product|null>(null);
 const [show,setShow]=useState(false);
 useEffect(()=>{const value=new URLSearchParams(window.location.search).get('search');if(value!==null)setQ(value)},[]);
 useEffect(()=>{if(selectedCompanyId!=='all')setCompany(selectedCompanyId)},[selectedCompanyId]);
 const filtered=useMemo(()=>products.filter(p=>(!company||p.companyId===company)&&[p.name,p.sku,p.barcode,p.companyName].join(' ').toLowerCase().includes(q.toLowerCase())),[products,q,company]);
 function openNew(){if(!company){alert('Select a company first.');return}const c=companies.find(x=>x.id===company)!;setEdit(blank(c.id,c.name));setShow(true)}
 async function save(){
  if(!edit||!edit.sku.trim()){alert('SKU is required.');return}
  const normalized=edit.sku.trim();
  const dup=products.find(p=>p.companyId===edit.companyId&&p.sku.toLowerCase()===normalized.toLowerCase()&&p.id!==edit.id);
  if(dup){alert('This SKU already exists in the same company.');return}
  const ok=edit.id?await updateProduct({...edit,sku:normalized}):await addProduct({...edit,id:`${edit.companyId}::${normalized}`,sku:normalized});
  if(ok){setShow(false);setEdit(null)}
 }
 return <Shell active="Products" title="Products">
  <div className="page-intro"><div><p className="eyebrow">PRODUCT MASTER</p><h1>Products</h1><p className="muted">Company-wise product and SKU master. Changes are saved to Supabase.</p></div><button className="btn primary" onClick={openNew}>＋ Add Product</button></div>
  <CompanyNotice/>
  <div className="toolbar card"><select value={company} onChange={e=>setCompany(e.target.value)}><option value="">All Companies</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><input value={q} onChange={e=>setQ(e.target.value)} placeholder="⌕ Search company, product or exact SKU..."/><span className="pill">{filtered.length} results</span></div>
  <div className="card table-card"><div className="table-wrap"><table><thead><tr><th>Company</th><th>Product</th><th>SKU</th><th>Opening</th><th>Received</th><th>Current</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map(p=><tr key={p.id}><td>{p.companyName}</td><td><b>{p.name||'Unnamed product'}</b></td><td className="sku-cell">{p.sku}</td><td>{p.openingStock}</td><td>{p.received}</td><td><b>{p.stock}</b></td><td><span className={`badge ${p.stock===0?'out-of-stock':p.stock<=p.minStock?'low-stock':'in-stock'}`}>{p.stock===0?'Out of Stock':p.stock<=p.minStock?'Low Stock':'In Stock'}</span></td><td><button className="link-btn" onClick={()=>{setEdit(p);setShow(true)}}>✎ Edit</button> <button className="link-btn danger-text" onClick={async()=>{await removeProduct(p.id)}}>Delete</button></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty">No products match this filter.</div>}</div></div>
  {show&&edit&&<div className="modal-backdrop"><div className="modal"><div className="card-head"><div><h2>{edit.id?'Edit Product':'Add Product'}</h2><p>SKU can be edited. The new SKU is saved permanently to Supabase.</p></div><button className="link-btn" onClick={()=>{setShow(false);setEdit(null)}}>Close</button></div><div className="form-grid"><label>Company<select value={edit.companyId} disabled={!!edit.id} onChange={e=>{const c=companies.find(x=>x.id===e.target.value)!;setEdit({...edit,companyId:c.id,companyName:c.name})}}>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Exact SKU<input value={edit.sku} onChange={e=>setEdit({...edit,sku:e.target.value})}/></label><label>Barcode (optional)<input value={edit.barcode} onChange={e=>setEdit({...edit,barcode:e.target.value})}/></label><label>Product Name<input value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></label><label>Opening Stock<input type="number" min="0" value={edit.openingStock} onChange={e=>setEdit({...edit,openingStock:Number(e.target.value)})}/></label><label>Minimum Stock<input type="number" min="0" value={edit.minStock} onChange={e=>setEdit({...edit,minStock:Number(e.target.value)})}/></label></div><div className="modal-actions"><button className="btn secondary" onClick={()=>{setShow(false);setEdit(null)}}>Cancel</button><button className="btn primary" onClick={save}>Save Product</button></div></div></div>}
 </Shell>
}
