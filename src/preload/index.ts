import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PlayableSource } from '../main/hianime'

const api = {
  api_searchAnime: (query: string): Promise<string> =>
    ipcRenderer.invoke('api-search-anime', query),
  api_getAnimeEpisodeList: (query: string): Promise<string> =>
    ipcRenderer.invoke('api-get-anime-episode-list', query),
  api_getAnimeVideo: (anime_id: string, episode_id: string): Promise<string> =>
    ipcRenderer.invoke('api-get-anime-video', anime_id, episode_id),
  api_launchPlayer: (source: PlayableSource) => ipcRenderer.invoke('launch-mpv', source),
  onLog: (callback: (log: string) => void) => {
    const subscription = (_event: any, value: string) => callback(value)
    ipcRenderer.on('mpv-log', subscription)
    return () => ipcRenderer.removeListener('mpv-log', subscription)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    console.error(e)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
