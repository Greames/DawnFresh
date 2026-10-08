import { test, expect, request } from '@playwright/test'
import fs from 'node:fs'

const baseURL = process.env.FRESHROUTE_BASE_URL || 'https://coruscating-concha-76e38b.netlify.app'
const franchiseState = process.env.FRESHROUTE_FRANCHISE_STATE || 'e2e/.auth/franchisee.json'
const companyState = process.env.FRESHROUTE_COMPANY_STATE || 'e2e/.auth/company.json'

test.describe.configure({ mode: 'serial' })

function requireState(path: string) {
  test.skip(!fs.existsSync(path), `Missing auth state: ${path}. Create it locally after logging into the live app.`)
}

async function api(baseURL: string, statePath: string) {
  requireState(statePath)
  return request.newContext({ baseURL, storageState: statePath, extraHTTPHeaders: { 'Accept': 'application/json' } })
}

test('franchise procurement traceability: request → PO → GRN → stock → delivered', async () => {
  requireState(franchiseState)
  requireState(companyState)

  const franchise = await api(baseURL, franchiseState)
  const company = await api(baseURL, companyState)

  const franchiseOps = await franchise.get('/api/operations')
  expect(franchiseOps.ok()).toBeTruthy()
  const franchisePayload = await franchiseOps.json()
  const franchiseId = franchisePayload.franchise?.id
  expect(franchiseId).toBeTruthy()

  const product = 'Chicken'
  const unit = 'kg'
  const quantity = 1
  const marker = `E2E-${Date.now()}`

  const requestResponse = await franchise.post('/api/operations', {
    data: {
      kind: 'supply',
      data: {
        name: String(franchisePayload.franchise.name || marker),
        status: 'Requested',
        product,
        quantity,
        unit,
        amount: 0,
        paid: 0,
        date: new Date().toISOString().slice(0, 10)
      }
    }
  })
  expect(requestResponse.ok()).toBeTruthy()
  const supplyRequest = await requestResponse.json()
  expect(supplyRequest.kind).toBe('supply')
  expect(supplyRequest.franchiseId).toBe(franchiseId)
  expect(supplyRequest.data.status).toBe('Requested')
  expect(supplyRequest.data.product).toBe(product)

  const supplierList = await company.get('/api/procurement')
  expect(supplierList.ok()).toBeTruthy()
  const procurement = await supplierList.json()
  let supplier = procurement.suppliers?.[0]

  if (!supplier) {
    const supplierResponse = await company.post('/api/procurement', {
      data: { action: 'create-supplier', data: { name: `${marker} Supplier`, status: 'Active' } }
    })
    expect(supplierResponse.ok()).toBeTruthy()
    supplier = await supplierResponse.json()
  }

  const poResponse = await company.post('/api/procurement', {
    data: {
      action: 'create-po',
      data: {
        supplierId: supplier.id,
        product,
        quantity,
        unit,
        unitPrice: 100,
        supplyRequestId: supplyRequest.id
      }
    }
  })
  expect(poResponse.ok()).toBeTruthy()
  const po = await poResponse.json()
  expect(po.supplyRequestId).toBe(supplyRequest.id)

  const requestAfterPO = await franchise.get('/api/operations')
  const requestAfterPOPayload = await requestAfterPO.json()
  const linkedRequest = requestAfterPOPayload.records.find((r: any) => r.id === supplyRequest.id)
  expect(linkedRequest.data.status).toBe('Confirmed')
  expect(linkedRequest.data.purchaseOrderId).toBe(po.id)

  const grnResponse = await company.post('/api/procurement', {
    data: {
      action: 'receive-po',
      data: {
        purchaseOrderId: po.id,
        receivedQuantity: quantity,
        acceptedQuantity: quantity,
        rejectedQuantity: 0,
        qcStatus: 'Passed',
        batchCode: marker
      }
    }
  })
  expect(grnResponse.ok()).toBeTruthy()
  const grnResult = await grnResponse.json()
  expect(grnResult.receipt.purchaseOrderId).toBe(po.id)
  expect(grnResult.receipt.stockLotId).toBeTruthy()
  expect(grnResult.stockLot.id).toBe(grnResult.receipt.stockLotId)

  const fulfilResponse = await company.post('/api/procurement', {
    data: {
      action: 'transfer-to-franchise',
      data: {
        franchiseId,
        product,
        quantity,
        supplyRequestId: supplyRequest.id,
        purchaseOrderId: po.id,
        goodsReceiptId: grnResult.receipt.id
      }
    }
  })
  expect(fulfilResponse.ok()).toBeTruthy()
  const fulfilment = await fulfilResponse.json()
  expect(fulfilment.rows.length).toBeGreaterThan(0)
  for (const row of fulfilment.rows) {
    expect(row.franchiseId).toBe(franchiseId)
    expect(row.product).toBe(product)
    expect(row.supplyRequestId).toBe(supplyRequest.id)
    expect(row.purchaseOrderId).toBe(po.id)
    expect(row.goodsReceiptId).toBe(grnResult.receipt.id)
    expect(row.stockLotId).toBe(grnResult.receipt.stockLotId)
  }

  const finalRequest = await franchise.get('/api/operations')
  const finalPayload = await finalRequest.json()
  const delivered = finalPayload.records.find((r: any) => r.id === supplyRequest.id)
  expect(delivered.data.status).toBe('Delivered')
  expect(delivered.data.purchaseOrderId).toBe(po.id)
  expect(delivered.data.goodsReceiptId).toBe(grnResult.receipt.id)
  expect(Number(delivered.data.deliveredQuantity)).toBe(quantity)

  const finalProcurement = await company.get('/api/procurement')
  const finalProcurementPayload = await finalProcurement.json()
  const ledgerRows = finalProcurementPayload.franchiseStock.filter((r: any) => r.supplyRequestId === supplyRequest.id)
  expect(ledgerRows.length).toBeGreaterThan(0)
  expect(ledgerRows.every((r: any) =>
    r.purchaseOrderId === po.id &&
    r.goodsReceiptId === grnResult.receipt.id &&
    r.stockLotId === grnResult.receipt.stockLotId
  )).toBeTruthy()

  await franchise.dispose()
  await company.dispose()
})
