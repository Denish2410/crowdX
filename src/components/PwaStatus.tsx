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
      className={`flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold ${
        online
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-amber-400 bg-amber-100 text-amber-900'
      }`}
    >
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {online ? <span>Online</span> : <span>Offline<span className="hidden sm:inline"> · saved on device</span></span>}
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
    <div role="alert" className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-line bg-white p-4 text-sm text-slate-700 shadow-lift">
      <div className="flex-1">
        {needRefresh ? (
          <>
            <p className="font-semibold text-ink">Update available</p>
            <p className="mt-1 text-xs text-muted">Finish any report you are entering, then update. Saved reports and history are kept.</p>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              <RefreshCw size={14} /> Reload to update
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-ink">Ready to work offline</p>
            <p className="mt-1 text-xs text-muted">CrowdX is cached on this device.</p>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => (needRefresh ? setNeedRefresh(false) : setOfflineReady(false))}
        className="text-muted hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  )
}
