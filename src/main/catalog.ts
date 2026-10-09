import type { CategoryCount, Company } from '../shared/types'

export const DISCOVERY_BATCH_SIZE = 20

export function companyIdentity(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US').trim()
    .replace(/(?:,?\s+)(?:inc\.?|incorporated|ltd\.?|limited|llc|corp\.?|corporation)$/i, '')
    .replace(/[\p{P}\p{Z}\s]+/gu, '')
}

export function categoryCounts(companies: Company[], categories: string[], target: number): CategoryCount[] {
  return categories.map((category) => ({ category, count: companies.filter((company) => company.categories.includes(category)).length, target }))
}

export function mergeCategory(companies: Company[], incoming: Company[], category: string, target: number): number {
  const identities = new Map(companies.map((company) => [companyIdentity(company.name), company]))
  let count = companies.filter((company) => company.categories.includes(category)).length
  const before = count
  for (const candidate of incoming) {
    if (count >= target) break
    const identity = companyIdentity(candidate.name)
    const existing = identities.get(identity)
    if (existing?.categories.includes(category)) continue
    if (existing) {
      existing.categories.push(category)
      existing.sourceUrls = [...new Set([...existing.sourceUrls, ...candidate.sourceUrls])].slice(0, 5)
      if (!existing.website) existing.website = candidate.website
      if (!existing.value) existing.value = candidate.value
    } else {
      const company = { ...candidate, category, categories: [category] }
      companies.push(company)
      identities.set(identity, company)
    }
    count++
  }
  return count - before
}

export async function forEachConcurrent<T>(items: T[], limit: number, action: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) await action(items[index++])
  })
  const results = await Promise.allSettled(workers)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
