import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Company } from '../src/shared/types'
import { CompanyLibraryStore } from '../src/main/library'

let directory: string
let store: CompanyLibraryStore
const company = (name: string, category = 'AI'): Company => ({
  name, website: null, category, categories: [category], description: 'An AI company.', reason: 'Matches the category.',
  relevantRoles: [], location: '', sourceUrls: [], value: null
})

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'scout-library-')); store = new CompanyLibraryStore(directory) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('local company library', () => {
  it('creates companies.json and retains the catalog across restarts', async () => {
    expect((await store.read()).companies).toEqual([])
    await store.add([company('OpenAI')])
    const restarted = await new CompanyLibraryStore(directory).read()
    expect(restarted.path).toBe(join(directory, 'companies.json'))
    expect(restarted.companies.map((item) => item.name)).toEqual(['OpenAI'])
    expect(restarted.updatedAt).not.toBeNull()
    expect(await readdir(directory)).toEqual(['companies.json'])
  })
  it('deduplicates company names, merges categories, and preserves useful details', async () => {
    const first = { ...company('OpenAI, Inc.'), website: 'https://openai.com/', relevantRoles: ['AI Engineer'] }
    await store.add([first])
    await store.add([company('OPEN AI', 'Top AI startups'), company('Other')])
    const saved = await store.read()
    expect(saved.companies).toHaveLength(2)
    expect(saved.companies[0].name).toBe('OpenAI, Inc.')
    expect(saved.companies[0].categories).toEqual(['AI', 'Top AI startups'])
    expect(saved.companies[0].website).toBe('https://openai.com/')
    expect(saved.companies[0].relevantRoles).toEqual(['AI Engineer'])
    const updatedAt = saved.updatedAt
    expect((await store.add([first])).updatedAt).toBe(updatedAt)
  })
  it('serializes overlapping batch writes so no collected companies are lost', async () => {
    await Promise.all([store.add([company('One')]), store.add([company('Two')]), store.add([company('Three')])])
    expect((await store.read()).companies.map((item) => item.name)).toEqual(['One', 'Two', 'Three'])
  })
  it('does not overwrite a malformed existing library', async () => {
    await writeFile(store.path, '{broken')
    await expect(store.add([company('New')])).rejects.toThrow('existing file has been preserved')
    expect(await readFile(store.path, 'utf8')).toBe('{broken')
    await writeFile(store.path, JSON.stringify({ version: 1, companies: [], updatedAt: null }))
    expect((await store.add([company('Recovered')])).companies).toHaveLength(1)
  })
  it('stores only company data, strips dangerous links, and rejects invalid names', async () => {
    await store.add([{ ...company('Safe'), website: 'javascript:alert(1)', apiKey: 'not-for-disk' } as Company])
    expect((await store.read()).companies[0].website).toBeNull()
    expect(await readFile(store.path, 'utf8')).not.toContain('not-for-disk')
    await expect(store.add([company('!!!')])).rejects.toThrow('Invalid company name')
    expect((await store.read()).companies).toHaveLength(1)
  })
})
