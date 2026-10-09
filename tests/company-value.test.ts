import { describe, expect, it } from 'vitest'
import type { Company } from '../src/shared/types'
import { formatUsd, parseCompanyValue, sortCompanies } from '../src/shared/company-value'

const sources = new Set(['https://example.com/value'])
const value = { kind: 'valuation', amountUsd: 1.5e9, asOf: '2025-06', sourceUrl: 'https://example.com/value' }
const today = '2026-10-09'

describe('reported company values', () => {
  it('requires a retrieved source and supports honest year, month, and day precision', () => {
    for (const asOf of ['2025', '2025-06', '2025-06-30']) {
      expect(parseCompanyValue({ ...value, asOf }, sources, today)).toEqual({ ...value, asOf })
    }
  })
  it.each([
    { amountUsd: '1.5B' }, { amountUsd: -1 }, { amountUsd: 0 }, { amountUsd: NaN }, { amountUsd: Infinity },
    { sourceUrl: 'https://invented.com/' }, { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: null },
    { asOf: '' }, { asOf: '2027' }, { asOf: '2025-02-30' }, { asOf: '2025-13' }, { kind: 'funding' }
  ])('drops unsupported or misleading values: %s', (invalid) => {
    expect(parseCompanyValue({ ...value, ...invalid }, sources, today)).toBeNull()
  })
  it('never presents unsourced offline figures as reported values', () => {
    expect(parseCompanyValue(value, new Set(), today)).toBeNull()
  })
  it('sorts numerically, keeps unknowns last in both directions, and preserves best-match order', () => {
    const companies = [
      { name: 'Unknown A', value: null }, { name: 'Small', value: { ...value, amountUsd: 8e6 } },
      { name: 'Unknown B', value: null }, { name: 'Big', value: { ...value, amountUsd: 1.5e9 } }
    ] as Company[]
    expect(sortCompanies(companies, 'value_desc').map((c) => c.name)).toEqual(['Big', 'Small', 'Unknown A', 'Unknown B'])
    expect(sortCompanies(companies, 'value_asc').map((c) => c.name)).toEqual(['Small', 'Big', 'Unknown A', 'Unknown B'])
    expect(sortCompanies(companies, 'match').map((c) => c.name)).toEqual(['Unknown A', 'Small', 'Unknown B', 'Big'])
    expect(companies[0].name).toBe('Unknown A')
  })
  it('formats comparable USD amounts without string-based sorting', () => {
    expect(formatUsd(1.5e9)).toBe('$1.5B')
    expect(formatUsd(8e6)).toBe('$8M')
    expect(formatUsd(2e12)).toBe('$2T')
  })
})
