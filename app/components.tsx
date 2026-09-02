'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useStore, Product } from './store';

const items = [
  ['Dashboard','/'],
  ['Scan Product','/scan'],
  ['Products','/products'],
  ['Inventory','/inventory'],
  ['Orders','/orders'],
  ['Returns','/returns'],
  ['Reports','/reports'],
  ['Flipkart Upload','/flipkart-upload'],
];

function iconFor(label:string){
  if(label==='Scan Product') return '⌁';
  if(label==='Products') return '□';
  if(label==='Inventory') return '▦';
  if(label==='Orders') return '▤';
  if(label==='Returns') return '↻';
  if(label==='Reports') return '◒';
  if(label==='Flipkart Upload') return '⇧';
  return '◈';
}

function DoraemonAvatar({small=false}:{small?:boolean}){
  return <span className={`dora-avatar ${small?'small':''}`} aria-hidden="true">
    <span className="dora-eye left"/><span className="dora-eye right"/><span className="dora-nose"/>
    <span className="dora-mouth"/><span className="dora-bib"/><span className="dora-bell"/>
  </span>;
}

function GlobalSearch(){
  const router=useRouter();
  const {products,orders,selectedCompanyId,companies,setSelectedCompanyId}=useStore();
  const [q,setQ]=useState('');
  const [open,setOpen]=useState(false);
  const wrap=useRef<HTMLDivElement>(null);
  const normalized=q.trim().toLowerCase();

  const results=useMemo(()=>{
    if(!normalized) return [] as Array<{kind:'product'|'order';product?:Product;order?:any}>;
    const companyScoped=selectedCompanyId==='all'?products:products.filter(p=>p.companyId===selectedCompanyId);
    const productMatches=companyScoped.filter(p=>[p.sku,p.name,p.barcode,p.companyName].join(' ').toLowerCase().includes(normalized)).slice(0,7);
    const productIds=new Set(productMatches.map(p=>p.id));
    const orderMatches=orders.filter(o=>[o.id,o.sku,o.platform,o.companyId].join(' ').toLowerCase().includes(normalized)).slice(0,3);
    const out:Array<{kind:'product'|'order';product?:Product;order?:any}>=productMatches.map(product=>({kind:'product',product}));
    for(const order of orderMatches){
      if(!out.some(x=>x.kind==='order'&&x.order?.id===order.id)) out.push({kind:'order',order});
    }
    return out.slice(0,8);
  },[normalized,products,orders,selectedCompanyId]);

  useEffect(()=>{
    const onDown=(e:MouseEvent)=>{if(wrap.current&&!wrap.current.contains(e.target as Node))setOpen(false)};
    const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();wrap.current?.querySelector<HTMLInputElement>('input')?.focus();setOpen(true)}};
    document.addEventListener('mousedown',onDown);document.addEventListener('keydown',onKey);
    return()=>{document.removeEventListener('mousedown',onDown);document.removeEventListener('keydown',onKey)};
  },[]);

  function goProduct(p:Product){
    setSelectedCompanyId(p.companyId);
    setQ('');setOpen(false);
    router.push(`/products?search=${encodeURIComponent(p.sku)}`);
  }
  function submit(e:FormEvent){
    e.preventDefault();
    if(results[0]?.kind==='product'&&results[0].product) return goProduct(results[0].product);
    if(normalized){setOpen(true)}
  }

  return <div className="global-search" ref={wrap}>
    <form onSubmit={submit} className="search-form">
      <span className="search-icon">⌕</span>
      <input value={q} onChange={e=>{setQ(e.target.value);setOpen(true)}} onFocus={()=>setOpen(true)} placeholder="Search by SKU, Product, Order ID..." aria-label="Search inventory"/>
      <kbd>⌘K</kbd>
      <button type="submit" aria-label="Search">⌕</button>
    </form>
    {open&&normalized&&<div className="search-results">
      {results.length===0?<div className="search-empty">No matching SKU, product or order found.</div>:results.map((r,i)=>r.kind==='product'&&r.product?<button className="search-result" key={`p-${r.product.id}-${i}`} onClick={()=>goProduct(r.product)}>
        <span className="search-result-icon">□</span><span className="search-result-main"><b>{r.product.sku}</b><small>{r.product.name||'Unnamed product'} · {r.product.companyName}</small></span><strong>{r.product.stock} stock</strong>
      </button>:<button className="search-result" key={`o-${r.order?.id}-${i}`} onClick={()=>{setQ('');setOpen(false);router.push('/orders')}}>
        <span className="search-result-icon">▤</span><span className="search-result-main"><b>Order {String(r.order?.id||'').slice(0,10)}</b><small>{r.order?.sku} · {r.order?.platform}</small></span><strong>{r.order?.items} units</strong>
      </button>)}
    </div>}
  </div>;
}

function DoraemonAssistant(){
  const {selectedCompanyId,companies}=useStore();
  const companyName=selectedCompanyId==='all'?'All Companies':companies.find(c=>c.id===selectedCompanyId)?.name || 'Selected Company';
  const [open,setOpen]=useState(false);
  const [input,setInput]=useState('');
  const [loading,setLoading]=useState(false);
  const [messages,setMessages]=useState<Array<{role:'user'|'assistant';text:string}>>([
    {role:'assistant',text:`Hi Azam 👋 Main DORAEMON hoon — tumhara inventory assistant. ${companyName==='All Companies'?'All Companies view active hai.':'Abhi '+companyName+' selected hai.'} SKU, stock, orders ya returns ke baare mein pucho.`}
  ]);

  useEffect(()=>{
    if(messages.length===1&&messages[0].role==='assistant'){
      setMessages([{role:'assistant',text:`Hi Azam 👋 Main DORAEMON hoon — tumhara inventory assistant. ${companyName==='All Companies'?'All Companies view active hai.':'Abhi '+companyName+' selected hai.'} SKU, stock, orders ya returns ke baare mein pucho.`}]);
    }
  },[companyName]);

  async function send(text=input){
    const question=text.trim(); if(!question||loading)return;
    setInput('');
    const next=[...messages,{role:'user' as const,text:question}]; setMessages(next);setLoading(true);
    try{
      const res=await fetch('/api/assistant',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:question,companyId:selectedCompanyId,companyName,history:next.slice(-8)})});
      const data=await res.json(); if(!res.ok) throw new Error(data?.error||'Assistant failed');
      setMessages(m=>[...m,{role:'assistant',text:data.text}]);
    }catch(e:any){setMessages(m=>[...m,{role:'assistant',text:`Bhai, DORAEMON abhi connect nahi ho paaya. ${e?.message||'Please try again.'}`}]);}
    finally{setLoading(false)}
  }
  function submit(e:FormEvent){e.preventDefault();void send()}

  return <>
    <button className={`dora-launcher ${open?'hidden':''}`} onClick={()=>setOpen(true)} aria-label="Open DORAEMON AI Assistant">
      <DoraemonAvatar/><span className="dora-ai-badge">AI</span><span className="dora-launcher-label"><b>DORAEMON</b><small>AI Assistant</small></span>
    </button>
    {open&&<div className="dora-panel">
      <div className="dora-panel-head"><div className="dora-title"><DoraemonAvatar small/><span><b>DORAEMON</b><small>AI Assistant · {companyName}</small></span></div><div className="dora-online"><i/> Online</div><button className="dora-close" onClick={()=>setOpen(false)}>×</button></div>
      <div className="dora-messages">{messages.map((m,i)=><div key={i} className={`dora-msg ${m.role}`}><div className="dora-msg-avatar">{m.role==='assistant'?<DoraemonAvatar small/>:<span>A</span>}</div><div className="dora-bubble">{m.text.split('\n').map((line,j)=><span key={j}>{line}{j<m.text.split('\n').length-1&&<br/>}</span>)}</div></div>)}{loading&&<div className="dora-msg assistant"><div className="dora-msg-avatar"><DoraemonAvatar small/></div><div className="dora-bubble typing">Checking<span>•</span><span>•</span><span>•</span></div></div>}</div>
      <div className="dora-quick"><button onClick={()=>void send('Low stock products dikhao')} disabled={loading}>⚠ Low Stock</button><button onClick={()=>void send("Today's orders ka summary do")} disabled={loading}>▤ Orders</button><button onClick={()=>void send('Total stock kitna hai?')} disabled={loading}>▦ Total Stock</button></div>
      <form className="dora-input" onSubmit={submit}><input value={input} onChange={e=>setInput(e.target.value)} placeholder="Kuch bhi pucho..."/><button disabled={loading||!input.trim()} aria-label="Send">➤</button></form>
      <div className="dora-foot">AI responses can make mistakes. Important data verify kar lena.</div>
    </div>}
  </>;
}

export function Shell({children,active,title}:{children:React.ReactNode;active:string;title:string}){
  const path=usePathname();
  const {companies,selectedCompanyId,setSelectedCompanyId}=useStore();
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href="/" className="side-brand"><img src="/online-vyapari-logo.webp"/><div><b>OV Stock House</b><small>Inventory Manager</small></div></Link>
      <div className="company-switch"><span>ACTIVE COMPANY</span><select value={selectedCompanyId} onChange={e=>setSelectedCompanyId(e.target.value)}><option value="all">All Companies</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <nav>{items.map(([l,h])=><Link href={h} key={l} className={(active===l||(l==='Inventory'&&path.startsWith('/inventory')))?'active':''}><i>{iconFor(l)}</i>{l}</Link>)}</nav>
      <div className="sidebar-bottom"><Link href="/settings">⚙ Settings</Link><div className="user-mini"><span>A</span><div><b>Azam</b><small>Administrator</small></div></div></div>
    </aside>
    <DoraemonAssistant/>
    <nav className="mobile-nav">{[items[0],items[1],items[2],items[4],items[5],items[6]].map(([l,h])=><Link href={h} key={l} className={active===l?'active':''}><i>{iconFor(l)}</i><span>{l==='Scan Product'?'Scan':l}</span></Link>)}</nav>
    <main className="main"><header className="topbar"><div className="mobile-title"><b>OV</b> {title}</div><GlobalSearch/><div className="top-actions"><span className="top-company">{selectedCompanyId==='all'?'All Companies':companies.find(c=>c.id===selectedCompanyId)?.name}</span><div className="avatar">A</div></div></header><div className="content">{children}</div></main>
  </div>;
}

export function Stat({label,value,note,tone='blue'}:{label:string;value:string|number;note?:string;tone?:string}){return <div className="stat-card"><div className={`stat-icon ${tone}`}>◈</div><div><span>{label}</span><strong>{value}</strong>{note&&<small className={tone==='red'?'danger-text':'success-text'}>{note}</small>}</div></div>}
export function CompanyNotice(){const {selectedCompanyId,companies}=useStore();return <div className="company-notice">{selectedCompanyId==='all'?<><b>All Companies</b><span>Dashboard view is combined. For stock updates, select a specific company from the sidebar.</span></>:<><b>{companies.find(c=>c.id===selectedCompanyId)?.name}</b><span>Stock, orders, returns and movements are isolated to this company.</span></>}</div>}
