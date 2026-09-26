import { useNavigate } from 'react-router-dom';
import { Building2, LogOut, ShieldAlert } from 'lucide-react';
import { accessMessage, type CompanyAccess } from '@/lib/companyAccess';
import { useApp, useCurrentUser, useOperableCompanies } from '@/store/app';
import { PageReveal } from '@/components/motion';

/**
 * The whole screen a blocked company context resolves to — no shell, no navigation and no
 * figure from the tenant this session was just cut off from. It reads its words from the
 * access reason alone (§17), and it is what a stale URL lands on too: the gate lives above
 * the router, so an old link cannot render a dashboard behind this card.
 */
export function CompanyUnavailableScreen({ access }: { access: CompanyAccess }) {
  const nav = useNavigate();
  const user = useCurrentUser();
  const companies = useOperableCompanies();
  const clearAccessNotice = useApp(s => s.clearAccessNotice);
  const signOut = useApp(s => s.signOut);
  const { title, body } = accessMessage(access);

  return (
    <div className="min-h-screen bg-canvas safe-top safe-bottom flex flex-col items-center justify-center px-5">
      <PageReveal className="w-full max-w-[420px]">
        <div className="flex items-center gap-2.5 mb-6">
          <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card"><Building2 size={17} /></span>
          <div className="leading-tight">
            <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Poultry Management</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">{user?.name}</p>
          </div>
        </div>

        <div className="bg-card border border-line rounded-[20px] p-6 shadow-card">
          <span className="w-11 h-11 rounded-[14px] bg-warn-soft text-warn flex items-center justify-center mb-4">
            <ShieldAlert size={20} />
          </span>
          <h1 className="font-display text-[24px] leading-tight font-semibold text-ink tracking-tight">{title}</h1>
          <p className="text-[14px] leading-relaxed text-muted mt-2">{body}</p>

          <div className="flex flex-col gap-2.5 mt-6">
            {companies.length > 0 && (
              <button
                onClick={() => { clearAccessNotice(); nav('/select-company', { replace: true }); }}
                className="w-full bg-brand text-white rounded-[14px] py-3.5 font-display text-[15px] font-semibold flex items-center justify-center gap-2 press hover:bg-brand-2 shadow-card"
              >
                {companies.length === 1 ? 'Continue to your company' : 'Choose another company'}
              </button>
            )}
            <button
              onClick={signOut}
              className="w-full rounded-[12px] border border-line bg-card text-ink text-[14px] font-semibold px-4 py-3.5 inline-flex items-center justify-center gap-2 press hover:bg-sunk"
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>

        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-2 mt-4 text-center">
          Your records are safe · Contact your administrator for access
        </p>
      </PageReveal>
    </div>
  );
}
