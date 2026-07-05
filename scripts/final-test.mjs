/**
 * Final intensive pre-launch test suite.
 * Run: node scripts/final-test.mjs [APP_URL]
 */
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const raw = readFileSync(resolve(root, '.env.local'), 'utf8')
  const env = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) env[m[1].trim()] = m[2].trim()
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.VITE_SUPABASE_URL
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
const APP_URL = process.argv[2] || process.env.APP_URL || 'http://localhost:4173'

const CONCURRENCY = Number(process.env.CONCURRENCY) || 100
const ROUNDS = Number(process.env.ROUNDS) || 5
const BURST = Number(process.env.BURST) || 200

function headers() {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

function pct(sorted, p) {
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))])
}

async function timed(label, fn, n = CONCURRENCY) {
  const latencies = []
  let ok = 0
  let fail = 0
  const errors = []
  const start = performance.now()

  await Promise.all(
    Array.from({ length: n }, async () => {
      const t0 = performance.now()
      try {
        await fn()
        ok++
        latencies.push(performance.now() - t0)
      } catch (e) {
        fail++
        latencies.push(performance.now() - t0)
        if (errors.length < 3) errors.push(e.message || String(e))
      }
    })
  )

  latencies.sort((a, b) => a - b)
  const ms = Math.round(performance.now() - start)
  return {
    label,
    ok,
    fail,
    n,
    ms,
    rps: Math.round((ok / ms) * 1000),
    avg: latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0,
    p50: pct(latencies, 0.5),
    p95: pct(latencies, 0.95),
    errors,
  }
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

async function fetchPage(path) {
  const res = await fetch(`${APP_URL}${path}`)
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  const text = await res.text()
  if (text.length < 100) throw new Error(`${path} → empty/short response`)
  return text
}

/** Mirrors member dashboard initial data fetch pattern */
async function simulateVoterSession() {
  await supabaseGet('elections?select=*&status=eq.open&limit=1')
  await supabaseGet('positions?select=*')
  await supabaseGet('candidates?select=*&election_id=is.null')
  await fetchPage('/pages/member/dashboard.html')
}

async function checkSupabaseHealth() {
  await supabaseGet('elections?select=id&limit=1')
  return true
}

async function checkDeployedFix() {
  const html = await fetchPage('/pages/admin/dashboard.html')
  const match = html.match(/adminDashboard-[\w]+\.js/)
  if (!match) throw new Error('admin dashboard JS bundle not found in HTML')
  const js = await (await fetch(`${APP_URL}/assets/${match[0]}`)).text()
  // Fixed runoff sync selects rows; old bug used head-only count on runoff_votes only
  if (
    js.includes("from('runoff_votes').select('*', { count: 'exact', head: true })") ||
    js.includes('from("runoff_votes").select("*",{count:"exact",head:!0})')
  ) {
    throw new Error('old adminVote runoff lockout logic still present')
  }
  const runoffSyncOk =
    js.includes('runoff_votes') &&
    js.includes('position_id') &&
    js.includes('candidate_id') &&
    (js.includes('>=y.length') || js.includes('>=positions.length'))
  if (!runoffSyncOk) {
    throw new Error('full-ballot runoff restore logic missing from admin bundle')
  }
  return { bundle: match[0] }
}

function printResult(r) {
  const status = r.fail === 0 ? 'PASS' : 'FAIL'
  console.log(
    `  [${status}] ${r.label}: ${r.ok}/${r.n} ok | wall ${r.ms}ms | ~${r.rps} rps | avg ${r.avg}ms p50 ${r.p50}ms p95 ${r.p95}ms`
  )
  r.errors.forEach(e => console.log(`         ↳ ${e}`))
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║     NUTFS E-VOTING — FINAL INTENSIVE TEST        ║')
  console.log('╚══════════════════════════════════════════════════╝\n')
  console.log(`Target app:   ${APP_URL}`)
  console.log(`Supabase:     ${SUPABASE_URL?.replace(/https:\/\/([^.]+).*/, 'https://$1.***')}`)
  console.log(`Concurrency:  ${CONCURRENCY} | Rounds: ${ROUNDS}\n`)

  if (!SUPABASE_URL || !ANON_KEY) {
    console.error('ABORT: missing Supabase credentials in .env.local')
    process.exit(1)
  }

  const allResults = []
  let checks = []

  // ── Phase 1: Pre-flight checks ──────────────────────────────
  console.log('── Phase 1: Pre-flight checks ──')
  try {
    await checkSupabaseHealth()
    console.log('  [PASS] Supabase REST API reachable')
    checks.push(['Supabase health', true])
  } catch (e) {
    console.log(`  [FAIL] Supabase REST API: ${e.message}`)
    checks.push(['Supabase health', false])
  }

  try {
    const fix = await checkDeployedFix()
    console.log(`  [PASS] adminVote fix present in bundle (${fix.bundle})`)
    checks.push(['adminVote fix deployed', true])
  } catch (e) {
    console.log(`  [FAIL] adminVote fix check: ${e.message}`)
    checks.push(['adminVote fix deployed', false])
  }

  try {
    const page = await fetchPage('/pages/login.html')
    const misconfigured = page.includes('disabled') && page.includes('not configured')
    if (misconfigured) throw new Error('login page shows misconfiguration state')
    console.log('  [PASS] Login page loads (Supabase env baked in)')
    checks.push(['Login page', true])
  } catch (e) {
    console.log(`  [FAIL] Login page: ${e.message}`)
    checks.push(['Login page', false])
  }

  // Check elections state
  try {
    const elections = await supabaseGet('elections?select=id,title,status,results_published&order=created_at.desc&limit=5')
    const open = elections.filter(e => e.status === 'open')
    const published = elections.filter(e => e.results_published)
    console.log(`  [INFO] Elections in DB: ${elections.length} recent | open: ${open.length} | published: ${published.length}`)
    if (open.length > 1) {
      console.log('  [WARN] More than one open election — DB constraint should prevent this')
    }
    if (open.length === 0) {
      console.log('  [INFO] No open election yet — remember to set status=open before polls')
    } else {
      console.log(`  [INFO] Open election: "${open[0].title}"`)
    }
    checks.push(['Elections query', true])
  } catch (e) {
    console.log(`  [FAIL] Elections query: ${e.message}`)
    checks.push(['Elections query', false])
  }

  try {
    const candidates = await supabaseGet('candidates?select=id&election_id=is.null')
    const positions = await supabaseGet('positions?select=id')
    console.log(`  [INFO] Global candidates: ${candidates.length} | Positions: ${positions.length}`)
    if (candidates.length === 0) console.log('  [WARN] No global candidates — add before opening polls')
    checks.push(['Candidates/positions', true])
  } catch (e) {
    console.log(`  [FAIL] Candidates/positions: ${e.message}`)
    checks.push(['Candidates/positions', false])
  }

  console.log()

  // ── Phase 2: Intensive load ─────────────────────────────────
  console.log(`── Phase 2: Load test (${CONCURRENCY} concurrent × ${ROUNDS} rounds) ──`)

  const suites = [
    { label: 'Supabase: elections', fn: () => supabaseGet('elections?select=id,title,status&limit=10') },
    { label: 'Supabase: positions', fn: () => supabaseGet('positions?select=id,position_name') },
    { label: 'Supabase: candidates', fn: () => supabaseGet('candidates?select=id,full_name,position_id&limit=100') },
    { label: 'Static: landing', fn: () => fetchPage('/') },
    { label: 'Static: login', fn: () => fetchPage('/pages/login.html') },
    { label: 'Static: register', fn: () => fetchPage('/pages/register.html') },
    { label: 'Static: member dashboard', fn: () => fetchPage('/pages/member/dashboard.html') },
    { label: 'Static: admin dashboard', fn: () => fetchPage('/pages/admin/dashboard.html') },
    { label: 'Voter session (API+page)', fn: simulateVoterSession, n: 30 },
  ]

  for (let round = 1; round <= ROUNDS; round++) {
    console.log(`  Round ${round}/${ROUNDS}:`)
    for (const suite of suites) {
      const r = await timed(suite.label, suite.fn, suite.n ?? CONCURRENCY)
      allResults.push(r)
      printResult(r)
    }
    console.log()
  }

  // ── Phase 3: Burst test ─────────────────────────────────────
  console.log(`── Phase 3: Burst (${BURST} simultaneous election lookups) ──`)
  const burst = await timed(
    'Burst: open election check',
    () => supabaseGet('elections?select=id,title,status&status=eq.open&limit=1'),
    BURST
  )
  allResults.push(burst)
  printResult(burst)
  console.log()

  // ── Summary ─────────────────────────────────────────────────
  const totalOk = allResults.reduce((s, r) => s + r.ok, 0)
  const totalFail = allResults.reduce((s, r) => s + r.fail, 0)
  const totalMs = allResults.reduce((s, r) => s + r.ms, 0)
  const passRate = ((totalOk / (totalOk + totalFail)) * 100).toFixed(1)
  const preflightPass = checks.every(([, ok]) => ok)

  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║                    FINAL REPORT                  ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`Pre-flight checks:  ${checks.filter(([,o])=>o).length}/${checks.length} passed`)
  console.log(`Load requests:      ${totalOk + totalFail} total`)
  console.log(`Load success rate:  ${passRate}% (${totalFail} failures)`)
  console.log(`Aggregate RPS:      ~${Math.round((totalOk / totalMs) * 1000)}`)
  console.log(`Burst p95 latency:  ${burst.p95}ms`)

  const go = preflightPass && totalFail === 0
  console.log()
  if (go) {
    console.log('✅ GO — All intensive tests passed. Ready for voting.')
  } else {
    console.log('❌ NO-GO — Fix failures above before opening polls.')
    process.exit(1)
  }
}

main().catch(e => {
  console.error('Test suite crashed:', e)
  process.exit(1)
})
