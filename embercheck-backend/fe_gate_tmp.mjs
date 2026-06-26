import { chromium } from 'playwright'
import fs from 'fs'

const APP = 'http://127.0.0.1:5173'
const fx = JSON.parse(fs.readFileSync('C:/tmp/fixtures.json', 'utf8'))
const SHOT = 'C:/tmp/shots'
fs.mkdirSync(SHOT, { recursive: true })

function log(...a) { console.log(...a) }
function ok(cond, msg) { log((cond ? 'PASS' : 'FAIL') + ' — ' + msg); if (!cond) process.exitCode = 1 }

// Seed a logged-in session: put the refresh token in localStorage, then load the
// app so AuthContext bootstraps (refresh -> getMe). Returns a page with network
// capture attached.
async function sessionPage(browser, refresh, hash = '') {
  const ctx = await browser.newContext()
  // Seed the refresh token BEFORE any app script runs, so the app's first render
  // already sees a session (hasSession=true) and honours the boot hash. Mirrors a
  // real returning user who logged in previously.
  await ctx.addInitScript((rt) => {
    // Seed only if absent — the app rotates the refresh token on every use and
    // persists the new one; don't clobber it back to the stale original on reload.
    try {
      const k = 'embercheck.refresh_token'
      if (!localStorage.getItem(k)) localStorage.setItem(k, rt)
    } catch { /* noop */ }
  }, refresh)
  const page = await ctx.newPage()
  const reqs = []
  page.on('request', (r) => {
    if (r.url().includes('/assessor/')) reqs.push({ method: r.method(), url: r.url().replace(APP, ''), ct: r.headers()['content-type'] })
  })
  await page.goto(APP + (hash || ''))
  return { ctx, page, reqs }
}

const browser = await chromium.launch()
try {
  // ───────── 1. Entry point: UserMenu item -> screen + hash ─────────
  log('\n=== [1] Entry point via UserMenu ===')
  {
    const { ctx, page } = await sessionPage(browser, fx.a.refresh)
    await page.waitForSelector('button[aria-haspopup="menu"]', { timeout: 15000 })
    await page.click('button[aria-haspopup="menu"]')
    const item = page.getByRole('menuitem', { name: /become an accredited assessor/i })
    ok(await item.count() > 0, 'menu shows "Become an accredited assessor"')
    await item.click()
    await page.waitForTimeout(800)
    const hash = await page.evaluate(() => location.hash)
    ok(hash === '#/become-assessor', `URL hash is #/become-assessor (got ${hash})`)
    ok(await page.getByRole('heading', { name: /become an accredited assessor/i }).count() > 0, 'registration screen opened')
    await page.screenshot({ path: SHOT + '/1_form.png', fullPage: true })
    await ctx.close()
  }

  // ───────── 2. New applicant -> form -> register + documents -> pending; refresh persists ─────────
  log('\n=== [2] New applicant: submit -> pending, two requests, refresh persists ===')
  {
    const { ctx, page, reqs } = await sessionPage(browser, fx.a.refresh, '#/become-assessor')
    await page.waitForSelector('text=Operating LGAs', { timeout: 15000 })
    // Fill required fields (label-based)
    const set = async (label, val) => {
      const f = page.locator(`label:has-text("${label}")`).locator('xpath=following-sibling::*[1]')
      await f.first().fill(val)
    }
    // inputs are inside the Field wrapper; target by surrounding label text via nearby input
    await page.getByLabel('Legal first name', { exact: false }).fill('Alex').catch(() => {})
    // Fallback: fill by order using placeholder/role since custom Field has no htmlFor
    const inputs = page.locator('form input[type="text"], form input:not([type])')
    // Robust: fill by section using locator chains
    async function fillByLabel(text, val, tag = 'input') {
      const block = page.locator(`label:has-text("${text}")`).first().locator('xpath=..')
      await block.locator(tag).first().fill(val)
    }
    await fillByLabel('Legal first name', 'Alex')
    await fillByLabel('Legal last name', 'Rivers')
    await fillByLabel('Phone', '0400111222')
    await fillByLabel('Business name', 'Rivers Fire Assessments')
    await fillByLabel('Accreditation number', 'BPAD-9001')
    await fillByLabel('Accreditation level', '3')
    await page.locator('label:has-text("Accreditation expiry")').first().locator('xpath=..').locator('input[type="date"]').fill('2027-06-01')
    await fillByLabel('Operating LGAs', 'Blue Mountains\nLithgow', 'textarea')
    await fillByLabel('Base address', '10 Ridge Rd, Katoomba NSW')
    // operating states: click NSW pill
    await page.getByRole('button', { name: 'NSW', exact: true }).click()
    // attach a PDF
    await page.locator('input[type="file"]').first().setInputFiles('C:/tmp/cert.pdf')
    await page.waitForTimeout(300)
    await page.screenshot({ path: SHOT + '/2a_filled.png', fullPage: true })

    await page.getByRole('button', { name: /submit application/i }).click()
    // wait for pending state
    await page.waitForSelector('text=/pending review/i', { timeout: 15000 })
    ok(true, 'landed on "pending review" after submit')
    await page.screenshot({ path: SHOT + '/2b_pending.png', fullPage: true })

    // network order: register (json) then documents (multipart)
    const reg = reqs.find((r) => r.url.endsWith('/assessor/register') && r.method === 'POST')
    const doc = reqs.find((r) => r.url.endsWith('/assessor/documents') && r.method === 'POST')
    log('  captured assessor requests:', JSON.stringify(reqs, null, 0))
    ok(!!reg && reg.ct && reg.ct.includes('application/json'), 'POST /assessor/register sent as JSON')
    ok(!!doc && doc.ct && doc.ct.includes('multipart/form-data') && /boundary=/.test(doc.ct), 'POST /assessor/documents sent as multipart with browser boundary')
    ok(reqs.indexOf(reg) < reqs.indexOf(doc), 'register fired before documents')

    // refresh persists pending (GET /assessor/me now returns PENDING -> status, not form)
    await page.reload()
    await page.waitForSelector('text=/pending review/i', { timeout: 15000 })
    const formGone = await page.getByRole('button', { name: /submit application/i }).count()
    ok(formGone === 0, 'after refresh: pending state shown, form NOT shown')
    await page.screenshot({ path: SHOT + '/2c_refresh_pending.png', fullPage: true })
    await ctx.close()
  }

  // ───────── 3. Validation blocks bad input (no network) ─────────
  log('\n=== [3] Validation: blank required + bad ABN, no network call ===')
  {
    const { ctx, page, reqs } = await sessionPage(browser, fx.b.refresh, '#/become-assessor')
    await page.waitForSelector('text=Operating LGAs', { timeout: 15000 })
    // submit immediately (all blank)
    await page.getByRole('button', { name: /submit application/i }).click()
    await page.waitForSelector('text=/required fields/i', { timeout: 5000 })
    ok(true, 'blank submit shows inline "required fields" error')
    const postReqs1 = reqs.filter((r) => r.method === 'POST')
    ok(postReqs1.length === 0, 'no POST /assessor/* fired on blank submit')

    // fill required + a bad ABN
    async function fillByLabel(text, val, tag = 'input') {
      const block = page.locator(`label:has-text("${text}")`).first().locator('xpath=..')
      await block.locator(tag).first().fill(val)
    }
    await fillByLabel('Legal first name', 'Bad')
    await fillByLabel('Legal last name', 'Abn')
    await fillByLabel('Phone', '0400000000')
    await fillByLabel('Business name', 'Test Co')
    await fillByLabel('ABN', '123')  // malformed
    await fillByLabel('Accreditation number', 'X1')
    await fillByLabel('Accreditation level', '2')
    await page.locator('label:has-text("Accreditation expiry")').first().locator('xpath=..').locator('input[type="date"]').fill('2027-01-01')
    await fillByLabel('Operating LGAs', 'Lithgow', 'textarea')
    await fillByLabel('Base address', '1 St')
    await page.getByRole('button', { name: 'NSW', exact: true }).click()
    await page.getByRole('button', { name: /submit application/i }).click()
    await page.waitForSelector('text=/ABN must be 11 digits/i', { timeout: 5000 })
    ok(true, 'malformed ABN shows client-side error')
    const postReqs2 = reqs.filter((r) => r.method === 'POST')
    ok(postReqs2.length === 0, 'still no POST /assessor/* fired (client-blocked)')
    await page.screenshot({ path: SHOT + '/3_validation.png', fullPage: true })
    await ctx.close()
  }

  // ───────── 4. Already-applied user -> status directly ─────────
  log('\n=== [4] Already-applied user sees status, not form ===')
  {
    const { ctx, page } = await sessionPage(browser, fx.c.refresh, '#/become-assessor')
    await page.waitForSelector('text=/pending review/i', { timeout: 15000 })
    const formGone = await page.getByRole('button', { name: /submit application/i }).count()
    ok(formGone === 0, 'pending state shown directly, no form')
    await page.screenshot({ path: SHOT + '/4_already_applied.png', fullPage: true })
    await ctx.close()
  }

  // ───────── 5. ★ Approved user -> "you're approved" ─────────
  log('\n=== [5] ★ Approved account sees approved state ===')
  {
    const { ctx, page } = await sessionPage(browser, fx.d.refresh, '#/become-assessor')
    await page.waitForSelector('text=/approved assessor/i', { timeout: 15000 })
    ok(true, 'approved state shown ("you\'re an approved assessor")')
    const formGone = await page.getByRole('button', { name: /submit application/i }).count()
    ok(formGone === 0, 'no form for approved user')
    await page.screenshot({ path: SHOT + '/5_approved.png', fullPage: true })
    await ctx.close()
  }

  log('\nDONE')
} finally {
  await browser.close()
}
