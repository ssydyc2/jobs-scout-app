import { _electron } from 'playwright'
import electron from 'electron'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const artifactDir = resolve('artifacts')
await mkdir(artifactDir, { recursive: true })
const testDir = await mkdtemp(join(tmpdir(), 'jobs-scout-smoke-'))
const fixturePath = join(testDir, 'preferences.json')
const preference = { name: 'Smoke test', interests: ['AI + finance', 'AI + healthcare'], roles: ['AI Engineer'], locations: [], companiesPerCategory: 3 }
await writeFile(fixturePath, JSON.stringify(preference))
const packaged = process.env.SCOUT_EXECUTABLE
await mkdir(join(testDir, 'profile'))
const profilePath = await realpath(join(testDir, 'profile'))
const launchOptions = {
  executablePath: packaged || electron,
  args: [...(packaged ? [] : ['.']), `--user-data-dir=${profilePath}`],
  cwd: process.cwd(),
  timeout: 30000
}
let application = await _electron.launch(launchOptions)

try {
  const page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.getByLabel('Interests', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Interests', { exact: true }).inputValue(), 'AI + finance\nAI + healthcare')
  assert.equal(await page.getByLabel('Job titles / roles', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('Locations', { exact: true }).count(), 0)
  assert.equal(await page.getByLabel('Specific interests', { exact: false }).count(), 0)
  assert.equal(await page.getByText('Company stage', { exact: false }).count(), 0)
  for (const mode of ['Interest areas', 'Top AI startups', 'Large IT companies']) assert.equal(await page.locator('aside').getByRole('button', { name: mode, exact: true }).count(), 1)
  assert.equal(await page.getByLabel('Model', { exact: true }).inputValue(), 'glm-5.3-flash')
  assert.equal(await page.getByLabel('Per category', { exact: true }).inputValue(), '100')
  const defaultDraft = await page.evaluate(() => window.scout.editConfig())
  assert.equal(defaultDraft.ok, true)
  assert.equal(defaultDraft.data.path, join(profilePath, 'scout.json'))
  await page.getByRole('button', { name: 'Edit preferences', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  const preferencesJson = page.getByLabel('Preferences JSON', { exact: true })
  const initialJson = await preferencesJson.inputValue()
  await preferencesJson.fill('{broken')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').getByRole('alert').filter({ hasText: 'not valid JSON' }).waitFor()
  assert.equal(await readFile(defaultDraft.data.path, 'utf8'), initialJson)
  const modifiedDefault = { ...JSON.parse(initialJson), name: 'My edited scout' }
  await preferencesJson.fill(JSON.stringify(modifiedDefault, null, 2))
  await page.screenshot({ path: join(artifactDir, 'editor.png') })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.getByText('My edited scout', { exact: true }).waitFor()
  assert.equal(JSON.parse(await readFile(defaultDraft.data.path, 'utf8')).name, 'My edited scout')
  async function expectEnglishUi() {
    assert.equal(await page.locator('html').getAttribute('lang'), 'en')
    assert.ok(!/[\u4e00-\u9fff]/.test(await page.locator('body').innerText()), 'The built-in interface should be in English')
  }
  await expectEnglishUi()
  await page.screenshot({ path: join(artifactDir, 'home.png') })
  await page.getByRole('button', { name: 'Preview example results', exact: true }).click()
  await page.getByRole('heading', { name: 'Northstar Finance', exact: true }).waitFor()
  assert.equal(await page.locator('article h3').first().innerText(), 'Helix Health')
  await page.getByLabel('Sort companies').selectOption('value_asc')
  assert.deepEqual(await page.locator('article h3').allTextContents(), ['Northstar Finance', 'Helix Health', 'Ledger Studio'])
  await page.getByLabel('Sort companies').selectOption('value_desc')
  await expectEnglishUi()
  await page.screenshot({ path: join(artifactDir, 'preview.png') })
  assert.equal((await page.evaluate(() => window.scout.getLibrary())).data.companies.length, 0, 'Preview companies must not be saved')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(940, 660))
  await page.screenshot({ path: join(artifactDir, 'compact.png') })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'The English interface should fit the minimum window width')
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1220, 820))
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    return contents.executeJavaScript('typeof require')
  }), 'undefined')
  const sandbox = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences())
  assert.equal(sandbox.sandbox, true)
  assert.equal(sandbox.contextIsolation, true)
  assert.equal(sandbox.nodeIntegration, false)
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, fixturePath)
  // Inline interests validate and save without changing the job preferences.
  const interests = page.getByLabel('Interests', { exact: true })
  await interests.fill('')
  await page.getByLabel('Model', { exact: true }).focus()
  await page.locator('aside').getByRole('alert').filter({ hasText: 'at least one interest' }).waitFor()
  assert.deepEqual(JSON.parse(await readFile(defaultDraft.data.path, 'utf8')).interests, modifiedDefault.interests)
  await interests.fill('AI + robotics\nAI + climate')
  await page.getByLabel('Model', { exact: true }).focus()
  await page.locator('aside').getByRole('status').filter({ hasText: 'Saved locally' }).waitFor()
  const inlineDefault = JSON.parse(await readFile(defaultDraft.data.path, 'utf8'))
  assert.deepEqual(inlineDefault.interests, ['AI + robotics', 'AI + climate'])
  assert.deepEqual(inlineDefault.roles, modifiedDefault.roles)
  assert.ok(!Object.hasOwn(inlineDefault, 'companyStage'))
  await page.getByRole('button', { name: 'Job search', exact: true }).click()
  assert.equal(await page.getByLabel('Interests', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Top AI startups', exact: true }).count(), 0)
  await page.locator('aside').getByLabel('Job titles / roles', { exact: true }).fill('ML Engineer')
  await page.locator('aside').getByLabel('Locations', { exact: true }).fill('Remote')
  await page.locator('aside').getByRole('button', { name: 'RL', exact: true }).click()
  await page.getByLabel('Model', { exact: true }).focus()
  await page.locator('aside').getByRole('status').filter({ hasText: 'Saved locally' }).waitFor()
  await page.getByRole('button', { name: 'Company discovery', exact: true }).click()
  assert.equal(await interests.inputValue(), 'AI + robotics\nAI + climate')
  assert.equal(await page.getByLabel('Job titles / roles', { exact: true }).count(), 0)
  const savedInline = JSON.parse(await readFile(defaultDraft.data.path, 'utf8'))
  assert.deepEqual(savedInline.roles, ['ML Engineer'])
  assert.deepEqual(savedInline.locations, ['Remote'])
  assert.deepEqual(savedInline.jobInterests, ['RL'])
  assert.deepEqual(savedInline.interests, ['AI + robotics', 'AI + climate'])
  await page.getByRole('button', { name: 'Import preferences', exact: true }).click()
  await page.getByText('Smoke test', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Per category', { exact: true }).inputValue(), '3')
  await page.getByRole('button', { name: 'Edit preferences', exact: true }).click()
  await preferencesJson.fill(JSON.stringify({ ...preference, notes: 'Edited inside app' }, null, 2))
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(JSON.parse(await readFile(fixturePath, 'utf8')).notes, 'Edited inside app')
  await writeFile(fixturePath, JSON.stringify({ ...preference, notes: 'Updated outside app' }))
  await page.getByLabel('Per category', { exact: true }).fill('2')
  await application.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      globalThis.smokeRequestValid = init.headers.Authorization === 'Bearer smoke-only-key' && !init.body.includes('smoke-only-key')
      if (_url.endsWith('/web_search')) return new Response(JSON.stringify({ search_result: [{ title: 'Fixture source', link: 'https://example.com/about', content: 'Retrieved company details.' }] }))
      if (JSON.parse(init.body).messages[0].content.startsWith('Extract reported')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ valuations: [
        { name: 'Fixture Finance', value: { kind: 'valuation', amountUsd: 5e8, asOf: '2025-09', sourceUrl: 'https://example.com/about' } },
        { name: 'Fixture Health', value: { kind: 'market_cap', amountUsd: 3e9, asOf: '2026-09-30', sourceUrl: 'https://example.com/about' } }
      ] }) } }] }))
      globalThis.smokePreferencesFresh = JSON.parse(init.body).messages[1].content.includes('Updated outside app')
      globalThis.smokeCountValid = JSON.parse(init.body).messages[1].content.includes('"companiesPerCategory":2')
      globalThis.smokeFlashRequestValid = JSON.parse(init.body).model === 'glm-5.3-flash' && JSON.parse(init.body).thinking.type === 'enabled' && !JSON.parse(init.body).tools && !JSON.parse(init.body).response_format
      const health = JSON.parse(init.body).messages[1].content.includes('"interests":["AI + healthcare"]')
      const companies = health ? [
        { name: 'Fixture Health', website: null, description: 'A health test fixture.', reason: 'A second direction.', relevantRoles: [] },
        { name: 'Health Second', description: 'Another health fixture.' }, { name: 'Health Over Limit' }
      ] : [
        { name: 'Fixture Finance', website: 'https://example.com', description: 'A finance test fixture.', reason: 'Matches the imported preferences.', relevantRoles: ['AI Engineer'], sourceUrls: ['https://example.com/about'] },
        { name: 'Finance Second', description: 'Another finance fixture.' }, { name: 'Finance Over Limit' }
      ]
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ companies }) } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).last().click()
  await page.getByRole('heading', { name: 'Fixture Finance', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Find companies', exact: true }).waitFor()
  assert.equal(await page.getByLabel('GLM API key', { exact: false }).inputValue(), '')
  assert.equal(await application.evaluate(() => globalThis.smokeRequestValid), true)
  assert.equal(await application.evaluate(() => globalThis.smokePreferencesFresh), true)
  assert.equal(await application.evaluate(() => globalThis.smokeFlashRequestValid), true)
  assert.equal(await application.evaluate(() => globalThis.smokeCountValid), true)
  await page.getByText('Updated outside app', { exact: true }).waitFor()
  assert.equal(await page.locator('article').count(), 4)
  assert.equal(await page.locator('article h3').first().innerText(), 'Fixture Health')
  await page.getByText('$3B', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Value source for Fixture Health', exact: true }).waitFor()
  await page.getByLabel('Sort companies').selectOption('value_asc')
  assert.equal(await page.locator('article h3').first().innerText(), 'Fixture Finance')
  await page.getByLabel('Sort companies').selectOption('value_desc')
  await page.screenshot({ path: join(artifactDir, 'results.png') })
  await page.getByRole('button', { name: 'Copy company names', exact: true }).click()
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor()
  assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), 'Fixture Health\nFixture Finance\nFinance Second\nHealth Second')
  await page.getByRole('button', { name: /AI \+ healthcare.*2\/2/ }).click()
  assert.equal(await page.locator('article').count(), 2)
  await page.getByLabel('Filter companies by name or description').fill('no matches')
  await page.getByRole('heading', { name: 'No companies match your filters' }).waitFor()
  const savedFirst = await page.evaluate(() => window.scout.getLibrary())
  assert.equal(savedFirst.data.companies.length, 4)
  assert.equal(savedFirst.data.path, join(profilePath, 'companies.json'))
  assert.ok(!(await readFile(savedFirst.data.path, 'utf8')).includes('smoke-only-key'))
  await page.getByRole('button', { name: 'View saved companies', exact: true }).click()
  await page.getByRole('heading', { name: 'Your saved companies', exact: false }).waitFor()
  assert.equal(await page.locator('article').count(), 4)
  await page.getByRole('button', { name: 'Job search', exact: true }).click()
  await page.getByLabel('Job titles / roles', { exact: true }).fill('AI Engineer')
  await page.getByLabel('Locations', { exact: true }).fill('Remote')
  await page.locator('aside').getByRole('button', { name: 'Post training', exact: true }).click()
  await page.locator('aside').getByRole('button', { name: 'RL', exact: true }).click()
  await page.screenshot({ path: join(artifactDir, 'find-jobs.png') })
  await application.evaluate(() => {
    globalThis.jobSearchCompanies = []
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body)
      if (url.endsWith('/web_search')) return new Response(JSON.stringify({ search_result: [
        { title: 'AI Engineer', link: 'https://example.com/jobs/123', content: 'Fixture Finance is hiring an AI Engineer. Remote. Apply now.' },
        { title: 'AI Engineer, Post Training', link: 'https://example.com/jobs/456', content: 'AI Engineer, Post Training. Work on fine-tuning and reinforcement learning. Remote. Apply now.' }
      ] }))
      const company = JSON.parse(body.messages[1].content.split('Company (JSON data):\n')[1].split('\n')[0])
      globalThis.jobSearchCompanies.push(company.name)
      globalThis.jobCriteriaValid = body.messages[1].content.includes('"roles":["AI Engineer"],"locations":["Remote"]')
      globalThis.jobInterestsValid = body.messages[1].content.includes('"jobInterests":["Post training","RL"]')
      const jobs = company.name === 'Fixture Finance' ? [
        { company: company.name, title: 'AI Engineer', location: 'Remote', description: 'Build AI tools.', url: 'https://example.com/jobs/123', status: 'open' },
        { company: company.name, title: 'AI Engineer, Post Training', location: 'Remote', description: 'Fine-tune language models.', url: 'https://example.com/jobs/456', status: 'open' },
        { company: company.name, title: 'Invented CTO', location: 'Remote', url: 'https://fabricated.com/job', status: 'open' }
      ] : []
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ jobs }) } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find jobs', exact: true }).click()
  await page.getByRole('heading', { name: 'AI Engineer', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Find jobs', exact: true }).waitFor()
  assert.equal(await page.getByLabel('GLM API key', { exact: false }).inputValue(), '')
  assert.deepEqual((await application.evaluate(() => globalThis.jobSearchCompanies)).sort(), savedFirst.data.companies.map((company) => company.name).sort())
  assert.equal(await application.evaluate(() => globalThis.jobCriteriaValid), true)
  assert.equal(await application.evaluate(() => globalThis.jobInterestsValid), true)
  assert.equal(await page.locator('article').count(), 2)
  assert.equal(await page.locator('article h3').first().innerText(), 'AI Engineer, Post Training')
  await page.getByText('Why this matches', { exact: true }).click()
  await page.locator('article').first().getByText('reinforcement learning', { exact: false }).waitFor()
  await page.screenshot({ path: join(artifactDir, 'job-results.png') })
  await application.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.openedJob = url } })
  await page.getByRole('button', { name: 'View job', exact: true }).first().click()
  assert.equal(await application.evaluate(() => globalThis.openedJob), 'https://example.com/jobs/456')
  await application.evaluate(() => {
    let calls = 0
    globalThis.fetch = async (url, init) => {
      if (url.endsWith('/web_search')) return new Response(JSON.stringify({ search_result: [{ title: 'AI Engineer', link: 'https://example.com/jobs/123', content: 'AI Engineer. Remote. Apply now.' }] }))
      if (++calls > 1) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
      const company = JSON.parse(JSON.parse(init.body).messages[1].content.split('Company (JSON data):\n')[1].split('\n')[0])
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ jobs: [{ company: company.name, title: 'AI Engineer', location: 'Remote', description: 'A retained listing.', url: 'https://example.com/jobs/123', status: 'open' }] }) } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find jobs', exact: true }).click()
  await page.getByRole('heading', { name: 'AI Engineer', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Job search cancelled' }).waitFor()
  assert.equal(await page.locator('article').count(), 1)
  await page.getByRole('button', { name: 'Company discovery', exact: true }).click()
  await page.getByRole('button', { name: 'View latest search', exact: true }).click()
  await page.getByLabel('Web search', { exact: false }).uncheck()
  await page.getByLabel('Per category', { exact: true }).fill('1')
  await application.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      const content = JSON.parse(init.body).messages[1].content
      const config = JSON.parse(content.split('My job search preferences (JSON data):\n')[1].split('\n')[0])
      const excluded = JSON.parse(content.split('alternate spellings (JSON data):\n')[1].split('\n')[0])
      globalThis.savedExclusionValid = excluded.includes('Fixture Finance')
      globalThis.discoveryBroad = config.roles.length === 0 && config.locations.length === 0 && !Object.hasOwn(config, 'companyStage')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ companies: [{ name: `${config.interests[0]} Fixture` }] }) } }] }))
    }
  })
  for (const mode of ['Top AI startups', 'Large IT companies']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
    await page.getByRole('button', { name: 'Find companies', exact: true }).click()
    await page.getByRole('heading', { name: `${mode} Fixture`, exact: true }).waitFor()
    await page.getByRole('button', { name: 'Find companies', exact: true }).waitFor()
    assert.equal(await application.evaluate(() => globalThis.savedExclusionValid), true)
    assert.equal(await application.evaluate(() => globalThis.discoveryBroad), true)
  }
  assert.equal((await page.evaluate(() => window.scout.getLibrary())).data.companies.length, 6)
  await page.getByRole('button', { name: 'Interest areas', exact: true }).click()
  await page.getByLabel('Per category', { exact: true }).fill('2')
  await application.evaluate(() => {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"companies":[{"name":"Fixture Finance Inc."}]}' } }] }))
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).click()
  await page.getByRole('heading', { name: 'No matching companies this time', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.scout.getLibrary())).data.companies.length, 6, 'A saved alias must not be added again')
  await page.getByLabel('Web search', { exact: false }).check()
  await application.evaluate(() => {
    globalThis.fetch = async (url) => url.endsWith('/web_search')
      ? new Response(JSON.stringify({ error: { code: '1302', message: 'private provider message' } }), { status: 403 })
      : new Response(JSON.stringify({ choices: [{ message: { content: '{"companies":[{"name":"Offline fallback company"}]}' } }] }))
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).click()
  await page.getByRole('heading', { name: 'Offline fallback company' }).waitFor()
  await page.getByRole('button', { name: 'Find companies', exact: true }).waitFor()
  await page.getByText('Web search access denied (HTTP 403, code 1302)', { exact: false }).waitFor()
  await page.getByText('Web search unavailable · Model recommendations', { exact: false }).waitFor()
  await page.getByText('Unknown', { exact: true }).waitFor()
  await page.screenshot({ path: join(artifactDir, 'web-fallback.png') })
  await application.evaluate(() => { globalThis.fetch = async () => new Response('sensitive body', { status: 401 }) })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).last().click()
  await page.getByRole('alert').filter({ hasText: 'Your API key is invalid or expired' }).waitFor()
  assert.equal(await page.getByLabel('GLM API key', { exact: false }).inputValue(), '')
  await application.evaluate(() => {
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).last().click()
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Search cancelled' }).waitFor()
  await writeFile(fixturePath, JSON.stringify({ ...preference, companiesPerCategory: 100 }))
  await page.getByRole('button', { name: 'Reload preferences', exact: true }).click()
  await page.getByLabel('Web search', { exact: false }).uncheck()
  await application.evaluate(() => {
    globalThis.catalogCalls = 0
    globalThis.fetch = async (_url, init) => {
      const content = JSON.parse(init.body).messages[1].content
      const config = JSON.parse(content.split('My job search preferences (JSON data):\n')[1].split('\n')[0])
      const names = JSON.parse(content.split('alternate spellings (JSON data):\n')[1].split('\n')[0])
      globalThis.catalogCalls++
      if (globalThis.catalogCalls > 2) await new Promise((resolve) => setTimeout(resolve, 100))
      const companies = Array.from({ length: config.companiesPerCategory }, (_, index) => ({ name: `${config.interests[0]} Company ${names.filter((name) => name.startsWith(`${config.interests[0]} Company `)).length + index}` }))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ companies }) } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).click()
  await page.getByRole('heading', { name: 'AI + finance Company 0', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel search', exact: true }).waitFor()
  await page.screenshot({ path: join(artifactDir, 'bulk-progress.png') })
  await page.getByRole('button', { name: 'Find companies', exact: true }).waitFor()
  assert.equal(await application.evaluate(() => globalThis.catalogCalls), 10)
  await page.getByRole('button', { name: /AI \+ finance.*100\/100/ }).waitFor()
  await page.getByRole('button', { name: /AI \+ healthcare.*100\/100/ }).waitFor()
  assert.equal(await page.locator('article').count(), 60)
  await page.getByRole('button', { name: 'Copy company names', exact: true }).click()
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor()
  assert.equal((await application.evaluate(({ clipboard }) => clipboard.readText())).split('\n').length, 200)
  await page.getByRole('button', { name: 'Show 60 more', exact: true }).click()
  assert.equal(await page.locator('article').count(), 120)
  await page.getByRole('button', { name: /AI \+ healthcare.*100\/100/ }).click()
  assert.equal(await page.locator('article').count(), 60)
  await page.getByRole('button', { name: 'Show 60 more', exact: true }).click()
  assert.equal(await page.locator('article').count(), 100)
  await page.getByLabel('Filter companies by name or description').fill('Company 99')
  assert.equal(await page.locator('article').count(), 1)
  await writeFile(fixturePath, JSON.stringify({ ...preference, interests: ['AI + finance'], companiesPerCategory: 100 }))
  await page.getByRole('button', { name: 'Reload preferences', exact: true }).click()
  await application.evaluate(() => {
    let calls = 0
    globalThis.fetch = async (_url, init) => {
      if (++calls > 1) return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
      const companies = Array.from({ length: 20 }, (_, index) => ({ name: `Kept Company ${index}` }))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ companies }) } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).click()
  await page.getByRole('heading', { name: 'Kept Company 0', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'Search cancelled. Collected companies remain available.' }).waitFor()
  assert.equal(await page.locator('article').count(), 20)
  assert.equal(await page.getByLabel('GLM API key', { exact: false }).inputValue(), '')
  const savedAfterCancel = await page.evaluate(() => window.scout.getLibrary())
  assert.equal(savedAfterCancel.data.companies.filter((company) => company.name.startsWith('Kept Company')).length, 20)
  await writeFile(fixturePath, '{"interests": []}')
  await page.getByRole('button', { name: 'Reload preferences', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'at least one interest' }).waitFor()
  await writeFile(fixturePath, JSON.stringify({ ...preference, interests: ['AI + climate'] }))
  await page.getByRole('button', { name: 'Reload preferences', exact: true }).click()
  await page.waitForFunction(() => document.getElementById('interests')?.value === 'AI + climate')
  // Searching with unchanged sidebar inputs must preserve fresh external interests.
  await writeFile(fixturePath, JSON.stringify({ ...preference, interests: ['AI + robotics'] }))
  await application.evaluate(() => {
    globalThis.fetch = async (_url, init) => {
      const content = JSON.parse(init.body).messages[1].content
      globalThis.externalInterestsFresh = content.includes('"interests":["AI + robotics"]')
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"companies":[{"name":"Robotics Fixture"}]}' } }] }))
    }
  })
  await page.getByLabel('GLM API key', { exact: false }).fill('smoke-only-key')
  await page.getByRole('button', { name: 'Find companies', exact: true }).click()
  await page.getByRole('heading', { name: 'Robotics Fixture', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Find companies', exact: true }).waitFor()
  assert.equal(await application.evaluate(() => globalThis.externalInterestsFresh), true)
  assert.deepEqual(JSON.parse(await readFile(fixturePath, 'utf8')).interests, ['AI + robotics'])
  assert.equal(await page.getByLabel('Interests', { exact: true }).inputValue(), 'AI + robotics')
  const rejected = await page.evaluate(() => window.scout.openLink('javascript:alert(1)'))
  assert.equal(rejected.ok, false)
  assert.equal(await page.evaluate(() => localStorage.length), 0)
  assert.ok(!(await readFile(fixturePath, 'utf8')).includes('smoke-only-key'))
  assert.deepEqual(pageErrors, [])
  const libraryBeforeRestart = (await page.evaluate(() => window.scout.getLibrary())).data
  await application.close()
  application = await _electron.launch(launchOptions)
  const restarted = await application.firstWindow()
  restarted.setDefaultTimeout(15000)
  await restarted.getByText('My edited scout', { exact: true }).waitFor()
  assert.equal(await restarted.getByLabel('Model', { exact: true }).inputValue(), 'glm-5.3-flash')
  const libraryAfterRestart = (await restarted.evaluate(() => window.scout.getLibrary())).data
  assert.deepEqual(libraryAfterRestart, libraryBeforeRestart)
  await restarted.getByRole('heading', { name: 'Your saved companies', exact: false }).waitFor()
  await restarted.getByRole('button', { name: 'Job search', exact: true }).click()
  assert.equal(await restarted.getByLabel('Job titles / roles', { exact: true }).inputValue(), 'ML Engineer')
  assert.equal(await restarted.getByLabel('Locations', { exact: true }).inputValue(), 'Remote')
  assert.equal(await restarted.getByLabel('Specific interests', { exact: false }).inputValue(), 'RL')
  console.log('Desktop smoke test passed: contextual sidebar with inline editing and autosave, retired company-stage compatibility, company library persistence and deduplication, all three sidebar discovery modes, specific job interests with ranking, evidence and persistence, sourced job search and cancellation, 100 companies per category, incremental results and cancellation, pagination, sourced values and sorting, web failure fallback, English UI, JSON editing and persistence, key clearing, filters, copying, cancellation and sandbox.')
} finally {
  await application.close()
  await rm(testDir, { recursive: true, force: true })
}
