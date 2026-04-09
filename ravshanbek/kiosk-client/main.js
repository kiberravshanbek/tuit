const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const path = require('path')

let mainWindow = null
let currentServerOrigin = ''
let activeAttempt = null
let forceClosing = false
let hostPolicyInProgress = false

function sanitizeServerOrigin(rawUrl) {
    try {
        const parsed = new URL(String(rawUrl || '').trim())
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return ''
        }
        return parsed.origin
    } catch {
        return ''
    }
}

function sanitizeEmail(rawEmail) {
    return String(rawEmail || '').trim().slice(0, 254)
}

function buildTestUrl(origin, email) {
    const params = new URLSearchParams({ kiosk: '1' })
    const cleanEmail = sanitizeEmail(email)
    if (cleanEmail) {
        params.set('email', cleanEmail)
    }
    return `${origin}/test.html?${params.toString()}`
}

function sanitizeAttemptContext(rawContext) {
    if (!rawContext || typeof rawContext !== 'object') return null
    const attemptId = Number.parseInt(rawContext.attemptId, 10)
    const attemptToken = String(rawContext.attemptToken || '').trim().slice(0, 128)
    if (!Number.isInteger(attemptId) || attemptId <= 0 || !attemptToken) return null
    return { attemptId, attemptToken }
}

async function requestForceFinish(reason, details) {
    if (!activeAttempt || !currentServerOrigin) {
        return { success: false, skipped: true }
    }

    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 5000)

        const res = await fetch(`${currentServerOrigin}/api/test/force-finish`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: currentServerOrigin,
            },
            body: JSON.stringify({
                attemptId: activeAttempt.attemptId,
                attemptToken: activeAttempt.attemptToken,
                reason: String(reason || 'kiosk_host_force_finish').slice(0, 50),
                details: String(details || '').slice(0, 200),
            }),
            signal: controller.signal,
        })
        clearTimeout(timer)

        if (!res.ok) {
            return { success: false, skipped: false, status: res.status }
        }
        return { success: true, skipped: false }
    } catch {
        return { success: false, skipped: false }
    }
}

async function triggerHostPolicyFinish(reason, details) {
    if (hostPolicyInProgress) return
    hostPolicyInProgress = true

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('kiosk:host-policy-finish', {
            reason: String(reason || 'kiosk_host_force_finish'),
            details: String(details || ''),
        })
    }

    await requestForceFinish(reason, details)
    forceClosing = true
    setTimeout(() => app.quit(), 150)
}

function blockDangerousShortcuts(win) {
    win.webContents.on('before-input-event', (event, input) => {
        const key = String(input.key || '').toLowerCase()
        const hasCtrl = !!input.control
        const hasShift = !!input.shift
        const hasAlt = !!input.alt
        const hasMeta = !!input.meta

        const blocked =
            key === 'f11' ||
            key === 'f12' ||
            (hasAlt && key === 'f4') ||
            (hasCtrl && key === 'r') ||
            (hasCtrl && key === 'p') ||
            (hasCtrl && key === 'w') ||
            (hasCtrl && hasShift && key === 'i') ||
            (hasCtrl && hasShift && key === 'j') ||
            (hasCtrl && hasShift && key === 'c') ||
            (hasMeta && key === 'q')

        if (blocked) {
            event.preventDefault()
        }
    })
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 780,
        minWidth: 1024,
        minHeight: 700,
        kiosk: true,
        fullscreen: true,
        autoHideMenuBar: true,
        show: false,
        alwaysOnTop: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            devTools: false,
        },
    })

    mainWindow.on('ready-to-show', () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.show()
        mainWindow.focus()
        mainWindow.setAlwaysOnTop(true, 'screen-saver')
        mainWindow.setKiosk(true)
    })

    mainWindow.on('blur', () => {
        if (activeAttempt) {
            triggerHostPolicyFinish('kiosk_focus_lost', 'window-blur')
        }
    })

    mainWindow.on('minimize', (event) => {
        event.preventDefault()
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.restore()
            mainWindow.focus()
        }
        if (activeAttempt) {
            triggerHostPolicyFinish('kiosk_focus_lost', 'window-minimize')
        }
    })

    mainWindow.on('leave-full-screen', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setFullScreen(true)
            mainWindow.setKiosk(true)
            mainWindow.focus()
        }
        if (activeAttempt) {
            triggerHostPolicyFinish('kiosk_focus_lost', 'leave-full-screen')
        }
    })

    mainWindow.on('close', (event) => {
        if (!forceClosing && activeAttempt) {
            event.preventDefault()
            triggerHostPolicyFinish('kiosk_app_closed', 'window-close')
        }
    })

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (!targetUrl) return
        if (targetUrl.startsWith('file://')) return
        if (!currentServerOrigin) {
            event.preventDefault()
            return
        }
        if (!targetUrl.startsWith(currentServerOrigin)) {
            event.preventDefault()
        }
    })

    blockDangerousShortcuts(mainWindow)
    mainWindow.loadFile(path.join(__dirname, 'launcher.html'))
}

ipcMain.handle('kiosk:start-session', async (_event, payload) => {
    const serverOrigin = sanitizeServerOrigin(payload && payload.serverUrl)
    const email = sanitizeEmail(payload && payload.email)
    if (!serverOrigin) {
        return { success: false, message: 'Server URL noto`g`ri.' }
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, message: 'Asosiy oyna topilmadi.' }
    }

    try {
        currentServerOrigin = serverOrigin
        activeAttempt = null
        hostPolicyInProgress = false
        forceClosing = false
        await mainWindow.loadURL(buildTestUrl(serverOrigin, email))
        mainWindow.setKiosk(true)
        mainWindow.focus()
        return { success: true }
    } catch (err) {
        return { success: false, message: "Test sahifasini ochib bo'lmadi: " + String(err && err.message ? err.message : err) }
    }
})

ipcMain.handle('kiosk:go-launcher', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return { success: false, message: 'Asosiy oyna topilmadi.' }
    }
    try {
        activeAttempt = null
        hostPolicyInProgress = false
        await mainWindow.loadFile(path.join(__dirname, 'launcher.html'))
        mainWindow.setKiosk(true)
        mainWindow.focus()
        return { success: true }
    } catch (err) {
        return { success: false, message: String(err && err.message ? err.message : err) }
    }
})

ipcMain.handle('kiosk:force-finish', async (_event, payload) => {
    const reason = payload && payload.reason ? payload.reason : 'kiosk_host_force_finish'
    const details = payload && payload.details ? payload.details : ''
    return requestForceFinish(reason, details)
})

ipcMain.handle('kiosk:get-runtime', () => {
    return {
        isKiosk: true,
        appVersion: app.getVersion(),
        platform: process.platform,
    }
})

ipcMain.on('kiosk:set-attempt-context', (_event, context) => {
    const parsed = sanitizeAttemptContext(context)
    if (parsed) {
        activeAttempt = parsed
        hostPolicyInProgress = false
    }
})

ipcMain.on('kiosk:clear-attempt-context', () => {
    activeAttempt = null
    hostPolicyInProgress = false
})

app.on('ready', () => {
    Menu.setApplicationMenu(null)
    createMainWindow()
})

app.on('window-all-closed', () => {
    app.quit()
})

app.on('before-quit', async (event) => {
    if (forceClosing || !activeAttempt) return
    event.preventDefault()
    await triggerHostPolicyFinish('kiosk_app_closed', 'app-before-quit')
})
