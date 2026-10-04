import { getUser } from '@netlify/identity'
import type { Config } from '@netlify/functions'

export default async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const user = await getUser()
  if (!user?.roles?.some((role: string) => ['staff', 'admin'].includes(role))) return Response.json({ error: 'Staff access is required.' }, { status: 403 })
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) return new Response('Forbidden', { status: 403 })
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return Response.json({ error: 'Live discovery is not connected. Add GOOGLE_PLACES_API_KEY in Netlify, enable Places API (New), and redeploy. You can add leads manually now.' }, { status: 503 })
  try {
    const { latitude, longitude, radius } = await req.json()
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(radius) || radius < 20 || radius > 30) return Response.json({ error: 'Set valid territory coordinates and a radius between 20 and 30 km.' }, { status: 400 })
    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.internationalPhoneNumber' },
      body: JSON.stringify({ includedTypes: ['restaurant'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude, longitude }, radius: radius * 1000 } } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return Response.json({ error: 'The restaurant provider could not complete discovery. Check API access and billing in Google Cloud.' }, { status: 502 })
    const data = await response.json()
    return Response.json({ places: data.places || [], notice: 'Powered by Google. Up to 20 nearby results; this is not a complete restaurant directory.' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Discovery is temporarily unavailable. Try again or add leads manually.' }, { status: 503 })
  }
}
export const config: Config = { path: '/api/discover' }
