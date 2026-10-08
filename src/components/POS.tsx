import { useEffect, useMemo, useState } from 'react'
import { Banknote, Boxes, CheckCircle2, ClipboardList, Plus, RefreshCw, ShoppingCart, Store, Wallet } from 'lucide-react'

type Outlet={id:string;code:string;name:string;status:string;franchiseId?:string|null}
type Shift={id:string;outletId:string;status:string;openingCash:string;expectedCash:string;countedCash?:string|null;cashVariance?:string|null}
type Sale={id:string;outletId:string;billNumber:string;total:string;soldAt:string;status:string}
type Ledger={id:string;outletId:string;product:string;movementType:string;quantity:string;balanceAfter:string;createdAt:string}
type Data={outlets:Outlet[];shifts:Shift[];sales:Sale[];payments:any[];ledger:Ledger[];reconciliations:any[]}

const money=(v:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(v)
const post=async(action:string,data:Record<string,unknown>)=>{const r=await fetch('/api/pos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,data})});const j=await r.json();if(!r.ok)throw new Error(j.error||'POS request failed');return j}

export function POSWorkspace(){
 const [data,setData]=useState<Data>({outlets:[],shifts:[],sales:[],payments:[],ledger:[],reconciliations:[]})
 const [outletId,setOutletId]=useState(''); const [product,setProduct]=useState('Chicken'); const [qty,setQty]=useState('1'); const [price,setPrice]=useState('250'); const [method,setMethod]=useState('Cash'); const [countedCash,setCountedCash]=useState('0'); const [message,setMessage]=useState('')
 const load=async()=>{const r=await fetch('/api/pos');setData(await r.json())}
 useEffect(()=>{load()},[])
 const outlet=data.outlets.find(x=>x.id===outletId); const openShift=data.shifts.find(x=>x.outletId===outletId&&x.status==='Open')||null
 const salesToday=useMemo(()=>data.sales.filter(x=>new Date(x.soldAt).toDateString()===new Date().toDateString()),[data.sales])
 const totalToday=salesToday.reduce((a,x)=>a+Number(x.total||0),0)
 const stock=data.ledger.filter(x=>x.outletId===outletId).reduce((m,x)=>{m[x.product]=Number(x.balanceAfter);return m},{} as Record<string,number>)
 const run=async(fn:()=>Promise<unknown>)=>{setMessage('');try{await fn();setMessage('Saved successfully');await load()}catch(e){setMessage(e instanceof Error?e.message:'Action failed')}}
 return <div className="workspace-stack">
  <section className="panel">
   <div className="panel-heading"><div><h2>POS & outlet sales</h2><p>One outlet ledger for sales, stock, payments and day-end reconciliation.</p></div><button className="text-button" onClick={load}><RefreshCw size={15}/> Refresh</button></div>
   <div className="stats-grid">
    <div className="metric-card"><ShoppingCart size={18}/><strong>{money(totalToday)}</strong><span>Sales today</span></div>
    <div className="metric-card"><Store size={18}/><strong>{data.outlets.length}</strong><span>Outlets</span></div>
    <div className="metric-card"><Wallet size={18}/><strong>{salesToday.length}</strong><span>Bills today</span></div>
    <div className="metric-card"><Boxes size={18}/><strong>{Object.keys(stock).length}</strong><span>Tracked products</span></div>
   </div>
  </section>
  <section className="panel">
   <div className="panel-heading"><div><h3>Billing</h3><p>Select an outlet and open cashier shift before billing.</p></div></div>
   <div className="form-grid">
    <label>Outlet<select value={outletId} onChange={e=>setOutletId(e.target.value)}><option value="">Select outlet</option>{data.outlets.map(x=><option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}</select></label>
    <label>Product<select value={product} onChange={e=>setProduct(e.target.value)}>{['Chicken','Mutton','Eggs','Fish','Prawns'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>Quantity<input type="number" min="0.001" value={qty} onChange={e=>setQty(e.target.value)}/></label>
    <label>Unit price<input type="number" min="0" value={price} onChange={e=>setPrice(e.target.value)}/></label>
    <label>Payment<select value={method} onChange={e=>setMethod(e.target.value)}>{['Cash','UPI','Card','Credit'].map(x=><option key={x}>{x}</option>)}</select></label>
   </div>
   <div className="button-row">
    {!openShift&&outlet&&<button className="primary-button" onClick={()=>run(async()=>{const r=await post('open-shift',{outletId,openingCash:0});void r})}><Plus size={15}/> Open shift</button>}
    {openShift&&<button className="primary-button" onClick={()=>run(async()=>{await post('record-sale',{outletId,shiftId:openShift.id,items:[{product,quantity:Number(qty),unit:'kg',unitPrice:Number(price)}],idempotencyKey:`${openShift.id}-${Date.now()}`,payments:[{method,amount:Number(qty)*Number(price)}]})})}><ShoppingCart size={15}/> Record sale</button>}
    {openShift&&<><label className="inline-field">Counted cash<input type="number" min="0" value={countedCash} onChange={e=>setCountedCash(e.target.value)}/></label><button className="text-button" onClick={()=>run(async()=>{await post('close-shift',{shiftId:openShift.id,countedCash:Number(countedCash)});})}><CheckCircle2 size={15}/> Close shift</button></>}
   </div>
   {message&&<div className="info-note">{message}</div>}
  </section>
  <section className="panel">
   <div className="panel-heading"><div><h3>Outlet stock & sales trail</h3><p>Every transfer, sale and return stays traceable to the outlet.</p></div></div>
   <div className="table-wrap"><table><thead><tr><th>Product</th><th>Balance</th><th>Latest movement</th><th>Recent bill</th></tr></thead><tbody>
    {['Chicken','Mutton','Eggs','Fish','Prawns'].map(p=>{const l=data.ledger.filter(x=>x.outletId===outletId&&x.product===p)[0];const s=salesToday.find(x=>x.outletId===outletId);return <tr key={p}><td>{p}</td><td>{l?Number(l.balanceAfter):0}</td><td>{l?.movementType||'—'}</td><td>{s?.billNumber||'—'}</td></tr>})}
   </tbody></table></div>
  </section>
  <section className="panel">
   <div className="panel-heading"><div><h3>Consolidation view</h3><p>HQ can aggregate outlets from the same POS records without separate databases.</p></div><ClipboardList size={20}/></div>
   <div className="info-note"><Banknote size={18}/> Sales → payments → invoice → stock deduction → shift → reconciliation → audit event.</div>
  </section>
 </div>
}
