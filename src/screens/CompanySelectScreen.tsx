import { useNavigate } from 'react-router-dom';
import { Building2, Feather, LogOut } from 'lucide-react';
import { useApp, useCurrentUser, useOperableCompanies } from '@/store/app';
import { isPlatformAdmin } from '@/lib/companyAccess';
import { StaggerContainer, StaggerItem } from '@/components/motion';

export function CompanySelectScreen() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const companies = useApp(s => s.companies);
  const operable = useOperableCompanies();
  const selectCompany = useApp(s => s.selectCompany);
  const signOut = useApp(s => s.signOut);

  if (!user) return null;
  // Only a company that stands can be entered. A platform admin still sees the deactivated
  // ones here — greyed out, with no way in — because this is the one list they manage the
  // lifecycle from without a company context; operational access is a separate question.
  const list = isPlatformAdmin(user) ? companies : operable;

  const enter = (companyId: string) => {
    const r = selectCompany(companyId);
    if (r.ok) nav('/', { replace: true });
  };

  return (
    <div className="min-h-screen bg-canvas safe-top safe-bottom flex flex-col items-center justify-center px-5">
      <StaggerContainer className="w-full max-w-[420px]">
        <StaggerItem className="flex items-center gap-2.5 mb-6">
          <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card"><Feather size={17} /></span>
          <div className="leading-tight">
            <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Choose company</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">{user.name}</p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <h1 className="font-display text-[28px] leading-tight font-semibold text-ink tracking-tight">Select a company to continue</h1>
          <p className="text-[14px] text-muted mt-2 mb-6">Your account has access to more than one company. Data is kept strictly separate.</p>
        </StaggerItem>

        <StaggerContainer className="space-y-2.5">
          {list.map(c => (
            <StaggerItem key={c.id}>
              <button
                disabled={!c.active}
                onClick={() => enter(c.id)}
                className="w-full flex items-center gap-3 bg-card border border-line rounded-[16px] px-4 py-4 text-left press hover:border-brand shadow-card disabled:opacity-60 disabled:pointer-events-none"
              >
                <span className="w-11 h-11 rounded-[12px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0"><Building2 size={20} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] font-semibold text-ink truncate">{c.name}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted mt-0.5">{c.active ? 'Active' : 'Inactive · cannot be opened'}</span>
                </span>
              </button>
            </StaggerItem>
          ))}
          {list.length === 0 && (
            <StaggerItem>
              <p className="text-[14px] text-muted bg-card border border-line rounded-[16px] px-4 py-6 text-center">No active company is assigned to you. Contact your administrator.</p>
            </StaggerItem>
          )}
        </StaggerContainer>

        <StaggerItem className="mt-6">
          <button onClick={signOut} className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-danger press">
            <LogOut size={15} /> Sign out
          </button>
        </StaggerItem>
      </StaggerContainer>
    </div>
  );
}
