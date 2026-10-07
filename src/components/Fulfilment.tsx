import { useEffect, useState } from 'react'
import { Check, Package, Truck, ClipboardCheck, RefreshCw, Plus } from 'lucide-react'

type Row = Record<string, any>
async function api(action?: string, data?: unknown) {
  const response = await fetch('/api/fulfillment', action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) } : undefined)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || 'Fulfilment request failed.')
  return body
}
export function FulfilmentWorkspace() {
  const [data, setData] = useState<{production: Row[]; batches: Row[]; lots: Row[]; packages: Row[]; routes: Row[]; stops: Row[]; loads: Row[]; invoices: Row[]}>({ production: [], batches: [], lots: [], packages: [], routes: [], stops: [], loads: [], invoices: [] })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function load() { try { setData(await api()) } catch (e) { setMessage((e as Error).message) } }
  useEffect(() => { load() }, [])
  async function run(action: string, payload: Record<string, unknown>) { setBusy(true); setMessage(''); try { await api(action, payload); await load(); setMessage('Saved successfully.') } catch (e) { setMessage((e as Error).message) } finally { setBusy(false) } }
  const production = data.production.filter(row => row.status !== 'Completed' && row.status !== 'Rejected')
  const qc = data.batches.filter(row => row.qcStatus !== 'Passed')
  const ready = data.packages.filter(row => ['Packed', 'Loaded'].includes(row.status))
  const activeRoutes = data.routes.filter(row => row.status !== 'Completed' && row.status !== 'Cancelled')
  return <div className="section-content">
    <div className="section-heading"><div><span className="eyebrow">END-TO-END FULFILMENT</span><h1>Production to delivery</h1><p>One operational queue for production, QC, packing, dispatch and proof of delivery.</p></div><button className="outline" onClick={load} disabled={busy}><RefreshCw size={15} /> Refresh</button></div>
    {message && <div className="info-note"><Check size={17} /> {message}</div>}
    <div className="summary-strip"><div><span>Production queue</span><strong>{production.length}</strong></div><div><span>QC attention</span><strong>{qc.length}</strong></div><div><span>Packages ready / loaded</span><strong>{ready.length}</strong></div><div><span>Active routes</span><strong>{activeRoutes.length}</strong></div></div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Production queue</h2><p>Orders become explicit production work.</p></div><ClipboardCheck size={19} /></div>
        {!production.length ? <p className="muted">No production work is waiting.</p> : <div className="nearby-list">{production.slice(0, 10).map(row => <article key={row.id}><Package size={19} /><div><strong>{row.product} · {row.requestedQuantity} {row.unit}</strong><small>{row.status} · {row.orderId?.slice(0, 8)}</small></div><button className="text-button" disabled={busy} onClick={() => run('process-batch', { productionOrderId: row.id, inputQuantity: Number(row.requestedQuantity), outputQuantity: Number(row.requestedQuantity), wasteQuantity: 0, qcStatus: 'Passed', batchCode: 'FR-' + Date.now() })}>Complete QC <Check size={14} /></button></article>)}</div>}
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Finished stock</h2><p>Saleable lots created from passed batches.</p></div><Package size={19} /></div>
        {!data.lots.length ? <p className="muted">No finished-stock lots yet.</p> : <div className="nearby-list">{data.lots.slice(0, 10).map(row => <article key={row.id}><Package size={19} /><div><strong>{row.product} · {row.quantity} {row.unit}</strong><small>{row.batchCode} · {row.status}</small></div><span className="badge green"><span />{row.stage}</span></article>)}</div>}
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Packages & labels</h2><p>Packages get stable scan codes before dispatch.</p></div><Package size={19} /></div>
        {!data.packages.length ? <p className="muted">No packages yet. Packages can be created from an order through the fulfilment API.</p> : <div className="nearby-list">{data.packages.slice(0, 10).map(row => <article key={row.id}><Package size={19} /><div><strong>{row.packageCode}</strong><small>{row.product} · {row.quantity} {row.unit}</small></div><span className="badge blue"><span />{row.status}</span></article>)}</div>}
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Dispatch & routes</h2><p>Route, load and delivery status stay connected.</p></div><Truck size={19} /></div>
        {!activeRoutes.length ? <p className="muted">No active delivery routes.</p> : <div className="nearby-list">{activeRoutes.slice(0, 10).map(row => <article key={row.id}><Truck size={19} /><div><strong>{row.routeCode}</strong><small>{new Date(row.routeDate).toLocaleDateString()} · {row.status}</small></div><span className="badge blue"><span />{data.stops.filter(stop => stop.routeId === row.id).length} stops</span></article>)}</div>}
      </section>
    </div>
    <section className="panel"><div className="panel-heading"><div><h2>Delivery control</h2><p>Every stop can be loaded, delivered or marked as an exception with proof.</p></div><Truck size={19} /></div>
      {!data.stops.length ? <div className="empty-state"><Truck size={28} /><h3>No delivery stops yet</h3><p>Create a route and add orders to it. The route/stops API is ready for driver and map integrations.</p></div> : <div className="table-scroll"><table><thead><tr><th>ORDER</th><th>SEQUENCE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>{data.stops.slice(0, 20).map(row => <tr key={row.id}><td>{row.orderId?.slice(0, 8)}</td><td>{row.sequence}</td><td><span className="badge"><span />{row.status}</span></td><td>{row.status !== 'Delivered' && <button className="text-button" disabled={busy} onClick={() => run('proof-of-delivery', { stopId: row.id, recipientName: 'Confirmed recipient' })}>Mark delivered <Check size={14} /></button>}</td></tr>)}</tbody></table></div>}
    </section>
    <div className="info-note"><Plus size={17} /> The fulfilment API now supports production creation, processing/QC, finished-stock lots, package/label creation, routes/stops, loading scans, proof of delivery, invoices and payments. Hardware scanners, scales, thermal printers, WhatsApp and map routing remain integration adapters rather than separate data stores.</div>
  </div>
}
