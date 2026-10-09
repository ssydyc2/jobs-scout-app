import { describe, expect, it, vi } from 'vitest'
import { GLM_ENDPOINT, GLM_SEARCH_ENDPOINT, buildRequest, buildSearchQueries, parseResult, searchCompanies, validateOptions } from '../src/main/scout'
import { parseConfig } from '../src/shared/validation'
import { DEFAULT_MODEL } from '../src/shared/models'

const config = parseConfig('{"interests":["AI + finance"],"roles":["AI Engineer"],"companiesPerCategory":2}')
const options = { apiKey: 'test-only-secret', model: 'glm-4.7', webSearch: true, companiesPerCategory: 1 }
const company = { name: 'Example Co', category: 'AI + finance', website: 'https://example.com', sourceUrls: ['https://example.com/about', 'https://fabricated.com'], relevantRoles: ['AI Engineer'] }
function payload(companies: unknown[] = [company], extra = {}) {
  return { choices: [{ message: { content: JSON.stringify({ companies }) }, finish_reason: 'stop' }], web_search: [{ title: 'Company overview', link: 'https://example.com/about' }], ...extra }
}

describe('GLM boundary', () => {
  it('uses retrieved context without unsupported tools or embedding the key in prompts', () => {
    const request = buildRequest(config, options)
    expect(request).not.toHaveProperty('tools')
    expect(request.messages[1].content).toContain('AI + finance')
    expect(request.messages[1].content).toContain('AI Engineer')
    expect(request.messages[0].content).toContain('in English, even when the preferences or sources use another language')
    expect(JSON.stringify(request)).not.toContain(options.apiKey)
    expect(buildRequest(config, { ...options, webSearch: false })).not.toHaveProperty('tools')
  })
  it('retains only sources actually supplied by the provider, deduplicates, and limits company results', () => {
    const result = parseResult(payload([company, { ...company, name: 'EXAMPLE CO' }, { ...company, name: 'Second Co' }, { ...company, name: 'Third Co' }]), config, options)
    expect(result.companies.map((c) => c.name)).toEqual(['Example Co', 'Second Co'])
    expect(result.companies[0].sourceUrls).toEqual(['https://example.com/about'])
    expect(result.warning).toBeNull()
  })
  it('warns when the provider does not supply online sources', () => {
    const result = parseResult(payload([company], { web_search: [] }), config, options)
    expect(result.warning).toContain('No usable web sources')
    expect(result.companies[0].sourceUrls).toEqual([])
  })
  it('does not mark offline recommendations as sourced, even if the provider includes sources', () => {
    const result = parseResult(payload(), config, { ...options, webSearch: false })
    expect(result.sources).toEqual([])
    expect(result.companies[0].sourceUrls).toEqual([])
    expect(result.warning).toContain('Web search was disabled')
  })
  it('accepts zero matches and fenced JSON, and strips dangerous website URLs', () => {
    expect(parseResult(payload([]), config, options).companies).toEqual([])
    const fenced = { choices: [{ message: { content: '```json\n{"companies":[{"name":"Safe","website":"javascript:alert(1)"}]}\n```' } }] }
    expect(parseResult(fenced, config, options).companies[0].website).toBeNull()
  })
  it.each([
    {}, { choices: [] }, { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: 'not json' } }] },
    { choices: [{ message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    payload([{}])
  ])('rejects unusable model responses', (value) => {
    expect(() => parseResult(value, config, options)).toThrow()
  })
  it('sends a key only in the Authorization header to the fixed GLM endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())))
    const result = await searchCompanies(config, { ...options, webSearch: false }, new AbortController().signal, fetcher)
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe(GLM_ENDPOINT)
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${options.apiKey}` })
    expect(init?.body).not.toContain(options.apiKey)
    expect(init?.redirect).toBe('error')
    expect(result.companies[0].name).toBe('Example Co')
  })
  it.each([401, 403, 429, 400, 500])('handles HTTP %i without echoing the provider body or key', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(options.apiKey, { status }))
    await expect(searchCompanies(config, options, new AbortController().signal, fetcher)).rejects.not.toThrow(options.apiKey)
  })
  it('redacts raw network errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(options.apiKey))
    await expect(searchCompanies(config, options, new AbortController().signal, fetcher)).rejects.toThrow('Could not connect to GLM')
  })
  it('reports cancellation and does not turn it into a network error', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('abort'))
    await expect(searchCompanies(config, options, controller.signal, fetcher)).rejects.toMatchObject({ cancelled: true })
  })
  it('times out an unresponsive request', async () => {
    const fetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true })
    })
    await expect(searchCompanies(config, options, new AbortController().signal, fetcher, 10)).rejects.toThrow('exceeded 20 minutes')
  })
  it('rejects a blank key, header injection and invalid model names before contacting GLM', () => {
    for (const invalid of [{ ...options, apiKey: '' }, { ...options, apiKey: 'key\r\nHeader:evil' }, { ...options, model: 'other-model' }]) {
      expect(() => validateOptions(invalid)).toThrow()
    }
  })
  it('uses the official Flash model code and supported thinking fields, without text-model-only options', () => {
    const request = buildRequest(config, { ...options, model: DEFAULT_MODEL })
    expect(request).toMatchObject({
      model: 'glm-5.3-flash', thinking: { type: 'enabled', clear_thinking: false },
      reasoning_effort: 'low', temperature: 1, top_p: 0.95
    })
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('response_format')
  })
  it('retrieves sources before Flash generation and only keeps source URLs actually retrieved', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ search_result: [{ title: 'Retrieved company', link: 'https://example.com/about', content: 'A company working in AI and finance.' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload([company], { web_search: [{ title: 'Fabricated provider source', link: 'https://fabricated.com' }] }))))
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher)
    expect(fetcher.mock.calls.slice(0, 2).map(([url]) => url)).toEqual([GLM_SEARCH_ENDPOINT, GLM_ENDPOINT])
    const searchBody = JSON.parse(fetcher.mock.calls[0][1]?.body as string)
    expect(searchBody).toMatchObject({ search_engine: 'search_std', search_intent: false, count: 20 })
    expect(searchBody.search_query).toContain('AI finance')
    const chatBody = JSON.parse(fetcher.mock.calls[1][1]?.body as string)
    expect(chatBody.messages[1].content).toContain('A company working in AI and finance.')
    expect(chatBody.tools).toBeUndefined()
    expect(result.sources).toEqual([{ title: 'Retrieved company', url: 'https://example.com/about' }])
    expect(result.companies[0].sourceUrls).toEqual(['https://example.com/about'])
    expect(JSON.stringify(result)).not.toContain(options.apiKey)
  })
  it('skips standalone searches when Flash web search is disabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())))
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL, webSearch: false }, new AbortController().signal, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(GLM_ENDPOINT)
    expect(result.sources).toEqual([])
  })
  it('returns model recommendations after search access is denied and preserves the sanitized cause', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: '1302', message: options.apiKey } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload())))
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher)
    expect(result.companies[0].name).toBe('Example Co')
    expect(result.webSearch).toBe(true)
    expect(result.webSearchUsed).toBe(false)
    expect(result.sources).toEqual([])
    expect(result.warning).toContain('Web search access denied (HTTP 403, code 1302)')
    expect(result.warning).toContain('model knowledge instead')
    expect(JSON.stringify(result)).not.toContain(options.apiKey)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string).messages[0].content).toContain('Web search is unavailable or disabled')
  })
  it('keeps standalone queries within the documented 70 character limit', () => {
    const long = { ...config, interests: ['x'.repeat(200), 'AI + finance'] }
    const queries = buildSearchQueries(long)
    expect(queries).toHaveLength(2)
    expect(queries.every((query) => Array.from(query).length <= 70)).toBe(true)
  })
  it.each([0, 101, 1.5, '10', null])('rejects an invalid requested count: %s', (companiesPerCategory) => {
    expect(() => validateOptions({ ...options, companiesPerCategory })).toThrow('1 and 100')
  })
  it('applies the requested count to the prompt and the result cap without changing the file default', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload([company, { name: 'Second' }]))))
    const result = await searchCompanies(config, { ...options, webSearch: false, companiesPerCategory: 1 }, new AbortController().signal, fetcher)
    expect(result.companies).toHaveLength(1)
    expect(result.config.companiesPerCategory).toBe(1)
    expect(config.companiesPerCategory).toBe(2)
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string).messages[0].content).toContain('strict maximum of 1')
  })
  it('bounds a stalled web lookup and falls back without timing out the model call', async () => {
    const fetcher: typeof fetch = (url, init) => url === GLM_SEARCH_ENDPOINT
      ? new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
      : Promise.resolve(new Response(JSON.stringify(payload())))
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher, 1000, 10)
    expect(result.companies).toHaveLength(1)
    expect(result.warning).toContain('Web search timed out')
    expect(result.webSearchUsed).toBe(false)
  })
  it('keeps successful sources and category results when another interest lookup fails', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const body = JSON.parse(init?.body as string)
      if (url === GLM_SEARCH_ENDPOINT) return body.search_query.includes('healthcare')
        ? new Response('{}', { status: 429 })
        : new Response(JSON.stringify({ search_result: [{ title: 'Source', link: 'https://example.com/about' }] }))
      return new Response(JSON.stringify(payload()))
    })
    const result = await searchCompanies({ ...config, interests: ['AI finance', 'AI healthcare'] }, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher)
    expect(result.webSearchUsed).toBe(true)
    expect(result.companies[0].sourceUrls).toEqual(['https://example.com/about'])
    expect(result.companies[0].categories).toEqual(['AI finance', 'AI healthcare'])
    expect(result.categoryCounts.map((item) => item.count)).toEqual([1, 1])
    expect(result.warning).toContain('Web search rate limit')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('handles a provider error in an HTTP 200 response without exposing provider messages', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: '1113', message: options.apiKey } })))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload())))
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher)
    expect(result.warning).toContain('code 1113')
    expect(JSON.stringify(result)).not.toContain(options.apiKey)
  })
  it('adds a dated USD value from company-specific retrieval and rejects fabricated value sources', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      const body = JSON.parse(init?.body as string)
      if (url === GLM_SEARCH_ENDPOINT) return new Response(JSON.stringify({ search_result: [{ title: 'Finance value', link: 'https://example.com/value', content: 'Example Co was valued at USD 2 billion in September 2025.' }] }))
      if (body.messages[0].content.startsWith('Extract reported company valuations')) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ valuations: [
        { name: 'Example Co', value: { kind: 'valuation', amountUsd: 2e9, asOf: '2025-09', sourceUrl: 'https://example.com/value' } },
        { name: 'Second Co', value: { kind: 'market_cap', amountUsd: 5e9, asOf: '2025', sourceUrl: 'https://fabricated.com/value' } },
        { name: 'Invented', value: { kind: 'valuation', amountUsd: 9e9, asOf: '2025', sourceUrl: 'https://example.com/value' } }
      ] }) } }] }))
      return new Response(JSON.stringify(payload([company, { ...company, name: 'Second Co' }])))
    }
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL, companiesPerCategory: 2 }, new AbortController().signal, fetcher)
    expect(result.companies[0].value).toEqual({ kind: 'valuation', amountUsd: 2e9, asOf: '2025-09', sourceUrl: 'https://example.com/value' })
    expect(result.companies[1].value).toBeNull()
    expect(result.companies).toHaveLength(2)
    expect(result.sources.some((source) => source.url === 'https://example.com/value')).toBe(true)
  })
  it('preserves a generated shortlist when the optional value model call fails', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      if (url === GLM_SEARCH_ENDPOINT) return new Response(JSON.stringify({ search_result: [{ title: 'Source', link: 'https://example.com/about', content: 'Company data' }] }))
      if (JSON.parse(init?.body as string).messages[0].content.startsWith('Extract reported')) return new Response('{}', { status: 500 })
      return new Response(JSON.stringify(payload()))
    }
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher)
    expect(result.companies[0].name).toBe('Example Co')
    expect(result.companies[0].value).toBeNull()
    expect(result.warning).toContain('catalog is still available')
  })
  it('honors cancellation during value enrichment', async () => {
    const controller = new AbortController()
    const fetcher: typeof fetch = async (url, init) => {
      if (url === GLM_SEARCH_ENDPOINT) return new Response(JSON.stringify({ search_result: [{ title: 'Source', link: 'https://example.com/about' }] }))
      if (JSON.parse(init?.body as string).messages[0].content.startsWith('Extract reported')) { controller.abort(); throw new Error('abort') }
      return new Response(JSON.stringify(payload()))
    }
    await expect(searchCompanies(config, { ...options, model: DEFAULT_MODEL }, controller.signal, fetcher)).rejects.toMatchObject({ cancelled: true })
  })
  it('preserves the shortlist if the overall time budget expires during optional value retrieval', async () => {
    let searches = 0
    const fetcher: typeof fetch = async (url, init) => {
      if (url === GLM_SEARCH_ENDPOINT && ++searches === 1) return new Response(JSON.stringify({ search_result: [{ title: 'Source', link: 'https://example.com/about' }] }))
      if (url === GLM_SEARCH_ENDPOINT) return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
      return new Response(JSON.stringify(payload()))
    }
    const result = await searchCompanies(config, { ...options, model: DEFAULT_MODEL }, new AbortController().signal, fetcher, 30)
    expect(result.companies[0].name).toBe('Example Co')
    expect(result.warning).toContain('catalog is still available')
  })
})
