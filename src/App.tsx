import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useApp, useCan, useCurrentUser } from '@/store/app';
import type { PermissionKey, Role } from '@/types';
import { AppShell } from '@/components/layout/AppShell';
import { ToastHost } from '@/components/ui/Toast';
import { LoginScreen } from '@/screens/LoginScreen';
import { CompanySelectScreen } from '@/screens/CompanySelectScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { FarmsScreen } from '@/screens/FarmsScreen';
import { FarmDetailScreen } from '@/screens/FarmDetailScreen';
import { ShedDetailScreen } from '@/screens/ShedDetailScreen';
import { BatchListScreen } from '@/screens/BatchListScreen';
import { BatchDetailScreen } from '@/screens/BatchDetailScreen';
import { BatchUsersScreen } from '@/screens/BatchUsersScreen';
import { AssignBatchScreen } from '@/screens/AssignBatchScreen';
import { EggsScreen } from '@/screens/EggsScreen';
import { FeedStockScreen } from '@/screens/FeedStockScreen';
import { FeedFormulaScreen } from '@/screens/FeedFormulaScreen';
import { FormulaDetailScreen } from '@/screens/FormulaDetailScreen';
import { FormulaEditorScreen } from '@/screens/FormulaEditorScreen';
import { FormulaHistoryScreen } from '@/screens/FormulaHistoryScreen';
import { FinanceScreen } from '@/screens/FinanceScreen';
import { TradersScreen } from '@/screens/TradersScreen';
import { TraderDetailScreen } from '@/screens/TraderDetailScreen';
import { SalesScreen } from '@/screens/SalesScreen';
import { TasksScreen } from '@/screens/TasksScreen';
import { ReportsScreen } from '@/screens/ReportsScreen';
import { DailyReportScreen } from '@/screens/DailyReportScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { ContactScreen } from '@/screens/ContactScreen';
import { LaborLogScreen } from '@/screens/LaborScreen';
import { MortalityScreen } from '@/screens/MortalityScreen';

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

const GODOWN_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'MASTER_ADMIN'];
const COMMERCE_ROLES: Role[] = ['OWNER', 'FINANCIAL_SUPERVISOR', 'MASTER_ADMIN'];
const REPORT_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'MASTER_ADMIN'];
/** Farm labor stays on their own simple screens; the batch workspace is not for them (§14). */
const OPS_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'];
/** Every role except farm labor may read formulas; only manageFormulas may edit (§ Feed formulas). */
const FORMULA_VIEW_ROLES: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'MASTER_ADMIN'];

/** Routes available once a company context is selected. */
function CompanyRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/farms" element={<RequireRole roles={OPS_ROLES}><FarmsScreen /></RequireRole>} />
      <Route path="/farms/:farmId" element={<RequireRole roles={OPS_ROLES}><FarmDetailScreen /></RequireRole>} />
      <Route path="/sheds/:shedId" element={<RequireRole roles={OPS_ROLES}><ShedDetailScreen /></RequireRole>} />
      <Route path="/batches" element={<RequireRole roles={OPS_ROLES}><BatchListScreen /></RequireRole>} />
      <Route path="/batches/:batchId" element={<RequireRole roles={OPS_ROLES}><BatchDetailScreen /></RequireRole>} />
      <Route path="/batches/:batchId/users" element={<RequireRole roles={['OWNER']}><BatchUsersScreen /></RequireRole>} />
      <Route path="/batches/:batchId/users/assign" element={<RequireRole roles={['OWNER']}><AssignBatchScreen /></RequireRole>} />
      <Route path="/batches/:batchId/eggs" element={<RequireRole roles={OPS_ROLES}><EggsScreen /></RequireRole>} />
      <Route path="/batches/:batchId/mortality" element={<RequireRole roles={OPS_ROLES}><MortalityScreen /></RequireRole>} />
      <Route path="/batches/:batchId/daily-report" element={<RequireRole roles={OPS_ROLES}><DailyReportScreen /></RequireRole>} />
      <Route path="/feed" element={<RequireRole roles={GODOWN_ROLES}><FeedStockScreen /></RequireRole>} />
      <Route path="/feed/formulas" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FeedFormulaScreen /></RequireRole>} />
      <Route path="/feed/formulas/new" element={<RequirePermission permission="manageFormulas"><FormulaEditorScreen /></RequirePermission>} />
      <Route path="/feed/formulas/:formulaId" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FormulaDetailScreen /></RequireRole>} />
      <Route path="/feed/formulas/:formulaId/edit" element={<RequirePermission permission="manageFormulas"><FormulaEditorScreen /></RequirePermission>} />
      <Route path="/feed/formulas/:formulaId/history" element={<RequireRole roles={FORMULA_VIEW_ROLES}><FormulaHistoryScreen /></RequireRole>} />
      <Route path="/finance" element={<RequireRole roles={COMMERCE_ROLES}><FinanceScreen /></RequireRole>} />
      <Route path="/sales" element={<RequireRole roles={OPS_ROLES}><SalesScreen /></RequireRole>} />
      <Route path="/tasks" element={<TasksScreen />} />
      <Route path="/log" element={<RequireRole roles={['FARM_LABOR']}><LaborLogScreen /></RequireRole>} />
      <Route path="/reports" element={<RequireRole roles={REPORT_ROLES}><ReportsScreen /></RequireRole>} />
      <Route path="/traders" element={<RequireRole roles={COMMERCE_ROLES}><TradersScreen /></RequireRole>} />
      <Route path="/traders/:traderId" element={<RequireRole roles={COMMERCE_ROLES}><TraderDetailScreen /></RequireRole>} />
      <Route path="/profile" element={<ProfileScreen />} />
      <Route path="/contact" element={<ContactScreen />} />
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
  const user = useCurrentUser();
  useScrollReset();

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
      <>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <ToastHost />
      </>
    );
  }

  // Signed in but no company context yet.
  if (!session.companyId) {
    return (
      <>
        {user.role === 'MASTER_ADMIN' ? (
          <AppShell><MasterRoutes /></AppShell>
        ) : (
          <Routes>
            <Route path="/select-company" element={<CompanySelectScreen />} />
            <Route path="*" element={<Navigate to="/select-company" replace />} />
          </Routes>
        )}
        <ToastHost />
      </>
    );
  }

  return (
    <>
      <AppShell><CompanyRoutes /></AppShell>
      <ToastHost />
    </>
  );
}
