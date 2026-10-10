import { useEffect, useState } from 'react'
import { RefreshCw, Wifi, WifiOff, X } from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'

function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

export function ConnectionBadge() {
  const online = useOnlineStatus()
  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
        online
          ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
          : 'border-amber-300/30 bg-amber-400/15 text-amber-200'
      }`}
    >
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? 'Online' : 'Offline · saved on device'}
    </div>
  )
}

/** Registers the service worker and surfaces update / offline-ready notices. Never reloads on its own. */
export function PwaNotices() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!offlineReady && !needRefresh) return null

  return (
    <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-electric-400/30 bg-ink-900 p-4 text-sm text-slate-200 shadow-2xl">
      <div className="flex-1">
        {needRefresh ? (
          <>
            <p className="font-semibold text-white">Update available</p>
            <p className="mt-1 text-xs text-slate-400">Finish any report you are entering, then update. Saved reports and history are kept.</p>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-electric-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-electric-400"
            >
              <RefreshCw size={14} /> Reload to update
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-white">Ready to work offline</p>
            <p className="mt-1 text-xs text-slate-400">CrowdX is cached on this device.</p>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => (needRefresh ? setNeedRefresh(false) : setOfflineReady(false))}
        className="text-slate-400 hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  )
}
