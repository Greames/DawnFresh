import type { Config } from '@netlify/functions'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import {
  auditEvents, customerAddresses, customerOrderItems, customerOrders, dispatchLoads, deliveryRoutes, deliveryStops,
  drivers, invoiceRecords, labels, packages, paymentRecords, processingBatches,
  productionOrders, proofOfDelivery, qcChecks, stockLots, vehicles
} from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import type { Access } from '../../db/access.js'
import { Rejection, failure, idempotencyKeyOf, respond, transact } from '../../db/tx.js'
import type { Tx } from '../../db/tx.js'
import { r2 } from '../../db/stock.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const products = ['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns']

function num(value: unknown, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
function text(value: unknown, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}
function franchiseAllowed(access: Access, franchiseId?: string | null) {
  return access.role !== 'franchisee' || (!!franchiseId && access.franchise?.id === franchiseId)
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
      const visibleProduction = visible(production)
      const visibleRoutes = visible(routes)
      if (access.role === 'franchisee') {
        const visibleOrders = await db.select().from(customerOrders).where(eq(customerOrders.franchiseId, access.franchise!.id))
        const orderIds = new Set(visibleOrders.map(row => row.id))
        const productionIds = new Set(visibleProduction.map(row => row.id))
        const visibleBatches = batches.filter(row => !!row.productionOrderId && productionIds.has(row.productionOrderId))
        const batchIds = new Set(visibleBatches.map(row => row.id))
        const routeIds = new Set(visibleRoutes.map(row => row.id))
        return Response.json({
          production: visibleProduction,
          batches: visibleBatches,
          lots: lots.filter(row => row.franchiseId === access.franchise!.id || (!!row.sourceBatchId && batchIds.has(row.sourceBatchId))),
          packages: packageRows.filter(row => orderIds.has(row.orderId)),
          routes: visibleRoutes,
          stops: stops.filter(row => routeIds.has(row.routeId) && orderIds.has(row.orderId)),
          loads: loadRows.filter(row => routeIds.has(row.routeId)),
          invoices: invoices.filter(row => !!row.orderId && orderIds.has(row.orderId)),
        }, { headers })
      }
      return Response.json({ production: visibleProduction, batches, lots, packages: packageRows, routes: visibleRoutes, stops, loads: loadRows, invoices }, { headers })
    }

    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const body = await req.json()
    const action = text(body?.action, 80)
    const data = body?.data && typeof body.data === 'object' ? body.data : {}
    const actor = access.account.id
    const key = idempotencyKeyOf(req, body)
    const run = (fn: (tx: Tx) => Promise<{ status: number; body: unknown }>) => transact({ actor, action, key, payload: data }, fn)

    if (action === 'create-production') {
      if (!allowed(access, 'processing', 'edit')) return Response.json({ error: 'Processing edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80)
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, orderId))
      if (!order || !franchiseAllowed(access, order.franchiseId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const [item] = await db.select().from(customerOrderItems).where(eq(customerOrderItems.orderId, order.id))
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
      const input = num(data.inputQuantity, Number.NaN), output = num(data.outputQuantity, Number.NaN), waste = num(data.wasteQuantity, Number.NaN)
      const qcStatus = ['Pending', 'Passed', 'Failed'].includes(text(data.qcStatus, 30)) ? text(data.qcStatus, 30) : 'Pending'
      if (!Number.isFinite(input) || !Number.isFinite(output) || !Number.isFinite(waste) || input <= 0 || output < 0 || waste < 0 || output + waste > input) return Response.json({ error: 'Input, output and waste quantities are invalid.' }, { status: 400, headers })
      const result = await db.transaction(async tx => {
        const [production] = await tx.select().from(productionOrders).where(eq(productionOrders.id, productionOrderId)).for('update')
        if (!production || !franchiseAllowed(access, production.franchiseId)) return { error: 'Production order not found.', status: 404 as const }
        if (production.status !== 'Planned' && production.status !== 'Processing') return { error: 'This production order is already in quality check or finalized and cannot be processed again.', status: 409 as const }
        const [batch] = await tx.insert(processingBatches).values({ productionOrderId, product: production.product, inputQuantity: String(input), outputQuantity: String(output), wasteQuantity: String(waste), unit: production.unit, status: qcStatus === 'Passed' ? 'Completed' : 'Quality Check', qcStatus, qcRemarks: text(data.qcRemarks) || null, processedAt: qcStatus === 'Passed' ? new Date() : undefined }).returning()
        if (batch.qcStatus !== 'Pending') await tx.insert(qcChecks).values({ processingBatchId: batch.id, status: batch.qcStatus, temperature: data.temperature === undefined ? null : String(num(data.temperature)), remarks: text(data.qcRemarks) || null, checkedBy: actor })
        if (batch.qcStatus === 'Passed') {
          await tx.insert(stockLots).values({ product: batch.product, quantity: String(output), unit: batch.unit, sourceBatchId: batch.id, batchCode: text(data.batchCode, 100) || `FR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, status: 'Available', franchiseId: production.franchiseId })
          await tx.update(productionOrders).set({ status: 'Completed', updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId))
        } else {
          await tx.update(productionOrders).set({ status: qcStatus === 'Failed' ? 'Rejected' : 'Quality Check', updatedAt: new Date() }).where(eq(productionOrders.id, productionOrderId))
        }
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: production.franchiseId, entityType: 'processing_batch', entityId: batch.id, action: 'processed', metadata: { productionOrderId, input, output, waste, yieldPct: input ? Number((output / input * 100).toFixed(2)) : 0 } })
        return { batch }
      })
      if ('error' in result) return Response.json({ error: result.error }, { status: result.status, headers })
      return Response.json(result.batch, { status: 201, headers })
    }

    if (action === 'create-package') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80), quantity = num(data.quantity)
      if (!uuidPattern.test(orderId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      if (quantity <= 0) return Response.json({ error: 'Package quantity must be greater than zero.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [order] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId))
        if (!order || !franchiseAllowed(access, order.franchiseId)) throw new Rejection(404, 'Order not found.')
        const code = text(data.packageCode, 80) || `PKG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
        const [pkg] = await tx.insert(packages).values({ orderId, packageCode: code, product: text(data.product, 80) || 'Chicken', quantity: String(quantity), unit: text(data.unit, 30) || 'kg', status: 'Packed', packedAt: new Date() }).returning()
        const [label] = await tx.insert(labels).values({ packageId: pkg.id, code: `LBL-${code}`, payload: { packageCode: code, orderId, product: pkg.product, quantity, unit: pkg.unit } }).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: order.franchiseId, entityType: 'package', entityId: pkg.id, action: 'packed', metadata: { labelId: label.id, idempotencyKey: key } })
        return { status: 201, body: { package: pkg, label } }
      })
      return respond(done, headers)
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
      const routeId = text(data.routeId, 80), packageId = text(data.packageId, 80)
      if (!uuidPattern.test(routeId) || !uuidPattern.test(packageId)) return Response.json({ error: 'Route or package not found.' }, { status: 404, headers })
      const done = await run(async tx => {
        // The package row is the lock: two scanners of the same package queue here and the second sees the first load.
        const [pkg] = await tx.select().from(packages).where(eq(packages.id, packageId)).for('update')
        const [route] = await tx.select().from(deliveryRoutes).where(eq(deliveryRoutes.id, routeId)).for('update')
        if (!route || !pkg || !franchiseAllowed(access, route.franchiseId)) throw new Rejection(404, 'Route or package not found.')
        const [order] = await tx.select().from(customerOrders).where(eq(customerOrders.id, pkg.orderId))
        const [stop] = order ? await tx.select().from(deliveryStops).where(and(eq(deliveryStops.routeId, routeId), eq(deliveryStops.orderId, order.id))) : []
        if (!order || !stop || order.franchiseId !== route.franchiseId || !franchiseAllowed(access, order.franchiseId)) throw new Rejection(400, 'Package is not assigned to a delivery stop on this route.')
        const [existingLoad] = await tx.select().from(dispatchLoads).where(and(eq(dispatchLoads.routeId, routeId), eq(dispatchLoads.packageId, packageId)))
        if (existingLoad) throw new Rejection(409, 'This package is already scanned onto the route.')
        const [load] = await tx.insert(dispatchLoads).values({ routeId, packageId, scannedBy: actor, status: 'Loaded' }).returning()
        await tx.update(packages).set({ status: 'Loaded' }).where(eq(packages.id, packageId))
        await tx.update(deliveryRoutes).set({ status: 'Loaded', updatedAt: new Date() }).where(eq(deliveryRoutes.id, routeId))
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: route.franchiseId, entityType: 'dispatch_load', entityId: load.id, action: 'scanned', metadata: { routeId, packageId, idempotencyKey: key } })
        return { status: 201, body: load }
      })
      return respond(done, headers)
    }

    if (action === 'proof-of-delivery') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const stopId = text(data.stopId,80)
      const [stop] = await db.select().from(deliveryStops).where(eq(deliveryStops.id, stopId))
      if (!stop) return Response.json({ error: 'Delivery stop not found.' }, { status: 404, headers })
      const [route] = await db.select().from(deliveryRoutes).where(eq(deliveryRoutes.id, stop.routeId))
      const [order] = await db.select().from(customerOrders).where(eq(customerOrders.id, stop.orderId))
      if (!route || !order || !franchiseAllowed(access, route.franchiseId) || route.franchiseId !== order.franchiseId) return Response.json({ error: 'Delivery stop not found or access denied.' }, { status: 404, headers })
      const [pod] = await db.insert(proofOfDelivery).values({ stopId, status: 'Delivered', recipientName: text(data.recipientName,180) || null, notes: text(data.notes) || null, photoUrl: text(data.photoUrl,2000) || null, signatureRef: text(data.signatureRef,500) || null }).onConflictDoUpdate({ target: proofOfDelivery.stopId, set: { status: 'Delivered', recipientName: text(data.recipientName,180) || null, notes: text(data.notes) || null, photoUrl: text(data.photoUrl,2000) || null, signatureRef: text(data.signatureRef,500) || null, deliveredAt: new Date() } }).returning()
      await db.update(deliveryStops).set({ status: 'Delivered', deliveredAt: new Date() }).where(eq(deliveryStops.id, stopId))
      await db.update(customerOrders).set({ status: 'Delivered', updatedAt: new Date() }).where(eq(customerOrders.id, stop.orderId))
      return Response.json(pod, { headers })
    }

    if (action === 'record-payment') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Payment edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80), amount = num(data.amount)
      if (amount <= 0) return Response.json({ error: 'Payment amount must be greater than zero.' }, { status: 400, headers })
      if (!uuidPattern.test(orderId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const done = await run(async tx => {
        const [order] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId))
        if (!order || !franchiseAllowed(access, order.franchiseId)) throw new Rejection(404, 'Order not found.')
        // The invoice row is the lock: concurrent payments queue here and each sees the balance left by the one before.
        const [invoice] = await tx.select().from(invoiceRecords).where(eq(invoiceRecords.orderId, orderId)).orderBy(desc(invoiceRecords.createdAt)).limit(1).for('update')
        if (!invoice) throw new Rejection(409, 'This order has no invoice to pay. Create the invoice first.')
        const paid = r2(num(invoice.paid) + amount), total = num(invoice.total)
        if (paid > total + 0.0001) throw new Rejection(409, `Payment exceeds the unpaid balance of ${r2(total - num(invoice.paid))}.`)
        const [payment] = await tx.insert(paymentRecords).values({ orderId, invoiceId: invoice.id, amount: String(r2(amount)), method: text(data.method, 50) || 'Other', reference: text(data.reference, 200) || null }).returning()
        await tx.update(invoiceRecords).set({ paid: String(paid), status: paid >= total ? 'Paid' : 'Partially Paid', updatedAt: new Date() }).where(eq(invoiceRecords.id, invoice.id))
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: order.franchiseId, entityType: 'payment', entityId: payment.id, action: 'recorded', metadata: { orderId, invoiceId: invoice.id, amount, paidAfter: paid, idempotencyKey: key } })
        return { status: 201, body: payment }
      })
      return respond(done, headers)
    }

    if (action === 'create-driver') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const franchiseId = data.franchiseId ? text(data.franchiseId, 80) : null
      if (!franchiseAllowed(access, franchiseId) || !text(data.name, 180) || !text(data.phone, 30)) return Response.json({ error: 'Driver name and phone are required.' }, { status: 400, headers })
      const [driver] = await db.insert(drivers).values({ name: text(data.name, 180), phone: text(data.phone, 30), status: text(data.status, 40) || 'Available', franchiseId }).returning()
      return Response.json(driver, { status: 201, headers })
    }

    if (action === 'create-vehicle') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const franchiseId = data.franchiseId ? text(data.franchiseId, 80) : null
      if (!franchiseAllowed(access, franchiseId) || !text(data.registrationNumber, 50) || !text(data.type, 50)) return Response.json({ error: 'Vehicle registration and type are required.' }, { status: 400, headers })
      const [vehicle] = await db.insert(vehicles).values({ registrationNumber: text(data.registrationNumber, 50).toUpperCase(), type: text(data.type, 50), status: text(data.status, 40) || 'Available', franchiseId }).returning()
      return Response.json(vehicle, { status: 201, headers })
    }

    if (action === 'create-settlement') {
      if (access.role === 'franchisee' || !allowed(access, 'orders', 'edit')) return Response.json({ error: 'Only authorized company staff can create franchise settlements.' }, { status: 403, headers })
      // Retired: settlements are derived from the supply ledger on the server (POST /api/settlements). Old rows stay readable.
      return Response.json({ error: 'Manual settlements are retired. Settlements are now derived from supply records: use /api/settlements (create-settlement with the franchise, period and any adjustments with reasons).' }, { status: 410, headers })
    }

    if (action === 'create-invoice') {
      if (!allowed(access, 'orders', 'edit')) return Response.json({ error: 'Order edit access is required.' }, { status: 403, headers })
      const orderId = text(data.orderId, 80)
      if (!uuidPattern.test(orderId)) return Response.json({ error: 'Order not found.' }, { status: 404, headers })
      const dueAt = data.dueAt ? new Date(String(data.dueAt)) : undefined
      if (dueAt && Number.isNaN(dueAt.getTime())) return Response.json({ error: 'Invoice due date is invalid.' }, { status: 400, headers })
      const done = await run(async tx => {
        const [order] = await tx.select().from(customerOrders).where(eq(customerOrders.id, orderId))
        if (!order || !franchiseAllowed(access, order.franchiseId)) throw new Rejection(404, 'Order not found.')
        const total = r2(num(data.total, num(order.total))), subtotal = r2(num(data.subtotal, num(order.subtotal, total))), tax = r2(num(data.tax)), paid = r2(num(data.paid))
        if (total < 0 || subtotal < 0 || tax < 0 || paid < 0 || paid > total) throw new Rejection(400, 'Invoice amounts must be non-negative and the paid amount cannot exceed the total.')
        const [invoice] = await tx.insert(invoiceRecords).values({ orderId, invoiceNumber: text(data.invoiceNumber, 80) || `INV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, subtotal: String(subtotal), tax: String(tax), total: String(total), paid: String(paid), status: paid >= total ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Issued', issuedAt: new Date(), dueAt }).returning()
        await tx.insert(auditEvents).values({ actorUserId: actor, franchiseId: order.franchiseId, entityType: 'invoice', entityId: invoice.id, action: 'created', metadata: { orderId, total, paid, idempotencyKey: key } })
        return { status: 201, body: invoice }
      })
      return respond(done, headers)
    }

    return Response.json({ error: 'Unknown fulfilment action.' }, { status: 400, headers })
  } catch (error) {
    return failure(error, headers, 'Fulfilment operation failed.')
  }
}

export const config: Config = { path: '/api/fulfillment' }
