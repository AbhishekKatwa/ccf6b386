import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, ClipboardList, Warehouse, Layers, Wheat, FlaskConical, Handshake,
  Wallet, BarChart3, User, Phone, CloudSun, Menu, Plus, Egg, Skull, Lock,
  Wifi, WifiOff, RefreshCw, Feather,
} from 'lucide-react';
import { useApp, useCurrentUser, useCan } from '@/store/app';
import { Avatar } from '@/components/ui/Card';
import { ActionSheet } from '@/components/ui/Dialog';
import { ROLE_LABELS } from '@/types';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }
interface NavGroup { title: string; items: NavItem[] }

const GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Today', icon: <LayoutDashboard size={17} />, end: true },
      { to: '/tasks', label: 'Tasks', icon: <ClipboardList size={17} /> },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/farms', label: 'Farms', icon: <Warehouse size={17} /> },
      { to: '/batches', label: 'Batches', icon: <Layers size={17} /> },
      { to: '/feed', label: 'Feed stock', icon: <Wheat size={17} /> },
      { to: '/feed/formulas', label: 'Formulas', icon: <FlaskConical size={17} /> },
    ],
  },
  {
    title: 'Commerce',
    items: [
      { to: '/traders', label: 'Traders', icon: <Handshake size={17} /> },
      { to: '/finance', label: 'Finance', icon: <Wallet size={17} /> },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 size={17} /> },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/profile', label: 'Profile', icon: <User size={17} /> },
      { to: '/contact', label: 'Support', icon: <Phone size={17} /> },
      { to: '/weather', label: 'Weather', icon: <CloudSun size={17} /> },
    ],
  },
];

const MOBILE_TABS: NavItem[] = [
  { to: '/', label: 'Today', icon: <LayoutDashboard size={20} />, end: true },
  { to: '/farms', label: 'Farms', icon: <Warehouse size={20} /> },
  { to: '/traders', label: 'Trade', icon: <Handshake size={20} /> },
  { to: '/finance', label: 'Money', icon: <Wallet size={20} /> },
];

export function SyncPill({ compact = false }: { compact?: boolean }) {
  const online = useApp(s => s.online);
  const syncPending = useApp(s => s.syncPending);
  const pushToast = useApp(s => s.pushToast);
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const pending = [...mortality, ...feed, ...eggs].filter(x => !x.synced).length;

  if (!online) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft text-warn px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]">
        <WifiOff size={11} /> Offline
      </span>
    );
  }
  return (
    <button
      onClick={() => { if (pending) { syncPending(); pushToast('success', `${pending} record${pending === 1 ? '' : 's'} synced`); } }}
      className="inline-flex items-center gap-1.5 rounded-full bg-success-soft text-success px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] press"
      title={pending ? `${pending} pending sync — tap to sync` : 'All synced'}
    >
      {pending ? <RefreshCw size={11} /> : <Wifi size={11} />}
      {compact ? (pending ? `${pending}` : 'Synced') : pending ? `${pending} to sync` : 'Synced'}
    </button>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card">
        <Feather size={17} />
      </span>
      <div className="leading-tight">
        <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Amrut Poultry</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Management</p>
      </div>
    </div>
  );
}

function Sidebar({ onQuickAdd }: { onQuickAdd: () => void }) {
  const user = useCurrentUser();
  const signOut = useApp(s => s.signOut);
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-line bg-card/70 backdrop-blur min-h-screen sticky top-0">
      <div className="px-5 py-5"><BrandMark /></div>
      <nav className="flex-1 px-3 pb-4 overflow-y-auto no-scrollbar">
        {GROUPS.map(g => (
          <div key={g.title} className="mb-4">
            <p className="px-3 mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-2">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map(it => (
                <NavLink
                  key={it.to} to={it.to} end={it.end}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-colors',
                    isActive ? 'bg-brand-soft text-brand-ink font-semibold' : 'text-ink-2 hover:bg-sunk',
                  )}
                >
                  <span className="shrink-0">{it.icon}</span>{it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-3 pb-3">
        <button
          onClick={onQuickAdd}
          className="w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-[12px] px-3 py-2.5 text-[13px] font-semibold press hover:bg-brand-2 shadow-card"
        >
          <Plus size={15} /> Quick add
        </button>
      </div>
      {user && (
        <div className="px-4 py-4 border-t border-line-2">
          <div className="flex items-center gap-3">
            <Avatar name={user.name} size={34} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-ink truncate">{user.name}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted truncate">{ROLE_LABELS[user.role]}</p>
            </div>
            <button onClick={signOut} className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-danger press">Exit</button>
          </div>
          <div className="mt-3"><SyncPill /></div>
        </div>
      )}
    </aside>
  );
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const loc = useLocation();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom">
      <div className="mx-auto max-w-[520px] px-3 pb-2">
        <div className="grid grid-cols-5 bg-card/95 backdrop-blur-md border border-line rounded-[18px] shadow-float overflow-hidden">
          {MOBILE_TABS.map(t => (
            <NavLink
              key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => clsx(
                'flex flex-col items-center justify-center gap-1 py-2.5 transition-colors press',
                isActive ? 'text-brand' : 'text-muted',
              )}
            >
              {({ isActive }) => (
                <>
                  <span className={clsx('rounded-full px-3 py-0.5 transition-colors', isActive && 'bg-brand-soft')}>{t.icon}</span>
                  <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={onMore}
            className={clsx(
              'flex flex-col items-center justify-center gap-1 py-2.5 press',
              !MOBILE_TABS.some(t => (t.end ? loc.pathname === t.to : loc.pathname.startsWith(t.to))) ? 'text-brand' : 'text-muted',
            )}
          >
            <Menu size={20} />
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">More</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

function useQuickActions() {
  const nav = useNavigate();
  const canCreate = useCan('create');
  const canLock = useCan('lockDay');
  const batches = useApp(s => s.batches);
  const live = batches.find(b => b.status === 'LIVE');
  const b = live?.id ? `/batches/${live.id}` : '/batches';
  const actions = [] as { icon: ReactNode; label: string; hint?: string; onClick: () => void }[];
  if (canCreate) {
    actions.push(
      { icon: <Egg size={16} />, label: 'Collect eggs', hint: 'Log today\'s collection', onClick: () => nav(`${b}/eggs`) },
      { icon: <Skull size={16} />, label: 'Record mortality', hint: 'Add a daily entry', onClick: () => nav(`${b}/mortality`) },
      { icon: <Wheat size={16} />, label: 'Log feed', hint: 'Consumption or stock', onClick: () => nav('/feed') },
      { icon: <ClipboardList size={16} />, label: 'New task', hint: 'Assign daily work', onClick: () => nav('/tasks') },
      { icon: <Handshake size={16} />, label: 'New egg sale', hint: 'Trays × rate', onClick: () => nav(`${b}/eggs/new-sale`) },
      { icon: <Wallet size={16} />, label: 'Add transaction', hint: 'Income or expense', onClick: () => nav('/finance') },
    );
  }
  if (canLock) actions.push({ icon: <Lock size={16} />, label: 'Lock a day', hint: 'Freeze historical data', onClick: () => nav(`${b}/mortality`) });
  return actions;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const nav = useNavigate();
  const quick = useQuickActions();

  return (
    <div className="min-h-screen bg-canvas flex">
      <Sidebar onQuickAdd={() => setQuickOpen(true)} />
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1080px] px-0 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      {/* mobile quick-action FAB */}
      <button
        onClick={() => setQuickOpen(true)}
        aria-label="Quick add"
        className="lg:hidden fixed right-4 bottom-24 z-40 w-13 h-13 rounded-full bg-brand text-white shadow-float flex items-center justify-center press"
        style={{ width: 52, height: 52 }}
      >
        <Plus size={22} />
      </button>

      <BottomNav onMore={() => setMoreOpen(true)} />

      <ActionSheet
        open={moreOpen} onClose={() => setMoreOpen(false)} title="More"
        actions={[
          { icon: <ClipboardList size={16} />, label: 'Tasks', hint: 'Daily work & assignments', onClick: () => nav('/tasks') },
          { icon: <BarChart3 size={16} />, label: 'Reports', hint: 'Broiler & layer reports', onClick: () => nav('/reports') },
          { icon: <Wheat size={16} />, label: 'Feed stock', hint: 'Central godown inventory', onClick: () => nav('/feed') },
          { icon: <Layers size={16} />, label: 'All batches', onClick: () => nav('/batches') },
          { icon: <User size={16} />, label: 'Profile & settings', onClick: () => nav('/profile') },
          { icon: <CloudSun size={16} />, label: 'Weather', onClick: () => nav('/weather') },
          { icon: <Phone size={16} />, label: 'Support', onClick: () => nav('/contact') },
        ]}
      />
      <ActionSheet open={quickOpen} onClose={() => setQuickOpen(false)} title="Quick add" actions={quick} />
    </div>
  );
}
