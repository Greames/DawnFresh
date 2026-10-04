import type { Config } from '@netlify/functions'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { franchises, records } from '../../db/schema.js'
import { allowed, resolveAccess, sameOrigin } from '../../db/access.js'
import { distance, validRadius } from '../../src/lib/business.js'

const searches: Record<string, { type: string; segment: string }> = {
  restaurant: { type: 'restaurant', segment: 'Restaurant' },
  caterer: { type: 'catering_service', segment: 'Caterer' },
  hotel: { type: 'hotel', segment: 'Hotel' },
}
// "all" runs one search per business type so each type gets its own 20 results.
const categories: Record<string, string[]> = { all: ['restaurant', 'caterer', 'hotel'], restaurant: ['restaurant'], caterer: ['caterer'], hotel: ['hotel'] }
type Place = { id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; googleMapsUri?: string; internationalPhoneNumber?: string }

async function search(key: string, type: string, rank: 'DISTANCE' | 'POPULARITY', latitude: number, longitude: number, radius: number) {
  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.internationalPhoneNumber' },
    body: JSON.stringify({ includedTypes: [type], maxResultCount: 20, rankPreference: rank, locationRestriction: { circle: { center: { latitude, longitude }, radius: radius * 1000 } } }),
    signal: AbortSignal.timeout(7000), // Netlify stops functions after 10 seconds
  })
  if (!response.ok) throw new Error('provider')
  const data = await response.json()
  return (Array.isArray(data.places) ? data.places : []) as Place[]
}

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  let access
  try { access = await resolveAccess(req) }
  catch { return Response.json({ error: 'Discovery is temporarily unavailable. Try again or add leads manually.' }, { status: 503 }) }
  if ('error' in access) return Response.json({ error: access.error === 'Sign in to access business records.' ? 'Sign in to discover businesses.' : access.error }, { status: access.status })
  if (!allowed(access, 'leads', 'edit')) return Response.json({ error: 'You need edit access to customers and leads to discover businesses.' }, { status: 403 })
  if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 })
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return Response.json({ error: 'Live discovery is not connected. Add GOOGLE_PLACES_API_KEY in Netlify, enable Places API (New), and redeploy. You can add leads manually now.', code: 'not_configured' }, { status: 503 })
  try {
    const body = await req.json()
    const types = categories[String(body?.category || 'all')]
    if (!types) return Response.json({ error: 'Choose restaurants, caterers or hotels.' }, { status: 400 })
    const rank = body?.rank === 'popularity' ? 'POPULARITY' : 'DISTANCE'
    // A franchise always searches its own allocated location and radius; the client cannot move it.
    let franchise = access.role === 'franchisee' ? access.franchise ?? undefined : undefined
    if (!franchise && typeof body?.franchiseId === 'string' && body.franchiseId) {
      if (!/^[0-9a-f-]{36}$/i.test(body.franchiseId)) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400 })
      ;[franchise] = await db.select().from(franchises).where(eq(franchises.id, body.franchiseId))
      if (!franchise) return Response.json({ error: 'Choose a valid franchise.' }, { status: 400 })
    }
    const latitude = franchise ? Number(franchise.data.latitude) : body?.latitude
    const longitude = franchise ? Number(franchise.data.longitude) : body?.longitude
    const radius = franchise ? Number(franchise.data.radius) : body?.radius
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !validRadius(radius)) return Response.json({ error: 'Set valid territory coordinates and a radius between 1 and 50 km.' }, { status: 400 })
    let results: { place: Place; segment: string }[][]
    try { results = await Promise.all(types.map(async type => (await search(key, searches[type].type, rank, latitude, longitude, radius)).map(place => ({ place, segment: searches[type].segment })))) }
    catch { return Response.json({ error: 'The business provider could not complete discovery. Check API access and billing in Google Cloud.' }, { status: 502 }) }
    // A place can match several types (e.g. a hotel restaurant); keep the first.
    const unique = new Map<string, { place: Place; segment: string }>()
    for (const result of results.flat()) if (typeof result.place.id === 'string' && result.place.location && !unique.has(result.place.id)) unique.set(result.place.id, result)
    const ids = [...unique.keys()]
    const saved = ids.length ? await db.select({ placeId: sql<string>`${records.data}->>'placeId'`, franchiseId: records.franchiseId }).from(records).where(and(eq(records.kind, 'leads'), inArray(sql`${records.data}->>'placeId'`, ids))) : []
    const territoryId = franchise?.id ?? null
    const center = { latitude, longitude }
    const places = [...unique.values()].map(({ place, segment }) => {
      const lead = saved.find(row => row.placeId === place.id)
      return { ...place, segment, distanceKm: Math.round(distance(place.location!.latitude, place.location!.longitude, center) * 10) / 10, saved: lead ? (lead.franchiseId === territoryId ? 'here' : 'elsewhere') : undefined }
    }).filter(place => place.distanceKm <= radius).sort((a, b) => a.distanceKm - b.distanceKm)
    return Response.json({ places, radius, notice: `Powered by Google. Up to 20 results per business type within ${radius} km; this is not a complete business directory.` }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Discovery is temporarily unavailable. Try again or add leads manually.' }, { status: 503 })
  }
}

export const config: Config = { path: '/api/discover' }
