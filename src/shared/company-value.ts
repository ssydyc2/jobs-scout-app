import type { Company, CompanySort, CompanyValue } from './types'
import { safeWebUrl } from './validation'

export function parseCompanyValue(raw: unknown, sourceUrls: Set<string>, today = new Date().toISOString().slice(0, 10)): CompanyValue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  if (value.kind !== 'market_cap' && value.kind !== 'valuation') return null
  if (typeof value.amountUsd !== 'number' || !Number.isFinite(value.amountUsd) || value.amountUsd <= 0 || value.amountUsd > 1e16) return null
  if (typeof value.asOf !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value.asOf)) return null
  const date = value.asOf.length === 4 ? `${value.asOf}-01-01` : value.asOf.length === 7 ? `${value.asOf}-01` : value.asOf
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today || date < '1900-01-01') return null
  const sourceUrl = safeWebUrl(value.sourceUrl)
  if (!sourceUrl || !sourceUrls.has(sourceUrl)) return null
  return { kind: value.kind, amountUsd: value.amountUsd, asOf: value.asOf, sourceUrl }
}

export function sortCompanies(companies: Company[], sort: CompanySort): Company[] {
  if (sort === 'match') return [...companies]
  return [...companies].sort((a, b) => {
    if (!a.value && !b.value) return 0
    if (!a.value) return 1
    if (!b.value) return -1
    return sort === 'value_desc' ? b.value.amountUsd - a.value.amountUsd : a.value.amountUsd - b.value.amountUsd
  })
}

export function formatUsd(amount: number): string {
  const unit = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']].find(([scale]) => amount >= Number(scale))
  const number = unit ? amount / Number(unit[0]) : amount
  return `$${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number)}${unit ? unit[1] : ''}`
}
