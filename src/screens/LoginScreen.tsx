import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Feather, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import { useApp } from '@/store/app';
import { Button, Field } from '@/components/ui/Form';
import { ROLE_LABELS } from '@/types';

export function LoginScreen() {
  const nav = useNavigate();
  const signIn = useApp(s => s.signIn);
  const users = useApp(s => s.users);
  const online = useApp(s => s.online);
  const [mobile, setMobile] = useState('9035526551');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    setTimeout(() => {
      const r = signIn(mobile);
      setLoading(false);
      if (!r.ok) setError(r.error ?? 'Sign in failed');
      else nav('/', { replace: true });
    }, 300);
  }

  return (
    <div className="min-h-screen bg-canvas safe-top safe-bottom flex flex-col">
      <div className="flex items-center justify-between px-5 sm:px-8 pt-6">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card"><Feather size={17} /></span>
          <div className="leading-tight">
            <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Amrut Poultry</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Management</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-line px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
          {online ? <Wifi size={11} className="text-success" /> : <WifiOff size={11} className="text-warn" />} {online ? 'Online' : 'Offline'}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[400px]">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand mb-2">Welcome back</p>
          <h1 className="font-display text-[34px] leading-[1.1] font-semibold text-ink tracking-tight">Sign in to your farm</h1>
          <p className="text-[14px] text-muted mt-2.5 leading-relaxed">Use your registered mobile number to access your dashboard.</p>

          <form onSubmit={submit} className="mt-7">
            <div className="bg-card border border-line rounded-[20px] shadow-card p-4 space-y-3">
              <Field
                label="Mobile number"
                type="tel" inputMode="numeric" maxLength={10}
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                prefix="+91"
                placeholder="10-digit number"
                className="font-mono"
                error={error ?? undefined}
              />
              <Button type="submit" block size="lg" loading={loading}>Sign in</Button>
            </div>
          </form>

          <div className="mt-5 rounded-[18px] border border-line bg-card/60 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted font-semibold mb-2.5 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-brand" /> Demo accounts — tap to fill
            </p>
            <div className="grid grid-cols-2 gap-2">
              {users.slice(0, 4).map(u => (
                <button
                  key={u.id} type="button"
                  onClick={() => { setMobile(u.mobile); setError(null); }}
                  className="text-left bg-sunk hover:bg-brand-soft transition-colors px-3 py-2.5 rounded-[12px] press"
                >
                  <p className="text-[13px] font-semibold text-ink truncate">{u.name}</p>
                  <p className="font-mono text-[10px] text-muted mt-0.5 tnum truncate">{u.mobile} · {ROLE_LABELS[u.role]}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-[11px] text-muted px-6 pb-6">
        By signing in you agree to Amrut Poultry's terms & privacy policy.
      </p>
    </div>
  );
}
