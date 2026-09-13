export interface IElectronAPI {
  api_searchAnime: (query: string) => Promise<any>
  api_getAnimeEpisodeList: (query: string) => Promise<any>
  api_getAnimeVideo: (a: string, b: string) => Promise<any>
  api_launchPlayer: (source: any) => void
  onLog: (callback: (log: string) => void) => () => void
}

declare global {
  interface Window {
    api: IElectronAPI
  }
}
