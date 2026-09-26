import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpDown, BarChart3, ChevronRight, CornerDownLeft, FlaskConical, Handshake, Layers,
  Loader2, Package, Pill, Receipt, Search as SearchIcon, Truck, Warehouse, Wallet, X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  buildSearchIndex, runSearch, EMPTY_INPUT, type ReportEntry, type SearchAccess,
  type SearchInput, type SearchItem, type SearchResult,
} from '@/lib/search';
import { useApp, useCan, useCompanyData, useCurrentUser, useVisibleSheds } from '@/store/app';
import {
  COMMERCE_ROLES, FORMULA_VIEW_ROLES, GODOWN_ROLES, MEDICINE_ROLES, OPS_ROLES, REPORT_ROLES,
} from '@/lib/permissions';
import { visibleGroups } from '@/components/layout/nav';
import { BackdropTransition, ModalTransition, useReducedMotion } from '@/components/motion';
import { ROLE_LABELS } from '@/types';

/**
 * The one place every record in the current company can be reached from: ⌘K on a keyboard,
 * a tile on a phone. It reads the same selectors the screens read and asks the same role
 * questions the router asks, so a record this person may not open is never indexed —
 * nothing is filtered out at draw time (§5, §14).
 */

const RECENTS_KEY = 'amrut-search-recents-v1';
const RECENTS_MAX = 6;
/** Long enough to skip half-typed words, short enough that the list never feels stuck. */
const DEBOUNCE_MS = 120;

const KIND_ICON: Record<SearchItem['kind'], ReactNode> = {
  shed: <Warehouse size={15} />,
  batch: <Layers size={15} />,
  trader: <Handshake size={15} />,
  sale: <Receipt size={15} />,
  dispatch: <Truck size={15} />,
  purchase: <Package size={15} />,
  payment: <Wallet size={15} />,
  feed: <Package size={15} />,
  formula: <FlaskConical size={15} />,
  medicine: <Pill size={15} />,
  report: <BarChart3 size={15} />,
  page: <ArrowUpDown size={15} />,
};

/** Only the fields a row needs to be drawn again from the browser's own memory. */
type Recent = Pick<SearchItem, 'key' | 'kind' | 'group' | 'title' | 'subtitle' | 'meta' | 'href' | 'action'>;

function readRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r: Recent) => r?.href && r?.title).slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecents(list: Recent[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)));
  } catch {
    /* A private window that will not save memory still searches; only the recents are lost. */
  }
}

function asItem(r: Recent, rank: number): SearchItem {
  return { ...r, t: r.title.toLowerCase(), hay: '', rank, icon: undefined };
}

const has = (roles: readonly string[], role?: string) => !!role && roles.includes(role);

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const user = useCurrentUser();
  const companyId = useApp(s => s.session?.companyId);
  const data = useCompanyData();
  const sheds = useVisibleSheds();
  const canFinance = useCan('viewFinance');

  /** The same gates the router applies, so the palette cannot open a screen that would bounce. */
  const access = useMemo<SearchAccess>(() => ({
    ops: has(OPS_ROLES, user?.role),
    commerce: has(COMMERCE_ROLES, user?.role),
    godown: has(GODOWN_ROLES, user?.role),
    medicine: has(MEDICINE_ROLES, user?.role),
    reports: has(REPORT_ROLES, user?.role),
    finance: canFinance,
    formulas: has(FORMULA_VIEW_ROLES, user?.role),
  }), [user?.role, canFinance]);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  /** The report catalogue is a lazy chunk of its own; search works before it lands. */
  const [reports, setReports] = useState<ReportEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /* Closed means unmounted: no index is built, and nothing is scanned for a palette nobody opened. */
  useEffect(() => {
    if (!open) return;
    setQuery(''); setDebounced(''); setActive(0);
    setRecent(companyId ? readRecents() : []);
    const id = window.setTimeout(() => inputRef.current?.focus(), reduced ? 0 : 90);
    document.body.style.overflow = 'hidden';
    return () => { window.clearTimeout(id); document.body.style.overflow = ''; };
  }, [open, companyId, reduced]);

  useEffect(() => {
    if (!open || !access.reports || reports.length) return;
    let live = true;
    import('@/lib/reports')
      .then(m => { if (live) setReports(m.visibleReports(canFinance)); })
      .catch(() => { /* no catalogue, no report rows — the rest of search stands on its own */ });
    return () => { live = false; };
  }, [open, access.reports, reports.length, canFinance]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query]);

  /** One page per destination this role already sees. Before a company is chosen, only the
   *  platform's own three screens are mounted, so only those are offered. */
  const pages = useMemo<SearchItem[]>(() => {
    if (!user) return [];
    const mounted = companyId ? null : new Set(['/admin', '/profile', '/contact']);
    return visibleGroups(user.role).flatMap(g => g.items
      .filter(it => !mounted || mounted.has(it.to))
      .map((it, rank) => ({
        key: `page:${it.to}`, kind: 'page' as const, group: 'Pages', title: it.label,
        subtitle: g.title, href: it.to, action: `Open ${it.label}`,
        t: it.label.toLowerCase(),
        hay: `${it.label.toLowerCase()} ${g.title.toLowerCase()} page screen go to open`,
        rank, icon: it.icon,
      })));
  }, [user, companyId]);

  const items = useMemo<SearchItem[]>(() => {
    if (!open) return pages;
    const input: SearchInput = {
      ...EMPTY_INPUT, ...data, sheds, reports,
    };
    return [...pages, ...buildSearchIndex(input, access)];
  }, [open, pages, access, sheds, reports,
    data.sheds, data.batches, data.mortality, data.traders, data.saleEntries, data.saleLogs,
    data.feedStock, data.feedFormulas, data.medicineItems, data.medicineStock, data.finance, data.traderTxns]);

  const results = useMemo<SearchResult[]>(() => {
    if (open && debounced.trim()) return runSearch(items, debounced);
    const seed = companyId ? recent.map(asItem) : [];
    return seed.length
      ? [{ group: 'Recent', items: seed }, ...(pages.length ? [{ group: 'Pages', items: pages }] : [])]
      : pages.length ? [{ group: 'Pages', items: pages }] : [];
  }, [open, debounced, items, recent, pages, companyId]);

  const flat = useMemo(() => results.flatMap(r => r.items), [results]);
  const catchingUp = query !== debounced;
  /** A shorter result list must never leave the caret pointing past its last row. */
  const current = flat.length ? Math.min(active, flat.length - 1) : 0;

  useEffect(() => { setActive(0); }, [debounced, results.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${current}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function openItem(item: SearchItem) {
    const next = [{
      key: item.key, kind: item.kind, group: item.group, title: item.title,
      subtitle: item.subtitle, meta: item.meta, href: item.href, action: item.action,
    }, ...readRecents().filter(r => r.key !== item.key)];
    setRecent(next);
    writeRecents(next);
    onClose();
    nav(item.href);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault(); if (flat.length) setActive(i => (i + 1) % flat.length); return;
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault(); if (flat.length) setActive(i => (i - 1 + flat.length) % flat.length); return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[current];
      if (item) openItem(item);
    }
  }

  let row = -1;

  return createPortal(
    <>
      <BackdropTransition open={open} onClick={onClose} blur={reduced ? 0 : 3} />
      {open && (
        <div className="fixed inset-0 z-[100] flex items-stretch sm:items-start justify-center sm:p-6 sm:pt-[12vh] pointer-events-none">
          {/* The transition wrapper owns the geometry: a definite box on desktop, the whole
              screen on mobile, so the panel's own h-full/w-full never resolve to content. */}
          <ModalTransition open={open} className="w-full h-full sm:h-[min(72vh,640px)] sm:max-w-[620px]">
            <div
              onKeyDown={onKeyDown}
              role="dialog" aria-modal="true" aria-label="Search"
              className="pointer-events-auto w-full h-full flex flex-col bg-card sm:rounded-[20px] overflow-hidden shadow-pop border-0 sm:border sm:border-line"
            >
              <div className="flex items-center gap-2.5 px-4 sm:px-5 h-14 shrink-0 border-b border-line-2 safe-top">
                <SearchIcon size={17} className="text-muted shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search sheds, batches, traders, sales, payments, reports…"
                  aria-label="Search the company"
                  aria-controls="command-results"
                  autoComplete="off" autoCorrect="off" spellCheck={false}
                  className="flex-1 min-w-0 bg-transparent text-[15px] sm:text-[16px] text-ink placeholder:text-muted-2 outline-none"
                />
                {catchingUp && <Loader2 size={15} className="animate-spin text-muted-2 shrink-0" aria-label="Searching" />}
                {query && (
                  <button onClick={() => { setQuery(''); inputRef.current?.focus(); }} aria-label="Clear"
                    className="w-7 h-7 rounded-full bg-sunk text-muted hover:text-ink flex items-center justify-center press shrink-0">
                    <X size={14} />
                  </button>
                )}
                <button onClick={onClose} aria-label="Close search"
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted hover:text-ink press sm:hidden px-1">
                  Close
                </button>
                <kbd className="hidden sm:flex shrink-0 items-center font-mono text-[10px] text-muted-2 border border-line rounded-[6px] px-1.5 py-0.5">esc</kbd>
              </div>

              <div
                ref={listRef} id="command-results" role="listbox" aria-label="Search results"
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 sm:px-2.5 py-2"
              >
                {!results.length && (
                  <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center px-6 gap-2">
                    <span className="w-11 h-11 rounded-full bg-sunk flex items-center justify-center text-muted">
                      <SearchIcon size={18} strokeWidth={1.75} />
                    </span>
                    <p className="font-display text-[15.5px] font-semibold text-ink">
                      {debounced.trim() ? `Nothing matches “${debounced.trim()}”` : 'Nothing to search yet'}
                    </p>
                    <p className="text-[12.5px] text-muted max-w-[330px] leading-relaxed">
                      {debounced.trim()
                        ? <>Only the <span className="text-ink-2 font-medium">{ROLE_LABELS[user?.role ?? 'FARM_LABOR']}</span> records of this company are searched.</>
                        : 'Start typing a shed, batch code, trader, receipt number or report name.'}
                    </p>
                  </div>
                )}

                {results.map(g => (
                  <div key={g.group} className="mb-1.5">
                    <p className="px-2.5 pt-2 pb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-2">
                      {g.group}
                    </p>
                    <div className="space-y-0.5">
                      {g.items.map(item => {
                        row += 1;
                        const index = row;
                        const isActive = index === current;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            data-row={index}
                            role="option"
                            aria-selected={isActive}
                            onMouseMove={() => setActive(index)}
                            onClick={() => openItem(item)}
                            className={clsx(
                              'w-full flex items-center gap-3 rounded-[12px] px-2.5 py-2.5 text-left transition-colors',
                              isActive ? 'bg-brand-soft' : 'hover:bg-sunk',
                            )}
                          >
                            <span className={clsx(
                              'w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-colors',
                              isActive ? 'bg-card text-brand-ink shadow-card' : 'bg-sunk text-muted',
                            )}>
                              {(item.icon ?? KIND_ICON[item.kind]) as ReactNode}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={clsx('block truncate text-[14px] font-semibold', isActive ? 'text-brand-ink' : 'text-ink')}>
                                {item.title}
                              </span>
                              {item.subtitle && (
                                <span className="block truncate text-[12px] text-muted mt-0.5 tnum">{item.subtitle}</span>
                              )}
                            </span>
                            {item.meta && (
                              <span className={clsx('shrink-0 font-mono text-[11px] tnum', isActive ? 'text-brand-ink' : 'text-muted-2')}>
                                {item.meta}
                              </span>
                            )}
                            <span className={clsx(
                              'hidden sm:flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-opacity',
                              isActive ? 'text-brand' : 'text-muted-2 opacity-0',
                            )}>
                              {isActive && <CornerDownLeft size={12} />}
                              {item.action}
                            </span>
                            <ChevronRight size={14} className={clsx('shrink-0 sm:hidden', isActive ? 'text-brand' : 'text-muted-2')} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="shrink-0 hidden sm:flex items-center gap-4 px-5 py-2.5 border-t border-line-2 bg-sunk/60 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">
                <span className="flex items-center gap-1.5"><ArrowUpDown size={12} /> navigate</span>
                <span className="flex items-center gap-1.5"><CornerDownLeft size={12} /> open</span>
                <span className="flex-1" />
                <span className="tnum">{flat.length} result{flat.length === 1 ? '' : 's'}</span>
              </div>
              <div className="sm:hidden h-[env(safe-area-inset-bottom)] shrink-0" />
            </div>
          </ModalTransition>
        </div>
      )}
    </>,
    document.body,
  );
}
