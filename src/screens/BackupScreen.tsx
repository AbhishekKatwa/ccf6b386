import { useRef, useState } from 'react';
import {
  AlertTriangle, BadgeCheck, DatabaseBackup, Download, FileWarning,
  HardDriveDownload, Lock, ShieldCheck, Table2, Upload,
} from 'lucide-react';
import { useApp, useCan, useCompanyData } from '@/store/app';
import { Page, ScreenTitle } from '@/components/ui/Header';
import { Badge, Card, EmptyState, IconTile, ListRow } from '@/components/ui/Card';
import { Button } from '@/components/ui/Form';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { PageReveal, ScrollReveal } from '@/components/motion';
import { format } from 'date-fns';
import {
  CSV_GROUPS, SLICE_LABELS, backupFileName, csvFileName, parseBackup, recordsCsv,
  type BackupFile, type Issue, type Validation,
} from '@/lib/backup';

/**
 * One place to take a company's records out and put them back.
 *
 * Export is a read of what this role may already see. Restore is the dangerous half, so the
 * screen never writes on a file's arrival: the person picks a file, reads what it is, reads
 * exactly which rows would be added or changed, and only then confirms. A rejected file stops
 * with the reason on screen — it is never half-applied.
 */
export function BackupScreen() {
  const data = useCompanyData();
  const pushToast = useApp(s => s.pushToast);
  const exportCompanyBackup = useApp(s => s.exportCompanyBackup);
  const checkBackupFile = useApp(s => s.checkBackupFile);
  const restoreCompanyBackup = useApp(s => s.restoreCompanyBackup);
  const canRestore = useCan('delete');

  const [omitted, setOmitted] = useState<{ slice: string; reason: string }[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; json: unknown } | null>(null);
  const [v, setV] = useState<Validation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const download = (name: string, text: string, mime: string) => {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return true;
    } catch {
      pushToast('error', 'This browser blocked the download');
      return false;
    }
  };

  /** One build of the store, so every download carries the same company scope and the same role gate. */
  const build = (): BackupFile | null => {
    const answer = exportCompanyBackup();
    if (!answer.ok || !('file' in answer)) {
      pushToast('error', answer.error ?? 'This company cannot be exported');
      return null;
    }
    setOmitted(answer.omitted);
    return answer.file;
  };

  const onExport = () => {
    const f = build();
    if (!f) return;
    const iso = f.exportedAt || new Date().toISOString();
    if (download(backupFileName(f.company.id, iso), JSON.stringify(f, null, 2), 'application/json'))
      pushToast('success', 'Backup downloaded', `${Object.values(f.recordCounts).reduce((a, n) => a + n, 0)} records`);
  };

  const onCsv = (slice: string, title: string, columns: string[]) => {
    const f = build();
    if (!f) return;
    const rows = (f.records[slice] ?? []).filter(r => r);
    if (!rows.length) { pushToast('info', `No ${title.toLowerCase()} in this company yet`); return; }
    const name = csvFileName(f.company.id, slice, f.exportedAt || new Date().toISOString());
    if (download(name, recordsCsv(rows, columns), 'text/csv;charset=utf-8'))
      pushToast('success', `${name} downloaded`, `${rows.length} rows`);
  };

  const onPick = async (picked: File | undefined) => {
    if (!picked) return;
    setChecking(true); setCheckError(null); setV(null); setFile(null);
    try {
      const text = await picked.text();
      const parsed = parseBackup(text);
      if (!parsed.ok) { setCheckError(parsed.error); return; }
      setFile({ name: picked.name, json: parsed.json });
      setV(checkBackupFile(parsed.json));
    } catch {
      setCheckError('This file could not be read from disk.');
    } finally {
      setChecking(false);
      if (picker.current) picker.current.value = '';
    }
  };

  const onRestore = () => {
    if (!v?.restore) return;
    setRestoring(true);
    const summary = `Restored ${v.totals.add + v.totals.change} record(s) from ${file?.name ?? 'a backup file'}`;
    const answer = restoreCompanyBackup(v.restore, summary);
    setRestoring(false);
    setConfirming(false);
    if (!answer.ok) { pushToast('error', answer.error ?? 'The restore did not run'); return; }
    pushToast('success', 'Backup restored', `${v.totals.add} added, ${v.totals.change} updated`);
    setV(null); setFile(null);
  };

  const errors = (v?.issues ?? []).filter(i => i.level === 'error');
  const warnings = (v?.issues ?? []).filter(i => i.level === 'warning');

  return (
    <Page withNav>
      <PageReveal>
      <ScreenTitle
        eyebrow="Records"
        title="Backup & Recovery"
        subtitle={<>{data.companies.find(c => c.id === data.companyId)?.name ?? 'This farm'} · a file of this company's own records, and the checks a file must pass to come back</>}
      />

      <div className="px-4 sm:px-0 mt-1 space-y-5">
        {/* ============================= EXPORT ============================= */}
        <ScrollReveal>
        <Card>
          <div className="flex items-start gap-3">
            <IconTile><DatabaseBackup size={19} strokeWidth={1.9} /></IconTile>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[16px] font-semibold text-ink leading-tight">Export this company</h2>
              <p className="text-[12px] text-muted mt-0.5 leading-relaxed">
                Every record type your role can open, in the shapes the database itself holds. Money
                and people data you cannot read are left out and named below, and a person's
                password or a server credential is never carried in either direction.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <Button icon={<Download size={15} />} onClick={onExport}>Download JSON backup</Button>
            <p className="text-[11.5px] text-muted leading-relaxed self-center">
              The complete file — this is the one a restore reads.
            </p>
          </div>

          <div className="mt-4 rounded-[14px] bg-sunk px-3.5 py-3">
            <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              <Table2 size={12} /> Spreadsheets for accounting
            </p>
            <p className="text-[11.5px] text-muted mt-1 leading-relaxed">
              The same rows your role may see, one file per record type. A spreadsheet is for reading
              and handing to an accountant — it cannot be restored.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {CSV_GROUPS.map(g => (
                <Button key={g.slice} variant="outline" size="sm" icon={<Download size={13} />}
                  onClick={() => onCsv(g.slice, g.title, g.columns)}>
                  {g.title}
                </Button>
              ))}
            </div>
          </div>

          {omitted.length > 0 && (
            <ul className="mt-3 space-y-1">
              {omitted.map(o => (
                <li key={o.slice} className="flex items-start gap-2 text-[11.5px] text-accent-ink">
                  <Lock size={12} className="mt-[3px] shrink-0" />
                  <span>{SLICE_LABELS[o.slice] ?? o.slice} — {o.reason}.</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        </ScrollReveal>

        {/* ============================= RESTORE ============================= */}
        <ScrollReveal>
        <Card>
          <div className="flex items-start gap-3">
            <IconTile tone="accent"><HardDriveDownload size={19} strokeWidth={1.9} /></IconTile>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[16px] font-semibold text-ink leading-tight">Restore from a backup</h2>
              <p className="text-[12px] text-muted mt-0.5 leading-relaxed">
                Choose a file and nothing happens to the company yet: it is checked against the live
                records and shown to you row by row. A restore only ever adds records and updates ones
                that exist — <strong className="text-ink-2">it cannot delete anything</strong>, so a
                teammate's entry made after the export stays exactly where it is.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input ref={picker} type="file" accept="application/json,.json" className="hidden"
              onChange={e => void onPick(e.target.files?.[0])} />
            <Button variant="outline" icon={<Upload size={15} />} loading={checking}
              onClick={() => picker.current?.click()}>
              {checking ? 'Checking file…' : 'Choose backup file'}
            </Button>
            {file && <p className="font-mono text-[11px] text-muted truncate max-w-full tnum">{file.name}</p>}
          </div>

          {!canRestore && (
            <p className="mt-3 flex items-start gap-2 text-[11.5px] text-accent-ink leading-relaxed">
              <Lock size={12} className="mt-[3px] shrink-0" />
              <span>You can check a file and see what it holds, but restoring company data is an
                owner's action. Nothing here will write to the farm from your sign-in.</span>
            </p>
          )}

          {checkError && (
            <p className="mt-3 flex items-start gap-2 text-[12px] text-danger leading-relaxed">
              <FileWarning size={13} className="mt-[2px] shrink-0" /><span>{checkError}</span>
            </p>
          )}

          {v && <ValidationResult v={v} file={v.company} />}

          {v?.ok && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-center">
              <Button variant="danger" icon={<Upload size={15} />} disabled={!canRestore}
                loading={restoring} onClick={() => setConfirming(true)}>
                Restore {v.totals.add + v.totals.change} record(s)
              </Button>
              <p className="text-[11.5px] text-muted leading-relaxed">
                {errors.length === 0 ? 'This file passed every check.' : ''}
                {warnings.length > 0 && `${warnings.length} note(s) to read above.`}
              </p>
            </div>
          )}
        </Card>
        </ScrollReveal>

        {!v && !checkError && !checking && (
          <EmptyState
            icon={<ShieldCheck size={19} strokeWidth={1.75} />}
            title="Nothing staged"
            description="Export a file to keep this company's records, or choose one to see what restoring it would change before it changes anything."
          />
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        danger
        title="Restore this backup?"
        message={`This writes ${v?.totals.add ?? 0} new and ${v?.totals.change ?? 0} changed record(s) into ${v?.company?.name ?? 'this company'}, and the change is on the audit trail. Records the file does not mention are kept. Money rows are included — a payment already on record is never written twice.`}
        confirmLabel="Restore now"
        onConfirm={onRestore}
        onCancel={() => setConfirming(false)}
      />
      </PageReveal>
    </Page>
  );
}

/* ============================= PREVIEW ============================= */

function ValidationResult({ v, file }: { v: Validation; file: BackupFile['company'] | null }) {
  const blocked = v.issues.some(i => i.level === 'error');
  const nothingToWrite = !blocked && !v.ok;
  const tone = v.ok ? 'success' : blocked ? 'danger' : 'accent';
  const heading = v.ok ? 'This file can be restored'
    : blocked ? 'This file cannot be restored'
      : 'Nothing to restore';
  return (
    <div className="mt-4 space-y-3">
      {v.meta && file && (
        <div className="rounded-[14px] border border-line bg-canvas px-3.5 py-3">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">The file says</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
            <Line label="Company" value={`${file.name} (${file.id})`} />
            <Line label="Exported" value={v.meta.exportedAt ? format(new Date(v.meta.exportedAt), 'dd MMM yyyy, HH:mm') : 'not stated'} />
            <Line label="App version" value={v.meta.appVersion} />
            <Line label="Backup schema" value={`${v.meta.schemaVersion} · store v${v.meta.storeVersion || '?'}`} />
          </dl>
        </div>
      )}

      <div className={`flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 ${
        tone === 'success' ? 'bg-success-soft' : tone === 'danger' ? 'bg-danger-soft' : 'bg-accent-soft'}`}>
        {tone === 'success'
          ? <BadgeCheck size={15} className="text-success shrink-0 mt-[1px]" />
          : <AlertTriangle size={15} className={tone === 'danger' ? 'text-danger shrink-0 mt-[1px]' : 'text-accent-ink shrink-0 mt-[1px]'} />}
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${
            tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-accent-ink'}`}>
            {heading}
          </p>
          <p className="text-[11.5px] text-ink-2 mt-0.5 leading-relaxed">
            {v.ok
              ? `${v.totals.add} record(s) new, ${v.totals.change} changed, ${v.totals.same} already identical. ${v.totals.kept} record(s) the file does not mention stay untouched.`
              : blocked
                ? `Read the reason${v.issues.filter(i => i.level === 'error').length > 1 ? 's' : ''} below. Nothing has been written.`
                : nothingToWrite
                  ? 'Every record in this file already matches the company exactly, so writing it would change nothing.'
                  : ''}
          </p>
        </div>
      </div>

      {v.issues.length > 0 && (
        <div className="space-y-1.5">
          {v.issues.map((i, n) => <IssueRow key={`${i.code}-${n}`} issue={i} />)}
        </div>
      )}

      {v.plans.length > 0 && (
        <div className="overflow-hidden rounded-[14px] border border-line">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-sunk">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">What changes</p>
            <p className="font-mono text-[10px] text-muted tnum">{v.plans.length} record types</p>
          </div>
          {v.plans.map(p => (
            <ListRow
              key={p.slice}
              title={p.label}
              subtitle={`${p.fileRows} in the file · ${p.liveRows} live${p.money ? ' · money' : ''}`}
              trailing={
                <span className="flex items-center gap-1.5">
                  {p.money && <Badge tone="warn">₹</Badge>}
                  <span className="font-mono text-[11px] tnum text-ink-2">
                    {p.add === 0 && p.change === 0 ? 'no change' : `+${p.add} · ±${p.change}`}
                  </span>
                </span>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] uppercase tracking-[0.1em] text-muted">{label}</dt>
      <dd className="text-ink-2 truncate tnum">{value}</dd>
    </div>
  );
}

const ISSUE_ICON = {
  error: <AlertTriangle size={13} className="text-danger shrink-0 mt-[2px]" />,
  warning: <FileWarning size={13} className="text-accent-ink shrink-0 mt-[2px]" />,
};

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-[12px] px-3 py-2 ${
      issue.level === 'error' ? 'bg-danger-soft' : 'bg-accent-soft'}`}>
      {ISSUE_ICON[issue.level]}
      <p className="min-w-0 text-[11.5px] leading-relaxed text-ink-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted mr-1.5">{issue.code}</span>
        {issue.message}
      </p>
    </div>
  );
}
