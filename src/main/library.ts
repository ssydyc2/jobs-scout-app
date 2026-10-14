import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Company, CompanyLibrary } from '../shared/types'
import { record, safeWebUrl } from '../shared/validation'
import { parseCompanyValue } from '../shared/company-value'
import { companyIdentity } from './catalog'

function parseCompany(value: unknown): Company {
  const input = record(value)
  const text = (key: string, max: number): string => {
    if (typeof input[key] !== 'string' || (input[key] as string).length > max) throw new Error('Invalid company data.')
    return (input[key] as string).trim()
  }
  const list = (key: string, max: number): string[] => {
    if (!Array.isArray(input[key]) || (input[key] as unknown[]).some((item) => typeof item !== 'string' || item.length > max)) throw new Error('Invalid company data.')
    return [...new Set((input[key] as string[]).map((item) => item.trim()).filter(Boolean))]
  }
  const name = text('name', 150)
  if (!name || !companyIdentity(name)) throw new Error('Invalid company name.')
  const categories = list('categories', 200)
  const sourceUrls = list('sourceUrls', 2048).map(safeWebUrl).filter((url): url is string => !!url)
  const rawValue = input.value && typeof input.value === 'object' ? input.value as Record<string, unknown> : null
  const valueSource = safeWebUrl(rawValue?.sourceUrl)
  return {
    name, website: safeWebUrl(input.website), category: categories[0] || text('category', 200), categories,
    description: text('description', 1500), reason: text('reason', 1500), relevantRoles: list('relevantRoles', 200),
    location: text('location', 200), sourceUrls,
    value: parseCompanyValue(input.value, new Set(valueSource ? [valueSource] : []))
  }
}

function mergeCompanies(existing: Company[], incoming: Company[]): Company[] {
  const companies = new Map(existing.map((company) => [companyIdentity(company.name), company]))
  for (const company of incoming) {
    const identity = companyIdentity(company.name)
    const previous = companies.get(identity)
    companies.set(identity, previous ? {
      ...previous, website: company.website || previous.website,
      categories: [...new Set([...previous.categories, ...company.categories])],
      relevantRoles: [...new Set([...previous.relevantRoles, ...company.relevantRoles])],
      sourceUrls: [...new Set([...previous.sourceUrls, ...company.sourceUrls])],
      value: company.value || previous.value
    } : company)
  }
  return [...companies.values()]
}

export class CompanyLibraryStore {
  readonly path: string
  private pending: Promise<unknown> = Promise.resolve()

  constructor(userDataPath: string) { this.path = join(userDataPath, 'companies.json') }

  async read(): Promise<CompanyLibrary> {
    await this.pending
    return this.readFile()
  }

  private async readFile(): Promise<CompanyLibrary> {
    try {
      await mkdir(dirname(this.path), { recursive: true })
      try { await writeFile(this.path, JSON.stringify({ version: 1, updatedAt: null, companies: [] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 }) }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
      if ((await stat(this.path)).size > 32 * 1024 * 1024) throw new Error('Company library is too large.')
      const data = record(JSON.parse(await readFile(this.path, 'utf8')))
      if (data.version !== 1 || !Array.isArray(data.companies) || !(data.updatedAt === null || typeof data.updatedAt === 'string')) throw new Error('Invalid library format.')
      return { path: this.path, updatedAt: data.updatedAt as string | null, companies: mergeCompanies([], data.companies.map(parseCompany)) }
    } catch {
      throw new Error('Could not read companies.json. Check the local company library before searching; the existing file has been preserved.')
    }
  }

  add(incoming: Company[]): Promise<CompanyLibrary> {
    const update = this.pending.then(async () => {
      const previous = await this.readFile()
      const companies = mergeCompanies(previous.companies, incoming.map(parseCompany))
      if (JSON.stringify(companies) === JSON.stringify(previous.companies)) return previous
      const updatedAt = new Date().toISOString()
      const temporary = join(dirname(this.path), `.companies-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, updatedAt, companies }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.path)
      } catch {
        throw new Error('Could not save companies.json. Collected companies are still shown; check that the library folder is writable.')
      } finally { await unlink(temporary).catch(() => {}) }
      return { path: this.path, updatedAt, companies }
    })
    // Serialize batch writes without allowing one failed save to poison future attempts.
    this.pending = update.catch(() => {})
    return update
  }
}
