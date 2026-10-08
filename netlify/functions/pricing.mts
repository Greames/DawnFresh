import type { Config } from '@netlify/functions'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises, customerOrders } from '../../db/schema.js'
import { pricingConfigs, pricingScenarios, orderPricingSnapshots } from '../../db/pricing-schema.js'
import { resolveAccess, sameOrigin } from '../../db/access.js'

export const config: Config = { path: '/api/pricing' }
const products = ['Chicken','Mutton','Eggs','Fish','Prawns']
const statuses = ['Draft','Active','Archived']

function num(v: unknown, min=0, max=1e9) {
  const n=Number(v); return Number.isFinite(n)&&n>=min&&n<=max?n:null
}
function calculate(i:{liveWeightKg:number;supplierPricePerKg:number;standardYieldPct:number;logisticsCostPerKg:number;otherCostPerKg:number;companyPricePerKg:number;actualOutputKg?:number}) {
  const billableWeightKg=i.liveWeightKg*i.standardYieldPct/100
  const supplierCost=i.liveWeightKg*i.supplierPricePerKg
  const landedCost=supplierCost+i.liveWeightKg*(i.logisticsCostPerKg+i.otherCostPerKg)
  const franchiseValue=billableWeightKg*i.companyPricePerKg
  const grossMargin=franchiseValue-landedCost
  const grossMarginPct=franchiseValue?grossMargin/franchiseValue*100:0
  const actualYieldPct=i.actualOutputKg===undefined?null:i.liveWeightKg?i.actualOutputKg/i.liveWeightKg*100:0
  const yieldVariancePct=actualYieldPct===null?null:actualYieldPct-i.standardYieldPct
  return {billableWeightKg,supplierCost,landedCost,franchiseValue,grossMargin,grossMarginPct,actualYieldPct,yieldVariancePct}
}
function inputs(b:any){
  const live=num(b.liveWeightKg,.001),supplier=num(b.supplierPricePerKg),yieldPct=num(b.standardYieldPct,.001,100),logistics=num(b.logisticsCostPerKg),other=num(b.otherCostPerKg),company=num(b.companyPricePerKg)
  if([live,supplier,yieldPct,logistics,other,company].some(v=>v===null)) return null
  return {liveWeightKg:live!,supplierPricePerKg:supplier!,standardYieldPct:yieldPct!,logisticsCostPerKg:logistics!,otherCostPerKg:other!,companyPricePerKg:company!}
}
export default async (req:Request)=>{
 const headers={'Cache-Control':'no-store'}
 try{
  const access=await resolveAccess(req)
  if('error' in access)return Response.json({error:access.error},{status:access.status,headers})
  if(access.role==='franchisee')return Response.json({error:'Pricing configuration is controlled by the company.'},{status:403,headers})
  if(req.method==='GET'){
   const configs=await db.select().from(pricingConfigs).orderBy(desc(pricingConfigs.effectiveFrom))
   const scenarios=await db.select().from(pricingScenarios).orderBy(desc(pricingScenarios.createdAt)).limit(100)
   const network=await db.select().from(franchises).orderBy(franchises.createdAt)
   return Response.json({configs,scenarios,franchises:network.map(f=>({id:f.id,name:f.data.name}))},{headers})
  }
  if(req.method!=='POST'||!sameOrigin(req))return new Response('Method not allowed',{status:405,headers})
  const b=await req.json()
  if(!b||typeof b.action!=='string')return Response.json({error:'Action is required.'},{status:400,headers})
  if(b.action==='calculate'){
   const i=inputs(b); if(!i)return Response.json({error:'Check weight, prices, costs and yield.'},{status:400,headers})
   return Response.json({ok:true,result:calculate({...i,actualOutputKg:b.actualOutputKg===undefined?undefined:num(b.actualOutputKg,0)})},{headers})
  }
  if(b.action==='create-scenario'){
   const i=inputs(b); if(!i||!b.name||!products.includes(String(b.product)))return Response.json({error:'Complete all scenario inputs.'},{status:400,headers})
   const r=calculate({...i,actualOutputKg:b.actualOutputKg===undefined?undefined:num(b.actualOutputKg,0)})
   const [row]=await db.insert(pricingScenarios).values({name:String(b.name).slice(0,180),product:String(b.product),processingType:String(b.processingType||'Standard').slice(0,100),supplierName:String(b.supplierName||'Supplier').slice(0,180),liveWeightKg:String(i.liveWeightKg),supplierPricePerKg:String(i.supplierPricePerKg),standardYieldPct:String(i.standardYieldPct),logisticsCostPerKg:String(i.logisticsCostPerKg),otherCostPerKg:String(i.otherCostPerKg),companyPricePerKg:String(i.companyPricePerKg),billableWeightKg:String(r.billableWeightKg),supplierCost:String(r.supplierCost),landedCost:String(r.landedCost),franchiseValue:String(r.franchiseValue),grossMargin:String(r.grossMargin),grossMarginPct:String(r.grossMarginPct),actualOutputKg:b.actualOutputKg===undefined?null:String(num(b.actualOutputKg,0)),actualYieldPct:r.actualYieldPct===null?null:String(r.actualYieldPct),yieldVariancePct:r.yieldVariancePct===null?null:String(r.yieldVariancePct),createdBy:access.account.id}).returning()
   return Response.json({scenario:row,result:r},{headers})
  }
  if(b.action==='create-config'){
   const i=inputs(b)
   if(!i||!products.includes(String(b.product))||!b.supplierName||!b.effectiveFrom)return Response.json({error:'Complete the pricing configuration.'},{status:400,headers})
   const existing=await db.select().from(pricingConfigs).where(and(eq(pricingConfigs.product,String(b.product)),eq(pricingConfigs.processingType,String(b.processingType||'Standard')))).orderBy(desc(pricingConfigs.version))
   const version=(existing[0]?.version||0)+1
   const [row]=await db.insert(pricingConfigs).values({product:String(b.product),processingType:String(b.processingType||'Standard'),supplierName:String(b.supplierName).slice(0,180),supplierPricePerKg:String(i.supplierPricePerKg),standardYieldPct:String(i.standardYieldPct),logisticsCostPerKg:String(i.logisticsCostPerKg),otherCostPerKg:String(i.otherCostPerKg),companyPricePerKg:String(i.companyPricePerKg),franchiseId:b.franchiseId||null,effectiveFrom:new Date(b.effectiveFrom),effectiveTo:b.effectiveTo?new Date(b.effectiveTo):null,version,status:statuses.includes(String(b.status))?String(b.status):'Draft',notes:b.notes?String(b.notes).slice(0,1000):null,createdBy:access.account.id}).returning()
   return Response.json({config:row},{headers})
  }
  if(b.action==='activate-config'){
   const [row]=await db.select().from(pricingConfigs).where(eq(pricingConfigs.id,String(b.id)))
   if(!row)return Response.json({error:'Pricing configuration not found.'},{status:404,headers})
   await db.update(pricingConfigs).set({status:'Archived',effectiveTo:new Date()}).where(and(eq(pricingConfigs.product,row.product),eq(pricingConfigs.processingType,row.processingType),eq(pricingConfigs.status,'Active')))
   const [updated]=await db.update(pricingConfigs).set({status:'Active'}).where(eq(pricingConfigs.id,row.id)).returning()
   return Response.json({config:updated},{headers})
  }
  if(b.action==='snapshot-order'){
   const orderId=String(b.orderId), configId=String(b.pricingConfigId), live=num(b.liveWeightKg,.001)
   if(!orderId||!configId||live===null)return Response.json({error:'Order, pricing configuration and live weight are required.'},{status:400,headers})
   const [configRow]=await db.select().from(pricingConfigs).where(eq(pricingConfigs.id,configId))
   const [order]=await db.select().from(customerOrders).where(eq(customerOrders.id,orderId))
   if(!configRow||!order)return Response.json({error:'Order or pricing configuration not found.'},{status:404,headers})
   const r=calculate({liveWeightKg:live!,supplierPricePerKg:Number(configRow.supplierPricePerKg),standardYieldPct:Number(configRow.standardYieldPct),logisticsCostPerKg:Number(configRow.logisticsCostPerKg),otherCostPerKg:Number(configRow.otherCostPerKg),companyPricePerKg:Number(configRow.companyPricePerKg)})
   const snapshot={configId:configRow.id,version:configRow.version,product:configRow.product,processingType:configRow.processingType,supplierName:configRow.supplierName,supplierPricePerKg:Number(configRow.supplierPricePerKg),standardYieldPct:Number(configRow.standardYieldPct),logisticsCostPerKg:Number(configRow.logisticsCostPerKg),otherCostPerKg:Number(configRow.otherCostPerKg),companyPricePerKg:Number(configRow.companyPricePerKg),effectiveFrom:configRow.effectiveFrom.toISOString(),calculated:r}
   const [row]=await db.insert(orderPricingSnapshots).values({orderId,pricingConfigId:configId,liveWeightKg:String(live),billableWeightKg:String(r.billableWeightKg),snapshot}).onConflictDoUpdate({target:orderPricingSnapshots.orderId,set:{pricingConfigId:configId,liveWeightKg:String(live),billableWeightKg:String(r.billableWeightKg),snapshot}}).returning()
   return Response.json({snapshot:row,result:r},{headers})
  }
  return Response.json({error:'Unknown pricing action.'},{status:400,headers})
 }catch(error){console.error('pricing error',error);return Response.json({error:'Pricing service could not complete the request.'},{status:500,headers})}
}
