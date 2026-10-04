import type { Config } from '@netlify/functions'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises, records } from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'

const categories: Record<string, { types: string[]; segment: string }> = {
  restaurant: { types: ['restaurant'], segment: 'Restaurant' },
  caterer: { types: ['catering_service'], segment: 'Caterer' },
  hotel: { types: ['hotel'], segment: 'Hotel' },
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const access = await resolveAccess()
  if ('error' in access) return Response.json({ error: access.error === 'Sign in to access business records.' ? 'Sign in to discover businesses.' : access.error }, { status: access.status })
  if (!allowed(access, 'leads', 'edit')) return Response.json({ error: 'You need edit access to customers and leads to discover businesses.' }, { status: 403 })
  if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 })
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return Response.json({ error: 'Live discovery is not connected. Add GOOGLE_PLACES_API_KEY in Netlify, enable Places API (New), and redeploy. You can add leads manually now.' }, { status: 503 })
  try {
    const body = await req.json()
    const category = categories[String(body?.category || 'restaurant')]
    if (!category) return Response.json({ error: 'Choose restaurants, caterers or hotels.' }, { status: 400 })
    // A franchise always searches its own allocated territory; the client cannot move it.
    let franchise = access.role === 'franchisee' ? access.franchise ?? undefined : undefined
    if (!franchise && typeof body?.franchiseId === 'string' && body.franchiseId) {
      if (!/^[0-9a-f-]{36}$/i.test(body.franchiseId)) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400 })
      ;[franchise] = await db.select().from(franchises).where(eq(franchises.id, body.franchiseId))
      if (!franchise) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400 })
    }
    const latitude = franchise ? Number(franchise.data.latitude) : body?.latitude
    const longitude = franchise ? Number(franchise.data.longitude) : body?.longitude
    const radius = franchise ? Number(franchise.data.radius) : body?.radius
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(radius) || radius < 20 || radius > 30) return Response.json({ error: 'Set valid territory coordinates and a radius between 20 and 30 km.' }, { status: 400 })
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.internationalPhoneNumber' },
      body: JSON.stringify({ includedTypes: category.types, maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude, longitude }, radius: radius * 1000 } } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return Response.json({ error: 'The business provider could not complete discovery. Check API access and billing in Google Cloud.' }, { status: 502 })
    const data = await response.json()
    const places: { id: string }[] = Array.isArray(data.places) ? data.places : []
    const ids = places.map(place => place.id).filter(id => typeof id === 'string')
    const saved = ids.length ? await db.select({ placeId: sql<string>`${records.data}->>'placeId'`, franchiseId: records.franchiseId }).from(records).where(and(eq(records.kind, 'leads'), inArray(sql`${records.data}->>'placeId'`, ids))) : []
    const territoryId = franchise?.id ?? null
    const marked = places.map(place => {
      const lead = saved.find(row => row.placeId === place.id)
      return { ...place, segment: category.segment, saved: lead ? (lead.franchiseId === territoryId ? 'here' : 'elsewhere') : undefined }
    })
    return Response.json({ places: marked, notice: 'Powered by Google. Up to 20 nearby results per category; this is not a complete business directory.' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Discovery is temporarily unavailable. Try again or add leads manually.' }, { status: 503 })
  }
}

export const config: Config = { path: '/api/discover' }
