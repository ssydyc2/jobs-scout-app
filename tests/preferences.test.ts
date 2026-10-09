import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureLocalPreferences, readPreferencesText, savePreferencesText } from '../src/main/preferences'

const original = '{"interests":["AI + finance"]}'
const edited = '{"interests":["AI + healthcare"],"companiesPerCategory":5}'
let directory: string
let path: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'scout-preferences-'))
  path = join(directory, 'preferences.json')
  await writeFile(path, original)
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('editing preference files', () => {
  it('creates an editable local copy once and preserves edits on restart', async () => {
    const profile = join(directory, 'profile')
    const local = await ensureLocalPreferences(path, profile)
    expect(await readFile(local, 'utf8')).toBe(original)
    await writeFile(local, edited)
    expect(await ensureLocalPreferences(path, profile)).toBe(local)
    expect(await readFile(local, 'utf8')).toBe(edited)
    expect(await readFile(path, 'utf8')).toBe(original)
  })
  it('saves valid JSON to the selected file and cleans up the temporary replacement', async () => {
    const draft = await readPreferencesText(path)
    await savePreferencesText(path, { path, content: edited, originalContent: draft.content })
    expect(await readFile(path, 'utf8')).toBe(edited)
    expect(await readdir(directory)).toEqual(['preferences.json'])
  })
  it('rejects invalid JSON, credentials, and edits targeting another file without changing the file', async () => {
    for (const request of [
      { path, content: '{', originalContent: original },
      { path, content: '{"interests":["AI"],"apiKey":"secret"}', originalContent: original },
      { path: join(directory, 'other.json'), content: edited, originalContent: original },
      { path, content: edited, originalContent: null }
    ]) {
      await expect(savePreferencesText(path, request)).rejects.toThrow()
      expect(await readFile(path, 'utf8')).toBe(original)
    }
  })
  it('rejects stale edits instead of overwriting a change from an external editor', async () => {
    await writeFile(path, edited)
    await expect(savePreferencesText(path, { path, content: original, originalContent: original })).rejects.toThrow('changed outside the app')
    expect(await readFile(path, 'utf8')).toBe(edited)
  })
  it('can open and repair malformed JSON', async () => {
    await writeFile(path, '{broken')
    const draft = await readPreferencesText(path)
    expect(draft.content).toBe('{broken')
    await savePreferencesText(path, { path, content: edited, originalContent: draft.content })
    expect(await readFile(path, 'utf8')).toBe(edited)
  })
  it('enforces the file size limit before writing', async () => {
    const large = original + ' '.repeat(64 * 1024)
    await expect(savePreferencesText(path, { path, content: large, originalContent: original })).rejects.toThrow('64 KB')
    expect(await readFile(path, 'utf8')).toBe(original)
  })
})
