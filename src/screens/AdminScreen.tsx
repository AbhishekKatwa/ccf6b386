import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Users, Power, LogIn, Check, MessageCircle, Inbox, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Button, Field, SelectField, SegmentedTabs } from '@/components/ui/Form';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, EmptyState } from '@/components/ui/Card';
import { useApp } from '@/store/app';
import { COMPANY_ASSIGNABLE_ROLES, ROLE_LABELS, type Role } from '@/types';
import { fmtDateTime } from '@/lib/format';
import { DEMO_PASSWORD } from '@/data/seed';

type Tab = 'companies' | 'users' | 'support';

export function AdminScreen() {
  const nav = useNavigate();
  const companies = useApp(s => s.companies);
  const users = useApp(s => s.users);
  const addCompany = useApp(s => s.addCompany);
  const toggleCompanyActive = useApp(s => s.toggleCompanyActive);
  const createUser = useApp(s => s.createUser);
  const toggleUserActive = useApp(s => s.toggleUserActive);
  const updateUserCompanies = useApp(s => s.updateUserCompanies);
  const selectCompany = useApp(s => s.selectCompany);
  const pushToast = useApp(s => s.pushToast);
  const supportMessages = useApp(s => s.supportMessages);
  const markSupportHandled = useApp(s => s.markSupportHandled);

  const [tab, setTab] = useState<Tab>('companies');
  const [companyDialog, setCompanyDialog] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [userDialog, setUserDialog] = useState(false);
  const [mapDialog, setMapDialog] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', mobile: '', password: '', role: 'OWNER' as Role, companyIds: [] as string[] });
  const [formError, setFormError] = useState<string | null>(null);

  function submitCompany() {
    if (!newCompany.trim()) return;
    addCompany(newCompany.trim());
    pushToast('success', `Company "${newCompany.trim()}" created`);
    setNewCompany(''); setCompanyDialog(false);
  }

  function submitUser() {
    setFormError(null);
    const r = createUser(form);
    if (!r.ok) return setFormError(r.error ?? 'Failed to create user');
    pushToast('success', `${form.name} created`);
    setForm({ name: '', mobile: '', password: '', role: 'OWNER', companyIds: [] });
    setUserDialog(false);
  }

  const mapUser = users.find(u => u.id === mapDialog);

  return (
    <Page withNav>
      <ScreenTitle
        eyebrow="Master Admin"
        title="Platform"
        subtitle="Create companies, users and control access across the platform."
        action={tab === 'companies'
          ? <Button size="sm" icon={<Plus size={15} />} onClick={() => setCompanyDialog(true)}>Company</Button>
          : <Button size="sm" icon={<Plus size={15} />} onClick={() => setUserDialog(true)}>User</Button>}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-4">
        <SegmentedTabs
          value={tab} onChange={setTab}
          options={[
            { value: 'companies', label: `Companies (${companies.length})`, icon: <Building2 size={14} /> },
            { value: 'users', label: `Users (${users.length})`, icon: <Users size={14} /> },
            { value: 'support', label: `Support (${supportMessages.filter(m => !m.handledAt).length})`, icon: <Inbox size={14} /> },
          ]}
        />

        {tab === 'companies' && (
          <div className="space-y-2.5">
            {companies.map(c => {
              const memberCount = users.filter(u => u.companyIds.includes(c.id)).length;
              return (
                <div key={c.id} className="bg-card border border-line rounded-[16px] p-4 shadow-card">
                  <div className="flex items-start gap-3">
                    <span className="w-11 h-11 rounded-[12px] bg-brand-soft text-brand-ink flex items-center justify-center shrink-0"><Building2 size={20} /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-semibold text-ink truncate">{c.name}</p>
                        <Badge tone={c.active ? 'success' : 'neutral'}>{c.active ? 'Active' : 'Off'}</Badge>
                      </div>
                      <p className="font-mono text-[11px] text-muted mt-1 tnum">{memberCount} user{memberCount === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" icon={<LogIn size={14} />}
                      onClick={() => { const r = selectCompany(c.id); if (r.ok) { pushToast('info', `Entered ${c.name}`); nav('/'); } else pushToast('error', r.error ?? 'Cannot enter'); }}>
                      Enter
                    </Button>
                    <Button size="sm" variant={c.active ? 'outline' : 'success'} icon={<Power size={14} />}
                      onClick={() => { toggleCompanyActive(c.id); pushToast('success', c.active ? 'Company deactivated' : 'Company activated'); }}>
                      {c.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </div>
              );
            })}
            {companies.length === 0 && <EmptyState title="No companies yet" description="Create the first company to get started." />}
          </div>
        )}

        {tab === 'users' && (
          <div className="space-y-2">
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 bg-card border border-line rounded-[14px] px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold text-ink truncate">{u.name}</p>
                    {!u.active && <Badge tone="neutral">Off</Badge>}
                  </div>
                  <p className="font-mono text-[11px] text-muted mt-0.5 tnum truncate">
                    {u.mobile} · {ROLE_LABELS[u.role]}
                    {u.role !== 'MASTER_ADMIN' && ` · ${u.companyIds.map(id => companies.find(c => c.id === id)?.name ?? '?').join(', ') || 'no company'}`}
                  </p>
                </div>
                {u.role !== 'MASTER_ADMIN' && (
                  <Button size="sm" variant="ghost" onClick={() => setMapDialog(u.id)}>Map</Button>
                )}
                <Button size="sm" variant={u.active ? 'outline' : 'success'} icon={<Power size={14} />}
                  onClick={() => { toggleUserActive(u.id); pushToast('success', u.active ? 'User deactivated' : 'User activated'); }}>
                  {u.active ? 'Off' : 'On'}
                </Button>
              </div>
            ))}
          </div>
        )}
        {tab === 'support' && (
          <div className="space-y-2.5">
            {supportMessages.length === 0 && (
              <EmptyState icon={<MessageCircle size={22} />} title="No support messages"
                description="Anything sent from Contact & help by any user, in any company, lands here." />
            )}
            {[...supportMessages].sort((a, b) => (a.handledAt ? 1 : 0) - (b.handledAt ? 1 : 0) || b.at.localeCompare(a.at)).map(m => {
              const company = companies.find(c => c.id === m.companyId);
              return (
                <div key={m.id} className={clsx('bg-card border rounded-[16px] p-4 shadow-card', m.handledAt ? 'border-line-2' : 'border-line')}>
                  <div className="flex items-start gap-3">
                    <span className={clsx('w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0',
                      m.handledAt ? 'bg-sunk text-muted' : 'bg-brand-soft text-brand-ink')}>
                      {m.handledAt ? <ShieldCheck size={18} /> : <MessageCircle size={18} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[15px] font-semibold text-ink truncate">{m.name}</p>
                        {m.role && <Badge tone="neutral">{ROLE_LABELS[m.role]}</Badge>}
                        {m.handledAt && <Badge tone="success">Handled</Badge>}
                      </div>
                      <p className="font-mono text-[11px] text-muted mt-0.5 tnum truncate">
                        {fmtDateTime(m.at)}{m.mobile ? ` · ${m.mobile}` : ''}{company ? ` · ${company.name}` : ' · no company'}
                      </p>
                      {m.subject && <p className="text-[13px] font-semibold text-ink-2 mt-1.5">{m.subject}</p>}
                      <p className="text-[13px] text-muted mt-1 leading-relaxed whitespace-pre-wrap break-words">{m.message}</p>
                      {m.handledAt && (
                        <p className="font-mono text-[10px] text-muted-2 mt-2">
                          Handled {fmtDateTime(m.handledAt)}{m.handledBy ? ` by ${m.handledBy}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  {!m.handledAt && (
                    <div className="flex gap-2 mt-3">
                      <Button size="sm" variant="outline" icon={<Check size={14} />}
                        onClick={() => { const r = markSupportHandled(m.id); pushToast(r.ok ? 'success' : 'error', r.ok ? 'Marked handled' : r.error ?? 'Failed'); }}>
                        Mark handled
                      </Button>
                      {m.mobile && <Button size="sm" variant="ghost" icon={<MessageCircle size={14} />} onClick={() => { window.location.href = `sms:${m.mobile}`; }}>Reply</Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create company */}
      <Dialog open={companyDialog} onClose={() => setCompanyDialog(false)} title="New company"
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setCompanyDialog(false)}>Cancel</Button><Button block onClick={submitCompany}>Create</Button></div>}>
        <Field label="Company name" value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="e.g. Amrut Poultry Farm" autoFocus />
      </Dialog>

      {/* Create user */}
      <Dialog open={userDialog} onClose={() => setUserDialog(false)} title="New user" subtitle="Users are unique by mobile — assign them to companies instead of duplicating."
        footer={<div className="flex gap-2"><Button variant="outline" block onClick={() => setUserDialog(false)}>Cancel</Button><Button block onClick={submitUser}>Create user</Button></div>}>
        <div className="space-y-3">
          <Field label="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Name" />
          <Field label="Mobile number" type="tel" inputMode="numeric" maxLength={10} prefix="+91" className="font-mono"
            value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value.replace(/\D/g, '') })} placeholder="10-digit number" />
          <Field label="Password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            placeholder={`min 4 chars (demo: ${DEMO_PASSWORD})`} />
          <SelectField label="Role" value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value as Role })}
            options={[...COMPANY_ASSIGNABLE_ROLES, 'MASTER_ADMIN' as Role].map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
          {form.role !== 'MASTER_ADMIN' && (
            <div>
              <p className="block font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted mb-1.5">Companies</p>
              <div className="space-y-1.5">
                {companies.map(c => {
                  const on = form.companyIds.includes(c.id);
                  return (
                    <button key={c.id} type="button"
                      onClick={() => setForm({ ...form, companyIds: on ? form.companyIds.filter(x => x !== c.id) : [...form.companyIds, c.id] })}
                      className={clsx('w-full flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left press', on ? 'border-brand bg-brand-soft' : 'border-line bg-card')}>
                      <span className={clsx('w-5 h-5 rounded-[6px] border flex items-center justify-center shrink-0', on ? 'bg-brand border-brand text-white' : 'border-line')}>
                        {on && <Check size={13} />}
                      </span>
                      <span className="text-[13px] font-medium text-ink truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {formError && <p className="text-[12px] text-danger font-medium">{formError}</p>}
        </div>
      </Dialog>

      {/* Map user → companies */}
      <Dialog open={!!mapDialog} onClose={() => setMapDialog(null)} title="Map to companies" subtitle={mapUser?.name}
        footer={<Button block onClick={() => { setMapDialog(null); pushToast('success', 'Access updated'); }}>Done</Button>}>
        <div className="space-y-1.5">
          {companies.map(c => {
            const on = mapUser?.companyIds.includes(c.id) ?? false;
            return (
              <button key={c.id} type="button"
                onClick={() => mapUser && updateUserCompanies(mapUser.id, on ? mapUser.companyIds.filter(x => x !== c.id) : [...mapUser.companyIds, c.id])}
                className={clsx('w-full flex items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left press', on ? 'border-brand bg-brand-soft' : 'border-line bg-card')}>
                <span className={clsx('w-5 h-5 rounded-[6px] border flex items-center justify-center shrink-0', on ? 'bg-brand border-brand text-white' : 'border-line')}>
                  {on && <Check size={13} />}
                </span>
                <span className="text-[13px] font-medium text-ink truncate">{c.name}</span>
              </button>
            );
          })}
        </div>
      </Dialog>
    </Page>
  );
}
