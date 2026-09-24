import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useApp } from '@/store/app';
import { AppShell } from '@/components/layout/AppShell';
import { ToastHost } from '@/components/ui/Toast';
import { LoginScreen } from '@/screens/LoginScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { FarmsScreen } from '@/screens/FarmsScreen';
import { FarmDetailScreen } from '@/screens/FarmDetailScreen';
import { ShedDetailScreen } from '@/screens/ShedDetailScreen';
import { BatchListScreen } from '@/screens/BatchListScreen';
import { BatchDetailScreen } from '@/screens/BatchDetailScreen';
import { BatchUsersScreen } from '@/screens/BatchUsersScreen';
import { AssignBatchScreen } from '@/screens/AssignBatchScreen';
import { FcrScreen } from '@/screens/FcrScreen';
import { EggsScreen } from '@/screens/EggsScreen';
import { EggSaleFormScreen } from '@/screens/EggSaleFormScreen';
import { FeedStockScreen } from '@/screens/FeedStockScreen';
import { FeedFormulaScreen } from '@/screens/FeedFormulaScreen';
import { FinanceScreen } from '@/screens/FinanceScreen';
import { TradersScreen } from '@/screens/TradersScreen';
import { TraderDetailScreen } from '@/screens/TraderDetailScreen';
import { TasksScreen } from '@/screens/TasksScreen';
import { ReportsScreen } from '@/screens/ReportsScreen';
import { DailyReportScreen } from '@/screens/DailyReportScreen';
import { AnalyticsScreen } from '@/screens/AnalyticsScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { ContactScreen } from '@/screens/ContactScreen';
import { MortalityScreen } from '@/screens/MortalityScreen';
import { WeatherScreen } from '@/screens/WeatherScreen';
import { EggStockByShedScreen } from '@/screens/EggStockByShedScreen';

export default function App() {
  const session = useApp(s => s.session);
  const setOnline = useApp(s => s.setOnline);
  const loc = useLocation();

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [setOnline]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [loc.pathname]);

  return (
    <>
      <Routes>
        {!session && <Route path="/login" element={<LoginScreen />} />}
        {!session && <Route path="*" element={<Navigate to="/login" replace />} />}

        {session && (
          <Route path="*" element={
            <AppShell>
              <Routes>
                <Route path="/" element={<HomeScreen />} />
                <Route path="/farms" element={<FarmsScreen />} />
                <Route path="/farms/:farmId" element={<FarmDetailScreen />} />
                <Route path="/sheds/:shedId" element={<ShedDetailScreen />} />
                <Route path="/batches" element={<BatchListScreen />} />
                <Route path="/batches/:batchId" element={<BatchDetailScreen />} />
                <Route path="/batches/:batchId/users" element={<BatchUsersScreen />} />
                <Route path="/batches/:batchId/users/assign" element={<AssignBatchScreen />} />
                <Route path="/batches/:batchId/fcr" element={<FcrScreen />} />
                <Route path="/batches/:batchId/eggs" element={<EggsScreen />} />
                <Route path="/batches/:batchId/eggs/new-sale" element={<EggSaleFormScreen />} />
                <Route path="/batches/:batchId/mortality" element={<MortalityScreen />} />
                <Route path="/batches/:batchId/analytics" element={<AnalyticsScreen />} />
                <Route path="/batches/:batchId/daily-report" element={<DailyReportScreen />} />
                <Route path="/feed" element={<FeedStockScreen />} />
                <Route path="/feed/formulas" element={<FeedFormulaScreen />} />
                <Route path="/finance" element={<FinanceScreen />} />
                <Route path="/tasks" element={<TasksScreen />} />
                <Route path="/reports" element={<ReportsScreen />} />
                <Route path="/traders" element={<TradersScreen />} />
                <Route path="/traders/:traderId" element={<TraderDetailScreen />} />
                <Route path="/profile" element={<ProfileScreen />} />
                <Route path="/contact" element={<ContactScreen />} />
                <Route path="/weather" element={<WeatherScreen />} />
                <Route path="/egg-stock" element={<EggStockByShedScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AppShell>
          } />
        )}
      </Routes>
      <ToastHost />
    </>
  );
}
