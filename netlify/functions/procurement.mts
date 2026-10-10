import type { Config } from '@netlify/functions'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, franchises, records, stockLots } from '../../db/schema.js'
import { franchiseStockLedger, goodsReceipts, purchaseOrders, supplierInvoices, supplierPayments, suppliers } from '../../db/procurement-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'

const products = ['Chicken','Mutton','Eggs','Fish','Prawns']
const num=(v:unknown,d=0)=>{const n=Number(v);return Number.isFinite(n)?n:d}
const txt=(v:unknown,m=500)=>typeof v==='string'?v.trim().slice(0,m):''

export default async (req:Request)=>{
 const headers={'Cache-Control':'no-store'}
 try{
  const access=await resolveAccess(req)
  if('error' in access)return Response.json({error:access.error},{status:access.status,headers})
  if(!allowed(access,'sourcing','view')&&!allowed(access,'supply','view'))return Response.json({error:'Procurement or supply access is required.'},{status:403,headers})
  if(req.method==='GET'){
   const [supplierRows,poRows,receiptRows,invoiceRows,paymentRows,stockRows]=await Promise.all([
    db.select().from(suppliers).orderBy(desc(suppliers.createdAt)),
    db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt)),
    db.select().from(goodsReceipts).orderBy(desc(goodsReceipts.receivedAt)),
    db.select().from(supplierInvoices).orderBy(desc(supplierInvoices.issuedAt)),
    db.select().from(supplierPayments).orderBy(desc(supplierPayments.paidAt)),
    db.select().from(franchiseStockLedger).orderBy(desc(franchiseStockLedger.createdAt)),
   ])
   if(access.role==='franchisee') return Response.json({suppliers:[],purchaseOrders:[],goodsReceipts:[],supplierInvoices:[],supplierPayments:[],franchiseStock:stockRows.filter(row=>row.franchiseId===access.franchise?.id)},{headers})
   return Response.json({suppliers:supplierRows,purchaseOrders:poRows,goodsReceipts:receiptRows, supplierInvoices:invoiceRows,supplierPayments:paymentRows,franchiseStock:stockRows},{headers})
  }
  if(!sameOrigin(req)||!['POST','PATCH'].includes(req.method))return new Response('Forbidden',{status:403,headers})
  const body=await req.json();const action=txt(body?.action,80);const data=body?.data&&typeof body.data==='object'?body.data:{}
  const actor=access.id

  if(action==='create-supplier'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   if(!txt(data.name,180))return Response.json({error:'Supplier name is required.'},{status:400,headers})
   const [row]=await db.insert(suppliers).values({name:txt(data.name,180),phone:txt(data.phone,30)||null,email:txt(data.email,180)||null,status:txt(data.status,30)||'Active'}).returning()
   return Response.json(row,{status:201,headers})
  }

  if(action==='create-po'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   const supplierId=txt(data.supplierId,80),product=txt(data.product,80),quantity=num(data.quantity),unit=txt(data.unit,30)||'kg',unitPrice=num(data.unitPrice),supplyRequestId=txt(data.supplyRequestId,80)
   const [supplier]=await db.select().from(suppliers).where(eq(suppliers.id,supplierId))
   if(!supplier||!products.includes(product)||quantity<=0||unitPrice<0||!supplyRequestId)return Response.json({error:'Supplier, product, quantity, price and Supply Request ID are required.'},{status:400,headers})
   const [request]=await db.select().from(records).where(eq(records.id,supplyRequestId))
   if(!request||request.kind!=='supply'||!request.franchiseId)return Response.json({error:'Valid franchise supply request is required.'},{status:400,headers})
   if(request.data.product!==product)return Response.json({error:'PO product must match the franchise supply request.'},{status:400,headers})
   const [row]=await db.insert(purchaseOrders).values({supplyRequestId,supplierId,product,quantity:String(quantity),unit,unitPrice:String(unitPrice),total:String(quantity*unitPrice),status:'Ordered',expectedAt:data.expectedAt?new Date(String(data.expectedAt)):undefined}).returning()
   await db.insert(auditEvents).values({actorUserId:actor,entityType:'purchase_order',entityId:row.id,action:'created',metadata:{supplierId,product,quantity,total:quantity*unitPrice,supplyRequestId}})
   await db.update(records).set({data:{...request.data,status:'Confirmed',purchaseOrderId:row.id}}).where(eq(records.id,supplyRequestId))
   return Response.json(row,{status:201,headers})
  }

  if(action==='receive-po'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   const purchaseOrderId=txt(data.purchaseOrderId,80),received=num(data.receivedQuantity),accepted=num(data.acceptedQuantity),rejected=num(data.rejectedQuantity),qc=txt(data.qcStatus,30)||'Pending'
   const [po]=await db.select().from(purchaseOrders).where(eq(purchaseOrders.id,purchaseOrderId))
   if(!po||received<=0||accepted<0||rejected<0||accepted+rejected>received||!['Pending','Passed','Failed'].includes(qc))return Response.json({error:'Receipt quantities or QC status are invalid.'},{status:400,headers})
   if(qc==='Passed'&&accepted<=0)return Response.json({error:'A passed receipt must have accepted quantity.'},{status:400,headers})
   const priorReceipts=await db.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId,purchaseOrderId))
   const alreadyReceived=priorReceipts.reduce((sum,row)=>sum+num(row.receivedQuantity),0)
   if(alreadyReceived+received>num(po.quantity)+0.000001)return Response.json({error:'Receipt quantity exceeds the remaining purchase order quantity.'},{status:409,headers})
   if(po.status==='Received')return Response.json({error:'This purchase order has already been fully received.'},{status:409,headers})
   const result=await db.transaction(async tx=>{
    const [lockedPo]=await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id,purchaseOrderId)).for('update')
    if(!lockedPo||lockedPo.status==='Received')return null
    const lockedReceipts=await tx.select().from(goodsReceipts).where(eq(goodsReceipts.purchaseOrderId,purchaseOrderId))
    const lockedReceived=lockedReceipts.reduce((sum,row)=>sum+num(row.receivedQuantity),0)
    if(lockedReceived+received>num(lockedPo.quantity)+0.000001)return null
    const [receipt]=await tx.insert(goodsReceipts).values({purchaseOrderId,receivedQuantity:String(received),acceptedQuantity:String(accepted),rejectedQuantity:String(rejected),unit:lockedPo.unit,qcStatus:qc,batchCode:txt(data.batchCode,100)||`GRN-${Date.now()}`,receivedBy:actor}).returning()
    let lot=null
    if(qc==='Passed'&&accepted>0){
     ;[lot]=await tx.insert(stockLots).values({product:lockedPo.product,quantity:String(accepted),unit:lockedPo.unit,stage:'Finished stock',batchCode:receipt.batchCode,status:'Available'}).returning()
    }
    const totalReceived=lockedReceived+received
    await tx.update(purchaseOrders).set({status:totalReceived+0.000001>=num(lockedPo.quantity)?'Received':'Partially Received'}).where(eq(purchaseOrders.id,lockedPo.id))
    await tx.insert(auditEvents).values({actorUserId:actor,entityType:'goods_receipt',entityId:receipt.id,action:'received',metadata:{purchaseOrderId,accepted,rejected,qcStatus:qc,stockLotId:lot?.id||null,supplyRequestId:lockedPo.supplyRequestId||null}})
    if(lot) await tx.update(goodsReceipts).set({stockLotId:lot.id}).where(eq(goodsReceipts.id,receipt.id))
    return {receipt,stockLot:lot}
   })
   if(!result)return Response.json({error:'Purchase order was fully received or the receipt exceeds its remaining quantity.'},{status:409,headers})
   return Response.json(result,{status:201,headers})
  }

  if(action==='create-supplier-invoice'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   const supplierId=txt(data.supplierId,80),total=num(data.total),invoiceNumber=txt(data.invoiceNumber,100)
   if(!supplierId||total<0||!invoiceNumber)return Response.json({error:'Supplier, invoice number and total are required.'},{status:400,headers})
   const [row]=await db.insert(supplierInvoices).values({supplierId,purchaseOrderId:data.purchaseOrderId?txt(data.purchaseOrderId,80):null,invoiceNumber,total:String(total),paid:'0',status:'Issued',dueAt:data.dueAt?new Date(String(data.dueAt)):undefined}).returning()
   return Response.json(row,{status:201,headers})
  }

  if(action==='pay-supplier'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   const invoiceId=txt(data.supplierInvoiceId,80),amount=num(data.amount),method=txt(data.method,40)||'Bank'
   const [invoice]=await db.select().from(supplierInvoices).where(eq(supplierInvoices.id,invoiceId))
   if(!invoice||amount<=0||num(invoice.paid)+amount>num(invoice.total)+0.01)return Response.json({error:'Payment exceeds supplier outstanding.'},{status:400,headers})
   const result=await db.transaction(async tx=>{
    const [payment]=await tx.insert(supplierPayments).values({supplierInvoiceId:invoiceId,amount:String(amount),method,reference:txt(data.reference,200)||null}).returning()
    const paid=num(invoice.paid)+amount,total=num(invoice.total)
    const [updated]=await tx.update(supplierInvoices).set({paid:String(paid),status:paid>=total?'Paid':'Partially Paid'}).where(eq(supplierInvoices.id,invoiceId)).returning()
    return {payment,invoice:updated}
   })
   return Response.json(result,{status:201,headers})
  }

  if(action==='transfer-to-franchise'){
   if(access.role==='franchisee'||!allowed(access,'supply','edit'))return Response.json({error:'Only authorized company staff can transfer company stock to a franchise.'},{status:403,headers})
   const franchiseId=txt(data.franchiseId,80),product=txt(data.product,80),quantity=num(data.quantity),supplyRequestId=txt(data.supplyRequestId,80),purchaseOrderId=txt(data.purchaseOrderId,80),goodsReceiptId=txt(data.goodsReceiptId,80)
   const [franchise]=await db.select().from(franchises).where(eq(franchises.id,franchiseId))
   if(!franchise||!products.includes(product)||quantity<=0||!supplyRequestId||!purchaseOrderId||!goodsReceiptId)return Response.json({error:'Franchise, product, quantity, Supply Request ID, Purchase Order ID and GRN ID are required.'},{status:400,headers})
   const [request]=await db.select().from(records).where(eq(records.id,supplyRequestId))
   const [po]=await db.select().from(purchaseOrders).where(eq(purchaseOrders.id,purchaseOrderId))
   const [grn]=await db.select().from(goodsReceipts).where(eq(goodsReceipts.id,goodsReceiptId))
   if(!request||request.kind!=='supply'||request.franchiseId!==franchiseId)return Response.json({error:'Supply request does not belong to this franchise.'},{status:400,headers})
   if(!po||po.supplyRequestId!==supplyRequestId)return Response.json({error:'Purchase Order is not linked to this Supply Request.'},{status:400,headers})
   if(!po||po.product!==product)return Response.json({error:'The supplied product must match the Purchase Order product.'},{status:400,headers})
   if(!grn||grn.purchaseOrderId!==purchaseOrderId||grn.qcStatus!=='Passed'||!grn.stockLotId)return Response.json({error:'A passed GRN with a finished-stock lot linked to this Purchase Order is required.'},{status:400,headers})
   if(request.data.status!=='Confirmed'&&request.data.status!=='Dispatched')return Response.json({error:'Supply Request must be Confirmed or Dispatched before franchise receipt.'},{status:400,headers})
   const result=await db.transaction(async tx=>{
    const [lockedRequest]=await tx.select().from(records).where(eq(records.id,supplyRequestId)).for('update')
    if(!lockedRequest||lockedRequest.kind!=='supply'||lockedRequest.franchiseId!==franchiseId||
       (lockedRequest.data.status!=='Confirmed'&&lockedRequest.data.status!=='Dispatched'))return null
    let remaining=quantity
    const lots=await tx.select().from(stockLots).where(and(eq(stockLots.id,grn.stockLotId!),eq(stockLots.product,product),eq(stockLots.stage,'Finished stock'),eq(stockLots.status,'Available'))).for('update')
    const allocations:{id:string;qty:number}[]=[]
    for(const lot of lots){const available=Math.max(0,num(lot.quantity));if(available<=0)continue;const take=Math.min(available,remaining);allocations.push({id:lot.id,qty:take});remaining-=take;if(remaining<=0.000001)break}
    if(remaining>0.000001)throw new Error(`Insufficient company stock for ${product}.`)
    let lastBalance=0
    const [last]=await tx.select().from(franchiseStockLedger).where(and(eq(franchiseStockLedger.franchiseId,franchiseId),eq(franchiseStockLedger.product,product))).orderBy(desc(franchiseStockLedger.createdAt)).limit(1)
    lastBalance=num(last?.balanceAfter)
    const rows=[]
    for(const a of allocations){
     const [lot]=await tx.select().from(stockLots).where(eq(stockLots.id,a.id))
     if(!lot||num(lot.quantity)<a.qty)throw new Error('Stock changed while supplying the franchise. Please retry.')
     const newQty=num(lot.quantity)-a.qty
     await tx.update(stockLots).set({quantity:String(newQty),status:newQty>0?'Available':'Depleted',updatedAt:new Date()}).where(eq(stockLots.id,lot.id))
     lastBalance+=a.qty
     const [row]=await tx.insert(franchiseStockLedger).values({franchiseId,product,stockLotId:lot.id,movementType:'SupplyIn',quantity:String(a.qty),referenceType:'FRANCHISE_SUPPLY',referenceId:supplyRequestId,supplyRequestId,purchaseOrderId,goodsReceiptId,balanceAfter:String(lastBalance),createdBy:actor}).returning()
     rows.push(row)
    }
    await tx.update(records).set({data:{...lockedRequest.data,status:'Delivered',deliveredQuantity:quantity,purchaseOrderId,goodsReceiptId,receivedAt:new Date().toISOString()}}).where(eq(records.id,supplyRequestId))
    await tx.insert(records).values({kind:'stock_movements',franchiseId,data:{name:`${product} received from company`,status:'Posted',date:new Date().toISOString().slice(0,10),product,quantity,unit:request.data.unit||'kg',reference:supplyRequestId,fromStage:'Finished stock',toStage:'Franchise stock',movementType:'SupplyIn',supplyRequestId,purchaseOrderId,goodsReceiptId}})
    await tx.insert(auditEvents).values({actorUserId:actor,franchiseId,entityType:'franchise_stock_supply',action:'received',metadata:{product,quantity,franchiseId,rows:rows.length,supplyRequestId,purchaseOrderId,goodsReceiptId}})
    return rows
   })
   if(!result)return Response.json({error:'Supply request was already delivered or is no longer eligible for transfer.'},{status:409,headers})
   return Response.json({rows:result},{status:201,headers})
  }

  return Response.json({error:'Unknown procurement action.'},{status:400,headers})
 }catch(e){console.error(e);return Response.json({error:e instanceof Error?e.message:'Procurement operation failed.'},{status:500,headers})}
}
export const config:Config={path:'/api/procurement'}
