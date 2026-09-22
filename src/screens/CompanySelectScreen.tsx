import { useNavigate } from 'react-router-dom';
import { Building2, Feather, LogOut } from 'lucide-react';
import { useApp, useCurrentUser } from '@/store/app';

export function CompanySelectScreen() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const companies = useApp(s => s.companies);
  const selectCompany = useApp(s => s.selectCompany);
  const signOut = useApp(s => s.signOut);

  if (!user) return null;
  const accessible = user.role === 'MASTER_ADMIN'
    ? companies
    : companies.filter(c => user.companyIds.includes(c.id));

  return (
    <div className="min-h-screen bg-canvas safe-top safe-bottom flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 mb-6">
          <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card"><Feather size={17} /></span>
          <div className="leading-tight">
            <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Choose company</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">{user.name}</p>
          </div>
        </div>

        <h1 className="font-display text-[28px] leading-tight font-semibold text-ink tracking-tight">Select a company to continue</h1>
        <p className="text-[14px] text-muted mt-2 mb-6">Your account has access to more than one company. Data is kept strictly separate.</p>

        <div className="space-y-2.5">
          {accessible.map(c => (
            <button
              key={c.id}
              onClick={() => { const r = selectCompany(c.id); if (r.ok) nav('/', { replace: true }); }}
              className="w-full flex items-center gap-3 bg-card border border-line rounded-[16px] px-4 py-4 text-left press hover:border-brand shadow-card"
            >
              <span className="w-11 h-11 rounded-[12px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0"><Building2 size={20} /></span>
              <span className="flex-1 min-w-0">
                <span className="block text-[15px] font-semibold text-ink truncate">{c.name}</span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted mt-0.5">{c.active ? 'Active' : 'Deactivated'}</span>
              </span>
            </button>
          ))}
          {accessible.length === 0 && (
            <p className="text-[14px] text-muted bg-card border border-line rounded-[16px] px-4 py-6 text-center">No company access. Contact your administrator.</p>
          )}
        </div>

        <button onClick={signOut} className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-muted hover:text-danger press">
          <LogOut size={15} /> Sign out
        </button>
      </div>
    </div>
  );
}
