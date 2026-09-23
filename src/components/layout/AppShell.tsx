import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, ClipboardList, Warehouse, Layers, Wheat, FlaskConical, Handshake,
  Wallet, BarChart3, User, Phone, Menu, Building2,
  Wifi, WifiOff, RefreshCw, Feather, Receipt, ChevronDown, Check, History, LogOut, BellRing,
  CalendarRange, Pill,
} from 'lucide-react';
import { useApp, useCurrentUser } from '@/store/app';
import { Avatar } from '@/components/ui/Card';
import { ActionSheet, ConfirmDialog } from '@/components/ui/Dialog';
import { FORMULA_VIEW_ROLES, MEDICINE_ROLES } from '@/lib/permissions';
import { ROLE_LABELS, type Role } from '@/types';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean; roles?: Role[] }
interface NavGroup { title: string; items: NavItem[]; roles?: Role[] }
interface MoreAction { icon: ReactNode; label: string; hint?: string; onClick: () => void; roles?: Role[] }

/** Nav is role-gated so users never see modules they cannot access (§14).
 *  MASTER_ADMIN sees every panel: platform duties require reading any company. */
const M: Role = 'MASTER_ADMIN';
const GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={17} />, end: true },
      //{ to: '/alerts', label: 'Alerts', icon: <BellRing size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M] },
      //{ to: '/tasks', label: 'Tasks', icon: <ClipboardList size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR', M] },
      { to: '/log', label: "Today's log", icon: <History size={17} />, roles: ['FARM_LABOR'] },
    ],
  },
  {
    title: 'Farm',
    roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M],
    items: [
      { to: '/farms', label: 'Sheds', icon: <Warehouse size={17} /> },
      //{ to: '/batches', label: 'Batches', icon: <Layers size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', M] },
      //{ to: '/feed/formulas', label: 'Feed', icon: <FlaskConical size={17} />, roles: FORMULA_VIEW_ROLES },
      { to: '/feed', label: 'Godown', end: true, icon: <Wheat size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', M] },
      { to: '/medicines', label: 'Medicines & Vaccines', icon: <Pill size={17} />, roles: MEDICINE_ROLES },
    ],
  },
  {
    title: 'Commerce',
    roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M],
    items: [
      { to: '/sales', label: 'Sales', end: true, icon: <Receipt size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M] },
      { to: '/sales/planner', label: 'Egg Sale Planner', icon: <CalendarRange size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR', M] },
      { to: '/traders', label: 'Traders', icon: <Handshake size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M] },
      { to: '/finance', label: 'Finance', icon: <Wallet size={17} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M] },
    ],
  },
  {
    title: 'Insights',
    roles: ['OWNER', 'FINANCIAL_SUPERVISOR', M],
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 size={17} /> },
    ],
  },
  {
    title: 'Platform',
    roles: ['MASTER_ADMIN'],
    items: [
      { to: '/admin', label: 'Companies', icon: <Building2 size={17} /> },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/profile', label: 'Profile', icon: <User size={17} /> },
      { to: '/contact', label: 'Support', icon: <Phone size={17} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'] },
    ],
  },
];

function allowed(item: { roles?: Role[] }, role: Role): boolean {
  return !item.roles || item.roles.includes(role);
}

function visibleGroups(role: Role): NavGroup[] {
  return GROUPS
    .filter(g => allowed(g, role))
    .map(g => ({ ...g, items: g.items.filter(it => allowed(it, role)) }))
    .filter(g => g.items.length > 0);
}

function mobileTabs(role: Role): NavItem[] {
  if (role === 'FARM_LABOR') {
    return [
      { to: '/', label: 'Today', icon: <LayoutDashboard size={20} />, end: true },
      { to: '/log', label: 'Log', icon: <History size={20} /> },
    ];
  }
  if (role === 'MASTER_ADMIN') {
    return [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} />, end: true },
      { to: '/admin', label: 'Companies', icon: <Building2 size={20} /> },
      { to: '/profile', label: 'Profile', icon: <User size={20} /> },
    ];
  }
  /** Four thumb-reach destinations; everything else lives in the More sheet. */
  const base: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} />, end: true },
    { to: '/farms', label: 'Sheds', icon: <Warehouse size={20} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER'] },
    //{ to: '/batches', label: 'Batches', icon: <Layers size={20} />, roles: ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER'] },
    { to: '/sales', label: 'Sales', end: true, icon: <Receipt size={20} />, roles: ['OWNER', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_SUPERVISOR'] },
  ];
  return base.filter(t => allowed(t, role)).slice(0, 4);
}

export function SyncPill({ compact = false }: { compact?: boolean }) {
  const online = useApp(s => s.online);
  const syncPending = useApp(s => s.syncPending);
  const pushToast = useApp(s => s.pushToast);
  const mortality = useApp(s => s.mortality);
  const feed = useApp(s => s.feed);
  const eggs = useApp(s => s.eggs);
  const saleLogs = useApp(s => s.saleLogs);
  const saleEntries = useApp(s => s.saleEntries);
  const feedRounds = useApp(s => s.feedRounds);
  const vaccinations = useApp(s => s.vaccinations);
  const pending = [...mortality, ...feed, ...eggs, ...saleLogs, ...saleEntries, ...feedRounds, ...vaccinations].filter(x => !x.synced).length;

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

function CompanySwitcher() {
  const user = useCurrentUser();
  const companies = useApp(s => s.companies);
  const session = useApp(s => s.session);
  const selectCompany = useApp(s => s.selectCompany);
  const [open, setOpen] = useState(false);
  if (!user) return null;

  const accessible = user.role === 'MASTER_ADMIN'
    ? companies
    : companies.filter(c => user.companyIds.includes(c.id));
  const current = companies.find(c => c.id === session?.companyId);
  if (accessible.length === 0) return null;

  return (
    <div className="relative px-3 pb-2">
      <button
        onClick={() => setOpen(o => !o)}
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
      {open && (
        <div className="absolute z-50 mt-1 left-3 right-3 rounded-[12px] border border-line bg-card shadow-float overflow-hidden">
          {accessible.map(c => (
            <button
              key={c.id}
              onClick={() => { selectCompany(c.id); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-[13px] hover:bg-sunk press"
            >
              <span className="flex-1 truncate font-medium text-ink">{c.name}</span>
              {!c.active && <span className="font-mono text-[9px] uppercase text-muted">off</span>}
              {c.id === session?.companyId && <Check size={15} className="text-brand" />}
            </button>
          ))}
        </div>
      )}
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

function Sidebar() {
  const user = useCurrentUser();
  const signOut = useApp(s => s.signOut);
  const groups = user ? visibleGroups(user.role) : [];
  return (
    <aside className="hidden lg:flex flex-col w-[248px] shrink-0 border-r border-line bg-card/70 backdrop-blur min-h-screen sticky top-0">
      <div className="px-5 py-5"><BrandMark /></div>
      {user && user.role !== 'FARM_LABOR' && <CompanySwitcher />}
      <nav className="flex-1 px-3 pb-4 overflow-y-auto no-scrollbar">
        {groups.map(g => (
          <div key={g.title} className="mb-4">
            <p className="px-3 mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-2">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map(it => (
                <NavLink
                  key={it.to} to={it.to} end={it.end}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-colors',
                    isActive ? 'bg-brand-soft text-brand-ink font-semibold ring-1 ring-brand/10' : 'text-ink-2 hover:bg-sunk',
                  )}
                >
                  <span className="shrink-0">{it.icon}</span>{it.label}
                </NavLink>
              ))}
            </div>
          </div>
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

function BottomNav({ onMore, onSignOut }: { onMore: () => void; onSignOut: () => void }) {
  const loc = useLocation();
  const user = useCurrentUser();
  const tabs = user ? mobileTabs(user.role) : [];
  const isLabor = user?.role === 'FARM_LABOR';
  const showMore = user ? !isLabor : false;
  const cols = tabs.length + (showMore || isLabor ? 1 : 0);
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 safe-bottom">
      <div className="mx-auto max-w-[520px] px-3 pb-2">
        <div className="grid bg-card/95 backdrop-blur-md border border-line rounded-[18px] shadow-float overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {tabs.map(t => (
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
  const nav = useNavigate();
  const signOut = useApp(s => s.signOut);
  const user = useCurrentUser();
  const isLabor = user?.role === 'FARM_LABOR';
  const isMaster = user?.role === 'MASTER_ADMIN';

    const role = user?.role;
  const OPS: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FARM_MANAGER', M];
  const MONEY: Role[] = ['OWNER', 'FINANCIAL_SUPERVISOR', M];

  /** Everything the bottom nav has no room for, money and stock first (§IA). */
  const moreActions = ([
    { icon: <Wheat size={16} />, label: 'Godown', hint: 'Feed inventory in KG', onClick: () => nav('/feed'), roles: ['OWNER', 'FARM_SUPERVISOR', M] },
    { icon: <Pill size={16} />, label: 'Medicines & Vaccines', hint: 'Central stock, ledger and flock usage', onClick: () => nav('/medicines'), roles: MEDICINE_ROLES },
    { icon: <CalendarRange size={16} />, label: 'Egg Sale Planner', hint: 'Trays promised to traders, 5 days ahead', onClick: () => nav('/sales/planner'), roles: [...OPS, 'FINANCIAL_SUPERVISOR'] },
    
    { icon: <Handshake size={16} />, label: 'Traders', hint: 'Balances & collections', onClick: () => nav('/traders'), roles: MONEY },
    { icon: <Wallet size={16} />, label: 'Finance', hint: 'Money ledger & shed P&L', onClick: () => nav('/finance'), roles: MONEY },
    { icon: <BarChart3 size={16} />, label: 'Reports', hint: 'Every historical statement', onClick: () => nav('/reports'), roles: MONEY },
    { icon: <User size={16} />, label: 'Profile', hint: 'Account & settings', onClick: () => nav('/profile') },
    { icon: <Building2 size={16} />, label: 'Companies', hint: 'Platform administration', onClick: () => nav('/admin'), roles: [M] },
    { icon: <Phone size={16} />, label: 'Support', onClick: () => nav('/contact'), roles: ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', M] },
  ] as MoreAction[]).filter(a => allowed(a, role ?? 'FARM_LABOR'));

  return (
    <div className="min-h-screen bg-canvas flex">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 min-w-0">
          <div className="mx-auto w-full max-w-[1080px] px-0 sm:px-6 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      <BottomNav onMore={() => setMoreOpen(true)} onSignOut={() => setSignOutOpen(true)} />

      <ActionSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More" actions={moreActions} />
      <ConfirmDialog open={signOutOpen} title="Sign out?" message="You'll need your mobile number and PIN to sign in again."
        confirmLabel="Sign out" onCancel={() => setSignOutOpen(false)}
        onConfirm={() => { setSignOutOpen(false); signOut(); }} />
    </div>
  );
}
