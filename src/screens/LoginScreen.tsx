import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Feather, ShieldCheck, Wifi, WifiOff, KeyRound, MessageSquareCode } from 'lucide-react';
import { motion } from 'motion/react';
import { useApp } from '@/store/app';
import { dataService } from '@/services/dataService';
import { Button, Field, SegmentedTabs } from '@/components/ui/Form';
import { ErrorShake, EASE, MOTION, Presence, StaggerContainer, StaggerItem, useReducedMotion } from '@/components/motion';
import { ROLE_LABELS } from '@/types';
import { DEMO_PASSWORD } from '@/data/seed';

type Mode = 'password' | 'otp';

export function LoginScreen() {
  const nav = useNavigate();
  const users = useApp(s => s.users);
  const online = useApp(s => s.online);
  const reduced = useReducedMotion();

  const [mode, setMode] = useState<Mode>('password');
  const [mobile, setMobile] = useState('9035526551');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [sentOtp, setSentOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function routeFor(userId: string) {
    // read fresh: cloud hydration replaces `users` in the same tick as sign-in
    const u = useApp.getState().users.find(x => x.id === userId);
    if (!u) return '/';
    if (u.role === 'MASTER_ADMIN') return u.companyIds.length === 0 ? '/admin' : '/';
    if (u.companyIds.length === 1) return '/';
    return '/select-company';
  }

  /** The store session is the single finish line: both auth paths stamp it on success. */
  function finishSignedIn() {
    const id = useApp.getState().session?.userId ?? '';
    nav(routeFor(id), { replace: true });
  }

  async function submitPassword() {
    setError(null); setLoading(true);
    const r = await dataService.auth.signInWithPassword(mobile, password);
    setLoading(false);
    if (!r.ok) return setError(r.error ?? 'Sign in failed');
    finishSignedIn();
  }

  async function sendOtp() {
    setError(null);
    const r = await dataService.auth.requestOtp(mobile);
    if (!r.ok) return setError(r.error ?? 'Cannot send OTP');
    setSentOtp(r.code ?? null);
  }

  async function submitOtp() {
    setError(null); setLoading(true);
    const r = await dataService.auth.signInWithOtp(mobile, otp);
    setLoading(false);
    if (!r.ok) return setError(r.error ?? 'Sign in failed');
    finishSignedIn();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === 'password') void submitPassword();
    else void submitOtp();
  }

  function fill(m: string) {
    setMobile(m); setPassword(DEMO_PASSWORD); setOtp(''); setSentOtp(null); setError(null);
  }

  return (
    <div className="min-h-screen bg-canvas safe-top safe-bottom flex flex-col">
      <StaggerContainer className="flex items-center justify-between px-5 sm:px-8 pt-6">
        <StaggerItem className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-[12px] bg-brand text-white flex items-center justify-center shadow-card"><Feather size={17} /></span>
          <div className="leading-tight">
            <p className="font-display font-semibold text-ink text-[15px] tracking-tight">Poultry</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted">Management</p>
          </div>
        </StaggerItem>
        <StaggerItem className="inline-flex">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-line px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            {online ? <Wifi size={11} className="text-success" /> : <WifiOff size={11} className="text-warn" />} {online ? 'Online' : 'Offline'}
          </span>
        </StaggerItem>
      </StaggerContainer>

      <div className="flex-1 flex items-center justify-center px-5 py-10">
        <StaggerContainer className="w-full max-w-[400px]">
          <StaggerItem>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand mb-2">Welcome back</p>
            <h1 className="font-display text-[34px] leading-[1.1] font-semibold text-ink tracking-tight">Sign in to your farm</h1>
            <p className="text-[14px] text-muted mt-2.5 leading-relaxed">Use your registered mobile number with a password or a one-time code.</p>
          </StaggerItem>

          <StaggerItem className="mt-6">
            <SegmentedTabs
              value={mode}
              onChange={(m) => { setMode(m); setError(null); setSentOtp(null); }}
              options={[
                { value: 'password', label: 'Password', icon: <KeyRound size={14} /> },
                { value: 'otp', label: 'OTP', icon: <MessageSquareCode size={14} /> },
              ]}
            />
          </StaggerItem>

          <StaggerItem>
            <form onSubmit={submit} className="mt-4">
              <ErrorShake trigger={error}>
                <div className="bg-card border border-line rounded-[20px] shadow-card p-4 space-y-3">
                  <Field
                    label="Mobile number" type="tel" inputMode="numeric" maxLength={10}
                    autoComplete="tel"
                    value={mobile}
                    onChange={(e) => { setMobile(e.target.value.replace(/\D/g, '')); setSentOtp(null); }}
                    prefix="+91" placeholder="10-digit number" className="font-mono"
                  />

                  {/* The two credential paths trade places with a short crossfade — the card itself
                    holds its size so the frame never jumps under the thumb. */}
                  <Presence mode="wait">
                    <motion.div
                      key={mode}
                      initial={reduced ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4, transition: { duration: MOTION.micro.duration, ease: EASE } }}
                      transition={reduced ? { duration: 0.01 } : { duration: MOTION.component.duration, ease: EASE }}
                    >
                      {mode === 'password' ? (
                        <Field
                          label="Password" type="password" value={password} autoComplete="current-password"
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••" error={error ?? undefined}
                        />
                      ) : (
                        <>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Field
                                label="One-time code" type="text" inputMode="numeric" maxLength={6}
                                autoComplete="one-time-code"
                                value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                                placeholder="6-digit OTP" className="font-mono" error={error ?? undefined}
                              />
                            </div>
                            <div className="pt-[22px]">
                              <Button type="button" variant="outline" onClick={sendOtp}>Send</Button>
                            </div>
                          </div>
                          {sentOtp && (
                            <motion.p
                              initial={reduced ? false : { opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={reduced ? { duration: 0.01 } : { duration: MOTION.component.duration, ease: EASE }}
                              className="text-[12px] text-muted bg-sunk rounded-[10px] px-3 py-2 mt-1.5"
                            >
                              Demo OTP: <span className="font-mono font-semibold text-brand tnum">{sentOtp}</span>
                            </motion.p>
                          )}
                        </>
                      )}
                    </motion.div>
                  </Presence>

                  <Button type="submit" block size="lg" loading={loading}
                    disabled={mode === 'otp' && !sentOtp}>
                    Sign in
                  </Button>
                </div>
              </ErrorShake>
            </form>
          </StaggerItem>

          <StaggerItem className="mt-5">
            <div className="rounded-[18px] border border-line bg-card/60 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted font-semibold mb-2.5 flex items-center gap-1.5">
                <ShieldCheck size={12} className="text-brand" /> Demo accounts — tap to fill
              </p>
              <div className="grid grid-cols-2 gap-2">
                {users.slice(0, 6).map(u => (
                  <button
                    key={u.id} type="button" onClick={() => fill(u.mobile)}
                    className="text-left bg-sunk hover:bg-brand-soft transition-colors px-3 py-2.5 rounded-[12px] press"
                  >
                    <p className="text-[13px] font-semibold text-ink truncate">{u.name}</p>
                    <p className="font-mono text-[10px] text-muted mt-0.5 tnum truncate">{u.mobile} · {ROLE_LABELS[u.role]}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted mt-2.5">Demo password for all accounts: <span className="font-mono font-semibold text-ink">{DEMO_PASSWORD}</span></p>
            </div>
          </StaggerItem>
        </StaggerContainer>
      </div>

      <p className="text-center text-[11px] text-muted px-6 pb-6">
        By signing in you agree to the platform terms & privacy policy.
      </p>
    </div>
  );
}
