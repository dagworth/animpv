import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getEpisodesList, searchAnime, getEpisodeData, PlayableSource } from './hianime'
import { spawn } from 'child_process'

const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon.ico')
  : join(__dirname, '../../resources/icon.ico')

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 1300,
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
  //     callback(0);
  // });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('api-search-anime', async (_event, query) => {
    return await searchAnime(query)
  })
  ipcMain.handle('api-get-anime-episode-list', async (_event, query) => {
    return await getEpisodesList(query)
  })
  ipcMain.handle('api-get-anime-video', async (event, a, b) => {
    const webContents = event.sender

    const logger = (msg: string) => {
      webContents.send('mpv-log', msg)
    }

    return await getEpisodeData(a, b, logger)
  })
  ipcMain.handle('launch-mpv', async (event, source: PlayableSource) => {
    const webContents = event.sender
    const videoUrl = source.sourceUrl
    //the stream host only serves the segments to the embed site it came from
    const referrer = source.referrer ?? ''

    const mpv_args = [
      '--fs',
      '--hwdec=auto', //gpu does decoding
      '--vo=gpu', //gpu rendering
      '--cache=yes', //mpv caching
      '--demuxer-max-bytes=500M' //buffer size of 500mb, idk if needed
    ]

    //regex woo
    if (/\.(mp4|mkv|m3u8|mov|webm)(\?.*)?$/i.test(videoUrl)) {
      mpv_args.push('--ytdl=no')
    }

    if (referrer) {
      mpv_args.push(`--referrer=${referrer}`)
    }

    //subtitles are a separate track now, toggle them in mpv with 'v'
    if (source.subtitle) {
      mpv_args.push(`--sub-file=${source.subtitle}`)
    }

    mpv_args.push(
      `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`
    )

    console.log(`Launching mpv with arguments: ${mpv_args.join(' ')} ${videoUrl}`)
    const player = spawn('mpv', [...mpv_args, videoUrl])

    player.stdout.on('data', (data) => {
      webContents.send('mpv-log', `[mpv stdout]: ${data.toString().trim()}`)
    })

    player.stderr.on('data', (data) => {
      webContents.send('mpv-log', `[mpv stderr]: ${data.toString().trim()}`)
    })

    player.on('close', (code) => {
      webContents.send('mpv-log', `[mpv close]: Process closed with code ${code}`)
    })
  })
  createWindow()
})
