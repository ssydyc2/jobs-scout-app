import type { ScoutConfig } from './types'

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.')
  }
  return value as Record<string, unknown>
}

function strings(value: unknown, label: string, required = false): string[] {
  if (value === undefined && !required) return []
  if (!Array.isArray(value) || value.length > 30 || value.some((v) => typeof v !== 'string' || !v.trim() || v.length > 200)) {
    throw new Error(`${label} must be an array of up to 30 strings, each 1–200 characters long.`)
  }
  const result = [...new Set((value as string[]).map((v) => v.trim()))]
  if (required && !result.length) throw new Error(`${label} must include at least one interest, such as AI + finance.`)
  return result
}

function text(value: unknown, label: string, fallback = '', max = 2000): string {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text of no more than ${max} characters.`)
  return value.trim()
}

export function parseConfig(raw: string): ScoutConfig {
  let value: unknown
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')) }
  catch { throw new Error('The preference file is not valid JSON. Check commas, quotes, and brackets.') }
  const config = record(value)
  // Credentials and provider settings never belong in a preference document.
  const allowed = new Set(['name', 'interests', 'roles', 'locations', 'companyStage', 'notes', 'companiesPerCategory', 'maxResults'])
  if (Object.keys(config).some((key) => !allowed.has(key))) {
    throw new Error('Unknown preference field. Supported fields: name, interests, roles, locations, companyStage, notes, companiesPerCategory. Enter your API key when searching.')
  }
  const companiesPerCategory = config.companiesPerCategory ?? 100
  // The retired total cap is accepted only for old files; new searches use the per-category target.
  if (config.maxResults !== undefined && (typeof config.maxResults !== 'number' || !Number.isInteger(config.maxResults) || config.maxResults < 1 || config.maxResults > 100)) {
    throw new Error('The legacy maxResults field must be numeric. Replace it with companiesPerCategory (1–100).')
  }
  if (typeof companiesPerCategory !== 'number' || !Number.isInteger(companiesPerCategory) || companiesPerCategory < 1 || companiesPerCategory > 100) {
    throw new Error('companiesPerCategory must be an integer between 1 and 100.')
  }
  return {
    name: text(config.name, 'name', 'My scout', 100) || 'My scout',
    interests: strings(config.interests, 'interests', true),
    roles: strings(config.roles, 'roles'),
    locations: strings(config.locations, 'locations'),
    companyStage: text(config.companyStage, 'companyStage', '', 200),
    notes: text(config.notes, 'notes'),
    companiesPerCategory
  }
}

export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
    const host = url.hostname.toLowerCase()
    if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^\d+(\.\d+){3}$/.test(host) || host.includes(':')) return null
    return url.href
  } catch { return null }
}
