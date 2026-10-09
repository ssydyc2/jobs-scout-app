import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseConfig, safeWebUrl } from '../src/shared/validation'

describe('preference files', () => {
  it('loads the shipped sample and a minimal user file', () => {
    expect(parseConfig(readFileSync('examples/scout.json', 'utf8')).interests).toEqual(['AI + finance', 'AI + healthcare'])
    expect(parseConfig('{"interests":[" AI + finance "]}')).toMatchObject({ interests: ['AI + finance'], roles: [], locations: [], companiesPerCategory: 100 })
  })
  it('accepts a UTF-8 BOM and removes duplicate directions', () => {
    expect(parseConfig('\uFEFF{"interests":["AI"," AI "]}').interests).toEqual(['AI'])
  })
  it.each(['', '[]', '{"interests":[]}', '{"interests":"AI"}', '{"interests":[123]}', '{"interests":[" "]}', '{"interests":["AI"],"roles":null}', '{"interests":["AI"],"companiesPerCategory":0}', '{"interests":["AI"],"companiesPerCategory":101}', '{"interests":["AI"],"companiesPerCategory":1.5}'])('rejects an invalid file: %s', (raw) => {
    expect(() => parseConfig(raw)).toThrow()
  })
  it('rejects credentials in configuration files', () => {
    expect(() => parseConfig('{"interests":["AI"],"apiKey":"secret"}')).toThrow('API key')
  })
  it('defaults to 100 per category when loading a legacy file with a total maxResults field', () => {
    expect(parseConfig('{"interests":["AI + finance","AI + healthcare"],"maxResults":12}').companiesPerCategory).toBe(100)
    expect(() => parseConfig('{"interests":["AI"],"maxResults":"secret"}')).toThrow('legacy maxResults')
  })
})

describe('external links', () => {
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://localhost', 'http://127.0.0.1', 'https://[::1]', 'https://computer.local', 'not a url', null])('rejects unsafe links: %s', (url) => {
    expect(safeWebUrl(url)).toBeNull()
  })
  it('accepts a normal public company website', () => {
    expect(safeWebUrl('https://example.com/careers')).toBe('https://example.com/careers')
  })
})
