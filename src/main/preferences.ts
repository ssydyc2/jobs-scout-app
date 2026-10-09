import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ConfigDraft, ConfigSaveRequest } from '../shared/types'
import { parseConfig, record } from '../shared/validation'

export const CONFIG_LIMIT_BYTES = 64 * 1024

export async function ensureLocalPreferences(examplePath: string, userDataPath: string): Promise<string> {
  await mkdir(userDataPath, { recursive: true })
  const path = join(userDataPath, 'scout.json')
  try { await copyFile(examplePath, path, constants.COPYFILE_EXCL) }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
  return path
}

export async function readPreferencesText(path: string): Promise<ConfigDraft> {
  try {
    if ((await stat(path)).size > CONFIG_LIMIT_BYTES) throw new Error('The preference file must be no larger than 64 KB.')
    const content = await readFile(path, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > CONFIG_LIMIT_BYTES) throw new Error('The preference file must be no larger than 64 KB.')
    return { path, content }
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw new Error('Could not read the preference file. Make sure it exists and is accessible, or import it again.')
    throw error
  }
}

export async function savePreferencesText(currentPath: string, value: unknown): Promise<void> {
  const request = record(value) as unknown as ConfigSaveRequest
  if (request.path !== currentPath) throw new Error('The selected file has changed. Close the editor and open it again.')
  if (typeof request.content !== 'string' || typeof request.originalContent !== 'string') throw new Error('Invalid preference edit.')
  if (Buffer.byteLength(request.content, 'utf8') > CONFIG_LIMIT_BYTES) throw new Error('The preference file must be no larger than 64 KB.')
  parseConfig(request.content)
  const original = await readPreferencesText(currentPath)
  if (original.content !== request.originalContent) throw new Error('This file was changed outside the app. Close and reopen the editor to load the latest version.')
  const temporary = join(dirname(currentPath), `.scout-${randomUUID()}.tmp`)
  try {
    const { mode } = await stat(currentPath)
    await writeFile(temporary, request.content, { encoding: 'utf8', flag: 'wx', mode })
    // Recheck after preparing the replacement to avoid overwriting a concurrent external edit.
    if ((await readPreferencesText(currentPath)).content !== request.originalContent) {
      throw new Error('This file was changed outside the app. Close and reopen the editor to load the latest version.')
    }
    await rename(temporary, currentPath)
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw new Error('Could not save this file. Check that its folder is writable and try again.')
    throw error
  } finally { await unlink(temporary).catch(() => {}) }
}
