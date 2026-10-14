import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, apiChannel, eventChannel, type Api, type Bridge, type Events, type IpcResult } from '../shared/ipc'

const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>
for (const name of API_METHODS) {
  api[name] = async (...args) => {
    const res = (await ipcRenderer.invoke(apiChannel(name), ...args)) as IpcResult<unknown>
    if (!res.ok) throw new Error(res.error)
    return res.data
  }
}

const bridge: Bridge = {
  ...(api as unknown as Api),
  on(event, listener) {
    const channel = eventChannel(event as keyof Events)
    const wrapped = (_: unknown, payload: Events[typeof event]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('player', bridge)
