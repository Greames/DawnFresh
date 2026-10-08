import { useEffect, useState } from 'react'
import { Calculator, Save, TrendingUp } from 'lucide-react'
import { money, products } from '../lib/business'

type ConfigRow={id:string;product:string;processingType:string;supplierName:string;supplierPricePerKg:string;standardYieldPct:string;logisticsCostPerKg:string;otherCostPerKg:string;companyPricePerKg:string;franchiseId:string|null;effectiveFrom:string;effectiveTo:string|null;version:number;status:string;notes:string|null}
type Scenario=ConfigRow&{name:string;liveWeightKg:string;billableWeightKg:string;franchiseValue:string;grossMargin:string;grossMarginPct:string;actualYieldPct:string|null;yieldVariancePct:string|null}
export function PricingWorkspace(){
 const [data,setData]=useState<{configs:ConfigRow[];scenarios:Scenario[];franchises:{id:string;name:string}[]}>({configs:[],scenarios:[],franchises:[]})
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [result,setResult]=useState<any>(null)
 const [form,setForm]=useState<any>({product:'Chicken',processingType:'Standard',supplierName:'',supplierPricePerKg:120,standardYieldPct:70,logisticsCostPerKg:0,otherCostPerKg:0,companyPricePerKg:180,liveWeightKg:100,actualOutputKg:'',effectiveFrom:new Date().toISOString().slice(0,10),status:'Draft',franchiseId:''})
 async function load(){try{const r=await fetch('/api/pricing');const x=await r.json();if(!r.ok)throw new Error(x.error);setData(x)}catch(e){setError(e instanceof Error?e.message:'Could not load pricing.')}}
 useEffect(()=>{load()},[])
 const post=async(action:string,extra:any={})=>{setBusy(true);setError('');try{const r=await fetch('/api/pricing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...form,...extra})});const x=await r.json();if(!r.ok)throw new Error(x.error);return x}finally{setBusy(false)}}
 async function calculate(){try{const x=await post('calculate');setResult(x.result)}catch(e){setError(e instanceof Error?e.message:'Calculation failed.')}}
 async function saveScenario(){try{const x=await post('create-scenario',{name:'Scenario '+new Date().toLocaleString()});setResult(x.result);await load()}catch(e){setError(e instanceof Error?e.message:'Scenario failed.')}}
 async function saveConfig(){try{await post('create-config');await load()}catch(e){setError(e instanceof Error?e.message:'Configuration save failed.')}}
 const set=(k:string,v:any)=>setForm({...form,[k]:v})
 const field=(label:string,key:string,type='number')=><label>{label}<input type={type} value={form[key]??''} onChange={e=>set(key,type==='number'?Number(e.target.value):e.target.value)}/></label>
 return <section className="workspace"><div className="section-heading"><div><span className="eyebrow">COMMERCIAL ENGINE</span><h1>Pricing & yield</h1><p>Versioned supplier, yield and company pricing with scenario analysis.</p></div></div>{error&&<div className="error-banner">{error}</div>}
 <div className="panel-grid"><div className="panel"><h2><Calculator size={18}/> Pricing calculator</h2>
 <div className="form-grid"><label>Product<select value={form.product} onChange={e=>set('product',e.target.value)}>{products.map(p=><option key={p.name}>{p.name}</option>)}</select></label>{field('Processing type','processingType','text')}</div>
 <div className="form-grid">{field('Supplier','supplierName','text')}{field('Live weight (kg)','liveWeightKg')}</div>
 <div className="form-grid">{field('Supplier price / live kg','supplierPricePerKg')}{field('Standard yield %','standardYieldPct')}</div>
 <div className="form-grid">{field('Logistics / live kg','logisticsCostPerKg')}{field('Other cost / live kg','otherCostPerKg')}</div>
 <div className="form-grid">{field('Company price / billable kg','companyPricePerKg')}{field('Actual output kg (optional)','actualOutputKg')}</div>
 <div className="form-grid"><label>Effective from<input type="date" value={form.effectiveFrom} onChange={e=>set('effectiveFrom',e.target.value)}/></label><label>Franchise-specific (optional)<select value={form.franchiseId} onChange={e=>set('franchiseId',e.target.value)}><option value="">Company default</option>{data.franchises.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label></div>
 <div className="button-row"><button className="primary" disabled={busy} onClick={calculate}><Calculator size={16}/> Calculate</button><button disabled={busy} onClick={saveScenario}><TrendingUp size={16}/> Save scenario</button><button disabled={busy} onClick={saveConfig}><Save size={16}/> Save configuration</button></div>
 {result&&<div className="metric-grid"><div><span>Billable weight</span><strong>{result.billableWeightKg.toFixed(2)} kg</strong></div><div><span>Supplier cost</span><strong>{money(result.supplierCost,'INR')}</strong></div><div><span>Landed cost</span><strong>{money(result.landedCost,'INR')}</strong></div><div><span>Franchise value</span><strong>{money(result.franchiseValue,'INR')}</strong></div><div><span>Gross margin</span><strong>{money(result.grossMargin,'INR')}</strong></div><div><span>Margin %</span><strong>{result.grossMarginPct.toFixed(2)}%</strong></div>{result.actualYieldPct!==null&&<div><span>Actual yield / variance</span><strong>{result.actualYieldPct.toFixed(2)}% / {result.yieldVariancePct.toFixed(2)} pts</strong></div>}</div>}</div>
 <div className="panel"><h2>Active/configured pricing</h2><p className="muted">Changes are versioned. Historical orders can keep their pricing snapshot.</p>{data.configs.slice(0,15).map(c=><div className="list-row" key={c.id}><div><strong>{c.product} · {c.processingType} · v{c.version}</strong><span>{c.supplierName} · supplier ₹{c.supplierPricePerKg}/kg · yield {c.standardYieldPct}% · company ₹{c.companyPricePerKg}/kg</span></div><span className="badge amber"><span/>{c.status}</span></div>)}</div></div>
 <div className="panel"><h2>Saved scenarios</h2>{data.scenarios.slice(0,20).map(s=><div className="list-row" key={s.id}><div><strong>{s.name}</strong><span>{s.product} · {s.liveWeightKg}kg live → {s.billableWeightKg}kg billable · margin {Number(s.grossMarginPct).toFixed(2)}%</span></div><strong>{money(Number(s.franchiseValue),'INR')}</strong></div>)}</div></section>
}
