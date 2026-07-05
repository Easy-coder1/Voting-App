const APP = process.argv[2] || 'http://localhost:4173'
const html = await (await fetch(`${APP}/pages/admin/dashboard.html`)).text()
const m = html.match(/adminDashboard-[\w]+\.js/)
if (!m) throw new Error('bundle not found')
const js = await (await fetch(`${APP}/assets/${m[0]}`)).text()
const old = js.includes("count: 'exact', head: true") || js.includes('count:"exact",head:!0')
console.log('Bundle:', m[0])
console.log('Old bug present:', old)
console.log('Fix deployed:', !old && js.includes('runoff_votes') && js.includes('position_id'))
