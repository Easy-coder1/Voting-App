/**
 * Production load test — concurrent Supabase reads + static page fetches.
 * Run: node scripts/load-test.mjs
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  try {
    const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
    const env = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) env[m[1].trim()] = m[2].trim()
    }
    return env
  } catch {
    return {}
  }
}

const env = loadEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const APP_URL = process.env.APP_URL || 'http://localhost:3000'

const CONCURRENCY = 50
const ROUNDS = 3

function headers() {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function timed(label, fn) {
  const start = performance.now()
  let ok = 0
  let fail = 0
  const errors = []

  const tasks = Array.from({ length: CONCURRENCY }, async (_, i) => {
    try {
      await fn(i)
      ok++
    } catch (e) {
      fail++
      if (errors.length < 5) errors.push(e.message || String(e))
    }
  })

  await Promise.all(tasks)
  const ms = Math.round(performance.now() - start)
  return { label, ok, fail, ms, rps: Math.round((ok / ms) * 1000), errors }
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

async function fetchPage(path) {
  const res = await fetch(`${APP_URL}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  await res.text()
}

async function main() {
  console.log('=== NUTFS E-Voting Load Test ===\n')
  console.log(`App URL:      ${APP_URL}`)
  console.log(`Supabase:     ${SUPABASE_URL ? 'configured' : 'MISSING'}`)
  console.log(`Concurrency:  ${CONCURRENCY} parallel requests × ${ROUNDS} rounds\n`)

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('ABORT: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not found in .env.local')
    process.exit(1)
  }

  const suites = [
    {
      label: 'GET /elections (public read)',
      fn: () => supabaseGet('elections?select=id,title,status&limit=10'),
    },
    {
      label: 'GET /positions (public read)',
      fn: () => supabaseGet('positions?select=id,position_name&limit=20'),
    },
    {
      label: 'GET /candidates (public read)',
      fn: () => supabaseGet('candidates?select=id,full_name,position_id&limit=50'),
    },
    {
      label: 'GET / (landing page)',
      fn: () => fetchPage('/'),
    },
    {
      label: 'GET /pages/login.html',
      fn: () => fetchPage('/pages/login.html'),
    },
    {
      label: 'GET /pages/member/dashboard.html',
      fn: () => fetchPage('/pages/member/dashboard.html'),
    },
  ]

  const results = []

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`--- Round ${round}/${ROUNDS} ---`)
    for (const suite of suites) {
      const r = await timed(suite.label, suite.fn)
      results.push(r)
      const status = r.fail === 0 ? 'PASS' : 'FAIL'
      console.log(
        `  [${status}] ${r.label}: ${r.ok}/${CONCURRENCY} ok in ${r.ms}ms (~${r.rps} req/s)`
      )
      if (r.errors.length) r.errors.forEach(e => console.log(`         ↳ ${e}`))
    }
    console.log()
  }

  const totalOk = results.reduce((s, r) => s + r.ok, 0)
  const totalFail = results.reduce((s, r) => s + r.fail, 0)
  const totalMs = results.reduce((s, r) => s + r.ms, 0)
  const passRate = ((totalOk / (totalOk + totalFail)) * 100).toFixed(1)

  console.log('=== Summary ===')
  console.log(`Total requests: ${totalOk + totalFail}`)
  console.log(`Success rate:   ${passRate}% (${totalOk} ok, ${totalFail} fail)`)
  console.log(`Total time:     ${totalMs}ms`)
  console.log(`Overall RPS:    ~${Math.round((totalOk / totalMs) * 1000)}`)

  if (totalFail > 0) {
    console.log('\n⚠ Some requests failed — investigate before go-live.')
    process.exit(1)
  }
  console.log('\n✓ Load test passed.')
}

main().catch(e => {
  console.error('Load test crashed:', e)
  process.exit(1)
})
