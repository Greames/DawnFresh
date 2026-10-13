import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const realDb = path.join(root, 'db', 'index')
const testDb = pathToFileURL(path.join(root, 'tests', 'helpers', 'test-db.ts')).href

export async function resolve(specifier, context, next) {
  if (context.parentURL && specifier.startsWith('.')) {
    const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier).replace(/\.(js|ts)$/, '')
    if (target === realDb) return { url: testDb, shortCircuit: true }
  }
  return next(specifier, context)
}
