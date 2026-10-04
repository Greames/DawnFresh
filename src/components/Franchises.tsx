import { useState } from 'react'
import { ArrowUpRight, Check, KeyRound, MapPin, MoreHorizontal, Plus, Store } from 'lucide-react'
import { FRANCHISE_RADIUS_KM, distance, franchiseStatuses, money, radiusOptions } from '../lib/business'
import type { BusinessRecord, Franchise, FranchiseLogins } from '../lib/business'

export function franchiseSummary(rows: BusinessRecord[]) {
  const leads = rows.filter(row => row.kind === 'leads')
  const customers = leads.filter(row => row.data.status === 'Customer')
  const orders = rows.filter(row => row.kind === 'orders' && row.data.status !== 'Cancelled')
  const supply = rows.filter(row => row.kind === 'supply' && row.data.status !== 'Cancelled')
  return {
    leads: leads.length,
    customers: customers.length,
    acquired: customers.reduce((sum, row) => sum + (row.data.amount || 0), 0),
    pipeline: leads.filter(row => row.data.status !== 'Customer').reduce((sum, row) => sum + (row.data.amount || 0), 0),
    orderValue: orders.reduce((sum, row) => sum + (row.data.amount || 0), 0),
    customerDue: orders.reduce((sum, row) => sum + Math.max(0, (row.data.amount || 0) - (row.data.paid || 0)), 0),
    toDeliver: orders.filter(row => row.data.status !== 'Delivered').length,
    supplyDue: supply.reduce((sum, row) => sum + Math.max(0, (row.data.amount || 0) - (row.data.paid || 0)), 0),
    supplyIncoming: supply.filter(row => ['Requested', 'Confirmed', 'Dispatched'].includes(row.data.status)).length,
  }
}

function loginText(login: FranchiseLogins | undefined, logins: Record<string, FranchiseLogins> | null) {
  if (!logins) return 'Contact email · logins are managed in Users & access'
  if (!login?.users) return 'No franchisee login yet · add one in Users & access'
  const users = `${login.active} of ${login.users} login${login.users === 1 ? '' : 's'} active`
  return login.lastSignInAt ? `${users} · last active ${login.lastSignInAt.slice(0, 10)}` : `${users} · not signed in yet`
}

export function FranchiseNetwork({ franchises, logins, rows, currency, isAdmin, add, edit, view }: { franchises: Franchise[]; logins: Record<string, FranchiseLogins> | null; rows: BusinessRecord[]; currency: string; isAdmin: boolean; add: () => void; edit: (franchise: Franchise) => void; view: (id: string) => void }) {
  const network = franchiseSummary(rows.filter(row => row.franchiseId))
  return <>
    <div className="summary-strip"><div><span>Franchises</span><strong>{franchises.filter(franchise => franchise.status === 'Active').length} active</strong></div><div><span>Customers acquired by franchises</span><strong>{network.customers}</strong></div><div><span>Supply due from franchises</span><strong>{money(network.supplyDue, currency)}</strong></div></div>
    {franchises.length ? <div className="franchise-grid">{franchises.map(franchise => {
      const summary = franchiseSummary(rows.filter(row => row.franchiseId === franchise.id))
      const overlaps = franchises.filter(other => other.id !== franchise.id && distance(other.latitude, other.longitude, franchise) < franchise.radius + other.radius)
      return <article className="panel franchise-card" key={franchise.id}>
        <div className="franchise-card-top"><span className="nearby-icon"><Store size={18} /></span><div><h3>{franchise.name}</h3><small><MapPin size={12} /> {franchise.location} · {franchise.radius} km</small></div><span className={`badge ${franchise.status === 'Active' ? 'green' : 'neutral'}`}><span />{franchise.status}</span></div>
        <p className="franchise-login"><KeyRound size={13} /><span><strong>{franchise.email}</strong>{loginText(logins?.[franchise.id], logins)}</span></p>
        <dl className="franchise-stats">
          <div><dt>Customers acquired</dt><dd>{summary.customers}<small> of {summary.leads} leads</small></dd></div>
          <div><dt>Est. monthly business won</dt><dd>{money(summary.acquired, currency)}</dd></div>
          <div><dt>Open pipeline</dt><dd>{money(summary.pipeline, currency)}</dd></div>
          <div><dt>Orders to deliver</dt><dd>{summary.toDeliver}</dd></div>
          <div><dt>Customer payments due</dt><dd className={summary.customerDue ? 'text-amber' : ''}>{money(summary.customerDue, currency)}</dd></div>
          <div><dt>Owes company for supply</dt><dd className={summary.supplyDue ? 'text-amber' : ''}>{money(summary.supplyDue, currency)}</dd></div>
        </dl>
        {overlaps.length > 0 && <p className="fine-print text-amber">Territory overlaps {overlaps.map(other => other.name).join(', ')}. Each business can be saved as a lead by only one franchise.</p>}
        <div className="franchise-actions"><button className="outline" onClick={() => view(franchise.id)}>Open dashboard <ArrowUpRight size={15} /></button>{isAdmin && <button className="icon-button" aria-label={`Edit ${franchise.name}`} onClick={() => edit(franchise)}><MoreHorizontal size={19} /></button>}</div>
      </article>
    })}</div> : <section className="panel"><div className="empty-state"><Store size={30} /><h3>No franchises yet</h3><p>Add a franchise location and its working radius (up to 50 km), then give its owner a login in Users & access.</p>{isAdmin && <button className="outline" onClick={add}><Plus size={16} /> Add franchise</button>}</div></section>}
    <div className="info-note"><Store size={18} /><span>Franchisees sign in with the <strong>franchisee</strong> role and only see their own leads, customer orders and supply requests. The company supplies every franchise: price, confirm and record payments in Franchise supply.</span></div>
  </>
}

export function FranchiseForm({ franchise, busy, error, save }: { franchise?: Franchise; busy: boolean; error: string; save: (values: { email: string; data: Omit<Franchise, 'id' | 'email'> }) => void }) {
  const currentRadius = franchise?.radius ?? FRANCHISE_RADIUS_KM
  const options = radiusOptions.includes(currentRadius) ? radiusOptions : [...radiusOptions, currentRadius].sort((a, b) => a - b)
  const [validation, setValidation] = useState('')
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const text = (key: string) => String(values.get(key) || '').trim()
    setValidation('')
    save({ email: franchise?.email || text('email'), data: { name: text('name'), location: text('location'), latitude: Number(text('latitude')), longitude: Number(text('longitude')), radius: Number(text('radius')), status: text('status'), phone: text('phone') || undefined, note: text('note') || undefined } })
  }
  return <form onSubmit={submit} className="record-form">
    <label>Franchise name<input name="name" required maxLength={120} defaultValue={franchise?.name} placeholder="e.g. North City franchise" /></label>
    <div className="form-grid"><label>Contact email<input name="email" type="email" required disabled={!!franchise} defaultValue={franchise?.email} autoComplete="off" /></label><label>Status<select name="status" defaultValue={franchise?.status || 'Active'}>{franchiseStatuses.map(status => <option key={status}>{status}</option>)}</select></label></div>
    <label>Allocated location<input name="location" required maxLength={180} defaultValue={franchise?.location} placeholder="Area, market or outlet address" /></label>
    <div className="form-grid"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required defaultValue={franchise?.latitude} /></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required defaultValue={franchise?.longitude} /></label></div>
    <label>Working radius<select name="radius" defaultValue={currentRadius}>{options.map(km => <option key={km} value={km}>{km} km</option>)}</select><small>The franchisee only sees and can add restaurants, caterers and hotels within this straight-line distance of the location above.</small></label>
    <label>Franchisee phone (international digits)<input name="phone" type="tel" pattern="[0-9]{7,15}" defaultValue={franchise?.phone} /></label>
    <label>Notes<textarea name="note" rows={2} maxLength={1000} defaultValue={franchise?.note} /></label>
    {(error || validation) && <p className="form-error" role="alert">{error || validation}</p>}
    <button className="primary full" disabled={busy}>{busy ? 'Saving…' : franchise ? 'Save franchise' : 'Create franchise'}<Check size={16} /></button>
  </form>
}
