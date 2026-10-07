import type { Config } from '@netlify/functions'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index.js'
import {
  auditEvents, customerAddresses, customerOrders, dispatchLoads, deliveryRoutes, deliveryStops,
  drivers, invoiceRecords, labels, packageItems, packages, paymentRecords, processingBatches,
  productionOrders, proofOfDelivery, qcChecks, settlementRecords, stockLots, vehicles
} from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'

const products = ['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns']
const productionStatuses = ['Planned', 'Processing', 'Quality Check', 'Completed', 'Rejected']
const routeStatuses = ['Planned', 'Loading', 'Loaded', 'Out for delivery', 'Completed', 'Cancelled']
const stopStatuses = ['Planned', 'Loaded', 'Out for delivery', 'Delivered', 'Failed', 'Rescheduled']

function num(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function text(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
function franchiseAllowed(access: Awaited<ReturnType<typeof resolveAccess>>, franchiseId?: string | null) {
  return access.role !== 'franchisee' || !franchiseId || access.franchise?.id === franchiseId
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    if (!allowed(access, 'processing', 'view') && !allowed(access, 'orders', 'view')) return Response.json({ error: 'You do not have access to fulfilment.' }, { status: 403, headers })

    if (req.method === 'GET') {
      const [production, batches, lots, packageRows, routes, stops, loadRows, invoices] = await Promise.all([
        db.select().from(productionOrders).orderBy(desc(productionOrders.createdAt)),
        db.select().from(processingBatches).orderBy(desc(processingBatches.createdAt)),
        db.select().from(stockLots).orderBy(desc(stockLots.createdAt)),
        db.select().from(packages).orderBy(desc(packages.createdAt)),
        db.select().from(deliveryRoutes).orderBy(desc(deliveryRoutes.routeDate)),
        db.select().from(deliveryStops).orderBy(deliveryStops.sequence),
        db.select().from(dispatchLoads).orderBy(desc(dispatchLoads.scannedAt)),
        db.select().from(invoiceRecords).orderBy(desc(invoiceRecords.createdAt)),
      ])
      const visible = <T extends { franchiseId?: string | null }>(rows: T[]) => rows.filter(row => franchiseAllowed(access, row.franchiseId))
      return Response.json({ production: visible(production), batches, lots, packages: packageRows, routes: visible(routes), stops, loads: loadRows, invoices }, { headers })
    }

    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = text(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.id

    if (action === 'create-production') {
      if (!allowed(access, 'processing', 'edit')) return Response.json({ error: 'Processing edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80)
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!order || !franchiseAllowed(access, order.franchiseId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const [item] = await db.select().from((await import('../../db/schema.js')).customerOrderItems).where(eq((await import('../../db/schema.js')).customerOrderItems.orderId, order.id))
      const product = text(data.product, 80) || item?.product
      const quantity = num(data.quantity, num(item?.quantity))
      if (!products.includes(product) || quantity <= 0) return Response.json({ error: 'A valid product and quantity are required.' }, { status: 400, headers })
      const [created] = await db.insert(productionOrders).values({ orderId: order.id, franchiseId: order.franchiseId, product, requestedQuantity: String(quantity), unit: text(data.unit, 30) || item?.unit || 'kg', dueAt: data.dueAt ? new Date(String(data.dueAt)) : undefined }).returning()
      await db.insert(auditEvents).values({ actorUserId: actor, franchiseId: order.franchiseId, entityType: 'production_order', entityId: created.id, action: 'created', metadata: { orderId: order.id } })
      return Response.json(created, { status: 201, headers })
    }

    if (action === 'process-batch') {
      if (!allowed(access, 'processing', 'edit')) return Response.json({ error: 'Processing edit access is required.' }, { status: 403, headers })
      const productionOrderId = text(data.productionOrderId, 80)
      const input = num(data.inputQuantity), output = num(data.outputQuantity), waste = num(data.wasteQuantity)
      if (input <= 0 || output < 0 || waste < 0 || output + waste > input) return Response.json({ error: 'Input, output and waste quantities are invalid.' }, { status: 400, headers })
      const [production] = await db.select().from(productionOrders).where(eq(productionOrders.id, productionOrderId))
      if (!production || !franchiseAllowed(access, production.franchiseId)) return Response.json({ error: 'Production order not found.' }, { status: 404, headers })
      const [batch] = await db.insert(processingBatches).values({ productionOrderId, product: production.product, inputQuantity: String(input), outputQuantity: String(output), wasteQuantity: String(waste), unit: production.unit, status: data.qcStatus === 'Passed' ? 'Completed' : 'Quality Check', qcStatus: ['Pending','Passed','Failed'].includes(text(data.qcStatus,30)) ? text(data.qcStatus,30) : 'Pending', qcRemarks: text(data.qcRemarks) || null, processedAt: data.qcStatus === 'Passed' ? new Date() : undefined }).returning()
      if (batch.qcStatus !== 'Pending') await db.insert(qcChecks).values({ processingBatchId: batch.id, status: batch.qcStatus, temperature: data.temperature === undefined ? null : String(num(data.temperature)), remarks: text(data.qcRemarks) || null, checkedBy: actor })
      if (batch.qcStatus === 'Passed') {
        await db.insert(stockLots).values({ product: batch.product, quantity: String(output), unit: batch.unit, sourceBatchId: batch.id, batchCode: text(data.batchCode, 100) || `FR-${Date.now()}`, status: 'Available' })
        await db.update(productionOrders).set({ status: 'Completed', updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId))
      } else {
        await db.update(productionOrders).set({ status: 'Quality Check', updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId))
      }
      await db.insert(auditEvents).values({ actorUserId: actor, franchiseId: production.franchiseId, entityType: 'processing_batch', entityId: batch.id, action: 'processed', metadata: { productionOrderId, input, output, waste, yieldPct: input ? Number((output / input * 100).toFixed(2)) : 0 } })
      return Response.json(batch, { status: 201, headers })
    }

    if (action === 'create-package') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80), quantity = num(data.quantity)
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!order || !franchiseAllowed(access, order.franchiseId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      if (quantity <= 0) return Response.json({ error: 'Package quantity must be greater than zero.' }, { status: 400, headers })
      const code = text(data.packageCode, 80) || `PKG-${Date.now()}-${Math.floor(Math.random()*1000)}`
      const [pkg] = await db.insert(packages).values({ orderId, packageCode: code, product: text(data.product,80) || 'Chicken', quantity: String(quantity), unit: text(data.unit,30) || 'kg', status: 'Packed', packedAt: new Date() }).returning()
      const [label] = await db.insert(labels).values({ packageId: pkg.id, code: `LBL-${code}`, payload: { packageCode: code, orderId, product: pkg.product, quantity, unit: pkg.unit } }).returning()
      await db.insert(auditEvents).values({ actorUserId: actor, franchiseId: order.franchiseId, entityType: 'package', entityId: pkg.id, action: 'packed', metadata: { labelId: label.id } })
      return Response.json({ package: pkg, label }, { status: 201, headers })
    }

    if (action === 'create-route') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const franchiseId = data.franchiseId ? text(data.franchiseId,80) : null
      if (!franchiseAllowed(access, franchiseId)) return Response.json({ error: 'Franchise access denied.' }, { status: 403, headers })
      const routeDate = new Date(String(data.routeDate || new Date().toISOString()))
      if (Number.isNaN(routeDate.getTime())) return Response.json({ error: 'Invalid route date.' }, { status: 400, headers })
      const [route] = await db.insert(deliveryRoutes).values({ franchiseId, routeDate, routeCode: text(data.routeCode,80) || `RT-${Date.now()}`, status: 'Planned', driverId: data.driverId ? text(data.driverId,80) : undefined, vehicleId: data.vehicleId ? text(data.vehicleId,80) : undefined, notes: text(data.notes) || null }).returning()
      await db.insert(auditEvents).values({ actorUserId: actor, franchiseId, entityType: 'delivery_route', entityId: route.id, action: 'created', metadata: {} })
      return Response.json(route, { status: 201, headers })
    }

    if (action === 'add-stop') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const routeId = text(data.routeId,80), orderId = text(data.orderId,80)
      const [route] = await db.select().from(deliveryRoutes).where(eq(deliveryRoutes.id, routeId))
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!route || !order || !franchiseAllowed(access, route.franchiseId) || route.franchiseId !== order.franchiseId) return Response.json({ error: 'Route or order not found.' }, { status: 404, headers })
      const [address] = await db.select().from(customerAddresses).where(and(eq(customerAddresses.customerId, order.customerId), eq(customerAddresses.isDefault, 1)))
      const [stop] = await db.insert(deliveryStops).values({ routeId, orderId, sequence: Math.max(0, num(data.sequence, 0)), addressId: address?.id, latitude: address?.latitude, longitude: address?.longitude, deliveryWindow: text(data.deliveryWindow,100) || null }).returning()
      await db.insert(auditEvents).values({ actorUserId: actor, franchiseId: route.franchiseId, entityType: 'delivery_stop', entityId: stop.id, action: 'created', metadata: { routeId, orderId } })
      return Response.json(stop, { status: 201, headers })
    }

    if (action === 'scan-load') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const routeId = text(data.routeId,80), packageId = text(data.packageId,80)
      const [route] = await db.select().from(deliveryRoutes).where(eq(deliveryRoutes.id, routeId))
      const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId))
      if (!route || !pkg || !franchiseAllowed(access, route.franchiseId)) return Response.json({ error: 'Route or package not found.' }, { status: 404, headers })
      const [load] = await db.insert(dispatchLoads).values({ routeId, packageId, scannedBy: actor, status: 'Loaded' }).returning()
      await db.update(packages).set({ status: 'Loaded' }).where(eq(packages.id, packageId))
      await db.update(deliveryRoutes).set({ status: 'Loaded', updatedAt: new Date() }).where(eq(deliveryRoutes.id, routeId))
      return Response.json(load, { status: 201, headers })
    }

    if (action === 'proof-of-delivery') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const stopId = text(data.stopId,80)
      const [stop] = await db.select().from(deliveryStops).where(eq(deliveryStops.id, stopId))
      if (!stop) return Response.json({ error: 'Delivery stop not found.' }, { status: 404, headers })
      const [pod] = await db.insert(proofOfDelivery).values({ stopId, status: 'Delivered', recipientName: text(data.recipientName,180) || null, notes: text(data.notes) || null, photoUrl: text(data.photoUrl,2000) || null, signatureRef: text(data.signatureRef,500) || null }).onConflictDoUpdate({ target: proofOfDelivery.stopId, set: { status: 'Delivered', recipientName: text(data.recipientName,180) || null, notes: text(data.notes) || null, photoUrl: text(data.photoUrl,2000) || null, signatureRef: text(data.signatureRef,500) || null, deliveredAt: new Date() } }).returning()
      await db.update(deliveryStops).set({ status: 'Delivered', deliveredAt: new Date() }).where(eq(deliveryStops.id, stopId))
      await db.update(customerOrders).set({ status: 'Delivered', updatedAt: new Date() }).where(eq(customerOrders.id, stop.orderId))
      return Response.json(pod, { headers })
    }

    if (action === 'record-payment') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Payment edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId,80), amount = num(data.amount)
      if (amount <= 0) return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400, headers })
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!order || !franchiseAllowed(access, order.franchiseId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const [invoice] = await db.select().from(invoiceRecords).where(eq(invoiceRecords.orderId, orderId)).orderBy(desc(invoiceRecords.createdAt))
      const [payment] = await db.insert(paymentRecords).values({ orderId, invoiceId: invoice?.id, amount: String(amount), method: text(data.method,50) || 'Other', reference: text(data.reference,200) || null }).returning()
      if (invoice) {
        const paid = num(invoice.paid) + amount
        const total = num(invoice.total)
        await db.update(invoiceRecords).set({ paid: String(paid), status: paid >= total ? 'Paid' : 'Partially Paid', updatedAt: new Date() }).where(eq(invoiceRecords.id, invoice.id))
      }
      return Response.json(payment, { status: 201, headers })
    }

    if (action === 'create-invoice') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId,80)
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!order || !franchiseAllowed(access, order.franchiseId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const total = num(data.total, num(order.total)), subtotal = num(data.subtotal, num(order.subtotal, total)), tax = num(data.tax)
      const [invoice] = await db.insert(invoiceRecords).values({ orderId, invoiceNumber: text(data.invoiceNumber,80) || `INV-${Date.now()}`, subtotal: String(subtotal), tax: String(tax), total: String(total), paid: String(num(data.paid)), status: num(data.paid) >= total ? 'Paid' : num(data.paid) > 0 ? 'Partially Paid' : 'Issued', issuedAt: new Date(), dueAt: data.dueAt ? new Date(String(data.dueAt)) : undefined }).returning()
      return Response.json(invoice, { status: 201, headers })
    }

    return Response.json({ error: 'Unknown fulfilment action.' }, { status: 400, headers })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Fulfilment operation failed.' }, { status: 500, headers })
  }
}

export const config: Config = { path: '/api/fulfillment' }
