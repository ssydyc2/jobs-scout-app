import { describe, expect, it, vi } from 'vitest'
import type { Company, ScoutConfig, SearchProgress } from '../src/shared/types'
import { companyIdentity, mergeCategory, categoryCounts } from '../src/main/catalog'
import { GLM_ENDPOINT, searchCompanies } from '../src/main/scout'
import { parseConfig } from '../src/shared/validation'

const config = parseConfig('{"interests":["AI + finance","AI + healthcare"],"companiesPerCategory":100}')
const options = { apiKey: 'batch-test-only-key', model: 'glm-5.3-flash', webSearch: false, companiesPerCategory: 100 }

function response(companies: unknown[]) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ companies }) } }] }))
}
function preferences(body: string): ScoutConfig {
  return JSON.parse(JSON.parse(body).messages[1].content.split('My job search preferences (JSON data):\n')[1].split('\n')[0])
}
function excluded(body: string): string[] {
  return JSON.parse(JSON.parse(body).messages[1].content.split('alternate spellings (JSON data):\n')[1].split('\n')[0])
}

describe('category catalogs', () => {
  it('collects 100 per category in ten bounded calls and publishes intermediate results without credentials', async () => {
    const updates: SearchProgress[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(GLM_ENDPOINT)
      const body = init?.body as string
      const batch = preferences(body)
      const names = excluded(body)
      expect(batch.companiesPerCategory).toBeLessThanOrEqual(20)
      expect(body).not.toContain(options.apiKey)
      return response(Array.from({ length: batch.companiesPerCategory }, (_, index) => ({ name: `${batch.interests[0]} Company ${names.length + index}` })))
    })
    const result = await searchCompanies(config, options, new AbortController().signal, fetcher, undefined, undefined, (update) => updates.push(update))
    expect(result.companies).toHaveLength(200)
    expect(result.categoryCounts.map((item) => item.count)).toEqual([100, 100])
    expect(result.incomplete).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(10)
    expect(updates.some((update) => update.result.companies.length > 0 && update.result.companies.length < 200)).toBe(true)
    expect(updates.every((update) => update.result.categoryCounts.every((item) => item.count <= 100))).toBe(true)
    expect(JSON.stringify(updates)).not.toContain(options.apiKey)
  })
  it('merges aliases across categories, retains category membership, and enforces each category cap', () => {
    const companies: Company[] = []
    const base = { name: 'Example Inc.', website: null, sourceUrls: [], categories: [], value: null } as unknown as Company
    expect(mergeCategory(companies, [base, { ...base, name: 'EXAMPLE' }, { ...base, name: 'Second' }], 'AI finance', 1)).toBe(1)
    expect(mergeCategory(companies, [{ ...base, name: 'Example' }, { ...base, name: 'Health Co' }], 'AI healthcare', 2)).toBe(2)
    expect(companies).toHaveLength(2)
    expect(companies[0].categories).toEqual(['AI finance', 'AI healthcare'])
    expect(categoryCounts(companies, ['AI finance', 'AI healthcare'], 2).map((item) => item.count)).toEqual([1, 2])
    expect(companyIdentity('Example, Inc.')).toBe(companyIdentity('EXAMPLE'))
  })
  it('stops when two additional batches add no companies, preserving honest partial counts', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(Array.from({ length: 20 }, (_, index) => ({ name: `Company ${index}` }))))
    const result = await searchCompanies({ ...config, interests: ['AI finance'] }, options, new AbortController().signal, fetcher)
    expect(result.companies).toHaveLength(20)
    expect(result.categoryCounts[0]).toEqual({ category: 'AI finance', count: 20, target: 100 })
    expect(result.incomplete).toBe(true)
    expect(result.warning).toContain('fewer companies than requested')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('keeps collecting other categories when a model response for one category fails', async () => {
    const fetcher: typeof fetch = async (_url, init) => {
      const batch = preferences(init?.body as string)
      if (batch.interests[0].includes('finance')) return new Response('{}', { status: 500 })
      const names = excluded(init?.body as string)
      return response(Array.from({ length: batch.companiesPerCategory }, (_, index) => ({ name: `Health Company ${names.length + index}` })))
    }
    const result = await searchCompanies(config, options, new AbortController().signal, fetcher)
    expect(result.categoryCounts.map((item) => item.count)).toEqual([0, 100])
    expect(result.companies).toHaveLength(100)
    expect(result.warning).toContain('AI + finance')
  })
  it('publishes collected companies before a user cancels, allowing the UI to retain them', async () => {
    const controller = new AbortController()
    let last: SearchProgress | undefined
    const fetcher: typeof fetch = async () => response(Array.from({ length: 20 }, (_, index) => ({ name: `Company ${index}` })))
    await expect(searchCompanies({ ...config, interests: ['AI finance'] }, options, controller.signal, fetcher, undefined, undefined, (update) => {
      last = update
      if (update.result.companies.length) controller.abort()
    })).rejects.toMatchObject({ cancelled: true })
    expect(last?.result.companies).toHaveLength(20)
  })
  it('returns a partial catalog when the time limit expires during a later discovery batch', async () => {
    let calls = 0
    const fetcher: typeof fetch = async (_url, init) => ++calls === 1
      ? response(Array.from({ length: 20 }, (_, index) => ({ name: `Company ${index}` })))
      : new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
    const result = await searchCompanies({ ...config, interests: ['AI finance'] }, options, new AbortController().signal, fetcher, 30)
    expect(result.companies).toHaveLength(20)
    expect(result.incomplete).toBe(true)
    expect(result.warning).toContain('time limit')
  })
})
