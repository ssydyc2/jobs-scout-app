import { contextBridge, ipcRenderer } from 'electron'
import type { ScoutApi } from '../shared/types'

const api: ScoutApi = {
  getConfig: () => ipcRenderer.invoke('scout:get-config'),
  chooseConfig: () => ipcRenderer.invoke('scout:choose-config'),
  saveExample: () => ipcRenderer.invoke('scout:save-example'),
  editConfig: () => ipcRenderer.invoke('scout:edit-config'),
  saveConfig: (request) => ipcRenderer.invoke('scout:save-config', request),
  getLibrary: () => ipcRenderer.invoke('scout:get-library'),
  search: (options) => ipcRenderer.invoke('scout:search', options),
  searchJobs: (options) => ipcRenderer.invoke('scout:search-jobs', options),
  cancelSearch: () => ipcRenderer.invoke('scout:cancel'),
  openLink: (url) => ipcRenderer.invoke('scout:open-link', url),
  copyNames: (names) => ipcRenderer.invoke('scout:copy-names', names),
  onProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('scout:progress', receive)
    return () => ipcRenderer.removeListener('scout:progress', receive)
  },
  onLibraryChanged: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, library: Parameters<typeof listener>[0]) => listener(library)
    ipcRenderer.on('scout:library-changed', receive)
    return () => ipcRenderer.removeListener('scout:library-changed', receive)
  },
  onJobProgress: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
    ipcRenderer.on('scout:job-progress', receive)
    return () => ipcRenderer.removeListener('scout:job-progress', receive)
  }
}
contextBridge.exposeInMainWorld('scout', api)
