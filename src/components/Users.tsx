import { useState } from 'react'
import { Check, KeyRound, MoreHorizontal, ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react'
import { accessLevels, modules, resolvePermissions, roleModules, roles, userStatuses } from '../lib/business'
import type { AccessLevel, AppUser, Franchise, Module, PendingAccount, Role } from '../lib/business'

const roleLabel = (role: string) => roles.find(item => item.id === role)?.label || role

function accessSummary(user: AppUser) {
  if (user.role === 'admin') return 'Full access · settings · users'
  const permissions = resolvePermissions(user.role, user.permissions)
  const edit = roleModules[user.role].filter(module => permissions[module] === 'edit')
  const view = roleModules[user.role].filter(module => permissions[module] === 'view')
  const label = (list: Module[]) => list.map(module => modules.find(item => item.id === module)?.short).join(', ')
  return [edit.length && `Edit: ${label(edit)}`, view.length && `View: ${label(view)}`].filter(Boolean).join(' · ') || 'No module access'
}

function lastActive(user: AppUser) {
  const seen = user.lastSeenAt || user.login?.lastSignInAt
  if (seen) return seen.slice(0, 10)
  return user.login?.exists ? 'Not signed in yet' : 'No login yet'
}

export function UsersAccess({ users, pending, franchises, identityAvailable, add, edit }: { users: AppUser[]; pending: PendingAccount[] | null; franchises: Franchise[]; identityAvailable: boolean; add: (prefill?: PendingAccount) => void; edit: (user: AppUser) => void }) {
  const franchiseName = (id?: string | null) => franchises.find(franchise => franchise.id === id)?.name || 'Unknown franchise'
  return <>
    <div className="summary-strip"><div><span>Active users</span><strong>{users.filter(user => user.status === 'Active').length}</strong></div><div><span>Franchisee logins</span><strong>{users.filter(user => user.role === 'franchisee').length}</strong></div><div><span>Accounts waiting for access</span><strong>{pending?.length ?? '—'}</strong></div></div>
    <section className="panel records-panel">
      <div className="panel-heading"><div><h2>Users & access</h2><p>Who can sign in, their role, franchise and what they can view or edit.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>USER</th><th>ROLE</th><th>ACCESS</th><th>STATUS</th><th>LAST ACTIVE</th><th aria-label="Actions" /></tr></thead><tbody>
        {users.map((user, index) => <tr key={user.id}>
          <td><div className="customer-cell"><span className={`customer-avatar avatar-${index % 5}`}>{(user.name || user.email).slice(0, 2).toUpperCase()}</span><span><strong>{user.name || user.email.split('@')[0]}</strong><small>{user.email}</small></span></div></td>
          <td><strong className="cell-strong">{roleLabel(user.role)}</strong>{user.role === 'franchisee' && <small className="cell-sub">{franchiseName(user.franchiseId)}</small>}</td>
          <td><span className="muted access-summary">{accessSummary(user)}</span></td>
          <td><span className={`badge ${user.status === 'Active' ? 'green' : 'neutral'}`}><span />{user.status}</span></td>
          <td className="muted">{lastActive(user)}</td>
          <td><button className="icon-button" aria-label={`Edit access for ${user.email}`} onClick={() => edit(user)}><MoreHorizontal size={19} /></button></td>
        </tr>)}
      </tbody></table>{!users.length && <div className="empty-state"><UsersIcon size={30} /><h3>No users yet</h3><p>Add your team and franchisees to give them access.</p><button className="outline" onClick={() => add()}><UserPlus size={16} /> Add user</button></div>}</div>
    </section>
    {pending && pending.length > 0 && <section className="panel pending-panel"><div className="panel-heading"><div><h2>Accounts waiting for access</h2><p>These Netlify Identity accounts can sign in but have no role in this workspace yet.</p></div></div><div className="nearby-list">{pending.map(account => <article key={account.identityId}><span className="nearby-icon"><KeyRound size={18} /></span><div><strong>{account.name || account.email}</strong><small>{account.email}{account.roles.includes('admin') ? ' · owner (Netlify Identity admin)' : ''}{account.lastSignInAt ? ` · last sign-in ${account.lastSignInAt.slice(0, 10)}` : ''}</small></div><button className="text-button" onClick={() => add(account)}>Grant access <UserPlus size={14} /></button></article>)}</div></section>}
    {!identityAvailable && <div className="info-note"><KeyRound size={18} /><span>Netlify Identity account details are unavailable here, so sign-in status and waiting accounts are not shown. Access rules still apply.</span></div>}
    <div className="info-note"><ShieldCheck size={18} /><span>This table decides access. Netlify Identity only checks passwords. Accounts with the <strong>admin</strong> role in Netlify Identity are owners and always keep full access, so you can't lock yourself out.</span></div>
  </>
}

export type UserFormValues = { email: string; name: string; role: Role; franchiseId: string | null; permissions: Partial<Record<Module, AccessLevel>>; status: string; password: string }

export function UserForm({ user, prefill, franchises, busy, error, save }: { user?: AppUser; prefill?: PendingAccount; franchises: Franchise[]; busy: boolean; error: string; save: (values: UserFormValues) => void }) {
  const [role, setRole] = useState<Role>(user?.role || 'staff')
  const [permissions, setPermissions] = useState<Partial<Record<Module, AccessLevel>>>(user?.permissions || {})
  const [validation, setValidation] = useState('')
  const resolved = resolvePermissions(role, permissions)
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const text = (key: string) => String(values.get(key) || '').trim()
    const password = String(values.get('password') || '')
    if (password && password.length < 8) { setValidation('The password must be at least 8 characters.'); return }
    if (role === 'franchisee' && !text('franchiseId')) { setValidation('Choose the franchise this user works for.'); return }
    setValidation('')
    const explicit = role === 'admin' ? {} : Object.fromEntries(roleModules[role].map(module => [module, resolved[module]]))
    save({ email: user?.email || text('email'), name: text('name'), role, franchiseId: role === 'franchisee' ? text('franchiseId') : null, permissions: explicit, status: text('status'), password })
  }
  return <form onSubmit={submit} className="record-form">
    <div className="form-grid"><label>Name<input name="name" maxLength={120} defaultValue={user?.name || prefill?.name} /></label><label>Email<input name="email" type="email" required disabled={!!user} defaultValue={user?.email || prefill?.email} autoComplete="off" /></label></div>
    <div className="form-grid"><label>Role<select name="role" value={role} onChange={event => setRole(event.target.value as Role)}>{roles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{roles.find(item => item.id === role)?.detail}</small></label><label>Status<select name="status" defaultValue={user?.status || 'Active'}>{userStatuses.map(status => <option key={status}>{status}</option>)}</select></label></div>
    {role === 'franchisee' && <label>Franchise<select name="franchiseId" defaultValue={user?.franchiseId || ''} required><option value="">Choose a franchise</option>{franchises.map(franchise => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select><small>Franchisees only ever see this franchise's records.</small></label>}
    {role === 'admin' ? <p className="muted fine-print">Admins have full access to every module, business settings and users & access.</p> : <fieldset className="permission-matrix"><legend>Module permissions</legend>{roleModules[role].map(module => {
      const info = modules.find(item => item.id === module)!
      return <div className="permission-row" key={module}><span><strong>{info.label}</strong><small>{info.detail}</small></span><div className="segmented" role="radiogroup" aria-label={`${info.label} access`}>{accessLevels.map(level => <label key={level.id} className={resolved[module] === level.id ? 'is-selected' : ''}><input type="radio" name={`permission-${module}`} value={level.id} checked={resolved[module] === level.id} onChange={() => setPermissions(current => ({ ...current, [module]: level.id }))} />{level.label}</label>)}</div></div>
    })}</fieldset>}
    <label>{user ? 'Set a new password (optional)' : 'Password (optional)'}<input name="password" type="password" minLength={8} maxLength={72} autoComplete="new-password" /><small>{user ? 'Leave empty to keep the current password.' : 'Creates the login now; share it privately. Leave empty if they already have a Netlify Identity account or you will invite them from Netlify.'}</small></label>
    {(error || validation) && <p className="form-error" role="alert">{error || validation}</p>}
    <button className="primary full" disabled={busy}>{busy ? 'Saving…' : user ? 'Save access' : 'Add user'}<Check size={16} /></button>
  </form>
}
