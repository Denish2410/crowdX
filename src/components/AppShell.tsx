import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ClipboardList, LayoutDashboard, Menu, TramFront, UserRound, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ConnectionBadge } from './PwaStatus'

export type View = 'overview' | 'reports' | 'stations'

const navItems: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'reports', label: 'Crowd Reports', icon: ClipboardList },
  { id: 'stations', label: 'Stations', icon: TramFront },
]

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-md shadow-brand-600/25"><TramFront size={21} aria-hidden /></div>
      <div><p className="text-lg font-bold leading-tight tracking-tight text-ink">CrowdX</p><p className="text-xs text-muted">Ahmedabad Metro</p></div>
    </div>
  )
}

function Nav({ view, onNavigate, badge }: { view: View; onNavigate: (view: View) => void; badge?: number }) {
  return (
    <nav aria-label="Main" className="space-y-1">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" onClick={() => onNavigate(id)} aria-current={view === id ? 'page' : undefined} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${view === id ? 'bg-tint text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-ink'}`}>
          <Icon size={18} aria-hidden />{label}
          {id === 'reports' && badge ? <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white">{badge}</span> : null}
        </button>
      ))}
    </nav>
  )
}

export function AppShell({ view, onNavigate, title, subtitle, activeCount, children }: { view: View; onNavigate: (view: View) => void; title: string; subtitle: string; activeCount: number; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false)

  useEffect(() => {
    if (!drawer) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawer])

  const navigate = (next: View) => { onNavigate(next); setDrawer(false) }
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-white px-4 py-6 lg:flex">
        <div className="px-2"><Brand /></div>
        <div className="mt-8"><p className="eyebrow mb-2 px-3">Workspace</p><Nav view={view} onNavigate={navigate} badge={activeCount} /></div>
        <div className="mt-auto rounded-xl bg-tint p-3.5 text-xs leading-5 text-brand-700"><strong className="block font-semibold">Works offline</strong>Reports are saved on this device and kept until site data is cleared.</div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white px-4 py-5 shadow-xl">
            <div className="flex items-center justify-between px-2"><Brand /><button type="button" onClick={() => setDrawer(false)} aria-label="Close navigation" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X size={18} /></button></div>
            <div className="mt-6"><Nav view={view} onNavigate={navigate} badge={activeCount} /></div>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu size={20} /></button>
          <div className="min-w-0 flex-1"><p className="truncate text-base font-bold tracking-tight text-ink lg:hidden">{title}</p><p className="hidden truncate text-sm font-medium text-slate-600 sm:block">{today}</p></div>
          <ConnectionBadge />
          <div className="hidden items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-3 text-xs sm:flex"><span className="grid h-7 w-7 place-items-center rounded-full bg-tint text-brand-700"><UserRound size={15} aria-hidden /></span><span className="font-medium text-slate-700">Demo staff</span></div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6"><h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1><p className="mt-1.5 max-w-2xl text-sm text-muted">{subtitle}</p></div>
        {children}
      </main>
    </div>
  )
}
