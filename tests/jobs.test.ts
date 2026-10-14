import { describe, expect, it, vi } from 'vitest'
import type { Company, JobSearchProgress } from '../src/shared/types'
import { buildJobQueries, buildJobRequest, parseJobs, searchJobs, validateJobOptions } from '../src/main/jobs'
import { GLM_ENDPOINT, GLM_SEARCH_ENDPOINT } from '../src/main/provider'

const options = { apiKey: 'job-test-secret', model: 'glm-5.3-flash', webSearch: true, roles: ['AI Engineer'], locations: ['Remote'] }
const company: Company = { name: 'Example', website: 'https://example.com/', category: 'AI', categories: ['AI'], description: '', reason: '', relevantRoles: [], location: '', sourceUrls: [], value: null }
const source = { title: 'AI Engineer at Example', link: 'https://example.com/jobs/123', content: 'Example is hiring an AI Engineer. Remote position. Apply now.' }
const job = { company: 'Example', title: 'AI Engineer', location: 'Remote', description: 'Build AI tools.', url: source.link, status: 'open' }
const payload = (jobs: unknown[]) => ({ choices: [{ message: { content: JSON.stringify({ jobs }) } }] })
const response = (jobs: unknown[]) => new Response(JSON.stringify(payload(jobs)))

describe('jobs from the saved company library', () => {
  it('retrieves listings for each saved company and passes role and location criteria without credentials', async () => {
    const updates: JobSearchProgress[] = []
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${options.apiKey}` })
      expect(init?.body).not.toContain(options.apiKey)
      if (url === GLM_SEARCH_ENDPOINT) return new Response(JSON.stringify({ search_result: [source] }))
      expect(url).toBe(GLM_ENDPOINT)
      const body = JSON.parse(init?.body as string)
      expect(body.messages[1].content).toContain('"roles":["AI Engineer"],"locations":["Remote"]')
      return body.messages[1].content.includes('"name":"Example"') ? response([job]) : response([])
    })
    const result = await searchJobs([company, { ...company, name: 'Other' }, { ...company, name: 'Example Inc.' }], options, new AbortController().signal, fetcher, undefined, undefined, (progress) => updates.push(progress))
    expect(result.jobs).toHaveLength(1)
    expect(result.totalCompanies).toBe(2)
    expect(result.companiesChecked).toBe(2)
    expect(result.incomplete).toBe(false)
    expect(updates.some((update) => update.result.jobs.length > 0)).toBe(true)
    expect(JSON.stringify(updates)).not.toContain(options.apiKey)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('rejects fabricated URLs, unsupported titles, other employers, unsafe links, and closed jobs', () => {
    const jobs = parseJobs(payload([
      job, job, { ...job, url: 'https://invented.com/jobs/1' }, { ...job, title: 'Invented CTO' },
      { ...job, company: 'Other' }, { ...job, url: 'javascript:alert(1)' }, { ...job, status: 'closed' }
    ]), company, [source])
    expect(jobs).toEqual([{ company: 'Example', title: 'AI Engineer', location: 'Remote', description: 'Build AI tools.', url: source.link, interestMatches: [], matchScore: 0 }])
  })
  it('uses no model-knowledge fallback when retrieval has no job sources', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ search_result: [] })))
    const result = await searchJobs([company], options, new AbortController().signal, fetcher)
    expect(result.jobs).toEqual([])
    expect(result.incomplete).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('retains successful company listings when another company fails', async () => {
    const fetcher: typeof fetch = async (url, init) => {
      if (url === GLM_SEARCH_ENDPOINT) return JSON.parse(init?.body as string).search_query.includes('Other')
        ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ search_result: [source] }))
      return response([job])
    }
    const result = await searchJobs([company, { ...company, name: 'Other' }], options, new AbortController().signal, fetcher)
    expect(result.jobs).toHaveLength(1)
    expect(result.incomplete).toBe(true)
    expect(result.warning).toContain('HTTP 500')
  })
  it('stops on provider authentication failures without echoing credentials or generating jobs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: { code: '1302', message: options.apiKey } }), { status: 401 }))
    await expect(searchJobs([company], options, new AbortController().signal, fetcher)).rejects.toThrow('invalid or expired')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves streamed listings when the search is cancelled', async () => {
    const controller = new AbortController()
    let last: JobSearchProgress | undefined
    const fetcher: typeof fetch = async (url) => url === GLM_SEARCH_ENDPOINT ? new Response(JSON.stringify({ search_result: [source] })) : response([job])
    await expect(searchJobs([company], options, controller.signal, fetcher, undefined, undefined, (progress) => {
      last = progress
      if (progress.result.jobs.length) controller.abort()
    })).rejects.toMatchObject({ cancelled: true })
    expect(last?.result.jobs).toHaveLength(1)
  })
  it('times out stalled requests and returns honest incomplete progress', async () => {
    const fetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(options.apiKey)), { once: true }))
    const result = await searchJobs([company], options, new AbortController().signal, fetcher, 10)
    expect(result.jobs).toEqual([])
    expect(result.companiesChecked).toBe(0)
    expect(result.incomplete).toBe(true)
    expect(result.warning).toContain('time limit')
    expect(JSON.stringify(result)).not.toContain(options.apiKey)
  })
  it('requires a populated library, online search, and bounded criteria', async () => {
    await expect(searchJobs([], options, new AbortController().signal)).rejects.toThrow('library is empty')
    for (const invalid of [{ ...options, webSearch: false }, { ...options, roles: 'Engineer' }, { ...options, locations: [''] }, { ...options, roles: Array(31).fill('Engineer') }]) {
      expect(() => validateJobOptions(invalid)).toThrow()
    }
    expect(validateJobOptions({ ...options, roles: [], locations: [] })).toMatchObject({ roles: [], locations: [] })
  })
  it('uses bounded queries for every role and reserves room for criteria in long company names', () => {
    const queries = buildJobQueries({ ...company, name: 'X'.repeat(150) }, { ...options, roles: ['Software Engineer', 'AI Engineer'] })
    expect(queries).toHaveLength(2)
    expect(queries.every((query) => Array.from(query).length <= 70 && query.includes('Remote'))).toBe(true)
    const multipleLocations = buildJobQueries(company, { ...options, roles: ['AI Engineer', 'Software Engineer'], locations: ['San Francisco', 'Remote'] })
    expect(multipleLocations).toHaveLength(4)
    expect(multipleLocations.filter((query) => query.includes('San Francisco'))).toHaveLength(2)
    expect(multipleLocations.filter((query) => query.includes('Remote'))).toHaveLength(2)
    const request = buildJobRequest(company, options, [source])
    expect(JSON.stringify(request)).not.toContain(options.apiKey)
    expect(request.messages[0].content).toContain('Exclude closed, expired')
    expect(request.messages[0].content).toContain('general careers pages')
  })
  it('retrieves specific interests while preserving broader role and location queries', () => {
    const queries = buildJobQueries(company, { ...options, jobInterests: ['Post training', 'LLM infra'] })
    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain('Post training')
    expect(queries[1]).toContain('LLM infra')
    expect(queries[2]).toContain('Remote')
    expect(queries.every((query) => Array.from(query).length <= 70)).toBe(true)
    expect(validateJobOptions(options).jobInterests).toEqual([])
    for (const jobInterests of [null, 'RL', [''], Array(31).fill('RL')]) expect(() => validateJobOptions({ ...options, jobInterests })).toThrow('Specific interests')
  })
  it('ignores model-generated matching claims unless the linked source supports the topic', () => {
    const found = parseJobs(payload([{ ...job, description: 'Post-training and RL work.', matchScore: 100, interestMatches: [{ interest: 'RL', evidence: 'Invented' }] }]), company, [source], ['Post training', 'RL'])
    expect(found[0].interestMatches).toEqual([])
    expect(found[0].matchScore).toBe(0)
  })
  it('ranks focused jobs above earlier general results across companies and retains both', async () => {
    const updates: JobSearchProgress[] = []
    const focused = { title: 'AI Engineer, Post Training', link: 'https://example.com/jobs/456', content: 'AI Engineer, Post Training. Remote. Fine-tuning and reinforcement learning.' }
    let firstGeneral: () => void = () => {}
    const generalReady = new Promise<void>((resolve) => { firstGeneral = resolve })
    const fetcher: typeof fetch = async (url, init) => {
      const body = JSON.parse(init?.body as string)
      if (url === GLM_SEARCH_ENDPOINT) return new Response(JSON.stringify({ search_result: body.search_query.startsWith('Other') ? [source] : [focused] }))
      if (body.messages[1].content.includes('"name":"Other"')) {
        firstGeneral()
        return response([{ ...job, company: 'Other' }])
      }
      await generalReady
      await new Promise((resolve) => setTimeout(resolve, 5))
      return response([{ ...job, title: focused.title, url: focused.link }])
    }
    const result = await searchJobs([company, { ...company, name: 'Other' }], { ...options, jobInterests: ['Post training', 'RL'] }, new AbortController().signal, fetcher, undefined, undefined, (update) => updates.push(update))
    expect(updates.some((update) => update.result.jobs.length === 1 && update.result.jobs[0].company === 'Other')).toBe(true)
    expect(result.jobs.map((job) => job.company)).toEqual(['Example', 'Other'])
    expect(result.jobs[0].interestMatches.map((match) => match.interest)).toEqual(['Post training', 'RL'])
    expect(result.criteria.jobInterests).toEqual(['Post training', 'RL'])
    expect(result.totalCompanies).toBe(2)
    expect(result.incomplete).toBe(false)
  })
})
