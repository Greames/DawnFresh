import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Bell, BookOpen, Boxes, Eye, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Download, ExternalLink, LayoutDashboard, Leaf, MapPin, Menu, MessageCircle, MoreHorizontal, Package, Plus, Search, Settings as SettingsIcon, ShieldCheck, ShoppingBag, ShoppingCart, Sprout, Store, Target, Truck, Users, Wallet, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { can, radiusOptions, dateOffset, defaultSettings, demoFranchises, demoRecords, demoUsers, discoveryCategories, distance, franchiseKinds, money, products, resolvePermissions, segments, statusOptions } from '../lib/business'
import type { AccessProfile, AppUser, BusinessData, BusinessRecord, Franchise, FranchiseLogins, Kind, Module, Settings } from '../lib/business'
import { FranchiseForm, FranchiseNetwork, franchiseSummary } from './Franchises'
import { UserForm, UsersAccess } from './Users'
import type { UserFormValues } from './Users'

type Section = 'overview' | Kind | 'territory' | 'deliveries' | 'settings' | 'playbook' | 'franchises' | 'users'
const sectionModule: Partial<Record<Section, Module>> = { orders: 'orders', deliveries: 'orders', leads: 'leads', territory: 'leads', inventory: 'inventory', sourcing: 'sourcing', outlets: 'outlets', supply: 'supply', franchises: 'franchises' }
type NavItem = { id: Section; label: string; icon: LucideIcon; group?: string }
const companyNavigation: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'WORKSPACE' },
  { id: 'orders', label: 'Orders & sales', icon: ShoppingBag },
  { id: 'leads', label: 'Customers & leads', icon: Users },
  { id: 'inventory', label: 'Inventory', icon: Package, group: 'OPERATIONS' },
  { id: 'sourcing', label: 'Sourcing', icon: Sprout },
  { id: 'deliveries', label: 'Deliveries', icon: Truck },
  { id: 'outlets', label: 'Outlets', icon: ShoppingCart },
  { id: 'franchises', label: 'Franchise network', icon: Store, group: 'NETWORK' },
  { id: 'supply', label: 'Franchise supply', icon: Boxes },
  { id: 'territory', label: 'Territory explorer', icon: MapPin, group: 'GROWTH' },
  { id: 'playbook', label: 'Business playbook', icon: BookOpen },
]
const franchiseNavigation: NavItem[] = [
  { id: 'overview', label: 'My franchise', icon: LayoutDashboard, group: 'WORKSPACE' },
  { id: 'orders', label: 'Customer orders', icon: ShoppingBag },
  { id: 'leads', label: 'Customers & leads', icon: Users },
  { id: 'deliveries', label: 'Deliveries', icon: Truck },
  { id: 'supply', label: 'Stock from company', icon: Boxes, group: 'SUPPLY' },
  { id: 'territory', label: 'My territory', icon: MapPin, group: 'GROWTH' },
  { id: 'playbook', label: 'Business playbook', icon: BookOpen },
]
type Place = { id: string; displayName: { text: string }; formattedAddress: string; internationalPhoneNumber?: string; googleMapsUri?: string; location: { latitude: number; longitude: number }; segment?: string; distanceKm?: number; saved?: 'here' | 'elsewhere' }

async function request(path: string, body?: unknown, method = 'POST') {
  let response: Response
  try { response = await fetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined) }
  catch { throw new Error('Could not reach the server. Check your internet connection and try again.') }
  const text = await response.text()
  let data
  try { data = text ? JSON.parse(text) : {} }
  catch {
    // A web page instead of data: usually Netlify's own login page (team login protection) or a platform error/timeout.
    if (/netlify/i.test(text) && /log ?in|sign ?in|password/i.test(text)) throw new Error('Netlify asked for its own login instead of letting the app answer. In Netlify, turn off team login protection for the live site (Project configuration → Access & security → Visitor access), then reload this page.')
    throw new Error(`The server didn’t answer properly (error ${response.status}). Please wait a moment and try again.`)
  }
  if (!response.ok) throw new Error(data.error || 'This action could not be completed.')
  return data
}

function Badge({ status }: { status: string }) {
  const tone = ['Delivered', 'Customer', 'Available', 'Received', 'Active'].includes(status) ? 'green' : ['Processing', 'Contacted', 'Ordered', 'Out for delivery', 'Confirmed', 'Dispatched'].includes(status) ? 'blue' : ['Cancelled', 'On hold', 'Inactive'].includes(status) ? 'neutral' : 'amber'
  return <span className={`badge ${tone}`}><span />{status}</span>
}

function Modal({ children, title, close }: { children: ReactNode; title: string; close: () => void }) {
  const dialog = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    (dialog.current?.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), select, textarea') ?? dialog.current?.querySelector<HTMLElement>('button'))?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
      if (event.key !== 'Tab') return
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]')
      if (!elements?.length) return
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); previous?.focus() }
  }, [close])
  return <div className="modal-backdrop" onClick={close}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event => event.stopPropagation()}><button className="modal-close icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button><span className="eyebrow">FRESHROUTE WORKSPACE</span><h2 id="modal-title">{title}</h2>{children}</section></div>
}

function RecordForm({ kind, record, outlets, franchises, franchiseMode, defaultFranchise, save, busy, error }: { kind: Kind; record?: BusinessRecord; outlets: string[]; franchises: Franchise[]; franchiseMode: boolean; defaultFranchise?: string; save: (data: BusinessData, franchiseId: string | null) => void; busy: boolean; error: string }) {
  const data = record?.data
  const assignable = !franchiseMode && franchiseKinds.includes(kind)
  const requestOnly = franchiseMode && kind === 'supply'
  const locked = requestOnly && !!record?.id && data?.status !== 'Requested'
  const [validation, setValidation] = useState('')
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const result: Record<string, unknown> = {}
    values.forEach((value, key) => {
      if (String(value).trim()) result[key] = ['quantity', 'amount', 'paid', 'temperature', 'latitude', 'longitude'].includes(key) ? Number(value) : String(value).trim()
    })
    const franchiseId = typeof result.franchiseId === 'string' ? result.franchiseId : null
    delete result.franchiseId
    if (requestOnly) { result.amount = 0; result.paid = 0 }
    if (['orders', 'sourcing', 'supply'].includes(kind)) result.paid = Number(result.paid || 0)
    if (kind === 'supply' && assignable && !franchiseId) { setValidation('Choose the franchise this supply is for.'); return }
    if (Number(result.paid || 0) > Number(result.amount || 0)) { setValidation('Amount paid cannot exceed the total value.'); return }
    if (result.expiry && result.date && String(result.expiry) < String(result.date)) { setValidation('Expiry date cannot be before the received date.'); return }
    if ((result.latitude === undefined) !== (result.longitude === undefined)) { setValidation('Enter both latitude and longitude, or leave both empty.'); return }
    setValidation('')
    save(result as BusinessData, franchiseId)
  }
  if (locked) return <div className="record-form"><p className="muted">{data?.status === 'Cancelled' ? 'This stock request was cancelled. Create a new request if you still need stock.' : `The company has marked this supply ${data?.status.toLowerCase()}. Contact the company to change it.`}</p></div>
  const statuses = requestOnly ? ['Requested', 'Cancelled'] : statusOptions[kind]
  return <form onSubmit={submit} className="record-form">{kind === 'supply' ? <input type="hidden" name="name" value={data?.name || 'Franchise supply'} /> : <label>{kind === 'orders' ? 'Customer / business' : kind === 'sourcing' ? 'Farmer / supplier' : kind === 'inventory' ? 'Stock lot name' : kind === 'outlets' ? 'Outlet name' : 'Restaurant / business'}<input name="name" required maxLength={180} defaultValue={data?.name} placeholder="Enter name" /></label>}{assignable && <label>{kind === 'supply' ? 'Supply to franchise' : 'Franchise'}<select name="franchiseId" defaultValue={record ? record.franchiseId || '' : defaultFranchise || ''} required={kind === 'supply'}><option value="">{kind === 'supply' ? 'Choose a franchise' : 'Company direct (no franchise)'}</option>{franchises.map(franchise => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select></label>}{data?.placeId && <input type="hidden" name="placeId" value={data.placeId} />}<div className="form-grid"><label>Status<select name="status" defaultValue={data?.status || statuses[0]}>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>{kind !== 'outlets' && <label>{kind === 'leads' ? 'Follow-up date' : kind === 'inventory' ? 'Received date' : kind === 'supply' ? 'Needed by' : 'Order / expected date'}<input name="date" type="date" required={kind === 'orders'} defaultValue={data?.date || dateOffset(0)} /></label>}</div>
    {kind === 'leads' && <label>Business type<select name="segment" defaultValue={data?.segment || 'Restaurant'}>{segments.map(segment => <option key={segment}>{segment}</option>)}</select></label>}
    {['orders', 'inventory', 'sourcing', 'supply'].includes(kind) && <><div className="form-grid"><label>Product<select name="product" defaultValue={data?.product}>{products.map(product => <option key={product.name}>{product.name}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min={kind === 'inventory' ? 0 : 0.01} step="0.01" required defaultValue={data?.quantity} /></label></div><div className="form-grid"><label>Unit<select name="unit" defaultValue={data?.unit || 'kg'}><option>kg</option><option>trays</option><option>pieces</option></select></label>{!franchiseMode && kind !== 'supply' && <label>Outlet<select name="outlet" defaultValue={data?.outlet}><option value="">Unassigned</option>{outlets.map(outlet => <option key={outlet}>{outlet}</option>)}</select></label>}</div></>}
    {requestOnly && <p className="muted fine-print">The company confirms the price, dispatch and payment for supply requests.</p>}
    {['orders', 'sourcing', 'leads', 'supply'].includes(kind) && !requestOnly && <div className="form-grid"><label>{kind === 'leads' ? 'Estimated monthly business' : 'Total value'}<input name="amount" type="number" min="0" max="100000000" step="0.01" required={kind !== 'leads'} defaultValue={data?.amount} /></label>{kind !== 'leads' && <label>Amount paid<input name="paid" type="number" min="0" max="100000000" step="0.01" defaultValue={data?.paid || 0} /></label>}</div>}
    {kind === 'inventory' && <><div className="form-grid"><label>Batch reference<input name="batch" required defaultValue={data?.batch} /></label><label>Expiry date<input name="expiry" type="date" required defaultValue={data?.expiry} /></label></div><label>Recorded temperature (°C)<input name="temperature" type="number" step="0.1" defaultValue={data?.temperature} /></label><p className="muted fine-print">Record actual available stock. Orders and sourcing do not automatically change lot quantities.</p></>}
    {kind === 'leads' && <div className="form-grid"><label>Latitude<input name="latitude" type="number" min="-90" max="90" step="any" required={franchiseMode} defaultValue={data?.latitude} /></label><label>Longitude<input name="longitude" type="number" min="-180" max="180" step="any" required={franchiseMode} defaultValue={data?.longitude} /></label></div>}
    {kind === 'leads' && (franchiseMode || assignable) && <p className="muted fine-print">Franchise leads need coordinates within the franchise territory.</p>}
    {!['inventory', 'supply'].includes(kind) && <label>Phone (international digits)<input name="phone" type="tel" pattern="[0-9]{7,15}" placeholder="Country code + number, no + or spaces" defaultValue={data?.phone} /></label>}
    <label>{kind === 'outlets' ? 'Address, route & operating notes' : 'Notes / delivery requirements'}<textarea name="note" rows={2} maxLength={1000} defaultValue={data?.note} /></label>{(error || validation) && <p className="form-error" role="alert">{error || validation}</p>}<button className="primary full" disabled={busy}>{busy ? 'Saving…' : record?.id ? 'Save changes' : 'Create record'}<Check size={16} /></button></form>
}

export function Operations() {
  const [section, setSection] = useState<Section>('overview')
  const [allRows, setRows] = useState<BusinessRecord[]>(demoRecords)
  const [franchises, setFranchises] = useState<Franchise[]>(demoFranchises)
  const [ownFranchise, setOwnFranchise] = useState<Franchise | null>(null)
  const [logins, setLogins] = useState<Record<string, FranchiseLogins> | null>(null)
  const [access, setAccess] = useState<AccessProfile | null>(null)
  const [users, setUsers] = useState<AppUser[]>(demoUsers)
  const [userModal, setUserModal] = useState<{ user?: AppUser } | null>(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [setupCodeRequired, setSetupCodeRequired] = useState(false)
  const [scope, setScope] = useState('all')
  const [franchiseModal, setFranchiseModal] = useState<{ franchise?: Franchise } | null>(null)
  const [category, setCategory] = useState<string>(discoveryCategories[0].id)
  const [rank, setRank] = useState<'distance' | 'popularity'>('distance')
  const [discoveryState, setDiscoveryState] = useState<'idle' | 'loading' | 'done' | 'unavailable'>('idle')
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('week')
  const [status, setStatus] = useState('All statuses')
  const [sidebar, setSidebar] = useState(false)
  const [notifications, setNotifications] = useState(false)
  const [modal, setModal] = useState<{ kind: Kind; record?: BusinessRecord } | null>(null)
  const [auth, setAuth] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'setup' | 'forgot' | 'account' | 'reset'>('login')
  const [emailOn, setEmailOn] = useState(false)
  const [link, setLink] = useState<{ token: string; email: string; purpose: string } | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  // Roles and permissions come from the server's users & access table; the sample workspace previews admin.
  const live = !!access
  const permissions = access?.permissions ?? resolvePermissions('admin')
  const companyUser = live && access.role !== 'franchisee'
  const isAdmin = !live || access.role === 'admin'
  const franchiseMode = access?.role === 'franchisee' && !!ownFranchise
  const canView = (module?: Module) => !module || can(permissions, module, 'view')
  const canEdit = (module?: Module) => !live || !module || can(permissions, module, 'edit')
  const navigation = (franchiseMode ? franchiseNavigation : companyNavigation).filter(item => canView(sectionModule[item.id]))
  const sectionModuleId = sectionModule[section]
  const readOnly = live && !!sectionModuleId && !canEdit(sectionModuleId)
  const canAct = !readOnly && (section !== 'overview' || canEdit('orders')) && (section !== 'users' || isAdmin)
  const currency = settings.currency
  // Administrators can narrow network records (orders, leads, supply) to one franchise or to company-direct business.
  const scopedFranchise = franchiseMode ? ownFranchise : franchises.find(franchise => franchise.id === scope) || null
  const rows = franchiseMode || scope === 'all' ? allRows : allRows.filter(row => !franchiseKinds.includes(row.kind) || (scope === 'hq' ? !row.franchiseId : row.franchiseId === scope))
  const territory = scopedFranchise ? { location: scopedFranchise.location, latitude: scopedFranchise.latitude, longitude: scopedFranchise.longitude, radius: scopedFranchise.radius } : settings
  const franchiseName = (row: BusinessRecord) => franchises.find(franchise => franchise.id === row.franchiseId)?.name
  const scorecard = scopedFranchise ? franchiseSummary(allRows.filter(row => row.franchiseId === scopedFranchise.id)) : null
  const orders = rows.filter(row => row.kind === 'orders' && row.data.status !== 'Cancelled')
  const leads = rows.filter(row => row.kind === 'leads')
  const lots = rows.filter(row => row.kind === 'inventory')
  const outlets = rows.filter(row => row.kind === 'outlets').map(row => row.data.name)
  const today = dateOffset(0)
  const startDate = period === 'today' ? today : dateOffset(period === 'month' ? -29 : -6)
  const periodOrders = orders.filter(row => (row.data.date || row.createdAt.slice(0, 10)) >= startDate && (row.data.date || row.createdAt.slice(0, 10)) <= today)
  const total = periodOrders.reduce((sum, row) => sum + (row.data.amount || 0), 0)
  const unpaid = orders.reduce((sum, row) => sum + Math.max(0, (row.data.amount || 0) - (row.data.paid || 0)), 0)
  const pending = orders.filter(row => row.data.status !== 'Delivered')
  const openLeads = leads.filter(row => row.data.status !== 'Customer')
  const lowStock = lots.filter(row => row.data.status === 'Low stock' || (row.data.expiry && row.data.expiry <= today))
  const title = section === 'overview' ? (franchiseMode ? 'My franchise' : 'Overview') : section === 'settings' ? 'Business settings' : section === 'users' ? 'Users & access' : navigation.find(item => item.id === section)?.label || 'Workspace'
  const subtitles: Record<Section, string> = {
    overview: 'A fresh perspective on your business. Everything in one place.', orders: 'From a first order to a repeat customer. Keep every sale moving.', leads: 'Build relationships. Follow up thoughtfully. Grow locally.', sourcing: 'Your farmer-to-kitchen supply chain starts here.', inventory: 'Know your batches, availability and freshness at every outlet.', deliveries: 'Keep an eye on every order from dispatch to doorstep.', outlets: 'One business. Connected wholesale, retail and mobile operations.', territory: 'Find your next customers, one neighbourhood at a time.', supply: franchiseMode ? 'Request stock from the company and keep track of what you owe.' : 'Supply every franchise. Price, dispatch and collect payments.', franchises: 'Every franchise location and result in one place.', users: 'Decide who can sign in and what each person can view or edit.', settings: 'Make this workspace yours. Set up your business and territory.', playbook: 'Build a repeatable business, not just a busy business.',
  }

  async function load() {
    setLoading(true); setRows([]); setFranchises([]); setOwnFranchise(null); setLogins(null); setUsers([]); setAccess(null); setScope('all'); setSection('overview'); setError(''); setPlaces([]); setDiscoveryState('idle')
    try {
      const data = await request('/api/operations')
      setUser({ name: data.access.name, email: data.access.email }); setSetupRequired(false)
      setRows(data.records); setSettings({ ...defaultSettings, ...data.settings }); setFranchises(data.franchises || []); setOwnFranchise(data.franchise || null); setAccess(data.access)
      const profile: AccessProfile = data.access
      if (profile.role !== 'franchisee' && can(profile.permissions, 'franchises', 'view')) request('/api/franchises').then(result => setLogins(result.logins)).catch(() => setLogins(null))
      if (profile.role === 'admin') loadUsers()
      // Franchisees see the restaurants, caterers and hotels in their own radius as soon as they sign in.
      if (profile.role === 'franchisee' && can(profile.permissions, 'leads', 'edit')) {
        setDiscoveryState('loading')
        request('/api/discover', { category: 'all', rank: 'distance' }).then(result => { setPlaces(result.places); setDiscoveryState('done') }).catch(() => setDiscoveryState('unavailable'))
      }
    }
    catch (cause) { setUser(null); setError(`${(cause as Error).message} Sample data is shown.`); setRows(demoRecords()); setFranchises(demoFranchises()); setUsers(demoUsers()) }
    finally { setLoading(false) }
  }
  useEffect(() => {
    async function initialize() {
      try {
        // A set-password link from an invitation or reset email: /?token=...
        const token = new URLSearchParams(window.location.search).get('token')
        if (token) {
          window.history.replaceState(null, '', window.location.pathname)
          const info = await request('/api/auth', { action: 'token', token })
          if (info.valid) { setLink({ token, email: info.email, purpose: info.purpose }); setAuthMode('reset'); setFormError(''); setAuth(true) }
          else setError(info.error)
        }
        const session = await request('/api/auth')
        setEmailOn(!!session.emailEnabled)
        if (session.user) { await load(); return }
        if (session.error) setError(session.error)
        setSetupCodeRequired(!!session.setupCodeRequired)
        // A brand-new workspace opens straight into creating the first administrator.
        if (session.setupRequired) { setSetupRequired(true); setAuthMode('setup'); setAuth(true) }
      } catch { setError('Sign-in is temporarily unavailable. Sample data is shown.') }
    }
    initialize()
  }, [])
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timeout) }, [toast])
  function viewFranchise(id: string) { setScope(id); navigate('overview') }
  function navigate(next: Section) { setSection(next); setSearch(''); setStatus('All statuses'); setSidebar(false); setError('') }
  async function loadUsers() {
    try { const result = await request('/api/users'); setUsers(result.users); setEmailOn(!!result.emailEnabled) }
    catch (cause) { setError((cause as Error).message) }
  }
  function openUserForm(account?: AppUser) {
    setFormError('')
    if (!live) { openAccount(); return }
    setUserModal({ user: account })
  }
  async function sendLoginLink(account: AppUser) {
    setBusy(true); setFormError('')
    try { const result = await request('/api/users', { action: 'send-link', id: account.id }); setUserModal(null); setToast(result.purpose === 'invite' ? `Invitation emailed to ${account.email}.` : `Password reset link emailed to ${account.email}.`) }
    catch (cause) { setFormError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function saveUser(values: UserFormValues) {
    const current = userModal?.user
    setBusy(true); setFormError('')
    try {
      const saved: AppUser = await request('/api/users', current ? { ...values, id: current.id } : values, current ? 'PATCH' : 'POST')
      setUsers(list => current ? list.map(item => item.id === saved.id ? saved : item) : [...list, saved])
      const created = saved as AppUser & { emailSent?: boolean }
      setUserModal(null)
      setToast(current ? 'Access updated. It applies on their next action.' : created.emailSent ? `Invitation emailed to ${saved.email}.` : created.emailSent === false ? 'User added, but the invitation email could not be sent. Use “Email a login link” or set a password.' : 'User added. Share the email and password privately.')
      loadUsers()
    } catch (cause) { setFormError((cause as Error).message) }
    finally { setBusy(false) }
  }
  function openForm(kind: Kind, record?: BusinessRecord) {
    setFormError('')
    if (!live) { openAccount(); return }
    if (!canEdit(kind)) { setError('You have view-only access here. Ask an administrator for edit access.'); return }
    setModal({ kind, record })
  }
  async function save(data: BusinessData, franchiseId: string | null) {
    if (!modal) return
    setBusy(true); setFormError('')
    try {
      const assignable = companyUser && franchiseKinds.includes(modal.kind)
      const saved = await request('/api/operations', { kind: modal.kind, id: modal.record?.id, data, ...(assignable ? { franchiseId } : {}) }, modal.record?.id ? 'PATCH' : 'POST')
      setRows(current => modal.record?.id ? current.map(row => row.id === saved.id ? saved : row) : [saved, ...current])
      setModal(null); setToast('Record saved to your business workspace.')
      if (data.placeId) setPlaces(current => current.map(place => place.id === data.placeId ? { ...place, saved: 'here' } : place))
    } catch (cause) { setFormError((cause as Error).message) }
    finally { setBusy(false) }
  }
  function openFranchiseForm(franchise?: Franchise) {
    setFormError('')
    if (!live) { openAccount(); return }
    if (!canEdit('franchises')) { setError('You have view-only access to the franchise network.'); return }
    setFranchiseModal({ franchise })
  }
  async function saveFranchise(values: { email: string; data: Omit<Franchise, 'id' | 'email'> }) {
    const current = franchiseModal?.franchise
    setBusy(true); setFormError('')
    try {
      const saved: Franchise & { invitationSent?: boolean } = await request('/api/franchises', current ? { id: current.id, data: values.data } : values, current ? 'PATCH' : 'POST')
      setFranchises(list => current ? list.map(item => item.id === saved.id ? saved : item) : [...list, saved])
      setFranchiseModal(null); setToast(current ? 'Franchise updated.' : saved.invitationSent ? `Franchise created. An activation email was sent to ${saved.email}.` : 'Franchise created, but the activation email could not be sent. Check Resend email settings and use Users & access to resend the login link.')
      request('/api/franchises').then(result => setLogins(result.logins)).catch(() => undefined)
    } catch (cause) { setFormError((cause as Error).message) }
    finally { setBusy(false) }
  }
  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFormError('')
    const values = new FormData(event.currentTarget)
    const text = (key: string) => String(values.get(key) || '')
    try {
      if (authMode === 'account') {
        if (text('password') !== text('confirm')) { setFormError('The new passwords do not match.'); return }
        await request('/api/auth', { action: 'password', current: text('current'), password: text('password') })
        setAuth(false); setToast('Password changed. Other devices have been signed out.'); return
      }
      if (authMode === 'forgot') {
        const result = await request('/api/auth', { action: 'forgot', email: text('email') })
        setNotice(result.message); return
      }
      if (authMode === 'reset') {
        if (text('password') !== text('confirm')) { setFormError('The passwords do not match.'); return }
        await request('/api/auth', { action: 'reset', token: link?.token, password: text('password') })
        setLink(null); await load(); setAuth(false); setToast('Password set. You’re signed in.'); return
      }
      if (authMode === 'setup') {
        if (text('password') !== text('confirm')) { setFormError('The passwords do not match.'); return }
        await request('/api/auth', { action: 'setup', name: text('name').trim(), email: text('email'), password: text('password'), code: text('code') })
      } else await request('/api/auth', { action: 'login', email: text('email'), password: text('password') })
      await load()
      setAuth(false); setToast(authMode === 'setup' ? 'Administrator created. Add your team in Users & access.' : 'You’re signed in. Your workspace is connected.')
    } catch (cause) { setFormError((cause as Error).message) }
    finally { setBusy(false) }
  }
  const [locating, setLocating] = useState(false)
  // Fills the settings coordinates from the browser's location (asks the user's permission).
  function useCurrentLocation(event: React.MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form
    if (!form || !('geolocation' in navigator)) { setError('This browser cannot share its location. Enter the coordinates instead.'); return }
    setLocating(true); setError('')
    navigator.geolocation.getCurrentPosition(position => {
      const set = (name: string, value: number) => { const input = form.elements.namedItem(name) as HTMLInputElement | null; if (input) input.value = value.toFixed(6) }
      set('latitude', position.coords.latitude); set('longitude', position.coords.longitude)
      setLocating(false); setToast('Location filled in. Check it, then save business settings.')
    }, () => { setLocating(false); setError('Location permission was denied or unavailable. Allow location for this site, or enter the coordinates.') }, { enableHighAccuracy: true, timeout: 15000 })
  }
  function openAccount() { setFormError(''); setAuthMode(user ? 'account' : setupRequired ? 'setup' : 'login'); setAuth(true) }
  async function signOut() {
    try { await request('/api/auth', { action: 'logout' }); setAuth(false); setUser(null); setRows(demoRecords()); setFranchises(demoFranchises()); setOwnFranchise(null); setLogins(null); setAccess(null); setUsers(demoUsers()); setScope('all'); setSettings(defaultSettings); setToast('Signed out. You’re viewing sample data.'); navigate('overview') }
    catch { setError('Sign out failed. Please try again.') }
  }
  function exportRows() {
    const records = tableRows
    if (!records.length) { setToast('There are no records to export.'); return }
    const escape = (value: unknown) => { const text = String(value ?? ''); return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"` }
    const columns = ['id', 'name', 'status', 'product', 'quantity', 'unit', 'amount', 'paid', 'date', 'outlet', 'segment', 'franchise', 'note']
    const csv = [columns.join(','), ...records.map(row => columns.map(column => escape(column === 'id' ? row.id : column === 'franchise' ? franchiseName(row) : row.data[column as keyof BusinessData])).join(','))].join('\r\n')
    const link = document.createElement('a'); const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); link.href = url; link.download = `freshroute-${section}-${live ? 'records' : 'sample'}-${today}.csv`; link.click(); URL.revokeObjectURL(url)
  }
  async function discover() {
    if (!live) { openAccount(); return }
    if (!canEdit('leads')) { setError('You need edit access to customers and leads to discover businesses.'); return }
    if (!territory.location) {
      if (franchiseMode) setError('Your franchise location is not configured. Ask the company administrator.')
      else if (scopedFranchise) setError(`Set a location for ${scopedFranchise.name} in Franchise network first.`)
      else if (isAdmin) { navigate('settings'); setError('Set your starting location first: enter its name and coordinates below, or use “Use my current location”, then save. Discovery searches around this point.') }
      else setError('An administrator needs to set the business location in Business settings before discovery can run.')
      return
    }
    setBusy(true); setError(''); setDiscoveryState('loading')
    try { const data = await request('/api/discover', { latitude: territory.latitude, longitude: territory.longitude, radius: territory.radius, category, rank, ...(!franchiseMode && scopedFranchise ? { franchiseId: scopedFranchise.id } : {}) }); setPlaces(data.places); setDiscoveryState('done'); if (!data.places.length) setToast('No nearby businesses returned. Try another business type or add leads manually.') }
    catch (cause) { setError((cause as Error).message); setDiscoveryState('idle') }
    finally { setBusy(false) }
  }
  const kind: Kind = ['orders', 'leads', 'inventory', 'sourcing', 'outlets', 'supply'].includes(section) ? section as Kind : 'orders'
  const tableRows = rows.filter(row => row.kind === kind).filter(row => section !== 'deliveries' || ['Ready', 'Out for delivery', 'Delivered'].includes(row.data.status)).filter(row => section !== 'overview' || ((row.data.date || row.createdAt.slice(0, 10)) >= startDate && (row.data.date || row.createdAt.slice(0, 10)) <= today)).filter(row => status === 'All statuses' || row.data.status === status).filter(row => Object.values(row.data).join(' ').toLowerCase().includes(search.toLowerCase()))
  const nearLeads = leads.filter(row => row.data.latitude !== undefined && row.data.longitude !== undefined && distance(row.data.latitude, row.data.longitude, territory) <= territory.radius)
  const supplyRows = rows.filter(row => row.kind === 'supply' && row.data.status !== 'Cancelled')
  const supplyDue = supplyRows.reduce((sum, row) => sum + Math.max(0, (row.data.amount || 0) - (row.data.paid || 0)), 0)

  function renderTable(compact = false) {
    const displayed = compact ? tableRows.slice(0, 5) : tableRows
    return <div className="table-scroll"><table><thead><tr><th>{kind === 'orders' ? 'CUSTOMER' : kind === 'supply' ? 'FRANCHISE' : kind === 'sourcing' ? 'SUPPLIER' : kind === 'inventory' ? 'STOCK LOT' : kind === 'outlets' ? 'OUTLET' : 'BUSINESS'}</th>{kind !== 'outlets' && <th>{kind === 'leads' ? 'OPPORTUNITY' : 'PRODUCT / QTY'}</th>}<th>STATUS</th><th>{kind === 'inventory' ? 'EXPIRY' : kind === 'outlets' ? 'NOTES' : 'VALUE'}</th>{!compact && <th>{['orders', 'sourcing', 'supply'].includes(kind) ? 'PAYMENT' : kind === 'leads' ? 'FOLLOW-UP' : 'DETAILS'}</th>}<th aria-label="Actions" /></tr></thead><tbody>{displayed.map((row, index) => <tr key={row.id}><td><div className="customer-cell"><span className={`customer-avatar avatar-${index % 5}`}>{row.data.name.split(' ').filter(word => word !== 'The').slice(0, 2).map(word => word[0]).join('')}</span><span><strong>{row.data.name}</strong><small>{kind === 'inventory' ? row.data.batch || 'No batch' : kind === 'outlets' ? 'Distribution channel' : `${row.data.date || 'No date'} · ${row.id.startsWith('demo') ? `FR-${1024 + Number(row.id.split('-')[1])}` : row.id.slice(0, 8).toUpperCase()}${!franchiseMode && kind !== 'supply' && franchiseName(row) ? ` · ${franchiseName(row)}` : ''}`}</small></span></div></td>{kind !== 'outlets' && <td>{kind === 'leads' ? <span className="muted">{row.data.segment ? `${row.data.segment} · ` : ''}{row.data.note || 'New opportunity'}</span> : <div className="product-cell"><span>{products.find(product => product.name === row.data.product)?.emoji}</span><span>{row.data.product}<small>{row.data.quantity} {row.data.unit}</small></span></div>}</td>}<td><Badge status={row.data.status} /></td><td className="amount-cell">{kind === 'inventory' ? <span className={row.data.expiry && row.data.expiry <= today ? 'text-amber' : ''}>{row.data.expiry || 'Not recorded'}</span> : kind === 'outlets' ? <span className="muted">{row.data.note || '—'}</span> : kind === 'supply' && row.data.status === 'Requested' && !row.data.amount ? <span className="muted">Awaiting price</span> : money(row.data.amount || 0, currency)}</td>{!compact && <td>{kind === 'supply' && row.data.status === 'Requested' && !row.data.amount ? <span className="muted">—</span> : ['orders', 'sourcing', 'supply'].includes(kind) ? <span className={(row.data.amount || 0) > (row.data.paid || 0) ? 'text-amber' : 'text-green'}>{(row.data.amount || 0) > (row.data.paid || 0) ? `${money((row.data.amount || 0) - (row.data.paid || 0), currency)} due` : 'Paid'}</span> : kind === 'leads' ? row.data.date || 'Not scheduled' : `${row.data.outlet || 'Unassigned'}${row.data.temperature !== undefined ? ` · ${row.data.temperature}°C` : ''}`}</td>}<td>{row.data.phone && /^[0-9]{7,15}$/.test(row.data.phone) && <a className="icon-button" aria-label={`Contact ${row.data.name} on WhatsApp`} target="_blank" rel="noreferrer" href={`https://wa.me/${row.data.phone}?text=${encodeURIComponent(`Hello ${row.data.name}, this is ${settings.company}. Let’s discuss your requirements.`)}`}><MessageCircle size={16} /></a>}{canEdit(row.kind) && <button className="icon-button" aria-label={`Edit ${row.data.name}`} onClick={() => openForm(row.kind, row)}><MoreHorizontal size={19} /></button>}</td></tr>)}</tbody></table>{!displayed.length && <div className="empty-state"><Package size={30} /><h3>{search || status !== 'All statuses' ? 'No matching records' : 'A fresh start'}</h3><p>{search ? 'Try a different search or clear your filters.' : 'Add your first record to start tracking your business.'}</p><button className="outline" onClick={() => openForm(kind)}><Plus size={16} /> {kind === 'orders' ? 'Add order' : kind === 'supply' && franchiseMode ? 'Request stock' : 'Add record'}</button></div>}</div>
  }

  function chart() {
    const days = Array.from({ length: period === 'today' ? 1 : period === 'month' ? 30 : 7 }, (_, index) => dateOffset(index - (period === 'today' ? 0 : period === 'month' ? 29 : 6)))
    const values = days.map(date => periodOrders.filter(row => row.data.date === date).reduce((sum, row) => sum + (row.data.amount || 0), 0))
    const maximum = Math.max(...values, 1000) * 1.2
    const points = values.map((value, index) => [45 + index * 590 / Math.max(1, days.length - 1), 170 - value / maximum * 140])
    const path = points.map((point, index) => `${index ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ')
    return <div className="revenue-chart"><svg viewBox="0 0 665 210" role="img" aria-label={`Order value trend. Total ${money(total, currency)} for the selected period.`}><defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#168160" stopOpacity="0.15" /><stop offset="100%" stopColor="#168160" stopOpacity="0" /></linearGradient></defs>{[0, 1, 2, 3].map(index => <g key={index}><line x1="45" x2="635" y1={30 + index * 46.66} y2={30 + index * 46.66} stroke="#edf0ee" strokeDasharray="4 4" /><text x="0" y={34 + index * 46.66} className="chart-text">{Math.round(maximum * (3 - index) / 3 / 1000)}k</text></g>)}<path d={`${path} L${points[points.length - 1][0]},170 L45,170 Z`} fill="url(#revenue-fill)" /><path d={path} fill="none" stroke="#188263" strokeWidth="2.8" strokeLinejoin="round" />{points.map((point, index) => <g key={index}><circle cx={point[0]} cy={point[1]} r="4" fill="#fff" stroke="#168160" strokeWidth="2"><title>{days[index]}: {money(values[index], currency)}</title></circle>{(days.length <= 7 || index % 5 === 0) && <text x={point[0]} y="200" textAnchor="middle" className="chart-text">{new Date(`${days[index]}T12:00:00`).toLocaleDateString('en', { timeZone: 'UTC', weekday: days.length <= 7 ? 'short' : undefined, day: days.length > 7 ? 'numeric' : undefined })}</text>}</g>)}</svg></div>
  }

  return <div className="app-shell">
    {sidebar && <button className="sidebar-overlay" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}><a className="brand" href="/"><span className="brand-icon"><Leaf size={24} /></span>{settings.company}<span className="brand-dot">.</span></a><button className="workspace-switch" onClick={() => navigate(franchiseMode ? 'territory' : 'outlets')}><span className="workspace-initial">{franchiseMode ? 'FN' : 'FR'}</span><span><strong>{franchiseMode ? ownFranchise?.name : 'Business workspace'}</strong><small>{franchiseMode ? `Franchise · ${ownFranchise?.radius} km territory` : live ? 'Connected operations' : 'Preview workspace'}</small></span><ChevronDown size={15} /></button><nav>{navigation.map(item => <div key={item.id}>{item.group && <p className="nav-group">{item.group}</p>}<button className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={19} /><span>{item.label}</span>{item.id === 'orders' && pending.length > 0 && <span className="nav-count">{pending.length}</span>}{item.id === 'supply' && !franchiseMode && rows.some(row => row.kind === 'supply' && row.data.status === 'Requested') && <span className="nav-count">{rows.filter(row => row.kind === 'supply' && row.data.status === 'Requested').length}</span>}{item.id === 'territory' && <span className="new-label">NEW</span>}</button></div>)}</nav><div className="sidebar-bottom"><a className="nav-item" href="/shop" target="_blank" rel="noreferrer"><ExternalLink size={18} /><span>View your website</span><ArrowUpRight size={15} /></a>{isAdmin && <button className={`nav-item ${section === 'users' ? 'active' : ''}`} onClick={() => navigate('users')}><ShieldCheck size={18} /><span>Users & access</span></button>}{isAdmin && <button className={`nav-item ${section === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><SettingsIcon size={18} /><span>Business settings</span></button>}<div className="sidebar-card"><span className="sidebar-card-icon"><Sprout size={20} /></span><strong>Grow a little closer.</strong><p>Your next restaurant partner<br />could be around the corner.</p><button onClick={() => navigate('territory')}>Explore your territory <ArrowRight size={14} /></button></div><button className="profile" onClick={openAccount}><span className="profile-avatar">{user ? (user.name || user.email || 'Team').slice(0, 1).toUpperCase() : 'FR'}</span><span><strong>{user?.name || (user ? 'Team member' : 'Your workspace')}</strong><small>{user ? (franchiseMode ? 'Franchisee · account' : 'Account & sign out') : setupRequired ? 'Create the administrator' : 'Sign in to get started'}</small></span><ChevronRight size={16} /></button></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebar(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={14} /><strong>{title}</strong></div><div className="topbar-actions"><div className="top-search"><Search size={16} /><input aria-label="Search workspace records" placeholder="Search this view..." value={search} onChange={event => setSearch(event.target.value)} /><span>⌕</span></div><span className="topbar-divider" /><div className="notification-wrapper"><button className="icon-button notification-button" aria-label="View business alerts" onClick={() => setNotifications(!notifications)}><Bell size={20} />{(lowStock.length > 0 || unpaid > 0) && <span />}</button>{notifications && <div className="notification-panel"><strong>Business alerts</strong>{!franchiseMode && <p>{lowStock.length} stock lots need attention.</p>}<p>{money(unpaid, currency)} in customer payments is outstanding.</p>{franchiseMode && <p>{money(supplyDue, currency)} is payable to the company for supply.</p>}<button className="text-button" onClick={() => { navigate(franchiseMode ? 'orders' : 'inventory'); setNotifications(false) }}>{franchiseMode ? 'Review orders' : 'Review inventory'} <ArrowRight size={14} /></button></div>}</div><button className="top-avatar" aria-label={user ? 'Your account' : 'Sign in'} onClick={openAccount}>{user ? (user.name || 'Team')[0] : 'FR'}</button></div></header>
    <main className="workspace-main"><div className="page-heading"><div><div className="heading-eyebrow"><span className="live-dot" /> YOUR BUSINESS, CONNECTED</div><h1>{section === 'overview' ? (scopedFranchise ? scopedFranchise.name : 'Your business, at a glance') : title}<span className="heading-period">.</span></h1><p>{subtitles[section]}</p></div><div className="page-actions">{!franchiseMode && franchises.length > 0 && ['overview', 'orders', 'leads', 'deliveries', 'supply', 'territory'].includes(section) && <label className="period-select"><Store size={16} /><select aria-label="Network scope" value={scope} onChange={event => { setScope(event.target.value); setPlaces([]) }}><option value="all">Whole network</option><option value="hq">Company direct</option>{franchises.map(franchise => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select><ChevronDown size={14} /></label>}{section === 'overview' && <label className="period-select"><CalendarDays size={16} /><select aria-label="Reporting period" value={period} onChange={event => setPeriod(event.target.value)}><option value="week">Last 7 days</option><option value="today">Today</option><option value="month">Last 30 days</option></select><ChevronDown size={14} /></label>}{readOnly && <span className="view-only-chip"><Eye size={14} /> View only</span>}{canAct && !['settings', 'playbook'].includes(section) && <button className="primary" onClick={() => section === 'territory' ? discover() : section === 'franchises' ? openFranchiseForm() : section === 'users' ? openUserForm() : openForm(kind)} disabled={busy}><Plus size={17} />{section === 'territory' ? 'Discover businesses' : section === 'franchises' ? 'Add franchise' : section === 'users' ? 'Add user' : kind === 'orders' ? 'New order' : kind === 'leads' ? 'Add lead' : kind === 'supply' ? (franchiseMode ? 'Request stock' : 'Add franchise supply') : kind === 'sourcing' ? 'Add purchase' : kind === 'inventory' ? 'Add stock lot' : 'Add outlet'}</button>}</div></div>
    {!live && <div className="preview-banner"><span><span className="preview-tag">DEMO</span> {setupRequired ? 'Your workspace is ready. Create the administrator account to start using real data.' : 'You’re exploring sample data. Sign in to start your own operation.'}</span><button onClick={openAccount}>{setupRequired ? 'Create administrator' : 'Connect workspace'} <ArrowRight size={14} /></button></div>}
    {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
    {loading ? <div className="loading-grid" aria-label="Loading workspace"><div /><div /><div /><div /></div> : <>
    {section === 'overview' && <>
      <div className="metrics-grid">{[
        { label: 'Order value', value: money(total, currency), icon: CircleDollarSign, note: `${periodOrders.length} orders in this period`, tone: 'green', sub: 'Booked sales · not profit' },
        { label: 'Orders to fulfil', value: String(pending.length).padStart(2, '0'), icon: ShoppingBag, note: `${orders.filter(row => row.data.status === 'Delivered').length} delivered overall`, tone: 'blue', sub: 'Across all open orders' },
        { label: 'Outstanding payments', value: money(unpaid, currency), icon: Wallet, note: `${new Set(orders.filter(row => (row.data.amount || 0) > (row.data.paid || 0)).map(row => row.data.name)).size} customers to follow up`, tone: 'amber', sub: 'Keep your cash flow healthy' },
        { label: 'Active opportunities', value: String(openLeads.length).padStart(2, '0'), icon: Users, note: `${leads.filter(row => row.data.status === 'Customer').length} converted to customers`, tone: 'violet', sub: 'Your next growth opportunities' },
      ].map(metric => <article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><span className={`metric-icon ${metric.tone}`}><metric.icon size={18} /></span></div><strong className="metric-value">{metric.value}</strong><p className={`metric-note text-${metric.tone}`}><ArrowUpRight size={14} />{metric.note}</p><small>{metric.sub}</small></article>)}</div>
      {scorecard && scopedFranchise && <section className="panel scorecard"><div className="panel-heading"><div><h2>{franchiseMode ? 'Your franchise scorecard' : `${scopedFranchise.name} scorecard`}</h2><p>{scopedFranchise.location} · {scopedFranchise.radius} km territory · all time</p></div>{!franchiseMode && <button className="text-button" onClick={() => navigate('franchises')}>All franchises <ArrowRight size={15} /></button>}</div><dl className="franchise-stats scorecard-stats">
        <div><dt>Business acquired</dt><dd>{scorecard.customers}<small> customers</small></dd><small>{money(scorecard.acquired, currency)} est. monthly</small></div>
        <div><dt>Pending conversions</dt><dd>{scorecard.leads - scorecard.customers}<small> leads</small></dd><small>{money(scorecard.pipeline, currency)} est. monthly pipeline</small></div>
        <div><dt>Orders to deliver</dt><dd>{scorecard.toDeliver}</dd><small>{money(scorecard.orderValue, currency)} booked overall</small></div>
        <div><dt>Customer payments pending</dt><dd className={scorecard.customerDue ? 'text-amber' : ''}>{money(scorecard.customerDue, currency)}</dd><small>Collect from your customers</small></div>
        <div><dt>{franchiseMode ? 'Payable to company' : 'Owes company'}</dt><dd className={scorecard.supplyDue ? 'text-amber' : ''}>{money(scorecard.supplyDue, currency)}</dd><small>{scorecard.supplyIncoming} supply requests open</small></div>
      </dl></section>}
      {franchiseMode && <section className="panel nearby-panel"><div className="panel-heading"><div><h2>Businesses to win near you {places.length > 0 && <span className="heading-count">{places.filter(place => !place.saved).length}</span>}</h2><p>Restaurants, caterers and hotels within your {ownFranchise?.radius} km territory, nearest first</p></div><button className="text-button" onClick={() => navigate('territory')}>See all <ArrowRight size={15} /></button></div>
        {discoveryState === 'loading' ? <p className="nearby-status muted">Finding businesses around {ownFranchise?.location}…</p>
        : discoveryState === 'unavailable' ? <p className="nearby-status muted">Business discovery isn’t available right now. You can still add leads by hand in Customers &amp; leads.</p>
        : places.filter(place => !place.saved).length === 0 ? <p className="nearby-status muted">{discoveryState === 'done' ? 'No new businesses found in your territory right now. Try “Most popular” on My territory.' : 'Open My territory to search your area.'}</p>
        : <div className="nearby-list">{places.filter(place => !place.saved).slice(0, 6).map(place => <article key={place.id}><span className="nearby-icon"><UtensilIcon /></span><div><strong>{place.displayName.text}</strong><small>{[place.segment, place.distanceKm !== undefined ? `${place.distanceKm} km away` : ''].filter(Boolean).join(' · ')}</small></div><button className="text-button" onClick={() => { setFormError(''); setModal({ kind: 'leads', record: { id: '', kind: 'leads', createdAt: '', franchiseId: null, data: { name: place.displayName.text, status: 'New lead', segment: place.segment, placeId: place.id, note: place.formattedAddress, latitude: place.location.latitude, longitude: place.location.longitude, phone: place.internationalPhoneNumber?.replace(/\D/g, '') } } }) }}>Add lead <Plus size={14} /></button></article>)}</div>}
      </section>}
      <div className="dashboard-middle"><section className="panel revenue-panel"><div className="panel-heading"><div><h2>Sales performance</h2><p>Your order value over time</p></div><span className="chart-key"><span />Order value</span></div><div className="chart-total"><strong>{money(total, currency)}</strong><span>{period === 'today' ? 'Today' : period === 'month' ? 'Last 30 days' : 'Last 7 days'}</span></div>{chart()}</section><section className="panel product-panel"><div className="panel-heading"><div><h2>Product mix</h2><p>What your customers are ordering</p></div><Package size={18} className="muted" /></div><div className="product-bars">{products.map(product => { const value = periodOrders.filter(row => row.data.product === product.name).reduce((sum, row) => sum + (row.data.amount || 0), 0); const percent = total ? Math.round(value / total * 100) : 0; return <div className="product-bar-row" key={product.name}><span className="product-emoji" style={{ background: product.color }}>{product.emoji}</span><div><div className="bar-label"><span>{product.name}</span><strong>{percent}%</strong></div><div className="bar-track"><div style={{ width: `${percent}%` }} /></div></div></div> })}</div>{!franchiseMode && <button className="text-button product-link" onClick={() => navigate('inventory')}>View inventory <ArrowRight size={15} /></button>}</section></div>
      <div className="dashboard-lower"><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent orders <span className="heading-count">{tableRows.length}</span></h2><p>Fresh orders. Moving forward.</p></div><button className="text-button" onClick={() => navigate('orders')}>View all orders <ArrowRight size={15} /></button></div>{renderTable(true)}</section><section className="territory-card"><div className="territory-card-top"><span className="territory-icon"><MapPin size={19} /></span><span className="territory-mini-label">GROW LOCALLY</span></div><h2>Your next customer<br />is closer than you think.</h2><p>Turn a {territory.radius} km neighbourhood into<br />your next growth opportunity.</p><TerritoryMap radius={territory.radius} count={nearLeads.length} /><div className="territory-card-foot"><span><strong>{nearLeads.length}</strong> leads in your territory</span><button onClick={() => navigate('territory')} aria-label="Explore territory"><ArrowUpRight size={20} /></button></div></section></div>
      <section className="daily-strip"><span className="daily-icon"><Truck size={21} /></span><div><strong>Keep the day moving.</strong><span>{orders.filter(row => row.data.status === 'Out for delivery').length} orders on the road · {franchiseMode ? `${money(unpaid, currency)} to collect` : `${lowStock.length} inventory alerts`} · {franchiseMode ? `${rows.filter(row => row.kind === 'supply' && ['Confirmed', 'Dispatched'].includes(row.data.status)).length} supply deliveries coming from the company` : `${rows.filter(row => row.kind === 'sourcing' && row.data.status === 'Ordered').length} incoming purchases`}</span></div><button className="text-button" onClick={() => navigate('deliveries')}>See operations <ArrowRight size={15} /></button></section>
    </>}
    {section === 'franchises' && <FranchiseNetwork franchises={franchises} logins={logins} rows={allRows} currency={currency} isAdmin={canEdit('franchises')} add={() => openFranchiseForm()} edit={franchise => openFranchiseForm(franchise)} view={viewFranchise} />}
    {section === 'users' && isAdmin && <UsersAccess users={users} franchises={franchises} currentUserId={access?.id} emailEnabled={emailOn} add={() => openUserForm()} edit={account => openUserForm(account)} />}
    {['orders', 'leads', 'inventory', 'sourcing', 'outlets', 'deliveries', 'supply'].includes(section) && <><div className="summary-strip"><div><span>Records</span><strong>{tableRows.length}</strong></div><div><span>{kind === 'inventory' ? 'Needs attention' : kind === 'leads' ? 'Open opportunities' : kind === 'outlets' ? 'Active outlets' : 'Total value'}</span><strong>{kind === 'inventory' ? lowStock.length : kind === 'leads' ? openLeads.length : kind === 'outlets' ? tableRows.filter(row => row.data.status === 'Active').length : money(tableRows.filter(row => row.data.status !== 'Cancelled').reduce((sum, row) => sum + (row.data.amount || 0), 0), currency)}</strong></div><div><span>{kind === 'sourcing' ? 'Supplier payments due' : kind === 'supply' ? (franchiseMode ? 'Payable to company' : 'Due from franchises') : kind === 'orders' ? 'Customer payments due' : 'Working together'}</span><strong>{['sourcing', 'supply', 'orders'].includes(kind) ? money(tableRows.filter(row => row.data.status !== 'Cancelled').reduce((sum, row) => sum + Math.max(0, (row.data.amount || 0) - (row.data.paid || 0)), 0), currency) : franchiseMode ? 'Company → You → Kitchen' : 'Farm → Kitchen'}</strong></div></div><section className="panel records-panel"><div className="table-toolbar"><div className="table-search"><Search size={17} /><input aria-label="Search records" placeholder={`Search ${kind}...`} value={search} onChange={event => setSearch(event.target.value)} /></div><div className="toolbar-actions"><select aria-label="Filter status" value={status} onChange={event => setStatus(event.target.value)}><option>All statuses</option>{statusOptions[kind].map(option => <option key={option}>{option}</option>)}</select><button className="outline" onClick={exportRows}><Download size={15} /> Export</button></div></div>{renderTable()}<div className="table-footer"><span>Showing {tableRows.length} records{!live && ' · Sample data'}</span><span>All amounts in {currency}</span></div></section>{section === 'sourcing' && <div className="info-note"><Sprout size={18} /> Receiving a purchase does not create stock automatically. Record the processed yield as a stock lot in Inventory, including its batch and expiry.</div>}{section === 'supply' && <div className="info-note"><Boxes size={18} /> {franchiseMode ? 'Request stock here. The company confirms the price, dispatches and records your payments. Supply does not change any stock count automatically.' : 'The company supplies every franchise. Set the price on Requested items, update the status as you dispatch and record payments received from the franchise.'}</div>}{section === 'deliveries' && <div className="info-note"><Truck size={18} /> Use an order’s notes for route, driver and delivery window. Update its status to track dispatch and completion.</div>}</>}
    {section === 'territory' && <div className="territory-layout"><section className="panel"><div className="panel-heading"><div><h2>{scopedFranchise ? `${franchiseMode ? 'Your' : scopedFranchise.name} territory` : 'Your service territory'}</h2><p>{territory.location || 'Starting location not configured'} · {territory.radius} km radius</p></div>{!franchiseMode && <button className="text-button" onClick={() => scopedFranchise ? openFranchiseForm(scopedFranchise) : navigate('settings')}>Configure <SettingsIcon size={15} /></button>}</div><TerritoryMap radius={territory.radius} count={nearLeads.length} large /><p className="map-disclaimer">Territory illustration, not a navigable street map. Lead distances below use actual coordinates and straight-line distance.</p><div className="territory-stats"><div><strong>{nearLeads.length}</strong><span>Leads in range</span></div><div><strong>{nearLeads.filter(row => row.data.status === 'Customer').length}</strong><span>Converted customers</span></div><div><strong>{money(nearLeads.filter(row => row.data.status !== 'Customer').reduce((sum, row) => sum + (row.data.amount || 0), 0), currency)}</strong><span>Estimated monthly pipeline</span></div></div></section><section className="panel"><div className="panel-heading"><div><h2>Nearby opportunities</h2><p>Prioritise a conversation, not just a pin.</p></div><button className="text-button" onClick={() => openForm('leads')}><Plus size={15} /> Add lead</button></div><div className="nearby-list">{nearLeads.length ? nearLeads.map(row => <article key={row.id}><span className="nearby-icon"><UtensilIcon /></span><div><strong>{row.data.name}</strong><small>{row.data.segment ? `${row.data.segment} · ` : ''}{distance(row.data.latitude!, row.data.longitude!, territory).toFixed(1)} km from your center</small><Badge status={row.data.status} /></div><button className="icon-button" aria-label={`Edit ${row.data.name}`} onClick={() => openForm('leads', row)}><ArrowUpRight size={18} /></button></article>) : <div className="empty-state"><MapPin size={28} /><p>Add lead coordinates and configure your territory to see nearby businesses.</p></div>}</div><div className="discovery-note"><strong>Find restaurants, caterers & hotels</strong><p>Live discovery uses Google Places when connected. Each search returns up to 20 nearby businesses of one type, not every business within the radius. A business can be saved as a lead by only one franchise.</p><div className="form-grid discovery-controls"><label className="discovery-category">Business type<select value={category} onChange={event => setCategory(event.target.value)}>{discoveryCategories.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label className="discovery-category">Show first<select value={rank} onChange={event => setRank(event.target.value as 'distance' | 'popularity')}><option value="distance">Nearest</option><option value="popularity">Most popular</option></select></label></div><button className="primary full" disabled={busy} onClick={discover}>{busy ? 'Finding businesses…' : `Find ${discoveryCategories.find(option => option.id === category)?.label.toLowerCase()} within ${territory.radius} km`}<Search size={16} /></button></div></section>{places.length > 0 && <section className="panel discovery-results"><div className="panel-heading"><div><h2>Businesses within {territory.radius} km <span className="heading-count">{places.length}</span></h2><p>Powered by Google · Up to 20 per business type, {rank === 'popularity' ? 'most popular first' : 'nearest first'} · Not a complete directory · Save the ones worth a conversation as leads</p></div></div><div className="nearby-list">{places.map(place => <article key={place.id}><div><strong>{place.displayName.text}</strong><small>{[place.segment, place.distanceKm !== undefined ? `${place.distanceKm} km away` : ''].filter(Boolean).join(' · ')}</small><small>{place.formattedAddress}</small>{place.googleMapsUri && <a target="_blank" rel="noreferrer" href={place.googleMapsUri}>View on Google Maps <ExternalLink size={12} /></a>}</div>{place.saved ? <span className="muted fine-print">{place.saved === 'here' ? 'Saved lead' : 'Claimed in network'}</span> : <button className="text-button" onClick={() => { setFormError(''); setModal({ kind: 'leads', record: { id: '', kind: 'leads', createdAt: '', franchiseId: scopedFranchise?.id || null, data: { name: place.displayName.text, status: 'New lead', segment: place.segment, placeId: place.id, note: place.formattedAddress, latitude: place.location.latitude, longitude: place.location.longitude, phone: place.internationalPhoneNumber?.replace(/\D/g, '') } } }) }}>Add lead <Plus size={14} /></button>}</article>)}</div></section>}</div>}
    {section === 'settings' && <section className="panel settings-panel"><div className="panel-heading"><div><h2>Business essentials</h2><p>The foundation for your sales and distribution workspace.</p></div><SettingsIcon size={20} /></div><form onSubmit={async event => { event.preventDefault(); if (!live) { openAccount(); return } const values = new FormData(event.currentTarget); const data = Object.fromEntries(values) as unknown as Settings; data.latitude = Number(data.latitude); data.longitude = Number(data.longitude); data.radius = Number(data.radius); setBusy(true); setError(''); try { await request('/api/operations', { kind: 'settings', data }); setSettings(data); setToast('Business settings saved. Your website contact is connected.') } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } }}><div className="form-grid"><label>Company name<input name="company" required maxLength={100} defaultValue={settings.company} /></label><label>Currency code<select name="currency" defaultValue={settings.currency}>{['INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD', 'SGD'].map(code => <option key={code}>{code}</option>)}</select></label></div><label>WhatsApp business number<input name="whatsapp" pattern="[0-9]{7,15}" defaultValue={settings.whatsapp} placeholder="Country code and number, digits only" /><small>This connects quotation requests from the public storefront.</small></label><label>Starting location / territory name<input name="location" required defaultValue={settings.location} placeholder="Your processing unit or outlet location" /></label><div className="form-grid"><label>Center latitude<input name="latitude" type="number" min="-90" max="90" step="any" required defaultValue={settings.latitude || ''} /></label><label>Center longitude<input name="longitude" type="number" min="-180" max="180" step="any" required defaultValue={settings.longitude || ''} /></label></div><div className="locate-row"><button type="button" className="outline" onClick={useCurrentLocation} disabled={locating}><MapPin size={15} /> {locating ? 'Finding your location…' : 'Use my current location'}</button><small>Stand at your processing unit or outlet, or copy coordinates from Google Maps (right-click a place → click the numbers to copy).</small></div><label>Service radius<select name="radius" defaultValue={settings.radius}>{radiusOptions.map(km => <option key={km} value={km}>{km} km</option>)}</select></label><div className="info-note"><ShieldIcon /> Only an administrator can change these settings. Google Places discovery needs a server-side API key configured in Netlify.</div><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save business settings'}<Check size={16} /></button></form></section>}
    {section === 'playbook' && <BusinessPlaybook />}
    </>}
    <footer className="workspace-footer"><span><Leaf size={13} /> FreshRoute · From farm to business</span><span>{live ? 'Connected to your business workspace' : 'Sample workspace · INR is an illustrative currency'}</span></footer></main></div>
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
    {modal && <Modal title={`${modal.record?.id ? 'Edit' : 'Add'} ${modal.kind === 'orders' ? 'order' : modal.kind === 'leads' ? 'lead' : modal.kind === 'supply' ? (franchiseMode ? 'stock request' : 'franchise supply') : modal.kind === 'sourcing' ? 'supplier purchase' : modal.kind === 'inventory' ? 'stock lot' : 'outlet'}`} close={() => { if (!busy) setModal(null) }}><RecordForm kind={modal.kind} record={modal.record} defaultFranchise={franchiseMode ? undefined : scopedFranchise?.id} outlets={outlets} franchises={franchises} franchiseMode={franchiseMode} busy={busy} error={formError} save={save} /></Modal>}
    {userModal && <Modal title={userModal.user ? 'Edit user access' : 'Add user'} close={() => { if (!busy) setUserModal(null) }}><UserForm user={userModal.user} franchises={franchises} emailEnabled={emailOn} sendLink={sendLoginLink} busy={busy} error={formError} save={saveUser} /></Modal>}
    {franchiseModal && <Modal title={franchiseModal.franchise ? 'Edit franchise' : 'Add franchise'} close={() => { if (!busy) setFranchiseModal(null) }}><FranchiseForm franchise={franchiseModal.franchise} busy={busy} error={formError} save={saveFranchise} /></Modal>}
    {auth && <Modal title={authMode === 'setup' ? 'Create the administrator' : authMode === 'account' ? 'Your account' : authMode === 'forgot' ? 'Forgot your password?' : authMode === 'reset' ? (link?.purpose === 'invite' ? 'Set your password' : 'Choose a new password') : 'Welcome back'} close={() => { if (!busy) setAuth(false) }}>
      {authMode === 'forgot' && emailOn ? <form onSubmit={authenticate}>{notice ? <p className="muted" role="status">{notice}</p> : <><p className="muted">Enter your login email and we’ll send you a link to choose a new password.</p><label>Email address<input name="email" type="email" autoComplete="email" required /></label>{formError && <p className="form-error" role="alert">{formError}</p>}<button className="primary full" disabled={busy}>{busy ? 'Sending…' : 'Email me a reset link'}<ArrowRight size={17} /></button></>}<button type="button" className="text-button auth-secondary" onClick={() => { setFormError(''); setNotice(''); setAuthMode('login') }}><ChevronLeft size={14} /> Back to sign in</button></form>
      : authMode === 'forgot' ? <><p className="muted">Passwords are reset by your administrator. Ask them to set a new password for you on the <strong>Users & access</strong> page, then sign in and change it under your account.</p><button type="button" className="text-button auth-secondary" onClick={() => { setFormError(''); setAuthMode('login') }}><ChevronLeft size={14} /> Back to sign in</button></>
      : <form onSubmit={authenticate}>
        {authMode === 'login' && <p className="muted">Sign in with the email and password your administrator gave you.</p>}
        {authMode === 'setup' && <p className="muted">This workspace has no administrator yet. The account you create here gets full access and can add everyone else.</p>}
        {authMode === 'reset' && <p className="muted">{link?.purpose === 'invite' ? 'Welcome! Choose a password for' : 'Choose a new password for'} <strong>{link?.email}</strong>. You’ll be signed in straight away.</p>}
        {authMode === 'account' && <p className="muted">Signed in as <strong>{user?.name || user?.email}</strong>{user?.name && user.email ? ` (${user.email})` : ''}.</p>}
        {authMode === 'setup' && <label>Your name<input name="name" autoComplete="name" maxLength={120} /></label>}
        {['login', 'setup'].includes(authMode) && <label>Email address<input name="email" type="email" autoComplete="email" required /></label>}
        {authMode === 'account' && <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>}
        <label>{authMode === 'account' ? 'New password' : 'Password'}<input name="password" type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={authMode === 'login' ? 1 : 8} maxLength={128} required /></label>
        {authMode !== 'login' && <label>Confirm {authMode === 'account' ? 'new ' : ''}password<input name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></label>}
        {authMode === 'setup' && setupCodeRequired && <label>Setup code<input name="code" required autoComplete="off" /><small>The OWNER_SETUP_CODE value set in Netlify.</small></label>}
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <button className="primary full" disabled={busy}>{busy ? 'Please wait…' : authMode === 'login' ? 'Sign in to workspace' : authMode === 'setup' ? 'Create administrator & sign in' : authMode === 'reset' ? 'Save password & sign in' : 'Change password'}<ArrowRight size={17} /></button>
        {authMode === 'login' && <button type="button" className="text-button auth-secondary" onClick={() => { setFormError(''); setNotice(''); setAuthMode('forgot') }}>Forgot password?</button>}
        {authMode === 'account' && <button type="button" className="outline full auth-signout" onClick={signOut} disabled={busy}>Sign out</button>}
      </form>}
      <div className="auth-note">Accounts are managed by your administrator in <strong>Users & access</strong>. There is no public sign-up.</div>
    </Modal>}
  </div>
}

function UtensilIcon() { return <ShoppingBag size={19} /> }
function ShieldIcon() { return <Package size={18} /> }

function TerritoryMap({ radius, count, large = false }: { radius: number; count: number; large?: boolean }) {
  return <div className={`territory-map ${large ? 'large-map' : ''}`}><svg viewBox="0 0 340 185" aria-label={`Illustration of a ${radius} kilometre service territory, ${count} saved leads in range.`} role="img"><defs><pattern id={large ? 'large-map-grid' : 'map-grid'} width="38" height="32" patternUnits="userSpaceOnUse"><path d="M38 0H0V32" fill="none" stroke="#d4e3d9" strokeWidth="1" /></pattern></defs><rect width="340" height="185" fill="#eaf1e9" /><rect width="340" height="185" fill={`url(#${large ? 'large-map-grid' : 'map-grid'})`} /><path d="M-20 140C70 90 78 100 155 130S250 70 360 72" stroke="#c4dedc" strokeWidth="20" fill="none" /><path d="M-5 65L340 143M77 0L165 185M280 0L202 185M0 161L345 22" stroke="#fff" strokeWidth="7" /><path d="M-5 65L340 143M77 0L165 185M280 0L202 185M0 161L345 22" stroke="#d6dcd0" strokeWidth="1" /><circle cx="171" cy="91" r="65" fill="#37825e" fillOpacity=".09" stroke="#408467" strokeWidth="1.5" strokeDasharray="5 4" /><circle cx="171" cy="91" r="43" fill="#37825e" fillOpacity=".06" />{[[136, 60], [206, 75], [144, 129], [203, 124], [182, 44]].slice(0, Math.min(count, 5)).map(([horizontal, vertical], index) => <g key={index}><circle cx={horizontal} cy={vertical} r="7" fill="#fff" /><circle cx={horizontal} cy={vertical} r="3.5" fill="#3e8466" /></g>)}<circle cx="171" cy="91" r="13" fill="#1d7654" /><path d="M165 91L171 86L177 91V98H165Z" fill="white" /><text x="242" y="159" fill="#4b735c" fontSize="10" fontFamily="sans-serif">{radius} km radius</text></svg></div>
}

function BusinessPlaybook() {
  return <div className="playbook"><section className="playbook-hero"><span className="eyebrow">THE BIGGER PICTURE</span><h2>Build locally.<br /><em>Repeat thoughtfully.</em></h2><p>A 20–30 km territory is a useful starting point. A healthy distribution business is built on reliable supply, repeat orders and disciplined collections—not just reach.</p><span><Target size={17} /> Make one territory work before opening the next.</span></section><div className="playbook-grid">{[
    { icon: Target, title: 'Start with an anchor customer', copy: 'Prioritise a few restaurants and caterers with predictable weekly demand. Learn their product mix, cuts, timing and payment expectations before committing supply.' },
    { icon: Wallet, title: 'Protect your cash flow', copy: 'Agree payment terms before delivery. Set customer credit limits, review overdue balances weekly and keep supplier obligations separate from customer receivables.' },
    { icon: Package, title: 'Treat freshness as a workflow', copy: 'Capture intake checks, batch references, temperatures, expiry and wastage. Use first-expiry-first-out and verify appropriate handling with local food-safety guidance.' },
    { icon: CircleDollarSign, title: 'Measure the true cost', copy: 'Track purchasing, processing yield, labour, packaging, delivery, returns and wastage. Sales value is not profit. Calculate contribution per product and delivery route.' },
    { icon: Truck, title: 'Grow route density', copy: 'Cluster deliveries by neighbourhood and delivery window. Scale a territory when recurring demand, cold-chain capacity and route economics justify it—not just when leads increase.' },
    { icon: Sprout, title: 'Build supplier resilience', copy: 'Develop backup farmers and suppliers, agree quality specifications and maintain receiving records. Separate raw input weight from sellable processed yield.' },
  ].map(item => <article className="panel playbook-item" key={item.title}><span className="playbook-icon"><item.icon size={22} /></span><h3>{item.title}</h3><p>{item.copy}</p></article>)}</div><section className="panel roadmap-panel"><div><span className="eyebrow">A FOCUSED ROADMAP</span><h2>Supply first. Software with purpose.</h2><p>This first version covers records, sourcing, stock lots, sales, collections, outlets, local leads and WhatsApp requests. Build the restaurant ERP around real customer workflows after the supply operation is reliable.</p></div><ol><li><span>01</span><div><strong>Strengthen your operations</strong>Processing yield, inventory allocation, credit controls, pricing agreements, invoicing and audit trails.</div></li><li><span>02</span><div><strong>Connect restaurant kitchens</strong>Recipe costing, purchasing, kitchen stock, waste, POS integration and role-based teams.</div></li><li><span>03</span><div><strong>Support caterers & scale territories</strong>Event menus, portion planning, job costing, capacity planning and multiple territory reporting.</div></li></ol></section><div className="info-note"><BookOpen size={18} /> Before trading, confirm local licensing, food safety, transport, tax and invoicing requirements with qualified local advisers. This playbook is a planning aid, not jurisdiction-specific advice.</div></div>
}
