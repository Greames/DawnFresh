import type { Config } from '@netlify/functions'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { auditEvents, franchises, records, stockLots } from '../../db/schema.js'
import { goodsReceipts, purchaseOrders, supplierInvoices, supplierPayments, suppliers } from '../../db/procurement-schema.js'
import { outletStockLedger, posOutlets } from '../../db/pos-schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { outletBalance, postMovement } from '../../db/outlet-stock.js'

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
    // Derived view: franchise stock is its outlets' ledger rows (franchise_stock_ledger is retired, inflow-only legacy).
    db.select({ledger:outletStockLedger,franchiseId:posOutlets.franchiseId}).from(outletStockLedger).innerJoin(posOutlets,eq(posOutlets.id,outletStockLedger.outletId)).where(isNotNull(posOutlets.franchiseId)).orderBy(desc(outletStockLedger.createdAt)),
   ])
   const franchiseStockRows=stockRows.map(r=>({...r.ledger,franchiseId:r.franchiseId}))
   if(access.role==='franchisee') return Response.json({suppliers:[],purchaseOrders:[],goodsReceipts:[],supplierInvoices:[],supplierPayments:[],franchiseStock:franchiseStockRows.filter(row=>row.franchiseId===access.franchise?.id)},{headers})
   return Response.json({suppliers:supplierRows,purchaseOrders:poRows,goodsReceipts:receiptRows, supplierInvoices:invoiceRows,supplierPayments:paymentRows,franchiseStock:franchiseStockRows},{headers})
  }
  if(!sameOrigin(req)||!['POST','PATCH'].includes(req.method))return new Response('Forbidden',{status:403,headers})
  const body=await req.json();const action=txt(body?.action,80);const data=body?.data&&typeof body.data==='object'?body.data:{}
  const actor=access.account.id
  // Supplier, purchase-order, receipt and supplier-payment actions are company-only, whatever the module permissions say.
  if(['create-supplier','create-po','receive-po','create-supplier-invoice','pay-supplier'].includes(action)&&access.role==='franchisee')return Response.json({error:'Procurement actions are limited to company users.'},{status:403,headers})

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
   const supplierId=txt(data.supplierId,80),total=num(data.total,Number.NaN),invoiceNumber=txt(data.invoiceNumber,100)
   const purchaseOrderId=data.purchaseOrderId?txt(data.purchaseOrderId,80):null
   if(!supplierId||!Number.isFinite(total)||total<0||!invoiceNumber)return Response.json({error:'Supplier, invoice number and a valid non-negative total are required.'},{status:400,headers})
   const [supplier]=await db.select().from(suppliers).where(eq(suppliers.id,supplierId))
   if(!supplier)return Response.json({error:'Supplier not found.'},{status:404,headers})
   if(purchaseOrderId){const [po]=await db.select().from(purchaseOrders).where(eq(purchaseOrders.id,purchaseOrderId));if(!po||po.supplierId!==supplierId)return Response.json({error:'Purchase order must belong to the selected supplier.'},{status:400,headers})}
   const dueAt=data.dueAt?new Date(String(data.dueAt)):undefined
   if(dueAt&&Number.isNaN(dueAt.getTime()))return Response.json({error:'Supplier invoice due date is invalid.'},{status:400,headers})
   const [row]=await db.insert(supplierInvoices).values({supplierId,purchaseOrderId,invoiceNumber,total:String(total),paid:'0',status:'Issued',dueAt}).returning()
   return Response.json(row,{status:201,headers})
  }

  if(action==='pay-supplier'){
   if(!allowed(access,'sourcing','edit'))return Response.json({error:'Sourcing edit access is required.'},{status:403,headers})
   const invoiceId=txt(data.supplierInvoiceId,80),amount=num(data.amount,Number.NaN),method=txt(data.method,40)||'Bank'
   if(!Number.isFinite(amount)||amount<=0)return Response.json({error:'Payment amount must be greater than zero.'},{status:400,headers})
   const result=await db.transaction(async tx=>{
    const [invoice]=await tx.select().from(supplierInvoices).where(eq(supplierInvoices.id,invoiceId)).for('update')
    if(!invoice||num(invoice.paid)+amount>num(invoice.total)+0.000001)return null
    const [payment]=await tx.insert(supplierPayments).values({supplierInvoiceId:invoiceId,amount:String(amount),method,reference:txt(data.reference,200)||null}).returning()
    const paid=num(invoice.paid)+amount,total=num(invoice.total)
    const [updated]=await tx.update(supplierInvoices).set({paid:String(paid),status:paid>=total?'Paid':'Partially Paid'}).where(eq(supplierInvoices.id,invoiceId)).returning()
    return {payment,invoice:updated}
   })
   if(!result)return Response.json({error:'Supplier invoice not found or payment exceeds the remaining balance.'},{status:409,headers})
   return Response.json(result,{status:201,headers})
  }

  if(action==='transfer-to-franchise'){
   if(access.role==='franchisee'||!allowed(access,'supply','edit'))return Response.json({error:'Only authorized company staff can transfer company stock to a franchise.'},{status:403,headers})
   const franchiseId=txt(data.franchiseId,80),product=txt(data.product,80),quantity=num(data.quantity),supplyRequestId=txt(data.supplyRequestId,80),purchaseOrderId=txt(data.purchaseOrderId,80),goodsReceiptId=txt(data.goodsReceiptId,80)
   const [franchise]=await db.select().from(franchises).where(eq(franchises.id,franchiseId))
   if(!franchise||!products.includes(product)||!(quantity>0)||!supplyRequestId||!purchaseOrderId||!goodsReceiptId)return Response.json({error:'Franchise, product, quantity, Supply Request ID, Purchase Order ID and GRN ID are required.'},{status:400,headers})
   const [request]=await db.select().from(records).where(eq(records.id,supplyRequestId))
   const [po]=await db.select().from(purchaseOrders).where(eq(purchaseOrders.id,purchaseOrderId))
   const [grn]=await db.select().from(goodsReceipts).where(eq(goodsReceipts.id,goodsReceiptId))
   if(!request||request.kind!=='supply'||request.franchiseId!==franchiseId)return Response.json({error:'Supply request does not belong to this franchise.'},{status:400,headers})
   if(request.data.product!==product)return Response.json({error:'The supplied product must match the Supply Request product.'},{status:400,headers})
   if(!po||po.supplyRequestId!==supplyRequestId)return Response.json({error:'Purchase Order is not linked to this Supply Request.'},{status:400,headers})
   if(po.product!==product)return Response.json({error:'The supplied product must match the Purchase Order product.'},{status:400,headers})
   if(!grn||grn.purchaseOrderId!==purchaseOrderId||grn.qcStatus!=='Passed'||!grn.stockLotId)return Response.json({error:'A passed GRN with a finished-stock lot linked to this Purchase Order is required.'},{status:400,headers})
   // Destination outlet: the franchise's only active outlet by default, otherwise it must be named.
   const outlets=await db.select().from(posOutlets).where(and(eq(posOutlets.franchiseId,franchiseId),eq(posOutlets.status,'Active')))
   const requestedOutletId=txt(data.outletId,80)
   if(!outlets.length)return Response.json({error:'This franchise has no active outlet to receive stock. Create a POS outlet for the franchise first.'},{status:400,headers})
   if(!requestedOutletId&&outlets.length>1)return Response.json({error:'This franchise has several outlets; choose the destination outlet (outletId).'},{status:400,headers})
   const outletId=requestedOutletId||outlets[0].id
   if(!outlets.some(o=>o.id===outletId))return Response.json({error:'Destination outlet must be an active outlet of this franchise.'},{status:400,headers})
   const unit=request.data.unit||'kg'
   const result=await db.transaction(async tx=>{
    // Lock order: supply request, destination outlet, then the GRN lot.
    const [lockedRequest]=await tx.select().from(records).where(eq(records.id,supplyRequestId)).for('update')
    if(!lockedRequest||lockedRequest.kind!=='supply'||lockedRequest.franchiseId!==franchiseId||!['Confirmed','Dispatched','Partially Delivered'].includes(String(lockedRequest.data.status)))return {error:'Supply request is not open for delivery (it must be Confirmed, Dispatched or Partially Delivered).'}
    const [lockedOutlet]=await tx.select().from(posOutlets).where(eq(posOutlets.id,outletId)).for('update')
    if(!lockedOutlet||lockedOutlet.franchiseId!==franchiseId||lockedOutlet.status!=='Active')return {error:'Destination outlet is no longer available.'}
    // Cap to the accepted quantity (falls back to the requested quantity) less what was already delivered.
    const approved=num(lockedRequest.data.acceptedQuantity,num(lockedRequest.data.quantity))
    const delivered=num(lockedRequest.data.deliveredQuantity)
    const outstanding=approved-delivered
    if(quantity>outstanding+0.000001)return {error:`Transfer exceeds the approved supply quantity. Approved: ${approved}; already delivered: ${delivered}; outstanding: ${Math.max(0,outstanding)}.`}
    const lots=await tx.select().from(stockLots).where(and(eq(stockLots.id,grn.stockLotId!),eq(stockLots.product,product),eq(stockLots.stage,'Finished stock'),eq(stockLots.status,'Available'),isNull(stockLots.franchiseId))).for('update')
    const lot=lots[0]
    if(!lot||num(lot.quantity)+0.000001<quantity)throw new Error(`Insufficient company stock for ${product} in the GRN lot.`)
    const newQty=Math.max(0,num(lot.quantity)-quantity)
    await tx.update(stockLots).set({quantity:String(newQty),status:newQty>0?'Available':'Depleted',updatedAt:new Date()}).where(eq(stockLots.id,lot.id))
    // Credit the receiving outlet ledger: this is the franchise's sellable stock.
    const row=await postMovement(tx,{outletId,product,stockLotId:lot.id,movementType:'SupplyIn',quantity,referenceType:'FRANCHISE_SUPPLY',referenceId:supplyRequestId,supplyRequestId,purchaseOrderId,goodsReceiptId,createdBy:actor})
    const totalDelivered=delivered+quantity
    const full=totalDelivered+0.000001>=approved
    await tx.update(records).set({data:{...lockedRequest.data,status:full?'Delivered':'Partially Delivered',deliveredQuantity:totalDelivered,purchaseOrderId,goodsReceiptId,destinationOutletId:outletId,receivedAt:new Date().toISOString()}}).where(eq(records.id,supplyRequestId))
    await tx.insert(records).values({kind:'stock_movements',franchiseId,data:{name:`${product} received from company`,status:'Posted',date:new Date().toISOString().slice(0,10),product,quantity,unit,reference:supplyRequestId,fromStage:'Finished stock',toStage:'Franchise outlet stock',movementType:'SupplyIn',supplyRequestId,purchaseOrderId,goodsReceiptId,outletId}})
    await tx.insert(auditEvents).values({actorUserId:actor,franchiseId,entityType:'franchise_stock_supply',action:'received',metadata:{product,quantity,franchiseId,outletId,ledgerRowId:row.id,stockLotId:lot.id,supplyRequestId,purchaseOrderId,goodsReceiptId,approved,totalDelivered,fullyDelivered:full,outletBalance:await outletBalance(tx,outletId,product)}})
    return {rows:[{...row,franchiseId}]}
   })
   if('error' in result)return Response.json({error:result.error},{status:409,headers})
   return Response.json(result,{status:201,headers})
  }

  return Response.json({error:'Unknown procurement action.'},{status:400,headers})
 }catch(e){console.error(e);return Response.json({error:e instanceof Error?e.message:'Procurement operation failed.'},{status:500,headers})}
}
export const config:Config={path:'/api/procurement'}
