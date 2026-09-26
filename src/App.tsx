import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { useApp, useCan, useCompanyAccess, useCurrentUser, useVisibleSheds } from '@/store/app';
import type { PermissionKey, Role } from '@/types';
import { contextIntact, isPlatformAdmin } from '@/lib/companyAccess';
import { runtime } from '@/lib/runtime';
import {
  COMMERCE_ROLES, FORMULA_VIEW_ROLES, GODOWN_ROLES, MEDICINE_ROLES, OPS_ROLES, REPORT_ROLES, STRUCTURE_ROLES,
} from '@/lib/permissions';
import { AppShell } from '@/components/layout/AppShell';
import { ToastHost } from '@/components/ui/Toast';
import { MotionProvider } from '@/components/motion';
import { ErrorBoundary, ScreenFallback } from '@/components/ui/ErrorBoundary';
import { LoginScreen } from '@/screens/LoginScreen';
import { CompanySelectScreen } from '@/screens/CompanySelectScreen';
import { CompanyUnavailableScreen } from '@/screens/CompanyUnavailableScreen';

/**
 * Every module behind its own file: the sign-in path stays in the first bundle, and a person
 * downloads only the screens they open. `screen()` keeps the named exports as they are, so no
 * screen had to change for this.
 */
function screen<M extends Record<string, unknown>>(name: keyof M, loader: () => Promise<M>) {
  return lazy(() => loader().then(m => ({ default: m[name] as ComponentType })));
}

const AdminScreen = screen('AdminScreen', () => import('@/screens/AdminScreen'));
const HomeScreen = screen('HomeScreen', () => import('@/screens/HomeScreen'));
const OwnerDashboard = screen('OwnerDashboard', () => import('@/screens/OwnerDashboard'));
const AlertsScreen = screen('AlertsScreen', () => import('@/screens/AlertsScreen'));
const TimelineScreen = screen('TimelineScreen', () => import('@/screens/TimelineScreen'));
const UsersScreen = screen('UsersScreen', () => import('@/screens/UsersScreen'));
const FarmsScreen = screen('FarmsScreen', () => import('@/screens/FarmsScreen'));
const FarmDetailScreen = screen('FarmDetailScreen', () => import('@/screens/FarmDetailScreen'));
const FarmLayoutScreen = screen('FarmLayoutScreen', () => import('@/screens/FarmLayoutScreen'));
const ShedGate = screen('ShedGate', () => import('@/screens/ShedDetailScreen'));
const BatchListScreen = screen('BatchListScreen', () => import('@/screens/BatchListScreen'));
const BatchDetailScreen = screen('BatchDetailScreen', () => import('@/screens/BatchDetailScreen'));
const BatchUsersScreen = screen('BatchUsersScreen', () => import('@/screens/BatchUsersScreen'));
const AssignBatchScreen = screen('AssignBatchScreen', () => import('@/screens/AssignBatchScreen'));
const BatchEggsScreen = screen('BatchEggsScreen', () => import('@/screens/BatchEggsScreen'));
const FeedStockScreen = screen('FeedStockScreen', () => import('@/screens/FeedStockScreen'));
const IngredientStockScreen = screen('IngredientStockScreen', () => import('@/screens/IngredientStockScreen'));
const MedicinesScreen = screen('MedicinesScreen', () => import('@/screens/MedicinesScreen'));
const MedicineItemScreen = screen('MedicineItemScreen', () => import('@/screens/MedicineItemScreen'));
const FeedFormulaScreen = screen('FeedFormulaScreen', () => import('@/screens/FeedFormulaScreen'));
const FormulaDetailScreen = screen('FormulaDetailScreen', () => import('@/screens/FormulaDetailScreen'));
const FormulaEditorScreen = screen('FormulaEditorScreen', () => import('@/screens/FormulaEditorScreen'));
const FormulaHistoryScreen = screen('FormulaHistoryScreen', () => import('@/screens/FormulaHistoryScreen'));
const FinanceScreen = screen('FinanceScreen', () => import('@/screens/FinanceScreen'));
const TradersScreen = screen('TradersScreen', () => import('@/screens/TradersScreen'));
const TraderDetailScreen = screen('TraderDetailScreen', () => import('@/screens/TraderDetailScreen'));
const SalesScreen = screen('SalesScreen', () => import('@/screens/SalesScreen'));
const SaleEntryDetailScreen = screen('SaleEntryDetailScreen', () => import('@/screens/SaleEntryDetailScreen'));
const TasksScreen = screen('TasksScreen', () => import('@/screens/TasksScreen'));
const ReportsScreen = screen('ReportsScreen', () => import('@/screens/ReportsScreen'));
const BackupScreen = screen('BackupScreen', () => import('@/screens/BackupScreen'));
const ReportDetailScreen = screen('ReportDetailScreen', () => import('@/screens/ReportDetailScreen'));
const DailyReportScreen = screen('DailyReportScreen', () => import('@/screens/DailyReportScreen'));
const ProfileScreen = screen('ProfileScreen', () => import('@/screens/ProfileScreen'));
const ContactScreen = screen('ContactScreen', () => import('@/screens/ContactScreen'));
const LaborLogScreen = screen('LaborLogScreen', () => import('@/screens/LaborScreen'));
const MortalityScreen = screen('MortalityScreen', () => import('@/screens/MortalityScreen'));
const EggsScreen = screen('EggsScreen', () => import('@/screens/EggsScreen'));

/** One screen at a time: the module is still in flight, and a screen that fails to draw keeps
 *  the shell and its navigation standing so there is always a way out. */
function Screen({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return (
    <ErrorBoundary resetKeys={[loc.pathname]}>
      <Suspense fallback={<ScreenFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function useScrollReset() {
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [loc.pathname]);
}

/** Route-level role gate so inaccessible modules cannot be opened by URL (§14). */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const user = useCurrentUser();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Permission gate for modules whose access is decided by the role matrix (§4). */
function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const allowed = useCan(permission);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Shed detail is only reachable for the sheds a user is mapped to (§14). */
function RequireVisibleShed({ children }: { children: ReactNode }) {
  const { shedId } = useParams();
  const visible = useVisibleSheds();
  if (!visible.some(s => s.id === shedId)) return <Navigate to="/farms" replace />;
  return <>{children}</>;
}

/** The Owner lands on the executive control centre; every other role keeps the operational home. */
/** A vaccine schedule belongs to the flock that owns it: an old link lands on that batch's Health tab. */
function VaccinationRedirect() {
  const loc = useLocation();
  const batch = new URLSearchParams(loc.search).get('batch');
  return <Navigate to={batch ? `/batches/${batch}?tab=health` : '/alerts'} replace />;
}

function RootHome() {
  const user = useCurrentUser();
  return user?.role === 'OWNER' ? <OwnerDashboard /> : <HomeScreen />;
}

/** Routes available once a company context is selected. */
function CompanyRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootHome />} />
      <Route path="/alerts" element={<RequireRole roles={['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN']}><AlertsScreen /></RequireRole>} />
      <Route path="/timeline" element={<RequireRole roles={OPS_ROLES}><TimelineScreen /></RequireRole>} />
      <Route path="/users" element={<RequirePermission permission="manageUsers"><UsersScreen /></RequirePermission>} />
      <Route path="/farms" element={<RequireRole roles={OPS_ROLES}><FarmsScreen /></RequireRole>} />
      <Route path="/farms/:farmId" element={<RequireRole roles={OPS_ROLES}><FarmDetailScreen /></RequireRole>} />
      <Route path="/farms/:farmId/layout" element={<RequireRole roles={STRUCTURE_ROLES}><FarmLayoutScreen /></RequireRole>} />
      <Route path="/sheds/:shedId" element={<RequireRole roles={OPS_ROLES}><RequireVisibleShed><ShedGate /></RequireVisibleShed></RequireRole>} />
      <Route path="/batches" element={<RequireRole roles={OPS_ROLES}><BatchListScreen /></RequireRole>} />
      <Route path="/batches/:batchId" element={<RequireRole roles={OPS_ROLES}><BatchDetailScreen /></RequireRole>} />
      <Route path="/batches/:batchId/users" element={<RequireRole roles={['OWNER']}><BatchUsersScreen /></RequireRole>} />
      <Route path="/batches/:batchId/users/assign" element={<RequireRole roles={['OWNER']}><AssignBatchScreen /></RequireRole>} />
      <Route path="/batches/:batchId/eggs" element={<RequireRole roles={OPS_ROLES}><BatchEggsScreen /></RequireRole>} />
      <Route path="/batches/:batchId/mortality" element={<RequireRole roles={OPS_ROLES}><MortalityScreen /></RequireRole>} />
      <Route path="/batches/:batchId/daily-report" element={<RequireRole roles={REPORT_ROLES}><DailyReportScreen /></RequireRole>} />
      <Route path="/eggs" element={<RequireRole roles={OPS_ROLES}><EggsScreen /></RequireRole>} />
      <Route path="/feed" element={<RequireRole roles={GODOWN_ROLES}><FeedStockScreen /></RequireRole>} />
      <Route path="/feed/ingredient/:ingredient" element={<RequireRole roles={GODOWN_ROLES}><IngredientStockScreen /></RequireRole>} />
      <Route path="/feed/formulas" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FeedFormulaScreen /></RequireRole>} />
      <Route path="/feed/formulas/new" element={<RequirePermission permission="manageFormulas"><FormulaEditorScreen /></RequirePermission>} />
      <Route path="/feed/formulas/:formulaId" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FormulaDetailScreen /></RequireRole>} />
      <Route path="/feed/formulas/:formulaId/edit" element={<RequirePermission permission="manageFormulas"><FormulaEditorScreen /></RequirePermission>} />
      <Route path="/feed/formulas/:formulaId/history" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FormulaHistoryScreen /></RequireRole>} />
      <Route path="/finance" element={<RequireRole roles={COMMERCE_ROLES}><FinanceScreen /></RequireRole>} />
      <Route path="/sales" element={<RequireRole roles={OPS_ROLES}><SalesScreen /></RequireRole>} />
      <Route path="/sales/entry/:entryId" element={<RequireRole roles={OPS_ROLES}><SaleEntryDetailScreen /></RequireRole>} />
      <Route path="/tasks" element={<TasksScreen />} />
      <Route path="/vaccination" element={<VaccinationRedirect />} />
      <Route path="/medicines" element={<RequireRole roles={MEDICINE_ROLES}><MedicinesScreen /></RequireRole>} />
      <Route path="/medicines/item/:id" element={<RequireRole roles={MEDICINE_ROLES}><MedicineItemScreen /></RequireRole>} />
      <Route path="/log" element={<RequireRole roles={['FARM_LABOR']}><LaborLogScreen /></RequireRole>} />
      <Route path="/reports" element={<RequireRole roles={REPORT_ROLES}><ReportsScreen /></RequireRole>} />
      <Route path="/reports/:reportId" element={<RequireRole roles={REPORT_ROLES}><ReportDetailScreen /></RequireRole>} />
      {/* Export is the report permission; the restore inside it is gated again on `delete`. */}
      <Route path="/backup" element={<RequirePermission permission="exportReports"><BackupScreen /></RequirePermission>} />
      <Route path="/traders" element={<RequireRole roles={COMMERCE_ROLES}><TradersScreen /></RequireRole>} />
      <Route path="/traders/:traderId" element={<RequireRole roles={COMMERCE_ROLES}><TraderDetailScreen /></RequireRole>} />
      <Route path="/profile" element={<ProfileScreen />} />
      <Route path="/contact" element={<ContactScreen />} />
      {/* The platform panel stays reachable while a Master Admin works inside a company. */}
      <Route path="/admin" element={<RequireRole roles={['MASTER_ADMIN']}><AdminScreen /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Routes for a Master Admin who has not entered a company context. */
function MasterRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminScreen />} />
      <Route path="/profile" element={<ProfileScreen />} />
      <Route path="/contact" element={<ContactScreen />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );
}

export default function App() {
  const session = useApp(s => s.session);
  const company = useApp(s => s.companies.find(c => c.id === s.session?.companyId));
  const setOnline = useApp(s => s.setOnline);
  const revalidateCompanyAccess = useApp(s => s.revalidateCompanyAccess);
  const notice = useApp(s => s.accessNotice);
  const access = useCompanyAccess();
  const user = useCurrentUser();
  useScrollReset();

  // In cloud mode the store's own revalidation runs after every pull and reconcile. This
  // covers the rest: a company switched off in this browser, a context that changed shape
  // while the tab was closed, and the selector screens. The pull is what makes `companies`
  // and `users` current, so revalidating before the first one would read a cache that has
  // not yet been told about a company the person genuinely belongs to.
  useEffect(() => {
    if (runtime.cloud) revalidateCompanyAccess();
  }, [session, user, company, revalidateCompanyAccess]);

  useEffect(() => {
    document.title = company ? `${company.name} · Poultry Management` : 'Poultry Farm Management';
  }, [company]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [setOnline]);

  if (!session || !user) {
    return (
      <MotionProvider>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <ToastHost />
      </MotionProvider>
    );
  }

  // A context that no longer stands is not a dashboard with its buttons greyed out. Nothing
  // below this line renders, so no protected data appears behind the reason (§5, §17), and the
  // route that was opened by URL is simply never mounted.
  const blocked = contextIntact(access)
    ? (notice && !contextIntact(notice) ? notice : null)
    : access;
  if (blocked) {
    return (
      <MotionProvider>
        <CompanyUnavailableScreen access={blocked} />
        <ToastHost />
      </MotionProvider>
    );
  }

  // Signed in but no company context yet: the platform's own panel for a Master Admin, the
  // selector for everybody else. Both are mounted without AppShell's company chrome.
  if (!session.companyId) {
    return (
      <MotionProvider>
        {isPlatformAdmin(user) ? (
          <AppShell><Screen><MasterRoutes /></Screen></AppShell>
        ) : (
          <Routes>
            <Route path="/select-company" element={<CompanySelectScreen />} />
            <Route path="*" element={<Navigate to="/select-company" replace />} />
          </Routes>
        )}
        <ToastHost />
      </MotionProvider>
      
    );
  }

  return (
    <MotionProvider>
      <AppShell><Screen><CompanyRoutes /></Screen></AppShell>
      <ToastHost />
    </MotionProvider>
  );
}
