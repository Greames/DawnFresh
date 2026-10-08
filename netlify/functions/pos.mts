import type { Config } from '@netlify/functions'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, invoiceRecords, paymentRecords, stockLots } from '../../db/schema.js'
import { outletStockLedger, posOutlets, posPayments, posReconciliations, posReturns, posSaleItems, posSales, posShifts } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'

const products = ['Chicken','Mutton','Eggs','Fish','Prawns']
const methods = ['Cash','UPI','Card','Credit']
const n=(v:unknown,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d}
const s=(v:unknown,m=500)=>typeof v==='string'?v.trim().slice(0,m):''
const scope=(access:Awaited<ReturnType<typeof resolveAccess>>, franchiseId?:string|null)=>access.role!=='franchisee'||!franchiseId||access.franchise?.id===franchiseId

export default async (req:Request)=>{
 const headers={'Cache-Control':'no-store'}
 try{
  const access=await resolveAccess(req)
  if('error' in access)return Response.json({error:access.error},{status:access.status,headers})
  if(!allowed(access,'outlets','view'))return Response.json({error:'Outlet access is required.'},{status:403,headers})
  if(req.method==='GET'){
   const [outlets,shifts,sales,payments,ledger,recs]=await Promise.all([
    db.select().from(posOutlets).orderBy(desc(posOutlets.createdAt)),
    db.select().from(posShifts).orderBy(desc(posShifts.openedAt)),
    db.select().from(posSales).orderBy(desc(posSales.soldAt)),
    db.select().from(posPayments).orderBy(desc(posPayments.receivedAt)),
    db.select().from(outletStockLedger).orderBy(desc(outletStockLedger.createdAt)),
    db.select().from(posReconciliations).orderBy(desc(posReconciliations.businessDate))
   ])
   const visibleOutletIds=new Set(outlets.filter(x=>scope(access,x.franchiseId)).map(x=>x.id))
   return Response.json({
    outlets:outlets.filter(x=>visibleOutletIds.has(x.id)),
    shifts:shifts.filter(x=>visibleOutletIds.has(x.outletId)),
    sales:sales.filter(x=>visibleOutletIds.has(x.outletId)),
    payments:payments.filter(x=>sales.some(y=>y.id===x.saleId&&visibleOutletIds.has(y.outletId))),
    ledger:ledger.filter(x=>visibleOutletIds.has(x.outletId)),
    reconciliations:recs.filter(x=>visibleOutletIds.has(x.outletId))
   },{headers})
  }
  if(!['POST','PATCH'].includes(req.method)||!sameOrigin(req))return new Response('Forbidden',{status:403,headers})
  const body=await req.json(); const action=s(body?.action,80); const data=body?.data&&typeof body.data==='object'?body.data:{}
  const actor=access.id
  if(action==='create-outlet'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const franchiseId=data.franchiseId?s(data.franchiseId,80):null
   if(!scope(access,franchiseId)||!s(data.code,50)||!s(data.name,150))return Response.json({error:'Outlet code and name are required.'},{status:400,headers})
   const [row]=await db.insert(posOutlets).values({franchiseId,code:s(data.code,50).toUpperCase(),name:s(data.name,150),address:s(data.address,500)||null,status:s(data.status,30)||'Active',openingTime:s(data.openingTime,20)||null,closingTime:s(data.closingTime,20)||null}).returning()
   return Response.json(row,{status:201,headers})
  }
  if(action==='open-shift'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const outletId=s(data.outletId,80); const [outlet]=await db.select().from(posOutlets).where(eq(posOutlets.id,outletId))
   if(!outlet||!scope(access,outlet.franchiseId)||outlet.status!=='Active')return Response.json({error:'Active outlet not found.'},{status:404,headers})
   const [open]=await db.select().from(posShifts).where(and(eq(posShifts.outletId,outletId),eq(posShifts.status,'Open')))
   if(open)return Response.json({error:'An open shift already exists for this outlet.'},{status:409,headers})
   const [row]=await db.insert(posShifts).values({outletId,cashierId:actor,openingCash:String(Math.max(0,n(data.openingCash)))}).returning()
   return Response.json(row,{status:201,headers})
  }
  if(action==='record-sale'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const outletId=s(data.outletId,80), shiftId=s(data.shiftId,80), items=Array.isArray(data.items)?data.items:[]
   const [outlet]=await db.select().from(posOutlets).where(eq(posOutlets.id,outletId)); const [shift]=await db.select().from(posShifts).where(eq(posShifts.id,shiftId))
   if(!outlet||!shift||shift.outletId!==outletId||shift.status!=='Open'||!scope(access,outlet.franchiseId))return Response.json({error:'Open outlet shift is required.'},{status:400,headers})
   if(!items.length)return Response.json({error:'At least one sale item is required.'},{status:400,headers})
   const subtotal=items.reduce((a:(number),i:any)=>a+n(i.quantity)*n(i.unitPrice),0), discount=items.reduce((a:number,i:any)=>a+n(i.discount),0), tax=items.reduce((a:number,i:any)=>a+n(i.tax),0), total=Math.max(0,subtotal-discount+tax)
   const bill=s(data.billNumber,80)||`POS-${Date.now()}`
   const [sale]=await db.insert(posSales).values({outletId,shiftId,billNumber:bill,customerId:data.customerId?s(data.customerId,80):null,cashierId:actor,subtotal:String(subtotal),discount:String(discount),tax:String(tax),total:String(total),status:'Completed'}).returning()
   for(const item of items){
    const product=s(item.product,80); const qty=n(item.quantity)
    if(!products.includes(product)||qty<=0)throw new Error('Invalid sale item')
    await db.insert(posSaleItems).values({saleId:sale.id,product,quantity:String(qty),unit:s(item.unit,20)||'kg',unitPrice:String(n(item.unitPrice)),discount:String(n(item.discount)),tax:String(n(item.tax)),total:String(Math.max(0,qty*n(item.unitPrice)-n(item.discount)+n(item.tax))),stockLotId:item.stockLotId?s(item.stockLotId,80):null})
   }
   const payments=Array.isArray(data.payments)?data.payments:[{method:'Cash',amount:total}]
   const paid=payments.reduce((a:number,p:any)=>a+n(p.amount),0)
   if(Math.abs(paid-total)>0.01)return Response.json({error:'Payment total must equal sale total.'},{status:400,headers})
   for(const p of payments){const method=s(p.method,30);if(!methods.includes(method)||n(p.amount)<=0)throw new Error('Invalid payment');await db.insert(posPayments).values({saleId:sale.id,method,amount:String(n(p.amount)),reference:s(p.reference,200)||null})}
   const invoiceNumber=`POS-${bill}`
   const [invoice]=await db.insert(invoiceRecords).values({orderId:null,posSaleId:sale.id,invoiceNumber,subtotal:String(subtotal),tax:String(tax),total:String(total),paid:String(paid),status:'Paid',issuedAt:new Date()}).returning()
   for(const p of payments)await db.insert(paymentRecords).values({orderId:null,invoiceId:invoice.id,posSaleId:sale.id,amount:String(n(p.amount)),method:s(p.method,30),reference:s(p.reference,200)||null})
   for(const item of items){
    const product=s(item.product,80),qty=n(item.quantity)
    const [last]=await db.select().from(outletStockLedger).where(and(eq(outletStockLedger.outletId,outletId),eq(outletStockLedger.product,product))).orderBy(desc(outletStockLedger.createdAt)).limit(1)
    const balance=n(last?.balanceAfter)-qty
    if(balance<0 && data.allowNegativeStock!==true)return Response.json({error:`Insufficient outlet stock for ${product}.`},{status:409,headers})
    await db.insert(outletStockLedger).values({outletId,product,stockLotId:item.stockLotId?s(item.stockLotId,80):null,movementType:'Sale',quantity:String(-qty),referenceType:'POS_SALE',referenceId:sale.id,balanceAfter:String(balance),createdBy:actor})
   }
   await db.insert(auditEvents).values({actorUserId:actor,franchiseId:outlet.franchiseId,entityType:'pos_sale',entityId:sale.id,action:'completed',metadata:{outletId,billNumber:bill,total,invoiceId:invoice.id}})
   return Response.json({sale,invoice},{status:201,headers})
  }
  if(action==='transfer-stock'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const outletId=s(data.outletId,80),product=s(data.product,80),qty=n(data.quantity)
   const [outlet]=await db.select().from(posOutlets).where(eq(posOutlets.id,outletId))
   if(!outlet||!scope(access,outlet.franchiseId)||!products.includes(product)||qty<=0)return Response.json({error:'Valid outlet, product and quantity are required.'},{status:400,headers})
   const [last]=await db.select().from(outletStockLedger).where(and(eq(outletStockLedger.outletId,outletId),eq(outletStockLedger.product,product))).orderBy(desc(outletStockLedger.createdAt)).limit(1)
   const balance=n(last?.balanceAfter)+qty
   const [row]=await db.insert(outletStockLedger).values({outletId,product,stockLotId:data.stockLotId?s(data.stockLotId,80):null,movementType:'TransferIn',quantity:String(qty),referenceType:s(data.referenceType,50)||'STOCK_TRANSFER',referenceId:data.referenceId?s(data.referenceId,80):null,balanceAfter:String(balance),createdBy:actor}).returning()
   return Response.json(row,{status:201,headers})
  }
  if(action==='return-sale'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const saleId=s(data.saleId,80),itemId=s(data.itemId,80),qty=n(data.quantity)
   const [sale]=await db.select().from(posSales).where(eq(posSales.id,saleId)); const [item]=await db.select().from(posSaleItems).where(eq(posSaleItems.id,itemId))
   if(!sale||!item||item.saleId!==sale.id||qty<=0||qty>n(item.quantity))return Response.json({error:'Invalid return quantity.'},{status:400,headers})
   const [ret]=await db.insert(posReturns).values({saleId,itemId,quantity:String(qty),amount:String(qty*n(item.unitPrice)),reason:s(data.reason,300)||null}).returning()
   const [last]=await db.select().from(outletStockLedger).where(and(eq(outletStockLedger.outletId,sale.outletId),eq(outletStockLedger.product,item.product))).orderBy(desc(outletStockLedger.createdAt)).limit(1)
   await db.insert(outletStockLedger).values({outletId:sale.outletId,product:item.product,stockLotId:item.stockLotId,movementType:'Return',quantity:String(qty),referenceType:'POS_RETURN',referenceId:ret.id,balanceAfter:String(n(last?.balanceAfter)+qty),createdBy:actor})
   return Response.json(ret,{status:201,headers})
  }
  if(action==='close-shift'){
   if(!allowed(access,'outlets','edit'))return Response.json({error:'Outlet edit access is required.'},{status:403,headers})
   const shiftId=s(data.shiftId,80); const [shift]=await db.select().from(posShifts).where(eq(posShifts.id,shiftId))
   if(!shift||shift.status!=='Open')return Response.json({error:'Open shift not found.'},{status:404,headers})
   const rows=await db.select().from(posPayments).innerJoin(posSales,eq(posPayments.saleId,posSales.id)).where(eq(posSales.shiftId,shiftId))
   const cash=rows.filter(r=>r.pos_payments.method==='Cash').reduce((a,r)=>a+n(r.pos_payments.amount),0)
   const total=rows.reduce((a,r)=>a+n(r.pos_payments.amount),0)
   const counted=n(data.countedCash); const expected=n(shift.openingCash)+cash; const variance=counted-expected
   await db.update(posShifts).set({status:'Closed',closedAt:new Date(),expectedCash:String(expected),countedCash:String(counted),cashVariance:String(variance)}).where(eq(posShifts.id,shiftId))
   const [rec]=await db.insert(posReconciliations).values({outletId:shift.outletId,shiftId,businessDate:new Date(),grossSales:String(total),netSales:String(total),cashCollected:String(cash),expectedCash:String(expected),countedCash:String(counted),variance:String(variance),status:Math.abs(variance)<0.01?'Closed':'Exception',closedBy:actor,closedAt:new Date()}).returning()
   await db.insert(auditEvents).values({actorUserId:actor,entityType:'pos_shift',entityId:shiftId,action:'closed',metadata:{expectedCash, countedCash:counted, variance, total}})
   return Response.json(rec,{status:201,headers})
  }
  return Response.json({error:'Unknown POS action.'},{status:400,headers})
 }catch(e){console.error(e);return Response.json({error:e instanceof Error?e.message:'POS operation failed.'},{status:500,headers})}
}
export const config:Config={path:'/api/pos'}
