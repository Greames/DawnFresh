export type Kind = 'orders' | 'leads' | 'sourcing' | 'inventory' | 'outlets' | 'supply'
export type BusinessData = {
  name: string
  status: string
  product?: string
  quantity?: number
  unit?: string
  amount?: number
  paid?: number
  cost?: number
  phone?: string
  note?: string
  date?: string
  expiry?: string
  temperature?: number
  latitude?: number
  longitude?: number
  outlet?: string
  batch?: string
  segment?: string
  placeId?: string
}
export type BusinessRecord = { id: string; kind: Kind; data: BusinessData; createdAt: string; franchiseId?: string | null }
export type Franchise = { id: string; name: string; email: string; phone?: string; location: string; latitude: number; longitude: number; radius: number; status: string; note?: string; createdAt?: string }
export type FranchiseLogins = { users: number; active: number; lastSignInAt?: string }
export type Module = 'orders' | 'leads' | 'inventory' | 'sourcing' | 'outlets' | 'supply' | 'franchises'
export type AccessLevel = 'none' | 'view' | 'edit'
export type Role = 'admin' | 'staff' | 'franchisee'
export type Permissions = Record<Module, AccessLevel>
export type AccessProfile = { id: string; role: Role; permissions: Permissions; name?: string; email?: string }
export type AppUser = { id: string; email: string; name?: string; role: Role; franchiseId?: string | null; permissions: Partial<Permissions>; status: string; createdAt?: string; lastSeenAt?: string | null; hasPassword?: boolean; locked?: boolean }
export const modules: { id: Module; label: string; short: string; detail: string }[] = [
  { id: 'orders', short: 'Orders', label: 'Orders & deliveries', detail: 'Customer orders, payments received and the delivery view' },
  { id: 'leads', short: 'Leads', label: 'Customers, leads & territory', detail: 'Leads, conversions and business discovery' },
  { id: 'supply', short: 'Supply', label: 'Franchise supply', detail: 'Stock supplied by the company to franchises' },
  { id: 'inventory', short: 'Inventory', label: 'Inventory', detail: 'Stock lots, batches and expiry' },
  { id: 'sourcing', short: 'Sourcing', label: 'Sourcing', detail: 'Farmer and supplier purchases' },
  { id: 'outlets', short: 'Outlets', label: 'Outlets', detail: 'Processing unit, retail and mobile outlets' },
  { id: 'franchises', short: 'Network', label: 'Franchise network', detail: 'Franchise locations and results' },
]
export const roles: { id: Role; label: string; detail: string }[] = [
  { id: 'admin', label: 'Admin', detail: 'Full access, business settings, and users & access' },
  { id: 'staff', label: 'Company staff', detail: 'Company records, limited by the permissions below' },
  { id: 'franchisee', label: 'Franchisee', detail: 'One franchise only: its orders, leads and stock requests' },
]
export const accessLevels: { id: AccessLevel; label: string }[] = [{ id: 'none', label: 'No access' }, { id: 'view', label: 'View' }, { id: 'edit', label: 'Edit' }]
export const userStatuses = ['Active', 'Disabled']
export const roleModules: Record<Role, Module[]> = {
  admin: modules.map(module => module.id),
  staff: modules.map(module => module.id),
  franchisee: ['orders', 'leads', 'supply'],
}
// Stored permissions are sparse; anything missing falls back to the role default.
export function resolvePermissions(role: Role, stored: Partial<Record<string, unknown>> = {}): Permissions {
  return Object.fromEntries(modules.map(({ id }) => {
    if (role === 'admin') return [id, 'edit']
    if (!roleModules[role].includes(id)) return [id, 'none']
    const value = stored[id]
    if (value === 'none' || value === 'view' || value === 'edit') return [id, value]
    return [id, role === 'staff' && id === 'franchises' ? 'view' : 'edit']
  })) as Permissions
}
export function can(permissions: Permissions | undefined, module: Module, level: 'view' | 'edit') {
  const granted = permissions?.[module] || 'none'
  return level === 'view' ? granted !== 'none' : granted === 'edit'
}
export type Center = { latitude: number; longitude: number }
export const FRANCHISE_RADIUS_KM = 20
// Google Places nearby search allows a circle of at most 50 km.
export const MAX_RADIUS_KM = 50
export const radiusOptions = [5, 10, 15, 20, 25, 30, 40, 50]
export function validRadius(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_RADIUS_KM
}
export const franchiseStatuses = ['Active', 'Inactive']
export const segments = ['Restaurant', 'Caterer', 'Hotel', 'Other']
export const discoveryCategories = [
  { id: 'all', label: 'Restaurants, caterers & hotels', segment: '' },
  { id: 'restaurant', label: 'Restaurants', segment: 'Restaurant' },
  { id: 'caterer', label: 'Caterers', segment: 'Caterer' },
  { id: 'hotel', label: 'Hotels', segment: 'Hotel' },
] as const
export type Settings = { company: string; currency: string; whatsapp: string; location: string; latitude: number; longitude: number; radius: number }
export const defaultSettings: Settings = { company: 'FreshRoute', currency: 'INR', whatsapp: '', location: '', latitude: 0, longitude: 0, radius: 25 }
export const products = [
  { name: 'Chicken', subtitle: 'Whole birds & custom cuts', emoji: '🍗', color: '#fff0e8', description: 'Whole chicken, curry cuts, boneless and restaurant-ready portions.' },
  { name: 'Mutton', subtitle: 'Premium, precisely portioned', emoji: '🥩', color: '#fbe8e9', description: 'Bone-in cuts, boneless portions and custom bulk requirements.' },
  { name: 'Eggs', subtitle: 'Farm-sourced, kitchen-ready', emoji: '🥚', color: '#f6efdc', description: 'Fresh eggs by the tray for breakfast service, baking and everyday cooking.' },
  { name: 'Fish', subtitle: 'Fresh catch, clean cuts', emoji: '🐟', color: '#e7f1f9', description: 'Whole fish, cleaned portions and fillets. Varieties subject to availability.' },
  { name: 'Prawns', subtitle: 'Sorted to your specification', emoji: '🦐', color: '#faece4', description: 'Size-graded prawns with whole, peeled and cleaned options.' },
]
export const statusOptions: Record<Kind, string[]> = {
  orders: ['Pending', 'Processing', 'Ready', 'Out for delivery', 'Delivered', 'Cancelled'],
  leads: ['New lead', 'Contacted', 'Qualified', 'Customer'],
  sourcing: ['Planned', 'Ordered', 'Received'],
  inventory: ['Available', 'Low stock', 'On hold'],
  outlets: ['Active', 'Inactive'],
  supply: ['Requested', 'Confirmed', 'Dispatched', 'Delivered', 'Cancelled'],
}
export const franchiseKinds: Kind[] = ['orders', 'leads', 'supply']
export function dateOffset(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function demoRecords(): BusinessRecord[] {
  const rows: { kind: Kind; data: BusinessData }[] = [
    { kind: 'orders', data: { name: 'The Urban Kitchen', product: 'Chicken', quantity: 45, unit: 'kg', amount: 12600, paid: 12600, status: 'Delivered', date: dateOffset(0), outlet: 'Central processing unit' } },
    { kind: 'orders', data: { name: 'Spice & Soul', product: 'Mutton', quantity: 20, unit: 'kg', amount: 15800, paid: 5000, status: 'Out for delivery', date: dateOffset(0), outlet: 'Central processing unit' } },
    { kind: 'orders', data: { name: 'Celebration Caterers', product: 'Chicken', quantity: 80, unit: 'kg', amount: 21600, paid: 10800, status: 'Processing', date: dateOffset(0), outlet: 'Central processing unit' } },
    { kind: 'orders', data: { name: 'Coastal Table', product: 'Prawns', quantity: 18, unit: 'kg', amount: 11700, paid: 0, status: 'Pending', date: dateOffset(0), outlet: 'Retail outlet' } },
    { kind: 'orders', data: { name: 'Morning Glory Café', product: 'Eggs', quantity: 15, unit: 'trays', amount: 3150, paid: 3150, status: 'Delivered', date: dateOffset(-1) } },
    { kind: 'orders', data: { name: 'Harbour House', product: 'Fish', quantity: 35, unit: 'kg', amount: 14700, paid: 14700, status: 'Delivered', date: dateOffset(-2) } },
    { kind: 'orders', data: { name: 'Green Leaf Banquets', product: 'Mutton', quantity: 30, unit: 'kg', amount: 23700, paid: 23700, status: 'Delivered', date: dateOffset(-3) } },
    { kind: 'orders', data: { name: 'The Urban Kitchen', product: 'Chicken', quantity: 40, unit: 'kg', amount: 11200, paid: 11200, status: 'Delivered', date: dateOffset(-4) } },
    { kind: 'orders', data: { name: 'Spice & Soul', product: 'Chicken', quantity: 25, unit: 'kg', amount: 7000, paid: 7000, status: 'Delivered', date: dateOffset(-5) } },
    { kind: 'orders', data: { name: 'Celebration Caterers', product: 'Fish', quantity: 30, unit: 'kg', amount: 12600, paid: 12600, status: 'Delivered', date: dateOffset(-6) } },
    { kind: 'leads', data: { name: 'Saffron Bistro', status: 'Qualified', note: 'Interested in daily chicken supply', latitude: 0.05, longitude: 0.02, amount: 45000 } },
    { kind: 'leads', data: { name: 'Grand Feast Catering', status: 'Contacted', note: 'Follow up on weekend requirements', latitude: -0.09, longitude: 0.07, amount: 65000 } },
    { kind: 'leads', data: { name: 'The Garden Restaurant', status: 'New lead', note: 'Introduce wholesale supply', latitude: 0.12, longitude: -0.04, amount: 28000 } },
    { kind: 'leads', data: { name: 'The Urban Kitchen', status: 'Customer', latitude: 0.03, longitude: -0.06, amount: 50000 } },
    ...products.map((product, index) => ({ kind: 'inventory' as Kind, data: { name: `${product.name} — fresh stock`, product: product.name, quantity: [245, 86, 120, 64, 18][index], unit: index === 2 ? 'trays' : 'kg', status: index === 4 ? 'Low stock' : 'Available', batch: `FR-${1008 + index}`, date: dateOffset(-1), expiry: dateOffset(index === 2 ? 6 : 1), temperature: 3, outlet: 'Central processing unit' } })),
    { kind: 'sourcing', data: { name: 'Green Valley Poultry', product: 'Chicken', quantity: 350, unit: 'kg', amount: 66500, paid: 30000, status: 'Ordered', date: dateOffset(1), note: 'Morning intake • check weight and quality' } },
    { kind: 'sourcing', data: { name: 'Riverbank Fisheries', product: 'Fish', quantity: 120, unit: 'kg', amount: 32400, paid: 32400, status: 'Received', date: dateOffset(0), note: 'Temperature and quality checked at intake' } },
    { kind: 'sourcing', data: { name: 'Meadow Farms', product: 'Eggs', quantity: 150, unit: 'trays', amount: 27000, paid: 0, status: 'Planned', date: dateOffset(2) } },
    { kind: 'outlets', data: { name: 'Central processing unit', status: 'Active', note: 'Sourcing, processing & wholesale dispatch' } },
    { kind: 'outlets', data: { name: 'Retail outlet', status: 'Active', note: 'Walk-in retail & customer pickup' } },
    { kind: 'outlets', data: { name: 'Mobile outlet', status: 'Active', note: 'Neighbourhood routes & direct retail' } },
  ]
  const franchiseRows: { kind: Kind; data: BusinessData; franchiseId: string }[] = [
    { kind: 'leads', franchiseId: 'demo-franchise-1', data: { name: 'Lakeview Grand Hotel', segment: 'Hotel', status: 'Customer', latitude: 0.17, longitude: 0.12, amount: 90000, note: 'Breakfast eggs and banquet chicken' } },
    { kind: 'leads', franchiseId: 'demo-franchise-1', data: { name: 'Northside Biryani House', segment: 'Restaurant', status: 'Qualified', latitude: 0.2, longitude: 0.07, amount: 38000, date: dateOffset(1) } },
    { kind: 'leads', franchiseId: 'demo-franchise-1', data: { name: 'Royal Events Catering', segment: 'Caterer', status: 'New lead', latitude: 0.11, longitude: 0.16, amount: 55000 } },
    { kind: 'orders', franchiseId: 'demo-franchise-1', data: { name: 'Lakeview Grand Hotel', product: 'Chicken', quantity: 60, unit: 'kg', amount: 16800, paid: 8000, status: 'Out for delivery', date: dateOffset(0) } },
    { kind: 'orders', franchiseId: 'demo-franchise-1', data: { name: 'Lakeview Grand Hotel', product: 'Eggs', quantity: 20, unit: 'trays', amount: 4200, paid: 4200, status: 'Delivered', date: dateOffset(-2) } },
    { kind: 'supply', franchiseId: 'demo-franchise-1', data: { name: 'North City franchise', product: 'Chicken', quantity: 120, unit: 'kg', amount: 26400, paid: 15000, status: 'Delivered', date: dateOffset(-1) } },
    { kind: 'supply', franchiseId: 'demo-franchise-1', data: { name: 'North City franchise', product: 'Eggs', quantity: 40, unit: 'trays', amount: 0, paid: 0, status: 'Requested', date: dateOffset(1) } },
    { kind: 'leads', franchiseId: 'demo-franchise-2', data: { name: 'Seabreeze Restaurant', segment: 'Restaurant', status: 'Contacted', latitude: -0.14, longitude: -0.06, amount: 42000 } },
    { kind: 'leads', franchiseId: 'demo-franchise-2', data: { name: 'Feast Masters Caterers', segment: 'Caterer', status: 'Customer', latitude: -0.1, longitude: -0.12, amount: 70000 } },
    { kind: 'orders', franchiseId: 'demo-franchise-2', data: { name: 'Feast Masters Caterers', product: 'Mutton', quantity: 25, unit: 'kg', amount: 19750, paid: 0, status: 'Ready', date: dateOffset(0) } },
    { kind: 'supply', franchiseId: 'demo-franchise-2', data: { name: 'South Harbour franchise', product: 'Mutton', quantity: 40, unit: 'kg', amount: 28000, paid: 28000, status: 'Dispatched', date: dateOffset(0) } },
  ]
  return [...rows, ...franchiseRows].map((row, index) => ({ franchiseId: null, ...row, id: `demo-${index + 1}`, createdAt: new Date().toISOString() }))
}
export function demoUsers(): AppUser[] {
  return [
    { id: 'demo-user-1', email: 'owner@example.com', name: 'Business owner', role: 'admin', permissions: {}, status: 'Active', hasPassword: true, lastSeenAt: new Date().toISOString() },
    { id: 'demo-user-2', email: 'dispatch@example.com', name: 'Dispatch lead', role: 'staff', permissions: { sourcing: 'view', franchises: 'none' }, status: 'Active', hasPassword: true },
    { id: 'demo-user-3', email: 'north@example.com', name: 'North City owner', role: 'franchisee', franchiseId: 'demo-franchise-1', permissions: {}, status: 'Active', hasPassword: true },
    { id: 'demo-user-4', email: 'south@example.com', name: 'South Harbour owner', role: 'franchisee', franchiseId: 'demo-franchise-2', permissions: { supply: 'view' }, status: 'Disabled', hasPassword: true },
  ]
}
export function demoFranchises(): Franchise[] {
  return [
    { id: 'demo-franchise-1', name: 'North City franchise', email: 'north@example.com', location: 'North City market', latitude: 0.2, longitude: 0.15, radius: FRANCHISE_RADIUS_KM, status: 'Active' },
    { id: 'demo-franchise-2', name: 'South Harbour franchise', email: 'south@example.com', location: 'South Harbour', latitude: -0.2, longitude: -0.15, radius: FRANCHISE_RADIUS_KM, status: 'Active' },
  ]
}
export function distance(latitude: number, longitude: number, center: Center) {
  const radians = Math.PI / 180
  const deltaLatitude = (latitude - center.latitude) * radians
  const deltaLongitude = (longitude - center.longitude) * radians
  const haversine = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(center.latitude * radians) * Math.cos(latitude * radians) * Math.sin(deltaLongitude / 2) ** 2
  const bounded = Math.min(1, Math.max(0, haversine))
  return 6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded))
}
export function money(value: number, currency: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value) }
  catch { return `${currency} ${value.toLocaleString('en')}` }
}
