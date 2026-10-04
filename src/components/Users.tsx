import { useState } from 'react'
import { Check, Mail, MoreHorizontal, ShieldCheck, UserPlus, Users as UsersIcon } from 'lucide-react'
import { accessLevels, modules, resolvePermissions, roleModules, roles, userStatuses } from '../lib/business'
import type { AccessLevel, AppUser, Franchise, Module, Role } from '../lib/business'

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
  if (user.locked) return 'Locked · too many attempts'
  if (!user.hasPassword) return 'Invited · password not set yet'
  return user.lastSeenAt ? user.lastSeenAt.slice(0, 10) : 'Not signed in yet'
}

export function UsersAccess({ users, franchises, currentUserId, emailEnabled, add, edit }: { users: AppUser[]; franchises: Franchise[]; currentUserId?: string; emailEnabled: boolean; add: () => void; edit: (user: AppUser) => void }) {
  const franchiseName = (id?: string | null) => franchises.find(franchise => franchise.id === id)?.name || 'Unknown franchise'
  return <>
    <div className="summary-strip"><div><span>Active users</span><strong>{users.filter(user => user.status === 'Active').length}</strong></div><div><span>Franchisee logins</span><strong>{users.filter(user => user.role === 'franchisee').length}</strong></div><div><span>Administrators</span><strong>{users.filter(user => user.role === 'admin' && user.status === 'Active').length}</strong></div></div>
    <section className="panel records-panel">
      <div className="panel-heading"><div><h2>Users & access</h2><p>Who can sign in, their role, franchise and what they can view or edit.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>USER</th><th>ROLE</th><th>ACCESS</th><th>STATUS</th><th>LAST ACTIVE</th><th aria-label="Actions" /></tr></thead><tbody>
        {users.map((user, index) => <tr key={user.id}>
          <td><div className="customer-cell"><span className={`customer-avatar avatar-${index % 5}`}>{(user.name || user.email).slice(0, 2).toUpperCase()}</span><span><strong>{user.name || user.email.split('@')[0]}{user.id === currentUserId ? ' (you)' : ''}</strong><small>{user.email}</small></span></div></td>
          <td><strong className="cell-strong">{roleLabel(user.role)}</strong>{user.role === 'franchisee' && <small className="cell-sub">{franchiseName(user.franchiseId)}</small>}</td>
          <td><span className="muted access-summary">{accessSummary(user)}</span></td>
          <td><span className={`badge ${user.status === 'Active' ? 'green' : 'neutral'}`}><span />{user.status}</span></td>
          <td className="muted">{lastActive(user)}</td>
          <td><button className="icon-button" aria-label={`Edit access for ${user.email}`} onClick={() => edit(user)}><MoreHorizontal size={19} /></button></td>
        </tr>)}
      </tbody></table>{!users.length && <div className="empty-state"><UsersIcon size={30} /><h3>No users yet</h3><p>Add your team and franchisees to give them access.</p><button className="outline" onClick={() => add()}><UserPlus size={16} /> Add user</button></div>}</div>
    </section>
    <div className="info-note"><Mail size={18} /><span>{emailEnabled ? 'Email is on: new users can be sent an invitation to set their own password, and anyone can use “Forgot password?” on the sign-in screen.' : <>Email is off, so you set passwords and share them yourself. To send invitations and password reset emails, add <strong>RESEND_API_KEY</strong> and <strong>EMAIL_FROM</strong> in Netlify and redeploy (see the README).</>}</span></div>
    <div className="info-note"><ShieldCheck size={18} /><span>Sign-in and access are both managed here, in your own database. Passwords are stored as secure one-way hashes and nobody can read them; to help someone who forgot theirs, set a new one. A new password or disabling a user signs them out everywhere. There must always be at least one active administrator.</span></div>
  </>
}

export type UserFormValues = { invite: boolean; email: string; name: string; role: Role; franchiseId: string | null; permissions: Partial<Record<Module, AccessLevel>>; status: string; password: string }

export function UserForm({ user, franchises, emailEnabled, sendLink, busy, error, save }: { user?: AppUser; franchises: Franchise[]; emailEnabled: boolean; sendLink: (user: AppUser) => void; busy: boolean; error: string; save: (values: UserFormValues) => void }) {
  const [role, setRole] = useState<Role>(user?.role || 'staff')
  const [permissions, setPermissions] = useState<Partial<Record<Module, AccessLevel>>>(user?.permissions || {})
  const [validation, setValidation] = useState('')
  const [invite, setInvite] = useState(emailEnabled)
  const resolved = resolvePermissions(role, permissions)
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const text = (key: string) => String(values.get(key) || '').trim()
    const password = String(values.get('password') || '')
    if (password && password.length < 8) { setValidation('The password must be at least 8 characters.'); return }
    if (!user && !password && !invite) { setValidation('Set a password, or email them an invitation, so this user can sign in.'); return }
    if (role === 'franchisee' && !text('franchiseId')) { setValidation('Choose the franchise this user works for.'); return }
    setValidation('')
    const explicit = role === 'admin' ? {} : Object.fromEntries(roleModules[role].map(module => [module, resolved[module]]))
    save({ invite: !user && invite, email: user?.email || text('email'), name: text('name'), role, franchiseId: role === 'franchisee' ? text('franchiseId') : null, permissions: explicit, status: text('status'), password })
  }
  return <form onSubmit={submit} className="record-form">
    <div className="form-grid"><label>Name<input name="name" maxLength={120} defaultValue={user?.name} /></label><label>Email<input name="email" type="email" required disabled={!!user} defaultValue={user?.email} autoComplete="off" /></label></div>
    <div className="form-grid"><label>Role<select name="role" value={role} onChange={event => setRole(event.target.value as Role)}>{roles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{roles.find(item => item.id === role)?.detail}</small></label><label>Status<select name="status" defaultValue={user?.status || 'Active'}>{userStatuses.map(status => <option key={status}>{status}</option>)}</select></label></div>
    {role === 'franchisee' && <label>Franchise<select name="franchiseId" defaultValue={user?.franchiseId || ''} required><option value="">Choose a franchise</option>{franchises.map(franchise => <option key={franchise.id} value={franchise.id}>{franchise.name}</option>)}</select><small>Franchisees only ever see this franchise's records.</small></label>}
    {role === 'admin' ? <p className="muted fine-print">Admins have full access to every module, business settings and users & access.</p> : <fieldset className="permission-matrix"><legend>Module permissions</legend>{roleModules[role].map(module => {
      const info = modules.find(item => item.id === module)!
      return <div className="permission-row" key={module}><span><strong>{info.label}</strong><small>{info.detail}</small></span><div className="segmented" role="radiogroup" aria-label={`${info.label} access`}>{accessLevels.map(level => <label key={level.id} className={resolved[module] === level.id ? 'is-selected' : ''}><input type="radio" name={`permission-${module}`} value={level.id} checked={resolved[module] === level.id} onChange={() => setPermissions(current => ({ ...current, [module]: level.id }))} />{level.label}</label>)}</div></div>
    })}</fieldset>}
    {!user && emailEnabled && <label className="checkbox-row"><input type="checkbox" checked={invite} onChange={event => setInvite(event.target.checked)} /> <span><strong>Email them an invitation</strong><small>They get a link to set their own password (valid 72 hours).</small></span></label>}
    {(user || !invite) && <label>{user ? 'Set a new password (optional)' : 'Password'}<input name="password" type="password" minLength={8} maxLength={128} required={!user && !invite} autoComplete="new-password" /><small>{user ? (user.locked ? 'This account is locked after failed attempts. Setting a new password unlocks it.' : 'Leave empty to keep the current password. A new password signs them out everywhere.') : 'Share it privately; they can change it from their account menu after signing in.'}</small></label>}
    {user && emailEnabled && user.status === 'Active' && <button type="button" className="outline full email-link-button" onClick={() => sendLink(user)} disabled={busy}><Mail size={15} /> {user.hasPassword ? 'Email a password reset link' : 'Resend the invitation email'}</button>}
    {(error || validation) && <p className="form-error" role="alert">{error || validation}</p>}
    <button className="primary full" disabled={busy}>{busy ? 'Saving…' : user ? 'Save access' : invite && emailEnabled ? 'Add user & send invitation' : 'Add user'}<Check size={16} /></button>
  </form>
}
