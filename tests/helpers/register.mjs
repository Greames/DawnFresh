// Loaded with `node --import`. Fails loudly without DATABASE_URL, then redirects the app's
// db/index module to a node-postgres client for that URL so the real handlers run unchanged.
import { register } from 'node:module'

if (!process.env.DATABASE_URL) {
  console.error('\nFAIL: DATABASE_URL is not set. These tests need a LOCAL throwaway Postgres 16 database whose name contains "test".')
  console.error('Example: DATABASE_URL=postgres://postgres@localhost:5432/dawn_test pnpm test\n')
  process.exit(1)
}
register('./hooks.mjs', import.meta.url)
