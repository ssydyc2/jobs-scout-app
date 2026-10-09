import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ConfigDocument, Reply } from '../shared/types'
import { parseConfig, safeWebUrl } from '../shared/validation'
import { ScoutError, searchCompanies, validateOptions } from './scout'
import { ensureLocalPreferences, readPreferencesText, savePreferencesText } from './preferences'

let window: BrowserWindow | null = null
let configPath: string
let controller: AbortController | null = null
const rendererFile = join(__dirname, '../renderer/index.html')
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const examplePath = app.isPackaged ? join(process.resourcesPath, 'scout.json') : join(app.getAppPath(), 'examples/scout.json')

async function readConfig(path = configPath): Promise<ConfigDocument> {
  const document = await readPreferencesText(path)
  return { path, config: parseConfig(document.content), isExample: path === examplePath }
}

function trusted(event: IpcMainInvokeEvent): boolean {
  return !!window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame.url === (devUrl ? new URL(devUrl).href : pathToFileURL(rendererFile).href)
}

function handle<T>(channel: string, action: (value: unknown) => Promise<T>) {
  ipcMain.handle(channel, async (event, value): Promise<Reply<T>> => {
    if (!trusted(event)) return { ok: false, error: 'Invalid request origin.' }
    try { return { ok: true, data: await action(value) } }
    catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Something went wrong. Please try again.', cancelled: error instanceof ScoutError && error.cancelled }
    }
  })
}

function installHandlers() {
  handle('scout:get-config', () => readConfig())
  handle('scout:edit-config', () => readPreferencesText(configPath))
  handle('scout:save-config', async (value) => {
    if (controller) throw new Error('Wait for the current search to finish before editing preferences.')
    await savePreferencesText(configPath, value)
    return readConfig()
  })
  handle('scout:choose-config', async () => {
    const result = await dialog.showOpenDialog(window!, {
      title: 'Choose your preference file', properties: ['openFile'], filters: [{ name: 'JSON preferences', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const document = await readConfig(await realpath(result.filePaths[0]))
    configPath = document.path
    return document
  })
  handle('scout:save-example', async () => {
    const result = await dialog.showSaveDialog(window!, {
      title: 'Save your preferences', defaultPath: join(app.getPath('documents'), 'scout.json'),
      filters: [{ name: 'JSON preferences', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, await readFile(examplePath, 'utf8'), 'utf8')
    const document = await readConfig(await realpath(result.filePath))
    configPath = document.path
    return document
  })
  handle('scout:search', async (input) => {
    const options = validateOptions(input)
    if (controller) throw new Error('A search is already in progress.')
    const current = new AbortController()
    controller = current
    try {
      const document = await readConfig()
      return await searchCompanies(document.config, options, current.signal, undefined, undefined, undefined, (progress) => {
        if (window && !window.isDestroyed()) window.webContents.send('scout:progress', progress)
      })
    } finally { controller = null }
  })
  handle('scout:cancel', async () => { controller?.abort(); return null })
  handle('scout:open-link', async (value) => {
    const url = safeWebUrl(value)
    if (!url) throw new Error('This link is not a valid website URL.')
    await shell.openExternal(url)
    return null
  })
  handle('scout:copy-names', async (value) => {
    if (!Array.isArray(value) || !value.length || value.length > 3000 || value.some((name) => typeof name !== 'string' || !name.trim() || name.length > 150)) {
      throw new Error('No valid company names to copy.')
    }
    clipboard.writeText(value.join('\n'))
    return null
  })
}

function createWindow() {
  window = new BrowserWindow({
    width: 1220, height: 820, minWidth: 940, minHeight: 660,
    title: 'Jobs Scout', backgroundColor: '#f7f8fa', titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 19 },
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.on('closed', () => { controller?.abort(); window = null })
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(rendererFile)
}

app.setName('Jobs Scout')
const userDataOverride = app.commandLine.getSwitchValue('user-data-dir')
if (userDataOverride) app.setPath('userData', userDataOverride)
app.whenReady().then(async () => {
  configPath = await realpath(await ensureLocalPreferences(examplePath, app.getPath('userData')))
  installHandlers()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Jobs Scout', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]))
  createWindow()
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
