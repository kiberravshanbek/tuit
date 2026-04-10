const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kioskBridge', {
    isKiosk: true,
    startSession(payload) {
        return ipcRenderer.invoke('kiosk:start-session', payload || {})
    },
    goLauncher() {
        return ipcRenderer.invoke('kiosk:go-launcher')
    },
    getRuntime() {
        return ipcRenderer.invoke('kiosk:get-runtime')
    },
    setAttemptContext(context) {
        ipcRenderer.send('kiosk:set-attempt-context', context || {})
    },
    clearAttemptContext() {
        ipcRenderer.send('kiosk:clear-attempt-context')
    },
    requestForceFinish(payload) {
        return ipcRenderer.invoke('kiosk:force-finish', payload || {})
    },
    onHostPolicyFinish(callback) {
        if (typeof callback !== 'function') return () => {}
        const listener = (_event, payload) => callback(payload || {})
        ipcRenderer.on('kiosk:host-policy-finish', listener)
        return () => ipcRenderer.removeListener('kiosk:host-policy-finish', listener)
    },
})
