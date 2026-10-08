import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const role = process.argv[2]
if (!['franchisee', 'company'].includes(role)) {
  console.error('Usage: npm run e2e:auth -- franchisee|company')
  process.exit(1)
}

const baseURL = process.env.FRESHROUTE_BASE_URL || 'https://coruscating-concha-76e38b.netlify.app'
const dir = path.resolve('e2e/.auth')
fs.mkdirSync(dir, { recursive: true })
const output = path.join(dir, role === 'franchisee' ? 'franchisee.json' : 'company.json')

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
console.log(`Log in as ${role} in the opened browser. The script will save the authenticated session after you reach the application workspace.`)
await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/sign-in'), { timeout: 10 * 60 * 1000 })
await page.context().storageState({ path: output })
console.log(`Saved authenticated session to ${output}`)
await browser.close()
