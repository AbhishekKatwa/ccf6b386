import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User, CreditCard, Gem, Globe, Lock, Bell, Share2, Star,
  FileText, LogOut, Wifi, WifiOff, RefreshCw, Check,
} from 'lucide-react';
import { useApp, useCurrentUser } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Card, Row, GroupList, ListRow, IconTile, Avatar, Badge } from '@/components/ui/Card';
import { Button, Field } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { fmtDateTime } from '@/lib/format';
import { ROLE_LABELS } from '@/types';

type Group = { title: string; items: Array<{ icon: typeof User; title: string; sub: string; badge?: string; danger?: boolean; action: () => void }> };

export function ProfileScreen() {
  const nav = useNavigate();
  const user = useCurrentUser();
  const signOut = useApp(s => s.signOut);
  const online = useApp(s => s.online);
  const syncPending = useApp(s => s.syncPending);
  const resetDemo = useApp(s => s.resetDemo);
  const pushToast = useApp(s => s.pushToast);
  const farms = useApp(s => s.farms);
  const batches = useApp(s => s.batches);
  const mortality = useApp(s => s.mortality);

  const [confirmOut, setConfirmOut] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [lang, setLang] = useState('English (India)');
  const [pwd, setPwd] = useState({ current: '', next: '', confirm: '' });

  if (!user) return null;

  const totalBirds = batches.filter(b => b.status === 'LIVE').reduce((s, b) => s + b.initialBirds, 0);
  const pendingSync = mortality.filter(m => !m.synced).length;

  const groups: Group[] = [
    {
      title: 'Account',
      items: [
        { icon: User, title: 'My profile', sub: `${user.name} · +91 ${user.mobile}`, action: () => pushToast('info', 'Profile editor coming soon') },
        { icon: CreditCard, title: 'Membership details', sub: 'Current plan: Free trial', action: () => pushToast('info', 'Membership: Free trial · 30 days left') },
        { icon: Gem, title: 'Subscription plan', sub: 'Upgrade for advanced analytics', badge: 'Upgrade', action: () => pushToast('info', 'Subscription plans coming soon') },
      ],
    },
    {
      title: 'Settings',
      items: [
        { icon: Globe, title: 'Change language', sub: lang, action: () => setLangOpen(true) },
        { icon: Lock, title: 'Change password', sub: 'Last changed 30 days ago', action: () => setPwdOpen(true) },
        { icon: Bell, title: 'Notifications', sub: 'Alerts & reminders', action: () => pushToast('info', 'Notifications enabled') },
      ],
    },
    {
      title: 'Data & sync',
      items: [
        { icon: online ? Wifi : WifiOff, title: online ? 'Online — synced' : 'Offline mode', sub: pendingSync > 0 ? `${pendingSync} records pending sync` : 'All records synced', action: () => { if (pendingSync > 0) { syncPending(); pushToast('success', 'Synced pending records'); } else pushToast('info', 'Already in sync'); } },
        { icon: RefreshCw, title: 'Reset demo data', sub: 'Restore seed data', danger: true, action: () => { resetDemo(); pushToast('success', 'Demo data reset'); } },
      ],
    },
    {
      title: 'More',
      items: [
        { icon: Share2, title: 'Share app', sub: 'Refer a farmer', action: () => pushToast('success', 'Share link copied') },
        { icon: Star, title: 'Rate app', sub: 'Leave a review', action: () => pushToast('info', 'Thanks for the love!') },
        { icon: FileText, title: 'Privacy policy', sub: 'Terms & conditions', action: () => pushToast('info', 'Privacy policy: data stays on your device') },
        { icon: LogOut, title: 'Sign out', sub: 'Log out of your account', danger: true, action: () => setConfirmOut(true) },
      ],
    },
  ];

  function submitPwd() {
    if (!pwd.current || !pwd.next) return pushToast('error', 'All fields required');
    if (pwd.next.length < 6) return pushToast('error', 'Password must be at least 6 characters');
    if (pwd.next !== pwd.confirm) return pushToast('error', 'Passwords do not match');
    pushToast('success', 'Password updated');
    setPwdOpen(false); setPwd({ current: '', next: '', confirm: '' });
  }

  return (
    <Page withNav>
      <ScreenTitle eyebrow="Account" title="Profile" />

      <div className="px-4 sm:px-0 mt-3 space-y-4">
        <div className="rounded-[22px] bg-brand text-white p-5 shadow-card">
          <div className="flex items-center gap-4">
            <Avatar name={user.name} initials={user.initials} size={56} tone="accent" />
            <div className="flex-1 min-w-0">
              <h2 className="font-display font-bold text-xl truncate">{user.name}</h2>
              <p className="text-white/60 text-sm mt-0.5 font-mono">+91 {user.mobile}</p>
              <span className="inline-block mt-2 bg-white/10 text-white/80 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
                {ROLE_LABELS[user.role]}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5">
            {[
              [String(farms.length), 'Farms'],
              [String(batches.length), 'Batches'],
              [totalBirds >= 1000 ? `${Math.round(totalBirds / 1000)}K` : String(totalBirds), 'Birds'],
            ].map(([v, l]) => (
              <div key={l} className="bg-white/10 rounded-2xl p-3 text-center">
                <p className="font-display font-bold text-xl tnum">{v}</p>
                <p className="text-white/60 text-[10px] mt-0.5">{l}</p>
              </div>
            ))}
          </div>
        </div>

        <Card>
          <p className="font-display font-bold text-ink text-sm mb-2">Session</p>
          <Row label="Signed in" value={fmtDateTime(user.createdAt)} />
          <Row label="Role" value={ROLE_LABELS[user.role]} mono={false} />
          <Row label="Sync status" value={online ? 'Online' : 'Offline'} mono={false} />
        </Card>

        {groups.map(g => (
          <div key={g.title}>
            <p className="font-display font-bold text-ink text-sm uppercase tracking-wider mb-2 px-1">{g.title}</p>
            <GroupList>
              {g.items.map(item => {
                const Icon = item.icon;
                return (
                  <ListRow key={item.title} onClick={item.action}
                    leading={<IconTile tone={item.danger ? 'danger' : 'brand'}><Icon size={17} /></IconTile>}
                    title={<span className={item.danger ? 'text-danger' : undefined}>{item.title}</span>}
                    subtitle={item.sub}
                    trailing={item.badge ? <Badge tone="accent">{item.badge}</Badge> : undefined} />
                );
              })}
            </GroupList>
          </div>
        ))}

        <p className="text-center text-faint text-xs mt-6 font-mono">
          AMRUT POULTRY MANAGEMENT · v2.0 · Build 2026.09
        </p>
      </div>

      <ConfirmDialog open={confirmOut} title="Sign out?" danger
        message="You will need to sign in again with your mobile number."
        confirmLabel="Sign out" onCancel={() => setConfirmOut(false)}
        onConfirm={() => { signOut(); nav('/login', { replace: true }); }} />

      <Dialog open={langOpen} onClose={() => setLangOpen(false)} title="Change language"
        footer={<Button block onClick={() => { setLangOpen(false); pushToast('success', `Language: ${lang}`); }}>Save</Button>}>
        <div className="space-y-2">
          {['English (India)', 'हिंदी', 'मराठी', 'ગુજરાતી', 'తెలుగు', 'ಕನ್ನಡ'].map(l => (
            <button key={l} onClick={() => setLang(l)}
              className={`press w-full flex items-center justify-between px-4 py-3 rounded-2xl border transition-all ${lang === l ? 'border-brand bg-brand-soft' : 'border-line bg-card'}`}>
              <span className="text-sm font-semibold text-ink">{l}</span>
              {lang === l && <Check size={16} className="text-brand" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog open={pwdOpen} onClose={() => setPwdOpen(false)} title="Change password"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setPwdOpen(false)}>Cancel</Button><Button block onClick={submitPwd}>Update</Button></div>}>
        <div className="space-y-3">
          <Field label="Current password" type="password" value={pwd.current} onChange={e => setPwd(p => ({ ...p, current: e.target.value }))} />
          <Field label="New password" type="password" value={pwd.next} onChange={e => setPwd(p => ({ ...p, next: e.target.value }))} hint="Minimum 6 characters" />
          <Field label="Confirm new password" type="password" value={pwd.confirm} onChange={e => setPwd(p => ({ ...p, confirm: e.target.value }))} />
        </div>
      </Dialog>
    </Page>
  );
}
