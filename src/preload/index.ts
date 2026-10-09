import { contextBridge, ipcRenderer } from 'electron'
import type { ScoutApi } from '../shared/types'

const api: ScoutApi = {
  getConfig: () => ipcRenderer.invoke('scout:get-config'),
  chooseConfig: () => ipcRenderer.invoke('scout:choose-config'),
  saveExample: () => ipcRenderer.invoke('scout:save-example'),
  editConfig: () => ipcRenderer.invoke('scout:edit-config'),
  saveConfig: (request) => ipcRenderer.invoke('scout:save-config', request),
  search: (options) => ipcRenderer.invoke('scout:search', options),
  cancelSearch: () => ipcRenderer.invoke('scout:cancel'),
  openLink: (url) => ipcRenderer.invoke('scout:open-link', url),
  copyNames: (names) => ipcRenderer.invoke('scout:copy-names', names),
  onProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('scout:progress', receive)
    return () => ipcRenderer.removeListener('scout:progress', receive)
  }
}
contextBridge.exposeInMainWorld('scout', api)
