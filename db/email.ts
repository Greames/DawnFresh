import { eq } from 'drizzle-orm'
import { db } from './index.js'
import { settings } from './schema.js'

// Transactional email through Resend (https://resend.com). Needs RESEND_API_KEY and
// EMAIL_FROM (an address on a domain verified in Resend, e.g. "DawnFresh <login@yourdomain.com>").
export function emailEnabled() {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM
}

export function siteUrl(req: Request) {
  return (process.env.URL || new URL(req.url).origin).replace(/\/$/, '')
}

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

async function companyName() {
  try {
    const [row] = await db.select().from(settings).where(eq(settings.id, 'main'))
    return typeof row?.data.company === 'string' && row.data.company ? row.data.company : 'FreshRoute'
  } catch { return 'FreshRoute' }
}

// Returns true when the provider accepted the message. Provider errors are never echoed.
export async function sendEmail(to: string, subject: string, text: string, html: string) {
  if (!emailEnabled()) return false
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch { return false }
}

export async function sendPasswordLink(req: Request, to: string, name: string | null, token: string, purpose: 'invite' | 'reset', hours: number) {
  const company = await companyName()
  const link = `${siteUrl(req)}/?token=${token}`
  const greeting = name ? `Hello ${name},` : 'Hello,'
  const intro = purpose === 'invite'
    ? `You have been given access to the ${company} workspace. Set your password to sign in.`
    : `We received a request to reset your ${company} workspace password. If you did not ask for this, you can ignore this email.`
  const action = purpose === 'invite' ? 'Set your password' : 'Choose a new password'
  const subject = purpose === 'invite' ? `Your ${company} login` : `Reset your ${company} password`
  const expiry = `This link works once and expires in ${hours} hour${hours === 1 ? '' : 's'}. Your login email is ${to}.`
  const text = `${greeting}\n\n${intro}\n\n${action}: ${link}\n\n${expiry}\n\n${company}`
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#26362f;max-width:520px">
<p>${escape(greeting)}</p><p>${escape(intro)}</p>
<p><a href="${escape(link)}" style="display:inline-block;background:#177654;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escape(action)}</a></p>
<p style="font-size:13px;color:#6b7a70">${escape(expiry)}<br>If the button doesn't work, copy this link: ${escape(link)}</p>
<p>${escape(company)}</p></div>`
  return sendEmail(to, subject, text, html)
}
