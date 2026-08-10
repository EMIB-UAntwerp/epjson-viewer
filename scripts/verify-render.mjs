/**
 * Headless render verification: loads an epJSON file into the running dev
 * server and captures a screenshot, reporting any page errors.
 *
 *   node scripts/verify-render.mjs <file.epJSON> <out.png> [settle-ms] [actions]
 *
 * actions: comma-separated post-load steps, e.g. "xray,pick,legend".
 * Selection level is set before picking, e.g. "zone,pick" or "building,pick".
 */
import { chromium } from 'playwright'

const [, , file, out, settleArg, actionsArg] = process.argv
if (!file || !out) {
  console.error('usage: node scripts/verify-render.mjs <file.epJSON> <out.png> [settle-ms] [actions]')
  process.exit(1)
}
const settle = Number(settleArg ?? 3000)
const actions = (actionsArg ?? '').split(',').filter(Boolean)
const url = process.env.URL ?? 'http://localhost:5199/'

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const problems = []
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console.error: ' + m.text())
})

await page.goto(url, { waitUntil: 'networkidle' })
if (file === 'DEMO_HOUSE' || file === 'DEMO_BLOCK') {
  await page.getByText(file === 'DEMO_HOUSE' ? 'Demo: single house' : 'Demo: urban block').click()
} else {
  await page.setInputFiles('input[type=file]', file)
}

// Wait until the viewer canvas exists (status === ready)
await page.waitForSelector('main canvas', { timeout: 120000 })
await page.waitForTimeout(settle)

for (const action of actions) {
  if (action === 'xray') {
    await page.getByText('X-ray', { exact: true }).first().click()
    await page.waitForTimeout(800)
  } else if (action === 'all') {
    await page.getByText('Display').click()
    await page.getByText('All', { exact: true }).first().click()
    await page.waitForTimeout(800)
  } else if (action === 'display') {
    await page.getByText('Display').click()
    await page.waitForTimeout(300)
  } else if (action === 'pick') {
    // Click roughly at the model center to select a surface
    const box = await page.locator('main canvas').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(600)
  } else if (action === 'surface' || action === 'zone' || action === 'building') {
    // Match on the label: levels the model cannot express are not rendered, so
    // a positional index would silently target the wrong button.
    const label = action[0].toUpperCase() + action.slice(1)
    await page.locator('button[title^="Click selects"]', { hasText: label }).click()
    await page.waitForTimeout(300)
  } else if (action === 'top') {
    await page.getByTitle('Top (plan) view').click()
    await page.waitForTimeout(800)
  } else if (action === 'boundary' || action === 'construction') {
    await page.getByText('Display').click()
    await page.getByText(action === 'boundary' ? 'Boundary condition' : 'Construction', { exact: true }).click()
    await page.waitForTimeout(800)
  }
}

await page.screenshot({ path: out })
console.log('screenshot:', out)
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no page errors')
await browser.close()
