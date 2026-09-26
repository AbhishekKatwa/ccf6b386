/**
 * UsersScreen — the people of the company you are standing in.
 *
 * The roster, the sheds beside a name and the access list inside a detail sheet are all read
 * through lib/team, which derives them from slices the store already holds: assignments, sheds,
 * batches and the audit trail. Nothing here is a second copy of a person's rights, so a row can
 * never disagree with what that person finds on screen when they sign in (§7, §9, §12).
 *
 * The company is the boundary. `useCompanyData()` answers with the members of the active company
 * — the same membership the database answers with — and every write is made against that company
 * rather than a companyId this screen picked (§6). What the database then allows is 015's
 * `set_person_access`, whose gates are the same rules the buttons here follow, so an action that
 * looks offered is an action that works.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users as UsersIcon, UserPlus, Power, ShieldCheck, ChevronRight, Info,
  MapPin, Lock, RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Avatar, Badge, Card, EmptyState, GroupList, ListRow, PermissionChip, Row, SectionTitle } from '@/components/ui/Card';
import { Button, Field, SearchField, SelectField, Toggle } from '@/components/ui/Form';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { PageReveal, StaggerContainer, StaggerItem } from '@/components/motion';
import { useApp, useCan, useCompanyData, useCurrentUser } from '@/store/app';
import { isPlatformAdmin } from '@/lib/companyAccess';
import { MANAGEABLE_ROLES, accessOf, buildTeam, roleLabel, type TeamRow } from '@/lib/team';
import { COMPANY_ASSIGNABLE_ROLES, ROLE_LABELS, type Role, type User } from '@/types';
import { dataService } from '@/services/dataService';
import { fmtDate, fmtDateTime } from '@/lib/format';

/** The order a role list reads in: most access first, so a long roster groups sensibly. */
const ROLE_ORDER: Role[] = ['OWNER', 'FARM_SUPERVISOR', 'FINANCIAL_SUPERVISOR', 'FARM_MANAGER', 'FARM_LABOR', 'MASTER_ADMIN'];

type Status = 'ALL' | 'ON' | 'OFF';

/** Which roles this session may hand out: an owner lowers access, the platform assigns it. */
function assignableRoles(platform: boolean): Role[] {
  return (platform ? COMPANY_ASSIGNABLE_ROLES : MANAGEABLE_ROLES)
    .slice()
    .sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
}

/**
 * Who is out of this session's reach. The screen reads the same rule the store and the database
 * read (lib/team · personBlock), so a person is never offered as editable here and refused there.
 */
const blocked = (row: TeamRow) => !row.manageable;

/** Where a person's shed access is actually granted. `/batches/:id/users` is an owner's screen,
 *  so a platform session goes to the batch list instead of a wall. */
function peopleLink(row: TeamRow, me: User | null): string {
  const batch = row.liveBatches[0];
  return batch && me?.role === 'OWNER' ? `/batches/${batch.id}/users` : '/batches';
}

export function UsersScreen() {
  const nav = useNavigate();
  const data = useCompanyData();
  const me = useCurrentUser();
  const canManage = useCan('manageUsers');
  const pushToast = useApp(s => s.pushToast);
  const platform = isPlatformAdmin(me);
  const company = data.companies.find(c => c.id === data.companyId);

  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [status, setStatus] = useState<Status>('ALL');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<TeamRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', mobile: '', password: '', role: 'FARM_LABOR' as Role, active: true });
  const [draftError, setDraftError] = useState<string | null>(null);

  const team = useMemo(() => buildTeam({
    users: data.users,
    sheds: data.sheds,
    batches: data.batches,
    assignments: data.assignments,
    audit: data.audit,
    companyId: data.companyId,
    caller: me,
    platform,
  }), [data, me, platform]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return team.filter(r =>
      (!needle || r.user.name.toLowerCase().includes(needle) || r.user.mobile.includes(needle))
      && (!role || r.user.role === role)
      && (status === 'ALL' || (status === 'ON') === r.user.active));
  }, [team, query, role, status]);

  /** Only the roles actually present, so a filter is never a dead end. */
  const roleOptions = useMemo(() => {
    const here = new Set(team.map(r => r.user.role));
    return [...ROLE_ORDER.filter(x => here.has(x))].map(value => ({
      value, label: `${ROLE_LABELS[value]} (${team.filter(r => r.user.role === value).length})`,
    }));
  }, [team]);

  const selected = team.find(r => r.user.id === openId) ?? null;
  const narrowing = !!query || !!role || status !== 'ALL';
  const active = team.filter(r => r.user.active).length;

  async function saveRole(row: TeamRow, next: Role) {
    setBusy(true);
    const r = await dataService.users.updateRole(row.user.id, next);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'The database refused that change');
    setError(null);
    pushToast('success', `${row.user.name} is now ${ROLE_LABELS[next]}`);
  }

  async function setActive(row: TeamRow, on: boolean) {
    setBusy(true);
    const r = await dataService.users.setActive(row.user.id, on);
    setBusy(false);
    if (!r.ok) return setError(r.error ?? 'The database refused that change');
    setError(null);
    setConfirmOff(null);
    pushToast('success', on ? `${row.user.name} can sign in again` : `${row.user.name} can no longer sign in`);
  }

  async function submitAdd() {
    if (!data.companyId) return;
    const startedOff = !draft.active;
    setBusy(true);
    const r = await dataService.users.create({
      name: draft.name.trim(), mobile: draft.mobile, password: draft.password,
      role: draft.role, companyIds: [data.companyId],
    });
    // The create path always lands a live account, so "created switched off" is a second step.
    // If only that step fails the person really does exist — the message has to say so.
    const off = r.ok && r.user && startedOff
      ? await dataService.users.setActive(r.user.id, false)
      : null;
    setBusy(false);
    if (!r.ok) return setDraftError(r.error ?? 'Could not create that user');
    setDraftError(null);
    setAddOpen(false);
    setDraft({ name: '', mobile: '', password: '', role: 'FARM_LABOR', active: true });
    const name = r.user?.name ?? 'The new user';
    if (off && !off.ok) {
      pushToast('error', `${name} was created, but could not be switched off — they can sign in until you do.`);
      return;
    }
    pushToast('success', `${name} can ${startedOff ? 'sign in once you switch them on' : 'now sign in'}`);
  }

  return (
    <Page withNav>
      <PageReveal>
        <ScreenTitle
          eyebrow="Team"
          title="Users"
          subtitle={company
            ? `${company.name} · ${team.length} ${team.length === 1 ? 'person' : 'people'} · ${active} able to sign in`
            : 'Choose a company to see its team'}
          action={canManage && data.companyId
            ? <Button size="sm" icon={<UserPlus size={15} />} onClick={() => setAddOpen(true)}>Add User</Button>
            : undefined}
        />

        <div className="px-4 sm:px-0 mt-1 space-y-4">
          {/* ---------- the roster is one company's, and says so ---------- */}
          <Card>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <SearchField value={query} onChange={setQuery} placeholder="Search name or mobile" />
              <SelectField className="sm:w-[190px]" label="Role" value={role}
                onChange={e => setRole(e.target.value as Role | '')}
                options={[{ value: '', label: 'All roles' }, ...roleOptions]} />
              <div>
                <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Status</p>
                <div className="flex gap-2">
                  {([['ALL', 'All'], ['ON', 'Active'], ['OFF', 'Switched off']] as [Status, string][]).map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setStatus(v)}
                      className={clsx('rounded-full border px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] press',
                        status === v ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-card text-muted hover:text-ink')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {narrowing && (
              <div className="mt-3 flex items-center gap-2 border-t border-line-2 pt-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-2">
                  {rows.length} of {team.length} shown
                </span>
                <button type="button"
                  onClick={() => { setQuery(''); setRole(''); setStatus('ALL'); }}
                  className="inline-flex items-center gap-1 rounded-full bg-sunk px-2 py-1 font-mono text-[10px] text-ink-2 press hover:text-brand">
                  <RotateCcw size={11} /> Clear filters
                </button>
              </div>
            )}
          </Card>

          {rows.length === 0 ? (
            team.length === 0 ? (
              <EmptyState icon={<UsersIcon size={19} strokeWidth={1.75} />}
                title="Nobody is listed here yet"
                description={canManage
                  ? 'Add the people who work this farm. Each one gets a login of their own and only the screens their role opens.'
                  : 'The platform admin maps people into this company. Once they do, they appear here.'} />
            ) : (
              <EmptyState icon={<UsersIcon size={19} strokeWidth={1.75} />}
                title="No one matches this reading"
                description="These people work here, but none of them fit the search and filters above."
                action={<Button variant="outline" size="sm" icon={<RotateCcw size={14} />}
                  onClick={() => { setQuery(''); setRole(''); setStatus('ALL'); }}>Clear filters</Button>} />
            )
          ) : (
            <>
              {/* ---------- desktop: one compact table ---------- */}
              <div className="hidden lg:block overflow-x-auto no-scrollbar">
                <table className="w-full min-w-[760px] text-[13px]">
                  <thead>
                    <tr className="text-left font-mono text-[9px] uppercase tracking-[0.1em] text-muted-2">
                      <th className="px-3 py-2 font-semibold">Person</th>
                      <th className="px-3 py-2 font-semibold">Role here</th>
                      <th className="px-3 py-2 font-semibold">Sheds</th>
                      <th className="px-3 py-2 font-semibold">Last recorded action</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-2">
                    {rows.map(r => (
                      <tr key={r.user.id} onClick={() => setOpenId(r.user.id)}
                        className="cursor-pointer transition-colors hover:bg-sunk/60">
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar name={r.user.name} initials={r.user.initials} size={32}
                              tone={r.user.active ? 'brand' : 'neutral'} />
                            <div className="min-w-0">
                              <p className="font-semibold text-ink truncate">
                                {r.user.name}
                                {r.user.id === me?.id && <span className="ml-1.5 font-mono text-[9px] uppercase text-muted-2">you</span>}
                              </p>
                              <p className="font-mono text-[10px] text-muted tnum">{r.user.mobile}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5"><Badge tone={r.user.role === 'OWNER' ? 'brand' : 'neutral'}>{roleLabel(r.user.role)}</Badge></td>
                        <td className="px-3 py-2.5 text-ink-2">
                          {r.sheds.length === 0
                            ? <span className="text-muted-2">None assigned</span>
                            : <span className="tnum">{r.sheds.map(s => s.name).join(', ')}</span>}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-muted tnum">
                          {r.lastActivity ? fmtDateTime(r.lastActivity) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={r.user.active ? 'success' : 'neutral'}>{r.user.active ? 'Active' : 'Off'}</Badge>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          {/* The row is clickable, but a keyboard only reaches a real control. */}
                          <button type="button" onClick={() => setOpenId(r.user.id)}
                            aria-label={`Open ${r.user.name}`} className="text-faint press hover:text-brand">
                            <ChevronRight size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ---------- mobile and tablet: cards ---------- */}
              <div className="lg:hidden">
                <StaggerContainer className="space-y-2.5">
                  {rows.map(r => (
                    <StaggerItem key={r.user.id}>
                      <GroupList>
                        <ListRow
                          leading={<Avatar name={r.user.name} initials={r.user.initials} size={38}
                            tone={r.user.active ? 'brand' : 'neutral'} />}
                          title={r.user.name}
                          subtitle={`${r.user.mobile} · ${roleLabel(r.user.role)}`}
                          chips={[
                            !r.user.active && <Badge key="s" tone="neutral">Off</Badge>,
                            r.sheds.length > 0 && <Badge key="h" tone="neutral">{r.sheds.length} shed{r.sheds.length === 1 ? '' : 's'}</Badge>,
                            // Your own row is not "platform managed" — it is you, and only another
                            // owner or the platform admin can change it.
                            r.user.id === me?.id && <Badge key="y" tone="neutral">You</Badge>,
                            blocked(r) && r.user.id !== me?.id && <Badge key="b" tone="warn">Platform managed</Badge>,
                          ].filter(Boolean)}
                          trailing={<ChevronRight size={16} className="text-faint" />}
                          onClick={() => setOpenId(r.user.id)}
                        />
                      </GroupList>
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </div>
            </>
          )}

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
            <Info size={12} className="mt-0.5 shrink-0" />
            This list is the company you are standing in, and so are the changes you can make from
            it. A role takes effect the next time that person opens the app; switching an account
            off ends their access without touching a single record they already wrote.
          </p>
        </div>
      </PageReveal>

      {/* ============================= one person, in full ============================= */}
      <Dialog open={!!selected} onClose={() => { setOpenId(null); setError(null); }}
        title={selected?.user.name ?? ''}
        subtitle={selected ? `${roleLabel(selected.user.role)} · ${company?.name ?? 'this company'}` : ''}>
        {selected && <PersonDetail
          key={selected.user.id}
          row={selected} companyName={company?.name ?? null} me={me} canManage={canManage}
          platform={platform} busy={busy} error={error}
          onRole={next => saveRole(selected, next)}
          onOff={() => setConfirmOff(selected)}
          onOn={() => setActive(selected, true)}
          onOpenBatches={() => { setOpenId(null); nav(peopleLink(selected, me)); }}
        />}
      </Dialog>

      {/* §5 — the wording is the one the specification asks for, and nothing deletes here. */}
      <ConfirmDialog open={!!confirmOff}
        title={confirmOff ? `Deactivate ${confirmOff.user.name}?` : 'Deactivate this user?'}
        message="Deactivate this user? They will no longer be able to access this company's operational data."
        confirmLabel="Deactivate" danger
        onConfirm={() => confirmOff && setActive(confirmOff, false)}
        onCancel={() => setConfirmOff(null)}
      />

      {/* ============================= add a person to THIS company ============================= */}
      <Dialog open={addOpen} onClose={() => { setAddOpen(false); setDraftError(null); }}
        title="Add user" subtitle={`They join ${company?.name ?? 'this company'} only.`}
        footer={<div className="flex gap-2">
          <Button variant="outline" block onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button block loading={busy} onClick={submitAdd}>Create user</Button>
        </div>}>
        <div className="space-y-3">
          <Field label="Full name" value={draft.name} autoComplete="off" placeholder="Name"
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
          <Field label="Mobile number" type="tel" inputMode="numeric" maxLength={10} prefix="+91"
            className="font-mono" autoComplete="off" placeholder="10-digit number"
            value={draft.mobile} onChange={e => setDraft({ ...draft, mobile: e.target.value.replace(/\D/g, '') })} />
          <Field label="Sign-in password" value={draft.password} autoComplete="new-password"
            hint="The login is created through the app's own authentication — this is not a note field."
            onChange={e => setDraft({ ...draft, password: e.target.value })}
            placeholder="min 4 characters" />
          <SelectField label="Role" value={draft.role}
            onChange={e => setDraft({ ...draft, role: e.target.value as Role })}
            options={assignableRoles(platform).map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
          <Toggle checked={draft.active} onChange={v => setDraft({ ...draft, active: v })}
            label="Can sign in" description={draft.active
              ? 'The account is live as soon as it is created.'
              : 'Created switched off: they will not appear able to sign in until you switch them on.'} />
          <AccessPreview role={draft.role} />
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-faint">
            <MapPin size={12} className="mt-0.5 shrink-0" />
            Sheds are not assigned here: a person works the sheds their batch access places them in.
            Open a batch's People screen after creating this one.
          </p>
          {draftError && <p className="text-[12px] font-semibold text-danger">{draftError}</p>}
        </div>
      </Dialog>
    </Page>
  );
}

/** The detail sheet's body: identity, access, assignments, activity, then the actions. */
function PersonDetail({ row, companyName, me, canManage, platform, busy, error, onRole, onOff, onOn, onOpenBatches }: {
  row: TeamRow; companyName: string | null; me: User | null; canManage: boolean; platform: boolean;
  busy: boolean; error: string | null; onRole: (next: Role) => void; onOff: () => void; onOn: () => void;
  onOpenBatches: () => void;
}) {
  const { user } = row;
  const [nextRole, setNextRole] = useState<Role>(user.role);
  const willChange = canManage && !blocked(row) && nextRole !== user.role;
  const access = accessOf(nextRole);
  const isSelf = user.id === me?.id;
  const offered = assignableRoles(platform);

  return (
    <div className="space-y-5">
      <div>
        <SectionTitle>Identity</SectionTitle>
        <div className="mt-1.5">
          <Row label="Name" value={user.name} mono={false} />
          <Row label="Mobile" value={user.mobile} />
          <Row label="Status" value={user.active ? 'Active' : 'Switched off'} mono={false}
            valueClass={user.active ? 'text-success' : 'text-muted'} />
          {user.createdAt && <Row label="On the team since" value={fmtDate(user.createdAt.slice(0, 10))} mono={false} />}
        </div>
      </div>

      <div>
        <SectionTitle>Company</SectionTitle>
        <div className="mt-1.5">
          <Row label="Works at" value={companyName ?? '—'} mono={false} />
          <Row label="Role here" value={roleLabel(user.role)} mono={false} />
          {row.sharedElsewhere && (
            <p className="mt-2 flex items-start gap-1.5 rounded-ctl bg-sunk px-3 py-2 text-[11.5px] leading-relaxed text-ink-2">
              <Lock size={12} className="mt-0.5 shrink-0" />
              They work with more than one company, so their role and status are one fact for all of
              them — only the platform admin may change it.
            </p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle right={willChange
          ? <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-accent-ink">Preview of the new role</span>
          : undefined}>
          Access
        </SectionTitle>
        <div className="mt-2 space-y-3">
          {access.map(g => (
            <div key={g.title}>
              <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">{g.title}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {g.items.map(i => <PermissionChip key={i.label} active={i.on} label={i.label} />)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Assignments</SectionTitle>
        <div className="mt-1.5 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">Sheds</span>
            {row.sheds.length === 0
              ? <span className="text-[12.5px] text-muted">None — they hold no batch access here</span>
              : row.sheds.map(s => <Badge key={s.id} tone="neutral">{s.name}</Badge>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-2">Live batches</span>
            {row.liveBatches.length === 0
              ? <span className="text-[12.5px] text-muted">None</span>
              : row.liveBatches.map(b => <Badge key={b.id} tone="brand">{b.code}</Badge>)}
          </div>
          {row.grantedBatches > 0 && (
            <p className="text-[11.5px] text-muted">
              {row.grantedBatches} of their batches carr{row.grantedBatches === 1 ? 'ies' : 'y'} extra
              permissions beyond the role, granted batch by batch.
            </p>
          )}
          <button type="button" onClick={onOpenBatches}
            className="inline-flex items-center gap-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-brand press hover:underline">
            Manage batch access <ChevronRight size={13} />
          </button>
          <p className="text-[11px] leading-relaxed text-faint">
            Sheds follow from batch access: a person works the sheds the batches they are assigned to
            stand on. There is no separate shed list to keep in step with it.
          </p>
        </div>
      </div>

      <div>
        <SectionTitle>Activity</SectionTitle>
        <div className="mt-1.5">
          <Row label="Last recorded action" value={row.lastActivity ? fmtDateTime(row.lastActivity) : 'Nothing recorded here yet'}
            mono={false} />
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Read from this company's audit trail — the app keeps no login timestamps, so a sign-in
            with nothing written shows as nothing recorded rather than a made-up time.
          </p>
        </div>
      </div>

      {/* ---------- actions ---------- */}
      {isSelf ? (
        <Card>
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-brand" />
            This is your own account. Another owner of this company, or the platform admin, changes
            it — so a mistake here can never lock the farm out of its own admin.
          </p>
        </Card>
      ) : !canManage ? null : blocked(row) ? (
        <Card>
          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-2">
            <Lock size={14} className="mt-0.5 shrink-0 text-warn" />
            {row.blockReason}
          </p>
        </Card>
      ) : (
        <div>
          <SectionTitle>Change access</SectionTitle>
          <div className="mt-2 space-y-3">
            <SelectField label="Role" value={nextRole}
              hint="Their access updates the next time they open the app."
              onChange={e => setNextRole(e.target.value as Role)}
              options={[
                { value: user.role, label: `${ROLE_LABELS[user.role]} (current)` },
                ...offered.filter(r => r !== user.role).map(r => ({ value: r, label: ROLE_LABELS[r] })),
              ]} />
            {nextRole !== user.role && (
              <Button size="sm" loading={busy} onClick={() => onRole(nextRole)} icon={<ShieldCheck size={14} />}>
                Make them {ROLE_LABELS[nextRole]}
              </Button>
            )}
            <div className="flex items-center gap-2 border-t border-line-2 pt-3">
              {user.active ? (
                <Button size="sm" variant="outline" loading={busy} icon={<Power size={14} />} onClick={onOff}>
                  Deactivate
                </Button>
              ) : (
                <Button size="sm" variant="success" loading={busy} icon={<Power size={14} />} onClick={onOn}>
                  Reactivate
                </Button>
              )}
              <span className="text-[11.5px] text-muted">
                {user.active ? 'They keep every record they wrote.' : 'Their records and their place in this company stay.'}
              </span>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-[12px] font-semibold text-danger">{error}</p>}
    </div>
  );
}

/** What the role about to be handed out actually opens — read off the same navigation the
 *  person will see, so the owner chooses with the answer in front of them (§12). */
function AccessPreview({ role }: { role: Role }) {
  const groups = accessOf(role).filter(g => g.items.some(i => i.on));
  return (
    <div className="rounded-ctl border border-line bg-sunk/60 px-3 py-2.5">
      <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-2">
        {ROLE_LABELS[role]} opens
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {groups.flatMap(g => g.items.filter(i => i.on).map(i => (
          <span key={`${g.title}-${i.label}`}
            className="rounded-full bg-card px-2 py-0.5 text-[11px] text-ink-2 ring-1 ring-inset ring-line">
            {i.label}
          </span>
        )))}
      </div>
    </div>
  );
}
