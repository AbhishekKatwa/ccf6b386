import { lazy, Suspense, useState, useEffect, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, ClipboardList, Warehouse, Layers, Wheat, FlaskConical, Handshake,
  Wallet, BarChart3, User, Phone, Menu, Building2,
  Wifi, WifiOff, CloudOff, RefreshCw, Feather, Receipt, ChevronDown, Check, History, LogOut, BellRing,
  CalendarRange, Pill, Egg,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp, useCurrentUser, useOperableCompanies } from '@/store/app';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { Avatar } from '@/components/ui/Card';
import { ActionSheet, ConfirmDialog } from '@/components/ui/Dialog';
import { FORMULA_VIEW_ROLES, MEDICINE_ROLES } from '@/lib/permissions';
import { ROLE_LABELS, type Role } from '@/types';
import { useReducedMotion, EASE, INDICATOR_SPRING, MOTION, Presence } from '@/components/motion';
import { Search, X } from 'lucide-react';
import { allowed, mobileTabs, visibleGroups, type MoreAction } from './nav';

/**
 * The palette is a keystroke away, not a click away from the screen a person is on, so its
 * module — the component and the search index it builds — has no reason to ride along on every
 * boot. It is fetched on the first ask, and warmed while the tab is idle so ⌘K stays instant.
 */
const paletteModule = () => import('@/components/command/CommandPalette');
const CommandPalette = lazy(() => paletteModule().then(m => ({ default: m.CommandPalette })));

/** Nav is role-gated so users never see modules they cannot access (§14).
 *  MASTER_ADMIN sees every panel: platform duties require reading any company. */
const M: Role = 'MASTER_ADMIN';

/** The chord the palette listens for: ⌘K on a Mac, Ctrl K anywhere else. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SEARCH_KEY_HINT = IS_MAC ? '⌘K' : 'Ctrl K';

function searchChord(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k';
}

export function SyncPill({ compact = false }: { compact?: boolean }) {
  // The badge is the engine's real queue: rows the database does not have yet, and its own
  // sentence for the ones it refused. Tapping retries them — it never claims a sync the wire
  // did not complete. The attention list reads the same snapshot.
  const { cloud, online, pending, errors, syncing: busy, retry } = useSyncStatus();
  const detail = cloud && errors.length ? ` — ${errors.slice(0, 3).join(' · ')}` : '';

  if (!online) {
    // Offline is not the end of the story: what is still sitting in this browser waiting for
    // the wire is named alongside the reason it cannot go. Nothing is lost, and nothing hides.
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft text-warn px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
        title={pending ? `${pending} change(s) waiting for the internet — they will go out on their own when it returns` : undefined}
      >
        <WifiOff size={11} /> {pending ? `Offline · ${pending}` : 'Offline'}
      </span>
    );
  }
  // A build with no Supabase configured has no queue to report and no database to be synced
  // with: every record on it is this browser's alone. Saying "Synced" there would be the one
  // lie this chip exists to avoid, and it is the difference between farm data and demo data.
  if (!cloud) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft text-warn px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em]"
        title="This app instance has no cloud connection: everything on it lives in this browser only, and nothing here is shared with the farm's database."
      >
        <CloudOff size={11} /> {compact ? 'Local' : 'Local only'}
      </span>
    );
  }
  // Four states, one chip: a pass on the wire says so, a queue says how long it is, and a
  // refusal goes red with the database's own sentence behind it. Nothing here is a card.
  const spinning = busy && pending > 0;
  return (
    <button
      onClick={retry}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] press',
        cloud && errors.length ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success',
      )}
      title={pending ? `${pending} pending sync${detail} — tap to retry` : 'All synced'}
    >
      {pending || spinning
        ? <RefreshCw size={11} className={spinning ? 'animate-spin' : undefined} />
        : <Wifi size={11} />}
      {compact
        ? (spinning ? '···' : pending ? `${pending}` : 'Synced')
        : (spinning ? 'Syncing' : pending ? `${pending} to sync` : 'Synced')}
    </button>
  );
}

function CompanySwitcher() {
  const companies = useOperableCompanies();
  const session = useApp(s => s.session);
  const selectCompany = useApp(s => s.selectCompany);
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  const current = companies.find(c => c.id === session?.companyId);
  if (companies.length === 0) return null;

  return (
    <div className="relative px-3 pb-2">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-2 press hover:bg-sunk"
      >
        <span className="w-7 h-7 rounded-[9px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0">
          <Building2 size={14} />
        </span>
        <span className="flex-1 min-w-0 text-left">
          <span className="block font-mono text-[9px] uppercase tracking-[0.16em] text-muted-2">Company</span>
          <span className="block text-[13px] font-semibold text-ink truncate">{current?.name ?? 'Select company'}</span>
        </span>
        <ChevronDown size={15} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <Presence>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, transition: { duration: MOTION.micro.duration, ease: EASE } }}
            transition={reduced ? { duration: 0.01 } : { duration: MOTION.component.duration, ease: EASE }}
            className="absolute z-50 mt-1 left-3 right-3 origin-top rounded-[12px] border border-line bg-card shadow-float overflow-hidden"
          >
            {companies.map(c => (
              <button
                key={c.id}
                onClick={() => {
                  setOpen(false);
                  // Entering another company is a fresh context: the screen left open belongs
                  // to the one being dropped, so the session returns to its own home (§11).
                  if (c.id !== session?.companyId && selectCompany(c.id).ok) nav('/', { replace: true });
                }}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-sunk press"
              >
                <span className="flex-1 truncate font-medium text-ink">{c.name}</span>
                {c.id === session?.companyId && <Check size={15} className="text-brand" />}
              </button>
            ))}
          </motion.div>
        )}
      </Presence>
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card">
        <Feather size={17} />
      </span>
      <div className="leading-tight">
        <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Poultry</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Management</p>
      </div>
    </div>
  );
}

function Sidebar({ onSearch }: { onSearch: () => void }) {
  const user = useCurrentUser();
  const signOut = useApp(s => s.signOut);
  const groups = user ? visibleGroups(user.role) : [];
  const reduced = useReducedMotion();
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-line bg-card/70 backdrop-blur min-h-screen sticky top-0">
      <div className="px-5 py-5"><BrandMark /></div>
      {user && user.role !== 'FARM_LABOR' && <CompanySwitcher />}
      <div className="px-3 pb-2">
        <button
          onClick={onSearch}
          className="w-full flex items-center gap-2 rounded-[12px] border border-line bg-card px-3 py-2 text-[13px] text-muted press hover:border-brand/40 hover:text-brand"
        >
          <Search size={15} className="shrink-0" />
          <span className="flex-1 min-w-0 text-left truncate">Search</span>
          <kbd className="shrink-0 font-mono text-[10px] text-muted-2 border border-line rounded-[6px] px-1.5 py-0.5">{SEARCH_KEY_HINT}</kbd>
        </button>
      </div>
      <nav className="flex-1 px-3 pb-4 overflow-y-auto no-scrollbar">
        {groups.map((g, gi) => (
          <motion.div
            key={g.title}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { duration: MOTION.component.duration, ease: EASE, delay: reduced ? 0 : gi * 0.05 }}
            className="mb-4"
          >
            <p className="px-3 mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-2">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map(it => (
                <NavLink
                  key={it.to} to={it.to} end={it.end}
                  className={({ isActive }) => clsx(
                    'relative flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-colors',
                    isActive ? 'text-brand-ink font-semibold' : 'text-ink-2 hover:bg-sunk',
                  )}
                >
                  {({ isActive }) => (
                    <>
                      {/* Sliding active pill — layoutId shares across siblings so it glides between items */}
                      <AnimatePresence>
                        {isActive && (
                          <motion.span
                            layoutId="sidebar-active"
                            initial={reduced ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={reduced ? { duration: 0 } : INDICATOR_SPRING}
                            className="absolute inset-0 rounded-[10px] bg-brand-soft ring-1 ring-inset ring-brand/10"
                            aria-hidden
                          />
                        )}
                      </AnimatePresence>
                      <span className={clsx('shrink-0 relative z-10 transition-transform', isActive && !reduced && 'scale-[1.06]')}>{it.icon}</span>
                      <span className="relative z-10">{it.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </motion.div>
        ))}
      </nav>
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

function BottomNav({ onMore, onSignOut, onSearch }: { onMore: () => void; onSignOut: () => void; onSearch: () => void }) {
  const loc = useLocation();
  const user = useCurrentUser();
  const tabs = user ? mobileTabs(user.role) : [];
  const isLabor = user?.role === 'FARM_LABOR';
  const showMore = user ? !isLabor : false;
  /** One thumb-reach tile always opens search, whatever else the row holds. */
  const cols = tabs.length + 1 + (showMore || isLabor ? 1 : 0);
  const reduced = useReducedMotion();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom">
      <div className="mx-auto max-w-[520px] px-3 pb-2">
        <div className="grid bg-card/95 backdrop-blur-md border border-line rounded-[18px] shadow-float overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {tabs.map(t => (
            <NavLink
              key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => clsx(
                'relative flex flex-col items-center justify-center gap-1 py-2.5 transition-colors press',
                isActive ? 'text-brand' : 'text-muted',
              )}
            >
              {({ isActive }) => (
                <>
                  <AnimatePresence>
                    {isActive && (
                      <motion.span
                        layoutId="bottom-nav-active"
                        initial={reduced ? false : { opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={reduced ? { duration: 0 } : INDICATOR_SPRING}
                        className="absolute inset-1 rounded-full bg-brand-soft"
                        aria-hidden
                      />
                    )}
                  </AnimatePresence>
                  <span className={clsx('relative z-10 rounded-full px-3 py-0.5 transition-transform', isActive && !reduced && 'scale-[1.08]', !isActive && 'transition-colors')}>{t.icon}</span>
                  <span className="relative z-10 font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">{t.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            onClick={onSearch}
            aria-label="Search"
            className="flex flex-col items-center justify-center gap-1 py-2.5 press text-muted hover:text-brand"
          >
            <span className="rounded-full px-3 py-0.5"><Search size={20} /></span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">Search</span>
          </button>
          {isLabor && (
            <button
              onClick={onSignOut}
              className="flex flex-col items-center justify-center gap-1 py-2.5 press text-muted hover:text-danger"
            >
              <span className="rounded-full px-3 py-0.5"><LogOut size={20} /></span>
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">Sign out</span>
            </button>
          )}
          {showMore && (
            <button
              onClick={onMore}
              className={clsx(
                'flex flex-col items-center justify-center gap-1 py-2.5 press',
                !tabs.some(t => (t.end ? loc.pathname === t.to : loc.pathname.startsWith(t.to))) ? 'text-brand' : 'text-muted',
              )}
            >
              <Menu size={20} />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em]">More</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Latched on the first ask, then never unset: the palette stays mounted so both its opening
  // and its closing animate, and its module is fetched once rather than on every boot.
  const [paletteSeen, setPaletteSeen] = useState(false);
  const openSearch = () => { setPaletteSeen(true); setSearchOpen(true); };
  const loc = useLocation();
  const reduced = useReducedMotion();
  const nav = useNavigate();
  const signOut = useApp(s => s.signOut);
  const user = useCurrentUser();
  const isLabor = user?.role === 'FARM_LABOR';
  const isMaster = user?.role === 'MASTER_ADMIN';

  // The chord works from anywhere in the shell, including while a field has the caret —
  // the browser's own focus-ring for ⌘K is what a keyboard user expects to break.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!searchChord(e)) return;
      e.preventDefault();
      setPaletteSeen(true);
      setSearchOpen(o => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Warmed while the tab is idle, after the screens have settled: a shortcut must not turn
  // into a download the first time it is pressed.
  useEffect(() => {
    const t = setTimeout(() => { void paletteModule(); }, 2500);
    return () => clearTimeout(t);
  }, []);

    const role = user?.role;
  const OPS: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', M];
  const MONEY: Role[] = ['OWNER', 'FINANCIAL_SUPERVISOR', M];

  /** Everything the bottom nav has no room for, money and stock first (§IA). */
  const moreActions = ([
    { icon: <Wheat size={16} />, label: 'Godown', hint: 'Feed inventory in KG', onClick: () => nav('/feed'), roles: ['OWNER', 'FARM_SUPERVISOR', M] },
    { icon: <Pill size={16} />, label: 'Medicines & Vaccines', hint: 'Central stock, ledger and flock usage', onClick: () => nav('/medicines'), roles: MEDICINE_ROLES },
    { icon: <CalendarRange size={16} />, label: 'Eggs', hint: 'Central Egg Stock and Planner', onClick: () => nav('/eggs'), roles: ['OWNER'] },
    
    { icon: <Handshake size={16} />, label: 'Traders', hint: 'Balances & collections', onClick: () => nav('/traders'), roles: MONEY },
    { icon: <Wallet size={16} />, label: 'Finance', hint: 'Money ledger & shed P&L', onClick: () => nav('/finance'), roles: MONEY },
    { icon: <BarChart3 size={16} />, label: 'Reports', hint: 'Every historical statement', onClick: () => nav('/reports'), roles: MONEY },
    { icon: <User size={16} />, label: 'Profile', hint: 'Account & settings', onClick: () => nav('/profile') },
    { icon: <Building2 size={16} />, label: 'Companies', hint: 'Platform administration', onClick: () => nav('/admin'), roles: [M] },
    { icon: <Phone size={16} />, label: 'Support', onClick: () => nav('/contact'), roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M] },
  ] as MoreAction[]).filter(a => allowed(a, role ?? 'FARM_LABOR'));

  return (
    <div className="min-h-screen bg-canvas flex">
      <Sidebar onSearch={openSearch} />
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1080px] px-0 sm:px-6 lg:px-8">
            {/* Navigation settles with opacity alone: a transform here would make this wrapper the
              containing block for every sticky header and portal-free fixed layer below it. */}
            <motion.div
              key={loc.pathname}
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={reduced ? { duration: 0 } : { duration: MOTION.micro.duration, ease: EASE }}
            >
              {children}
            </motion.div>
          </div>
        </main>
      </div>

      <BottomNav onMore={() => setMoreOpen(true)} onSignOut={() => setSignOutOpen(true)} onSearch={openSearch} />

      {/* Mounted only after it has been asked for, and never unmounted again, so the palette's
        // own open and close gestures still animate while its code stays off the boot path. */}
      {paletteSeen && (
        <Suspense fallback={null}>
          <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
        </Suspense>
      )}

      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More" actions={moreActions} />
      <ConfirmDialog open={signOutOpen} title="Sign out?" message="You'll need your mobile number and PIN to sign in again."
        confirmLabel="Sign out" onCancel={() => setSignOutOpen(false)}
        onConfirm={() => { setSignOutOpen(false); signOut(); }} />
    </div>
  );
}
