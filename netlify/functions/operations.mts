import type { Config } from '@netlify/functions'
import { eq, desc, and, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises, records, settings } from '../../db/schema.js'
import { allowed, franchiseView, profile, resolveAccess, sameOrigin } from '../../db/access.js'
import { distance, franchiseKinds, segments, validRadius } from '../../src/lib/business.js'
import type { Kind, Module } from '../../src/lib/business.js'

const statuses: Record<string, string[]> = {
  deliveries: ['Planned', 'Assigned', 'Picked up', 'Out for delivery', 'Delivered', 'Failed', 'Rescheduled', 'Cancelled'],
  invoices: ['Draft', 'Issued', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
  payments: ['Received', 'Reversed'],
  settlements: ['Open', 'Partially Settled', 'Settled', 'Disputed'],
  stock_movements: ['Planned', 'Posted', 'Cancelled'],
  processing: ['Planned', 'Processing', 'Quality Check', 'Completed', 'Rejected'],
  orders: ['Pending', 'Processing', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'],
  leads: ['New lead', 'Contacted', 'Qualified', 'Customer'],
  sourcing: ['Planned', 'Ordered', 'Received'],
  inventory: ['Available', 'Low stock', 'On hold'],
  outlets: ['Active', 'Inactive'],
  supply: ['Requested', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'],
}

function validate(kind: string, data: Record<string, unknown>) {
  if (typeof data !== 'object' || Array.isArray(data)) return false
  const textFields = ['name', 'status', 'product', 'unit', 'phone', 'note', 'date', 'expiry', 'outlet', 'batch', 'segment', 'placeId', 'customerType', 'channel', 'outletType', 'vehicleNumber', 'driver', 'paymentMethod', 'paymentReference', 'sourceStock', 'processingBatch', 'invoiceNumber', 'deliveryDate', 'deliveryWindow', 'deliveryStatus', 'stockStage', 'qcStatus', 'qcRemarks', 'sourceProcessingBatch', 'orderId', 'invoiceId', 'deliveryId', 'settlementId', 'reference', 'fromStage', 'toStage', 'movementType', 'collector', 'dueDate', 'issuedDate', 'paymentDate', 'driverPhone', 'vehicleType', 'route', 'outletId', 'customerId', 'franchiseName']
  const numberFields = ['quantity', 'amount', 'paid', 'cost', 'temperature', 'latitude', 'longitude', 'inputQuantity', 'outputQuantity', 'wasteQuantity', 'yieldPct', 'balance', 'tax', 'subtotal', 'unitPrice', 'collectedAmount', 'settlementAmount', 'openingQuantity', 'closingQuantity']
  if (Object.keys(data).some(key => !textFields.includes(key) && !numberFields.includes(key))) return false
  if (textFields.some(key => data[key] !== undefined && (typeof data[key] !== 'string' || String(data[key]).length > 1000))) return false
  if (!Array.isArray(statuses[kind]) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 180) return false
  if (!statuses[kind].includes(String(data.status))) return false
  if (JSON.stringify(data).length > 12000) return false
  for (const key of ['amount', 'paid', 'quantity', 'cost']) {
    if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || Number(data[key]) < 0 || Number(data[key]) > 100000000)) return false
  }
  if (Number(data.paid || 0) > Number(data.amount || 0)) return false
  if (data.latitude !== undefined && (typeof data.latitude !== 'number' || !Number.isFinite(data.latitude) || Math.abs(data.latitude) > 90)) return false
  if (data.longitude !== undefined && (typeof data.longitude !== 'number' || !Number.isFinite(data.longitude) || Math.abs(data.longitude) > 180)) return false
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(String(data.date))) return false
  for (const key of ['deliveryDate']) if (data[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(data[key]))) return false
  if (['orders', 'sourcing', 'inventory', 'supply', 'processing', 'stock_movements'].includes(kind) && (!['Chicken', 'Mutton', 'Eggs', 'Fish', 'Prawns'].includes(String(data.product)) || (kind !== 'inventory' && kind !== 'processing' && kind !== 'stock_movements' && typeof data.quantity !== 'number') || (kind !== 'inventory' && kind !== 'processing' && kind !== 'stock_movements' && Number(data.quantity) <= 0) || (kind === 'stock_movements' && (typeof data.quantity !== 'number' || data.quantity <= 0)) || !['kg', 'trays', 'pieces'].includes(String(data.unit)))) return false
  if (['orders', 'sourcing', 'supply'].includes(kind) && (typeof data.amount !== 'number' || typeof data.paid !== 'number')) return false
  if (['invoices', 'payments', 'settlements'].includes(kind) && (typeof data.amount !== 'number' && typeof data.collectedAmount !== 'number' && typeof data.settlementAmount !== 'number')) return false
  if (kind === 'stock_movements' && (!data.fromStage || !data.toStage || !data.reference)) return false
  if (kind === 'deliveries' && !data.deliveryDate && !data.date) return false
  if (kind === 'orders' && !data.date) return false
  if ((data.latitude === undefined) !== (data.longitude === undefined)) return false
  if (data.phone && !/^\d{7,15}$/.test(String(data.phone))) return false
  if (kind === 'inventory' && (!data.batch || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.expiry)) || (data.date && String(data.expiry) < String(data.date)))) return false
  if (data.segment !== undefined && (kind !== 'leads' || !segments.includes(String(data.segment)))) return false
  if (data.placeId !== undefined && (kind !== 'leads' || !/^[A-Za-z0-9_-]{1,300}$/.test(String(data.placeId)))) return false
  if (data.temperature !== undefined && (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature))) return false
  if (kind === 'processing') {
    if (data.qcStatus && !['Pending', 'Passed', 'Failed'].includes(String(data.qcStatus))) return false
    if (typeof data.inputQuantity !== 'number' || data.inputQuantity <= 0 || typeof data.outputQuantity !== 'number' || data.outputQuantity < 0 || typeof data.wasteQuantity !== 'number' || data.wasteQuantity < 0) return false
    if (data.outputQuantity + data.wasteQuantity > data.inputQuantity + 0.000001) return false
    const calculatedYield = data.inputQuantity ? data.outputQuantity / data.inputQuantity * 100 : 0
    if (data.yieldPct !== undefined && (typeof data.yieldPct !== 'number' || data.yieldPct < 0 || data.yieldPct > 100)) return false
    data.yieldPct = Number(calculatedYield.toFixed(2))
  }
  return true
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const networkKinds: string[] = ['orders', 'leads', 'supply', 'processing', 'inventory', 'outlets', 'deliveries', 'invoices', 'payments', 'settlements', 'stock_movements']
const kindModule = (kind: string): Module => ['deliveries', 'invoices', 'payments'].includes(kind) ? 'orders' : ['settlements', 'stock_movements'].includes(kind) ? 'supply' : kind as Module

function outsideTerritory(data: Record<string, unknown>, franchise: { data: Record<string, unknown> }) {
  const center = { latitude: Number(franchise.data.latitude), longitude: Number(franchise.data.longitude) }
  if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number') return 'Franchise leads need latitude and longitude so the territory can be checked.'
  if (distance(data.latitude, data.longitude, center) > Number(franchise.data.radius)) return `This business is outside the franchise's ${franchise.data.radius} km territory.`
  return ''
}

export default async (req: Request) => {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const access = await resolveAccess(req)
    if ('error' in access) return Response.json({ error: access.error }, { status: access.status, headers })
    const own = access.role === 'franchisee' ? access.franchise : null
    if (req.method === 'GET') {
      // Only record kinds the user may view are returned.
      const visible = (rows: (typeof records.$inferSelect)[]) => rows.filter(row => Object.hasOwn(statuses, row.kind) && allowed(access, kindModule(row.kind), 'view'))
      if (own) {
        const rows = await db.select().from(records).where(eq(records.franchiseId, own.id)).orderBy(desc(records.createdAt))
        const [configuration] = await db.select().from(settings).where(eq(settings.id, 'main'))
        return Response.json({ records: visible(rows), settings: { company: configuration?.data.company, currency: configuration?.data.currency }, franchise: franchiseView(own), access: profile(access) }, { headers })
      }
      const rows = await db.select().from(records).orderBy(desc(records.createdAt))
      const [configuration] = await db.select().from(settings).where(eq(settings.id, 'main'))
      const network = await db.select().from(franchises).orderBy(franchises.createdAt)
      // Without franchise-network access, staff still get names so network records stay labelled.
      const listed = allowed(access, 'franchises', 'view') ? network.map(franchiseView) : network.map(row => ({ id: row.id, name: row.data.name, location: '', latitude: 0, longitude: 0, radius: row.data.radius, status: row.data.status, email: '' }))
      return Response.json({ records: visible(rows), settings: configuration?.data || {}, franchises: listed, access: profile(access) }, { headers })
    }
    if (!['POST', 'PATCH'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers })
    if (!sameOrigin(req)) return new Response('Forbidden', { status: 403, headers })
    const raw = await req.text()
    if (raw.length > 16000) return Response.json({ error: 'Record is too large.' }, { status: 413, headers })
    let body
    try { body = JSON.parse(raw) } catch { return Response.json({ error: 'Invalid request data.' }, { status: 400, headers }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Invalid request data.' }, { status: 400, headers })
    if (body.kind === 'settings') {
      if (access.role !== 'admin') return Response.json({ error: 'Only administrators can change business settings.' }, { status: 403, headers })
      const data = body.data
      if (!data || typeof data.company !== 'string' || !data.company.trim() || data.company.length > 100 || !/^[A-Z]{3}$/.test(data.currency) || (data.whatsapp && !/^\d{7,15}$/.test(data.whatsapp)) || !Number.isFinite(Number(data.latitude)) || Math.abs(Number(data.latitude)) > 90 || !Number.isFinite(Number(data.longitude)) || Math.abs(Number(data.longitude)) > 180 || !validRadius(Number(data.radius))) return Response.json({ error: 'Check company, currency, international WhatsApp number, coordinates, and a 1–50 km radius.' }, { status: 400, headers })
      const saved = { company: data.company, currency: data.currency, whatsapp: data.whatsapp || '', location: String(data.location || '').slice(0, 180), latitude: Number(data.latitude), longitude: Number(data.longitude), radius: Number(data.radius) }
      await db.insert(settings).values({ id: 'main', data: saved }).onConflictDoUpdate({ target: settings.id, set: { data: saved } })
      return Response.json({ ok: true }, { headers })
    }
    if (typeof body.kind !== 'string' || !Object.hasOwn(statuses, body.kind)) return Response.json({ error: 'Unknown record type.' }, { status: 400, headers })
    const requestedModule = kindModule(body.kind)
    if (own && ['settlements', 'stock_movements'].includes(body.kind)) return Response.json({ error: 'Settlement and stock movement audit records are controlled by the company.' }, { status: 403, headers })
    if (own && !franchiseKinds.includes(body.kind as Kind)) return Response.json({ error: 'Franchise accounts can manage customers, orders, supply, processing, stock, outlets, deliveries, invoices and payments.' }, { status: 403, headers })
    if (!allowed(access, requestedModule, 'edit')) return Response.json({ error: 'You have view-only or no access to these records. Ask an administrator.' }, { status: 403, headers })
    if (!body.data || !validate(body.kind, body.data)) return Response.json({ error: 'Check required fields, status, amounts, and coordinates.' }, { status: 400, headers })
    const data: Record<string, unknown> = { ...body.data }
    let existing: typeof records.$inferSelect | undefined
    if (req.method === 'PATCH') {
      if (!uuidPattern.test(body.id || '')) return Response.json({ error: 'Invalid record.' }, { status: 400, headers })
      ;[existing] = await db.select().from(records).where(and(eq(records.id, body.id), eq(records.kind, body.kind)))
      if (!existing || (own && existing.franchiseId !== own.id)) return Response.json({ error: 'Record not found.' }, { status: 404, headers })
      if (existing.data.placeId) data.placeId = existing.data.placeId
      else delete data.placeId
    }
    // Which franchise the record belongs to is decided by the server: a franchisee's own,
    // or the one an administrator/staff member selected (company-direct when empty).
    let franchise = own
    if (!own) {
      const requested = 'franchiseId' in body ? body.franchiseId : existing?.franchiseId
      if (requested && !networkKinds.includes(body.kind)) return Response.json({ error: 'This record type cannot be assigned to a franchise.' }, { status: 400, headers })
      if (requested) {
        if (typeof requested !== 'string' || !uuidPattern.test(requested)) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400, headers })
        ;[franchise] = await db.select().from(franchises).where(eq(franchises.id, requested))
        if (!franchise) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400, headers })
      }
    }
    if (body.kind === 'supply' && !franchise) return Response.json({ error: 'Choose the franchise this supply is for.' }, { status: 400, headers })
    if (body.kind === 'leads' && franchise) {
      const problem = outsideTerritory(data, franchise)
      if (problem) return Response.json({ error: problem }, { status: 400, headers })
    }
    if (body.kind === 'supply' && franchise) data.name = String(franchise.data.name)
    if (franchise && ['deliveries', 'invoices', 'payments', 'settlements', 'stock_movements'].includes(body.kind)) data.franchiseName = String(franchise.data.name)
    if (body.kind === 'supply' && own) {
      // Franchisees request supply; the company confirms price, dispatch and payments.
      if (existing && existing.data.status !== 'Requested') return Response.json({ error: 'The company has already confirmed this supply. Contact them to change it.' }, { status: 409, headers })
      if (existing && !['Requested', 'Cancelled'].includes(String(data.status))) return Response.json({ error: 'You can only cancel a supply request.' }, { status: 400, headers })
      if (!existing) data.status = 'Requested'
      data.amount = 0
      data.paid = 0
    }
    if (body.kind === 'leads' && data.placeId && !existing) {
      const [claimed] = await db.select({ id: records.id }).from(records).where(and(eq(records.kind, 'leads'), sql`${records.data}->>'placeId' = ${String(data.placeId)}`)).limit(1)
      if (claimed) return Response.json({ error: 'This business is already a lead in the network.' }, { status: 409, headers })
    }
    const franchiseId = franchise?.id ?? null
    const previous = existing?.data
    if (body.kind === 'payments' && existing && Number(data.amount || data.collectedAmount || 0) < Number(existing.data.amount || existing.data.collectedAmount || 0)) return Response.json({ error: 'Payment amounts cannot be reduced. Create a reversal record for a correction.' }, { status: 409, headers })
    let saved: typeof records.$inferSelect
    if (existing) {
      ;[saved] = await db.update(records).set({ data, franchiseId }).where(eq(records.id, existing.id)).returning()
    } else {
      ;[saved] = await db.insert(records).values({ kind: body.kind, data, franchiseId }).returning()
    }

    if (body.kind === 'processing' && data.status === 'Completed' && previous?.status !== 'Completed') {
      const movementDate = data.date || new Date().toISOString().slice(0, 10)
      if (Number(data.inputQuantity || 0) > 0) await db.insert(records).values({ kind: 'stock_movements', franchiseId, data: { name: String(data.product) + ' processing input', status: 'Posted', product: data.product, quantity: Number(data.inputQuantity), unit: data.unit, fromStage: 'Raw / incoming', toStage: 'Processing unit', movementType: 'Processing input', reference: saved.id, date: movementDate, processingBatch: data.processingBatch, sourceProcessingBatch: data.sourceStock } })
      if (Number(data.outputQuantity || 0) > 0) await db.insert(records).values({ kind: 'stock_movements', franchiseId, data: { name: String(data.product) + ' processing output', status: 'Posted', product: data.product, quantity: Number(data.outputQuantity), unit: data.unit, fromStage: 'Processing unit', toStage: 'Finished stock', movementType: 'Processing output', reference: saved.id, date: movementDate, processingBatch: data.processingBatch, sourceProcessingBatch: data.processingBatch } })
      if (Number(data.wasteQuantity || 0) > 0) await db.insert(records).values({ kind: 'stock_movements', franchiseId, data: { name: String(data.product) + ' processing waste', status: 'Posted', product: data.product, quantity: Number(data.wasteQuantity), unit: data.unit, fromStage: 'Processing unit', toStage: 'Waste / by-product', movementType: 'Processing waste', reference: saved.id, date: movementDate, processingBatch: data.processingBatch } })
    }

    if (body.kind === 'orders') {
      const invoiceNumber = String(data.invoiceNumber || previous?.invoiceNumber || 'INV-' + new Date().getFullYear() + '-' + saved.id.slice(0, 8).toUpperCase())
      const amount = Number(data.amount || 0)
      const paid = Number(data.paid || 0)
      const invoiceStatus = amount <= 0 ? 'Draft' : paid >= amount ? 'Paid' : paid > 0 ? 'Partially Paid' : 'Issued'
      const invoiceData = { name: String(data.name), status: invoiceStatus, amount, subtotal: Number(data.amount || 0), paid, balance: Math.max(0, amount - paid), invoiceNumber, orderId: saved.id, product: data.product, quantity: data.quantity, unit: data.unit, date: data.date, dueDate: data.date }
      const existingInvoices = await db.select().from(records).where(and(eq(records.kind, 'invoices'), sql\`\${records.data}->>'orderId' = \${saved.id}\`))
      if (existingInvoices.length) await db.update(records).set({ data: invoiceData, franchiseId }).where(eq(records.id, existingInvoices[0].id))
      else await db.insert(records).values({ kind: 'invoices', franchiseId, data: invoiceData })
      const previousPaid = Number(previous?.paid || 0)
      if (paid > previousPaid) await db.insert(records).values({ kind: 'payments', franchiseId, data: { name: String(data.name), status: 'Received', amount: paid - previousPaid, paymentMethod: data.paymentMethod || 'Unspecified', paymentReference: data.paymentReference, orderId: saved.id, invoiceNumber, paymentDate: data.date || new Date().toISOString().slice(0, 10) } })
      const deliveryStatus = data.deliveryStatus || (data.status === 'Ready' ? 'Planned' : data.status === 'Out for delivery' ? 'Out for delivery' : data.status === 'Delivered' ? 'Delivered' : undefined)
      if (deliveryStatus) {
        const deliveryData = { name: String(data.name), status: String(deliveryStatus), orderId: saved.id, product: data.product, quantity: data.quantity, unit: data.unit, deliveryDate: data.deliveryDate || data.date, deliveryWindow: data.deliveryWindow, driver: data.driver, driverPhone: data.phone, vehicleNumber: data.vehicleNumber, outlet: data.outlet, route: data.note }
        const existingDeliveries = await db.select().from(records).where(and(eq(records.kind, 'deliveries'), sql\`\${records.data}->>'orderId' = \${saved.id}\`))
        if (existingDeliveries.length) await db.update(records).set({ data: deliveryData, franchiseId }).where(eq(records.id, existingDeliveries[0].id))
        else await db.insert(records).values({ kind: 'deliveries', franchiseId, data: deliveryData })
      }
      if (previous?.status !== 'Delivered' && data.status === 'Delivered' && Number(data.quantity || 0) > 0) {
        await db.insert(records).values({ kind: 'stock_movements', franchiseId, data: { name: String(data.product) + ' customer delivery', status: 'Posted', product: data.product, quantity: Number(data.quantity), unit: data.unit, fromStage: 'Finished stock', toStage: data.channel === 'Mobile outlet' ? 'Mobile outlet / customer' : 'Customer', movementType: 'Order fulfilment', reference: saved.id, date: data.deliveryDate || data.date || new Date().toISOString().slice(0, 10) } })
      }
    }
    return Response.json(saved, { status: existing ? 200 : 201, headers })
  } catch {
    return Response.json({ error: 'The service is unavailable. Please try again. Your changes have not been saved.' }, { status: 503, headers })
  }
}

export const config: Config = { path: '/api/operations' }
